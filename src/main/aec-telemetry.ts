/**
 * Measurement for the echo canceller, so its behaviour is a number and not a
 * guess.
 *
 * Every previous attempt at this failed the same way: the canceller was changed
 * and the only feedback was a transcript, which conflates alignment, filter
 * length, whether the far-end reference was being fed at all, and whether the
 * WASM module even initialised. All four have now been wrong at some point, and
 * two of them were wrong at the same time. A transcript cannot distinguish
 * them; these three numbers can.
 *
 *   ERLE      how much energy the canceller actually removed. If it is ~0dB the
 *             filter is not cancelling, whatever else looks right.
 *
 *   DELAY     where the echo actually sits relative to the reference we hand
 *             Speex. Must be positive (causal) and inside the filter length.
 *             This is the number that was silently wrong: the alignment came
 *             from a chunk index, so it was a per-session random offset.
 *
 *   COHERENCE how much of the mic is linearly explainable by the reference. It
 *             bounds what any linear canceller can achieve, so it separates
 *             "the filter is broken" from "this echo path is not cancellable".
 */

/** Report at most this often. The audio callback must not be a logging site. */
export const TELEMETRY_INTERVAL_MS = 5_000;

/** Analysis window. Long enough for a stable estimate, short enough to be live. */
export const TELEMETRY_WINDOW_MS = 2_000;

export interface AecReport {
  /** Energy removed by the canceller, dB. ~0 means it is doing nothing. */
  erleDb: number;
  /** Where the echo sits relative to the reference, ms. Negative is non-causal. */
  delayMs: number;
  /** Sharpness of the delay estimate. Below ~10 the delay is not trustworthy. */
  delayConfidence: number;
  /** Share of mic energy linearly explainable by the reference, 0..1. */
  coherence: number;
  /** Reference samples that were missing from the ring over the window. */
  referenceGapRatio: number;
  /** Mic energy over the window, dBFS. Silence makes every other number moot. */
  micLevelDb: number;
}

function energy(signal: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < signal.length; i += 1) sum += signal[i] * signal[i];
  return sum / Math.max(1, signal.length);
}

export function erleDb(before: Float32Array, after: Float32Array): number {
  const inputEnergy = energy(before);
  const outputEnergy = energy(after);
  if (inputEnergy <= 1e-12) return 0;
  if (outputEnergy <= 1e-12) return 60; // Fully cancelled; cap for readability.
  return 10 * Math.log10(inputEnergy / outputEnergy);
}

export function levelDb(signal: Float32Array): number {
  const e = energy(signal);
  return e <= 1e-12 ? -120 : 10 * Math.log10(e);
}

/** In-place iterative radix-2 FFT. `re`/`im` must have power-of-two length. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function nextPowerOfTwo(value: number): number {
  let n = 1;
  while (n < value) n <<= 1;
  return n;
}

/**
 * Delay of `captured` relative to `reference`, by cross-correlation with a
 * phase transform.
 *
 * PHAT whitens the cross-spectrum, which removes the bias the reference's own
 * spectrum would otherwise put on the peak. The same method recovered the delay
 * exactly on real hardware in the offline rig, including at lags that a plain
 * correlation got wrong.
 *
 * A positive result means the echo lags the reference, which is the physical
 * case and the causal one. A negative result means we are handing Speex a
 * reference that arrives after the echo it is supposed to cancel - unfixable by
 * adaptation, and precisely the failure that shipped.
 */
export function estimateDelay(
  reference: Float32Array,
  captured: Float32Array,
  maxLagSamples: number,
): { lagSamples: number; confidence: number } {
  const n = nextPowerOfTwo(Math.max(reference.length, captured.length) * 2);
  const refRe = new Float64Array(n);
  const refIm = new Float64Array(n);
  const capRe = new Float64Array(n);
  const capIm = new Float64Array(n);
  refRe.set(reference);
  capRe.set(captured);

  fft(refRe, refIm);
  fft(capRe, capIm);

  // Cross-spectrum captured * conj(reference), magnitude-normalised.
  const crossRe = new Float64Array(n);
  const crossIm = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const re = capRe[i] * refRe[i] + capIm[i] * refIm[i];
    const im = capIm[i] * refRe[i] - capRe[i] * refIm[i];
    const mag = Math.hypot(re, im) + 1e-12;
    crossRe[i] = re / mag;
    crossIm[i] = im / mag;
  }
  // Inverse transform via conjugation, which avoids a second implementation.
  for (let i = 0; i < n; i += 1) crossIm[i] = -crossIm[i];
  fft(crossRe, crossIm);

  let peakIndex = 0;
  let peakValue = -Infinity;
  let absSum = 0;
  const searchLimit = Math.min(maxLagSamples, n >> 1);
  for (let i = 0; i < searchLimit; i += 1) {
    const value = crossRe[i] / n;
    absSum += Math.abs(value);
    if (value > peakValue) {
      peakValue = value;
      peakIndex = i;
    }
  }
  const mean = absSum / Math.max(1, searchLimit);
  return {
    lagSamples: peakIndex,
    confidence: mean <= 1e-12 ? 0 : peakValue / mean,
  };
}

/**
 * Share of `captured` linearly explainable by `reference`, 0..1.
 *
 * Computed as squared normalised cross-correlation at the best lag, which is
 * the time-domain equivalent of averaged coherence and avoids needing a
 * spectral estimator here. It bounds what any linear canceller can remove:
 * a low value means the path is not linear and a better filter will not help.
 */
export function linearExplainability(
  reference: Float32Array,
  captured: Float32Array,
  lagSamples: number,
): number {
  let dot = 0;
  let refEnergy = 0;
  let capEnergy = 0;
  for (let i = 0; i + lagSamples < captured.length && i < reference.length; i += 1) {
    const r = reference[i];
    const c = captured[i + lagSamples];
    dot += r * c;
    refEnergy += r * r;
    capEnergy += c * c;
  }
  if (refEnergy <= 1e-12 || capEnergy <= 1e-12) return 0;
  const correlation = dot / Math.sqrt(refEnergy * capEnergy);
  return Math.min(1, correlation * correlation);
}

/**
 * Accumulates a window of audio and reports periodically.
 *
 * Deliberately does no logging itself: the audio callback is not a logging
 * site, and console capture adds jitter to the very timing the alignment
 * depends on. It returns a report when one is due and null otherwise.
 */
export class AecTelemetry {
  private readonly sampleRate: number;
  private readonly windowSamples: number;
  private micBefore: number[] = [];
  private micAfter: number[] = [];
  private reference: number[] = [];
  private missingReferenceSamples = 0;
  private lastReportAtMs = 0;

  constructor(sampleRate: number, windowMs: number = TELEMETRY_WINDOW_MS) {
    this.sampleRate = sampleRate;
    this.windowSamples = Math.round((windowMs / 1000) * sampleRate);
  }

  record(
    before: Float32Array,
    after: Float32Array,
    reference: Float32Array,
    missingSamples: number,
  ): void {
    for (let i = 0; i < before.length; i += 1) this.micBefore.push(before[i]);
    for (let i = 0; i < after.length; i += 1) this.micAfter.push(after[i]);
    for (let i = 0; i < reference.length; i += 1) this.reference.push(reference[i]);
    this.missingReferenceSamples += missingSamples;

    const excess = this.micBefore.length - this.windowSamples;
    if (excess > 0) {
      this.micBefore.splice(0, excess);
      this.micAfter.splice(0, excess);
      this.reference.splice(0, excess);
    }
  }

  /** A report when one is due and the window is full, otherwise null. */
  report(nowMs: number, maxLagSamples: number): AecReport | null {
    if (this.micBefore.length < this.windowSamples) return null;
    if (nowMs - this.lastReportAtMs < TELEMETRY_INTERVAL_MS) return null;
    this.lastReportAtMs = nowMs;

    const before = Float32Array.from(this.micBefore);
    const after = Float32Array.from(this.micAfter);
    const reference = Float32Array.from(this.reference);

    const { lagSamples, confidence } = estimateDelay(reference, before, maxLagSamples);
    const gapRatio = this.missingReferenceSamples / Math.max(1, this.windowSamples);
    this.missingReferenceSamples = 0;

    return {
      erleDb: erleDb(before, after),
      delayMs: (lagSamples / this.sampleRate) * 1000,
      delayConfidence: confidence,
      coherence: linearExplainability(reference, before, lagSamples),
      referenceGapRatio: gapRatio,
      micLevelDb: levelDb(before),
    };
  }
}

/** One-line summary, plus the reading that says what to do about it. */
export function describeReport(report: AecReport): string {
  const parts = [
    `erle=${report.erleDb.toFixed(1)}dB`,
    `delay=${report.delayMs.toFixed(0)}ms`,
    `conf=${report.delayConfidence.toFixed(0)}x`,
    `coh=${report.coherence.toFixed(3)}`,
    `refGap=${(report.referenceGapRatio * 100).toFixed(0)}%`,
    `mic=${report.micLevelDb.toFixed(0)}dBFS`,
  ];

  let verdict: string;
  if (report.micLevelDb < -60) {
    verdict = 'mic silent - other numbers are meaningless';
  } else if (report.referenceGapRatio > 0.25) {
    verdict = 'REFERENCE MISSING - the canceller has no far-end signal';
  } else if (report.delayConfidence < 10) {
    verdict = 'no echo detectable in the mic (good, or nothing is playing)';
  } else if (report.coherence < 0.2) {
    verdict = 'echo present but not linear - a better filter will not fix it';
  } else if (report.erleDb < 3) {
    verdict = 'ECHO PRESENT AND CANCELLABLE, BUT NOT BEING CANCELLED';
  } else if (report.erleDb < 10) {
    verdict = 'cancelling partially';
  } else {
    verdict = 'cancelling well';
  }
  return `[AEC] ${parts.join(' ')} -> ${verdict}`;
}
