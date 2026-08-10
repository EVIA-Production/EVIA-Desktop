/**
 * Sample-accurate reference alignment for acoustic echo cancellation.
 *
 * WHY THIS EXISTS
 * ---------------
 * An echo canceller subtracts an estimate of the far end from the microphone.
 * It can only do that if the reference it is given lines up in time with the
 * echo actually present in the mic. Everything here is about producing that
 * alignment; the cancellation itself is Speex's job.
 *
 * The previous pipeline aligned by picking a whole chunk out of a list:
 *
 *     const AEC_DELAY_CHUNKS = Math.max(1, Math.round(AEC_LATENCY_MS / 100))
 *     const referenceChunk = systemAudioBuffer[length - 1 - AEC_DELAY_CHUNKS]
 *
 * That has four separate problems, and each one alone is fatal:
 *
 *   1. Chunks are 100ms, so alignment could only ever be a multiple of 100ms.
 *   2. It delayed the reference by 100ms while the real acoustic delay,
 *      measured on this hardware, is 60.3ms. The echo therefore arrived
 *      *before* the reference, and a causal filter cannot model negative delay.
 *   3. Within a chunk, mic sample n was paired with reference sample n, so
 *      sub-chunk alignment did not exist at all.
 *   4. Mic and system audio are captured by two independent AudioContexts with
 *      independent start times, so the phase between their chunk streams is an
 *      arbitrary value in [0, 100)ms - fixed per session, different every time.
 *
 * Together those mean the reference was misaligned by a per-session random
 * amount, which is why cancellation appeared to work sometimes and not others.
 *
 * THE FIX
 * -------
 * Keep reference audio as one continuous sample stream, positioned on the wall
 * clock that both capture callbacks share (`performance.now()`), and read the
 * window that actually corresponds to a given mic chunk. Callback jitter is
 * real, so the window deliberately starts a little BEFORE the echo: a reference
 * that leads is something a causal filter can handle by learning leading zero
 * taps, whereas a reference that lags is unrecoverable.
 *
 * The adaptive filter then has to span LEAD + acoustic delay + reverb tail,
 * which is what sets the filter length in the caller.
 */

/** The pipeline's capture rate. Both captures are opened at this rate. */
export const AEC_SAMPLE_RATE = 24_000;

/**
 * Why there is no lead, and why pre-compensating the delay would be wrong.
 *
 * Speex keeps its own history of reference frames and searches for the echo
 * inside `filterLength`. Writing d for the acoustic delay and δ for our
 * alignment error - δ > 0 meaning we hand it reference from later than the mic
 * frame - the echo sits at (d + δ) inside that history. So:
 *
 *     causality   δ ≥ -d          the echo must not precede the history
 *     capacity    filterLength ≥ d + δ + reverb tail
 *
 * The correct reference is therefore the CONTEMPORANEOUS window, δ = 0, and the
 * delay is something Speex finds by itself. An earlier draft of this file read
 * the window at (micPosition - delay - lead) on the theory that the reference
 * should be pre-aligned to the echo. That is δ = -(d + lead) = -180ms, which
 * violates causality by a wide margin - the exact failure it was written to
 * avoid. The unit tests caught it; the arithmetic above is why.
 *
 * A positive lead cannot be manufactured anyway: it would mean reading
 * reference samples that have not been captured yet.
 */
export const REFERENCE_LEAD_MS = 0;

/**
 * Acoustic delay from speaker to microphone.
 *
 * Measured on a MacBook Air with built-in speakers and built-in mic on
 * 2026-08-09: 60.3ms, with a cross-correlation peak 1097x the mean, so this is
 * a solid number for the scoped hardware rather than an assumption. The filter
 * is sized to absorb a substantial error here regardless.
 */
export const ACOUSTIC_DELAY_MS = 60;

/**
 * Compatibility fallback for helper binaries that do not expose the real
 * ScreenCaptureKit presentation timestamp.
 *
 * This used to decide whether cancellation was possible at all. Current macOS
 * helpers send `capturedAtUnixMs`; the renderer uses this constant only when
 * that field is absent or invalid.
 *
 * A chunk of far-end audio is timestamped when it reaches the renderer, but it
 * was captured earlier - the helper buffered it, ScreenCaptureKit buffered it
 * before that, and it crossed an IPC boundary. Only the first chunk's stamp
 * matters, since every later position is derived by counting samples, so this
 * is one constant offset for the whole session.
 *
 * Write L for the true latency and A for this assumption. The reference window
 * handed to the canceller ends up (L - A) OLDER than the microphone window, and
 * the causality rule from REFERENCE_LEAD_MS says that has to stay under the
 * acoustic delay:
 *
 *     L - A <= 60ms          or the echo precedes the whole reference history
 *
 * Underestimating is therefore fatal and overestimating is merely expensive:
 * assuming too much latency makes the reference NEWER than the mic window,
 * which just adds to the lag AEC3 has to search. Measured on the bench, AEC3
 * tracks a total render-to-capture lag of 500ms and collapses somewhere between
 * 500 and 650ms, so 60ms of acoustic delay plus this leaves a wide margin.
 *
 * The stamp was previously `performance.now()` with no correction at all on the
 * macOS path, i.e. A = 0. Any helper latency above 60ms then made the echo
 * non-causal, and the bench shows exactly what that looks like: 42dB of
 * cancellation at -60ms of skew, 2.9dB at -120ms. It is a cliff, not a slope.
 *
 * A production capture on 2026-08-10 falsified the original 120ms estimate:
 * far-end-only windows retained a stable -55..-70ms residual offset (the
 * reference arrived after the echo) and achieved only 0.3..1.7dB attenuation.
 * With the measured 60ms acoustic path, that implies about 235..250ms of helper
 * latency. Using 240ms moves the same windows to a causal +50..65ms delay, where
 * AEC3 has real history to adapt against. The mic reserve is 400ms, covering the
 * 100ms window plus this assumption with 60ms to spare.
 */
export const SYSTEM_CAPTURE_ASSUMED_LATENCY_MS = 240;

/**
 * Residual alignment error the filter must still absorb.
 *
 * Each side derives its clock origin from a callback timestamp. Chunks are cut
 * at 2400 samples while the ScriptProcessor delivers 2048, so a naive stamp
 * carries up to 2048/24000 = 85ms of unknown constant error per side. The
 * pipeline removes most of that by subtracting the samples still pending when a
 * chunk is cut, but capture-path latency that differs between the microphone
 * and the system loopback cannot be measured from here. Budget for it, since a
 * positive error only costs filter length while a negative one costs causality.
 */
export const ALIGNMENT_SKEW_MARGIN_MS = 85;

/** Reverb tail of a normal room. Beyond this the echo is below the noise. */
export const REVERB_TAIL_MS = 150;

/**
 * Reference history retained. Must comfortably exceed delay + skew + one chunk
 * so a late mic callback can still find its reference.
 */
export const REFERENCE_HISTORY_MS = 2_000;

const MS_PER_SECOND = 1000;

function msToSamples(ms: number, sampleRate: number): number {
  return Math.round((ms / MS_PER_SECOND) * sampleRate);
}

export interface ReferenceReadResult {
  samples: Float32Array;
  /** Samples that fell outside retained history and were zero-filled. */
  missingSamples: number;
}

/**
 * Continuous reference audio, addressable by wall-clock time.
 *
 * Positions are absolute sample counts since the ring was created, which keeps
 * the arithmetic exact - converting back and forth through timestamps per
 * sample would accumulate rounding.
 */
export class ReferenceRing {
  private readonly capacity: number;
  private readonly buffer: Float32Array;
  private readonly sampleRate: number;

  /** Absolute index one past the newest sample written. */
  private writeCursor = 0;
  /** Wall-clock ms corresponding to absolute sample 0. Set on first write. */
  private originMs: number | null = null;

  constructor(sampleRate: number = AEC_SAMPLE_RATE, historyMs: number = REFERENCE_HISTORY_MS) {
    this.sampleRate = sampleRate;
    this.capacity = msToSamples(historyMs, sampleRate);
    this.buffer = new Float32Array(this.capacity);
  }

  /**
   * Append a captured reference chunk.
   *
   * `capturedAtMs` is when the chunk's FIRST sample was captured, on the same
   * clock the mic callback uses. The origin is established once, from the first
   * chunk, and every later position is derived by counting samples - so a
   * jittery timestamp on chunk 900 cannot shift the stream underneath a filter
   * that has already converged to a delay.
   */
  write(samples: Float32Array, capturedAtMs: number): void {
    if (samples.length === 0) return;
    if (this.originMs === null) this.originMs = capturedAtMs;

    for (let i = 0; i < samples.length; i += 1) {
      this.buffer[(this.writeCursor + i) % this.capacity] = samples[i];
    }
    this.writeCursor += samples.length;
  }

  /**
   * Forget everything, including the clock origin.
   *
   * The origin is per session. Carrying one across sessions would position the
   * next call's mic against the previous call's timeline - the same class of
   * misalignment this whole module exists to remove.
   */
  reset(): void {
    this.buffer.fill(0);
    this.writeCursor = 0;
    this.originMs = null;
  }

  /**
   * Has every sample up to `position` been written yet?
   *
   * A microphone chunk cannot be cancelled until the far-end audio covering it
   * exists. Measured offline against the live timeline: asking for a chunk's
   * reference the moment the chunk is cut leaves 2184 of its 2400 samples
   * unwritten, because those samples are still being captured. The canceller
   * was then skipped for 91% of chunks - silently, since a skipped chunk
   * records no telemetry, which is why the live logs reported refGap=0%.
   */
  hasWrittenThrough(position: number): boolean {
    return this.originMs !== null && position <= this.writeCursor;
  }

  /** Absolute sample index for a wall-clock instant, or null before any write. */
  positionAt(timestampMs: number): number | null {
    if (this.originMs === null) return null;
    return Math.round(((timestampMs - this.originMs) / MS_PER_SECOND) * this.sampleRate);
  }

  get samplesWritten(): number {
    return this.writeCursor;
  }

  get hasData(): boolean {
    return this.originMs !== null && this.writeCursor > 0;
  }

  /**
   * Read `length` samples starting at absolute position `start`.
   *
   * Positions outside retained history read as silence rather than as stale
   * audio: feeding the canceller a reference that is simply wrong is worse than
   * feeding it nothing, because the filter adapts to the wrong signal and then
   * has to un-learn it.
   */
  read(start: number, length: number): ReferenceReadResult {
    const samples = new Float32Array(length);
    if (this.originMs === null) return { samples, missingSamples: length };

    const oldestAvailable = Math.max(0, this.writeCursor - this.capacity);
    let missingSamples = 0;

    for (let i = 0; i < length; i += 1) {
      const position = start + i;
      if (position < oldestAvailable || position >= this.writeCursor) {
        missingSamples += 1;
        continue;
      }
      samples[i] = this.buffer[((position % this.capacity) + this.capacity) % this.capacity];
    }
    return { samples, missingSamples };
  }

  /**
   * The reference window contemporaneous with a mic chunk.
   *
   * Deliberately not shifted by the acoustic delay: Speex locates the echo
   * inside its own filter history, so handing it a pre-delayed window only
   * moves the echo toward - and past - the non-causal edge. See the note on
   * REFERENCE_LEAD_MS for the derivation.
   */
  referenceFor(micCapturedAtMs: number, length: number): ReferenceReadResult {
    const micPosition = this.positionAt(micCapturedAtMs);
    if (micPosition === null) {
      return { samples: new Float32Array(length), missingSamples: length };
    }
    return this.read(micPosition, length);
  }
}

/**
 * Filter length needed to span the whole echo path, in samples.
 *
 * The adaptive filter has to cover everything between the first sample of the
 * reference window and the last of the echo: the lead, the acoustic delay, and
 * the room's reverb tail. The previous configuration used 1600 taps - 66.7ms -
 * against a 60.3ms delay, so essentially the entire filter was consumed by pure
 * delay and there was nothing left to model the room with.
 */
export function requiredFilterSamples(
  sampleRate: number = AEC_SAMPLE_RATE,
  acousticDelayMs: number = ACOUSTIC_DELAY_MS,
  skewMarginMs: number = ALIGNMENT_SKEW_MARGIN_MS,
  reverbTailMs: number = REVERB_TAIL_MS,
): number {
  return msToSamples(acousticDelayMs + skewMarginMs + reverbTailMs, sampleRate);
}
