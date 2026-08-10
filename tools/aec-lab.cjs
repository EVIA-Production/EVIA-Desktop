/**
 * Measurement primitives for echo cancellation.
 *
 * The previous session lost most of a day to fixes that could not have worked,
 * because the only feedback available was a transcript and a metric that
 * conflated two different failures. Everything here exists to make a claim
 * about the canceller checkable in seconds, offline, with the right answer
 * known by construction.
 *
 * The one metric lesson worth stating up front: never measure the residual echo
 * as `output - near`. When a canceller attenuates the near end, that difference
 * is dominated by the missing near end, and the number it produces looks like
 * enormous residual echo. The old bench reported "ERLE -17dB" for a canceller
 * that was mostly just turning the rep down. Measure echo on material that
 * contains ONLY echo, and measure near-end damage on material that contains
 * ONLY the near end. That is why the scenarios below are built in regions.
 */

const fs = require('node:fs');

// ─────────────────────────────────────────────────────────────────────────────
// WAV I/O
// ─────────────────────────────────────────────────────────────────────────────

/** Read a mono/interleaved WAV (PCM16 or float32) and return mono float32. */
function readWav(path) {
  const buf = fs.readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }

  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = buf.subarray(pos + 8, pos + 8 + size);
    if (id === 'fmt ') {
      fmt = {
        format: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        rate: body.readUInt32LE(4),
        bits: body.readUInt16LE(14),
      };
    } else if (id === 'data') {
      data = body;
    }
    pos += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error(`${path}: missing fmt or data chunk`);

  const { channels, bits, format } = fmt;
  const isFloat = format === 3;
  const bytesPerSample = bits / 8;
  const frames = Math.floor(data.length / (bytesPerSample * channels));
  const out = new Float32Array(frames);

  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      const at = (f * channels + c) * bytesPerSample;
      sum += isFloat ? data.readFloatLE(at) : data.readInt16LE(at) / 32768;
    }
    out[f] = sum / channels;
  }
  return { samples: out, rate: fmt.rate };
}

/** Write mono float32 as a 16-bit PCM WAV - the format Deepgram is fed. */
function writeWav(path, samples, rate) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path, buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// FFT — needed for convolution (a 300ms room response over 30s of audio is
// 5 billion multiply-accumulates done directly) and for coherence.
// ─────────────────────────────────────────────────────────────────────────────

/** In-place iterative radix-2 complex FFT. `re`/`im` length must be a power of 2. */
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) { re[i] /= n; im[i] /= n; }
  }
}

const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

/** Overlap-add FFT convolution. Returns `signal.length` samples (the causal part). */
function convolve(signal, impulse) {
  const h = impulse.length;
  const fftSize = nextPow2(Math.max(h * 4, 4096));
  const hop = fftSize - h + 1;

  const hr = new Float64Array(fftSize);
  const hi = new Float64Array(fftSize);
  hr.set(impulse);
  fft(hr, hi);

  const out = new Float64Array(signal.length + h);
  const xr = new Float64Array(fftSize);
  const xi = new Float64Array(fftSize);

  for (let start = 0; start < signal.length; start += hop) {
    xr.fill(0); xi.fill(0);
    const len = Math.min(hop, signal.length - start);
    for (let i = 0; i < len; i += 1) xr[i] = signal[start + i];
    fft(xr, xi);
    for (let i = 0; i < fftSize; i += 1) {
      const rr = xr[i] * hr[i] - xi[i] * hi[i];
      const ii = xr[i] * hi[i] + xi[i] * hr[i];
      xr[i] = rr; xi[i] = ii;
    }
    fft(xr, xi, true);
    const upto = Math.min(fftSize, out.length - start);
    for (let i = 0; i < upto; i += 1) out[start + i] += xr[i];
  }
  return Float32Array.from(out.subarray(0, signal.length));
}

// ─────────────────────────────────────────────────────────────────────────────
// The acoustic path
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic uniform noise - reproducible scenarios matter more than entropy. */
function makeRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

/** Biquad, applied to the impulse response (the speaker's colouration is linear). */
function biquad(signal, { b0, b1, b2, a1, a2 }) {
  const out = new Float32Array(signal.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i += 1) {
    const x = signal[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}

function highpass(signal, rate, freq, q = 0.707) {
  const w = (2 * Math.PI * freq) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const cw = Math.cos(w);
  const a0 = 1 + alpha;
  return biquad(signal, {
    b0: ((1 + cw) / 2) / a0, b1: (-(1 + cw)) / a0, b2: ((1 + cw) / 2) / a0,
    a1: (-2 * cw) / a0, a2: (1 - alpha) / a0,
  });
}

function lowpass(signal, rate, freq, q = 0.707) {
  const w = (2 * Math.PI * freq) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const cw = Math.cos(w);
  const a0 = 1 + alpha;
  return biquad(signal, {
    b0: ((1 - cw) / 2) / a0, b1: (1 - cw) / a0, b2: ((1 - cw) / 2) / a0,
    a1: (-2 * cw) / a0, a2: (1 - alpha) / a0,
  });
}

/**
 * A laptop speaker-to-microphone impulse response.
 *
 * Built rather than measured so the right answer is known, but shaped to match
 * what was measured on the target hardware: 60ms of bulk delay, a strong direct
 * path, a handful of early reflections off the screen and desk, and a diffuse
 * tail. The band limits matter - a MacBook's speakers have no output below
 * ~300Hz, so a canceller that only has to model 300Hz-10kHz is the real problem.
 */
function makeRoomImpulse({ rate, delayMs = 60, rt60Ms = 150, seed = 4242 }) {
  const delay = Math.round((delayMs / 1000) * rate);
  const tail = Math.round((rt60Ms / 1000) * rate);
  const ir = new Float32Array(delay + tail + 1);
  const rand = makeRandom(seed);

  ir[delay] = 1.0;
  // Early reflections: screen, desk, body. Timing in ms, gain relative to direct.
  for (const [ms, gain] of [[1.4, 0.52], [3.1, -0.38], [5.7, 0.27], [9.3, -0.19], [14.6, 0.13]]) {
    const at = delay + Math.round((ms / 1000) * rate);
    if (at < ir.length) ir[at] += gain;
  }
  // Diffuse exponentially-decaying tail.
  for (let i = 0; i < tail; i += 1) {
    const t = i / rate;
    const decay = Math.exp((-6.9078 * t) / (rt60Ms / 1000));
    ir[delay + i] += (rand() * 2 - 1) * 0.22 * decay;
  }

  return lowpass(highpass(ir, rate, 300), rate, 9000);
}

/** Scale an impulse response so the echo it produces sits `erlDb` below the far end. */
function scaleToErl(ir, far, erlDb) {
  const echo = convolve(far, ir);
  const gain = Math.sqrt(energy(far) / Math.max(energy(echo), 1e-20)) * Math.pow(10, -erlDb / 20);
  return Float32Array.from(ir, (v) => v * gain);
}

/**
 * Loudspeaker overdrive.
 *
 * Small drivers compress before they clip. This is the part of the echo no
 * linear filter can remove, and the reason a residual suppressor exists at all.
 * `drive` of 1 is effectively linear; 4 is a laptop at an uncomfortable volume.
 */
function saturate(signal, drive) {
  if (drive <= 1) return signal;
  return Float32Array.from(signal, (v) => Math.tanh(v * drive) / drive);
}

/**
 * Resample by an exact ratio with cubic interpolation.
 *
 * Used to model clock drift: the speaker's DAC and the microphone's ADC are
 * different clocks, so over a long call the echo slowly slides against the
 * reference. Production pairs a ScreenCaptureKit helper against getUserMedia,
 * which have never been measured against each other - so this is a budgeted
 * risk, not a known quantity, and the canceller must survive it.
 */
function resampleRatio(signal, ratio) {
  const n = Math.floor(signal.length / ratio);
  const out = new Float32Array(n);
  const at = (i) => (i < 0 || i >= signal.length ? 0 : signal[i]);
  for (let i = 0; i < n; i += 1) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const t = x - i0;
    const p0 = at(i0 - 1), p1 = at(i0), p2 = at(i0 + 1), p3 = at(i0 + 2);
    // Catmull-Rom
    out[i] = 0.5 * ((2 * p1) + (-p0 + p2) * t
      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
      + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────────

function energy(a, from = 0, to = a.length) {
  let s = 0;
  for (let i = from; i < to; i += 1) s += a[i] * a[i];
  return s / Math.max(1, to - from);
}

const db = (x) => 10 * Math.log10(Math.max(x, 1e-20));
const levelDb = (a, from, to) => db(energy(a, from, to));

/**
 * Magnitude-squared coherence between two signals, averaged over a band.
 *
 * This is the ceiling on what ANY linear canceller can achieve: a coherence of
 * c bounds cancellation at -10*log10(1-c). Measuring it on real captured audio
 * says whether a disappointing ERLE is the canceller's fault or the path's.
 */
// 8192 samples is 341ms at 24kHz, comfortably longer than the ~210ms room
// response. A window shorter than the impulse response spreads each echo across
// frame boundaries and understates coherence badly - a 2048 window scored 0.783
// for a path that measures 0.97 with a window that actually contains it.
function coherence(x, y, rate, { fftSize = 8192, loHz = 300, hiHz = 3400, lag = 0 } = {}) {
  // The bulk delay must come out first. A 60ms delay inside an 85ms analysis
  // window leaves only 25ms of overlap, and the estimate collapses towards zero
  // for a path that is in fact almost perfectly linear - measuring 0.013 for a
  // path whose true coherence is 0.98. `lag` advances y against x by that many
  // samples before the comparison.
  if (lag > 0) y = y.subarray(lag);
  else if (lag < 0) x = x.subarray(-lag);

  const hop = fftSize / 2;
  const win = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i += 1) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);

  const bins = fftSize / 2;
  const pxx = new Float64Array(bins);
  const pyy = new Float64Array(bins);
  const pxyR = new Float64Array(bins);
  const pxyI = new Float64Array(bins);

  const n = Math.min(x.length, y.length);
  let frames = 0;
  const xr = new Float64Array(fftSize), xi = new Float64Array(fftSize);
  const yr = new Float64Array(fftSize), yi = new Float64Array(fftSize);

  for (let start = 0; start + fftSize <= n; start += hop) {
    for (let i = 0; i < fftSize; i += 1) {
      xr[i] = x[start + i] * win[i]; xi[i] = 0;
      yr[i] = y[start + i] * win[i]; yi[i] = 0;
    }
    fft(xr, xi); fft(yr, yi);
    for (let k = 0; k < bins; k += 1) {
      pxx[k] += xr[k] * xr[k] + xi[k] * xi[k];
      pyy[k] += yr[k] * yr[k] + yi[k] * yi[k];
      pxyR[k] += xr[k] * yr[k] + xi[k] * yi[k];
      pxyI[k] += xi[k] * yr[k] - xr[k] * yi[k];
    }
    frames += 1;
  }
  if (frames === 0) return 0;

  const loBin = Math.max(1, Math.floor((loHz / rate) * fftSize));
  const hiBin = Math.min(bins - 1, Math.ceil((hiHz / rate) * fftSize));
  let sum = 0;
  let count = 0;
  for (let k = loBin; k <= hiBin; k += 1) {
    const denom = pxx[k] * pyy[k];
    if (denom <= 1e-30) continue;
    sum += (pxyR[k] * pxyR[k] + pxyI[k] * pxyI[k]) / denom;
    count += 1;
  }
  return count ? sum / count : 0;
}

/**
 * Bulk delay between two signals, by normalised cross-correlation.
 *
 * Returns the lag in samples at which `y` best matches `x`, positive meaning y
 * lags x. Used to verify alignment on real captures rather than trusting a
 * timestamp. The search is done directly rather than by FFT because the range
 * that matters here is short and the code being obviously correct matters more
 * than it being fast.
 */
function bestLag(x, y, maxLag, { window = 5 * 24000, stride = 8 } = {}) {
  let best = 0;
  let bestScore = -Infinity;
  const n = Math.min(x.length, y.length, window + maxLag);
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let dot = 0;
    let yy = 0;
    for (let i = 0; i + lag < n; i += stride) {
      const yv = y[i + lag];
      dot += x[i] * yv;
      yy += yv * yv;
    }
    // Normalised by the lagged signal's energy only: x is fixed across lags, so
    // dividing by it would not change which lag wins, and leaving it out keeps
    // the inner loop short.
    const score = dot / Math.sqrt(Math.max(yy, 1e-20));
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  return best;
}

/**
 * How much of `source` survives in `out`, in dB, by least-squares projection.
 *
 * Double talk is the one case where echo and near end cannot be measured on
 * separate material - by definition they overlap. Two approaches were tried and
 * are both wrong: comparing `out` to `near` charges residual echo to near-end
 * damage, and differencing two runs (near+echo vs near alone) is dominated by
 * the suppressor applying different time-varying gain in each run, which
 * reported the residual as 7dB LOUDER than the echo going in.
 *
 * This works because the rep's speech and the prospect's speech are
 * uncorrelated. Projecting the output onto each source recovers that source's
 * surviving gain and ignores the other:
 *
 *     out ~ g_near * near + g_echo * echo + (uncorrelated rest)
 *     g = <out, source> / <source, source>
 *
 * so `-20log10(g_echo)` is the echo attenuation actually achieved with the rep
 * talking, and `20log10(g_near)` is what it cost the rep. The caveat, stated
 * rather than hidden: a residual whose spectrum differs from the source's is
 * only partly captured, and nonlinear distortion products appear in neither
 * number. The transcript test is the arbiter; this is the instrument.
 */
function projectGainDb(out, source, from, to, { searchLag = 600 } = {}) {
  let bestLag = 0;
  let bestCorr = -Infinity;
  let bestGain = 0;

  for (let lag = 0; lag <= searchLag; lag += 1) {
    let dot = 0, ss = 0, oo = 0;
    for (let i = from; i < to; i += 1) {
      const s = source[i];
      const o = out[i + lag] || 0;
      dot += o * s; ss += s * s; oo += o * o;
    }
    if (ss <= 1e-20 || oo <= 1e-20) continue;
    const corr = Math.abs(dot / Math.sqrt(ss * oo));
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; bestGain = dot / ss; }
  }
  return { gainDb: 20 * Math.log10(Math.max(Math.abs(bestGain), 1e-10)), lag: bestLag, corr: bestCorr };
}

module.exports = {
  readWav, writeWav,
  fft, convolve, nextPow2,
  makeRoomImpulse, scaleToErl, saturate, resampleRatio, makeRandom,
  highpass, lowpass,
  energy, db, levelDb, coherence, bestLag, projectGainDb,
};
