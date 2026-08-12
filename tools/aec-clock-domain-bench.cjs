/**
 * Does the clock-domain fix actually cancel echo, through the REAL path?
 *
 *     node tools/aec-clock-domain-bench.cjs
 *
 * The unit tests prove the arithmetic and `aec-bench.cjs` proves the canceller
 * in isolation, handed a perfectly aligned reference. Neither proves the thing
 * that actually broke in production: the reference reaching AEC3 through the
 * ring, looked up by a microphone timestamp that was in the wrong clock domain.
 *
 * So this drives the real ReferenceRing and the real Aec3Canceller exactly as
 * `audio-processor-glass-parity.ts` does - system chunks written with true
 * capture time, mic chunks looked up with `referenceFor(micChunkStartedAtMs)` -
 * and measures ERLE with the microphone timestamps biased LATE (the bug) and
 * corrected (the fix).
 *
 * Echo-only material, so ERLE is exact: there is no near-end speech whose
 * removal could be mistaken for cancellation. That mistake produced a wrong
 * diagnosis once already in this project.
 */
const path = require('node:path');
const lab = require('./aec-lab.cjs');
const { ReferenceRing } = require(path.join(__dirname, '..', 'dist/main/aec-reference.js'));
const { Aec3Canceller } = require(path.join(__dirname, '..', 'dist/main/aec3-canceller.js'));

const RATE = 24_000;
const CHUNK = 2400;                 // 100ms, the production chunk
const SECONDS = 24;
const N = RATE * SECONDS;
const ACOUSTIC_DELAY_MS = 60.3;     // measured on this hardware
const SYS_CHUNK = 480;              // 20ms, as the macOS helper delivers
const HELPER_AGE_MS = 150;          // measured PTS age when the renderer sees it
const RESERVE_CHUNKS = 4;

const db = (x) => 10 * Math.log10(Math.max(x, 1e-20));
const energy = (a, from = 0) => {
  let s = 0;
  for (let i = from; i < a.length; i += 1) s += a[i] * a[i];
  return s / Math.max(1, a.length - from);
};

/** The same committed speech `aec-bench.cjs` uses, so the two are comparable.
 *
 * Band-limited noise was the first choice and it was a bad one: measured
 * against this canceller it yields 7.6 dB whether fed through the ring or
 * directly, because AEC3's residual suppressor exploits speech structure that
 * noise does not have. The absolute number said nothing about the ring; only
 * matching the reference bench's material makes the two numbers mean the same
 * thing. */
function farEnd() {
  const wav = lab.readWav(path.join(__dirname, 'aec-speech', 'far.wav'));
  const src = wav.samples;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i += 1) out[i] = src[i % src.length];
  return out;
}

/** The far end as it comes back through the room, 19dB down, at the real delay.
 *
 * The impulse response carries the delay itself, and it is the IR that gets
 * scaled to the target ERL - the same construction `aec-bench.cjs` uses, so
 * this bench and that one are measuring the same physics. */
function echoOf(far) {
  const ir = lab.scaleToErl(
    lab.makeRoomImpulse({ rate: RATE, delayMs: ACOUSTIC_DELAY_MS, seed: 7 }),
    far,
    19,
  );
  const convolved = lab.convolve(far, ir);
  return convolved.subarray(0, N);
}

/**
 * One full run through the production data path.
 *
 * @param micBiasMs how late the microphone timestamps are. 0 = the fix,
 *                  positive = unmodelled input latency, which is the bug.
 */
async function run(far, echo, micBiasMs) {
  const ring = new ReferenceRing();
  const canceller = await Aec3Canceller.create({ streamRate: RATE });

  // Session origin shared by both sources, as CaptureSessionTimeline provides.
  const T0 = 1_000_000;

  // System audio: written with TRUE capture time, the way the ScreenCaptureKit
  // presentation timestamp now gives it. The chunk is only WRITTEN once the
  // renderer sees it, HELPER_AGE_MS after it was captured.
  const sysEvents = [];
  for (let start = 0; start + SYS_CHUNK <= N; start += SYS_CHUNK) {
    const capturedAtMs = T0 + (start / RATE) * 1000;
    sysEvents.push({
      arrivesAtMs: capturedAtMs + HELPER_AGE_MS,
      capturedAtMs,
      samples: far.subarray(start, start + SYS_CHUNK),
    });
  }

  // Microphone: chunks cut with the reserve held back, timestamped with the
  // bias under test.
  const reserveMs = (CHUNK / RATE) * 1000 * RESERVE_CHUNKS;
  const micEvents = [];
  for (let start = 0; start + CHUNK <= N; start += CHUNK) {
    const trueCaptureMs = T0 + (start / RATE) * 1000;
    micEvents.push({
      processAtMs: trueCaptureMs + reserveMs + (CHUNK / RATE) * 1000,
      claimedCaptureMs: trueCaptureMs + micBiasMs,
      samples: echo.subarray(start, start + CHUNK),
    });
  }

  const timeline = [
    ...sysEvents.map((e) => ({ at: e.arrivesAtMs, kind: 'sys', e })),
    ...micEvents.map((e) => ({ at: e.processAtMs, kind: 'mic', e })),
  ].sort((a, b) => a.at - b.at || (a.kind === 'sys' ? -1 : 1));

  const cancelled = [];
  const original = [];
  let skipped = 0;
  for (const item of timeline) {
    if (item.kind === 'sys') {
      ring.write(item.e.samples, item.e.capturedAtMs);
      continue;
    }
    const { samples, missingSamples } = ring.referenceFor(item.e.claimedCaptureMs, CHUNK);
    if (missingSamples !== 0) {
      skipped += 1;
      continue;
    }
    const out = canceller.process(item.e.samples, samples);
    cancelled.push(out);
    original.push(item.e.samples);
  }
  canceller.dispose();

  if (!cancelled.length) return { erle: 0, skipped, chunks: 0 };

  // Measure over the settled second half only: the filter needs time to adapt,
  // and including its convergence would understate a working canceller.
  const half = Math.floor(cancelled.length / 2);
  const flat = (rows) => {
    const out = new Float32Array(rows.length * CHUNK);
    rows.forEach((r, i) => out.set(r, i * CHUNK));
    return out;
  };
  const before = flat(original.slice(half));
  const after = flat(cancelled.slice(half));
  return {
    erle: db(energy(before)) - db(energy(after)),
    skipped,
    chunks: cancelled.length,
  };
}

(async () => {
  const far = farEnd();
  const echo = echoOf(far);

  console.log('\n\x1b[1mAEC CLOCK-DOMAIN BENCH\x1b[0m  real ReferenceRing + real AEC3, production lookup path');
  console.log(`\x1b[2mecho-only material, ${ACOUSTIC_DELAY_MS}ms path, 19dB ERL, helper age ${HELPER_AGE_MS}ms\x1b[0m\n`);
  console.log('  mic bias   meaning                              ERLE      skipped');

  const cases = [
    [0, 'corrected - one clock (the fix)'],
    [-20, 'over-corrected by 20ms'],
    [-40, 'over-corrected by 40ms'],
    [-60, 'over-corrected by 60ms'],
    [-80, 'over-corrected by 80ms'],
    [-100, 'over-corrected by 100ms'],
    [-120, 'over-corrected by the current clamp'],
  ];

  const results = [];
  for (const [bias, label] of cases) {
    const r = await run(far, echo, bias);
    results.push({ bias, label, ...r });
    const flag = r.erle >= 10 ? '\x1b[32m' : '\x1b[31m';
    console.log(
      `  ${String(bias).padStart(5)}ms   ${label.padEnd(38)} ${flag}${r.erle >= 0 ? '+' : ''}${r.erle.toFixed(1)} dB\x1b[0m   ${r.skipped}`,
    );
  }

  const fixed = results[0];
  const worst = results[results.length - 1];
  console.log('');
  const cancels = fixed.erle >= 10;
  const busted = worst.erle < 10;
  if (cancels && busted) {
    console.log(`\x1b[32mDEMONSTRATED\x1b[0m  the corrected clock cancels ${fixed.erle.toFixed(1)} dB of echo`);
    console.log(`             the same path with an unmodelled ${worst.bias}ms bias cancels ${worst.erle.toFixed(1)} dB`);
    console.log(`             difference: \x1b[1m${(fixed.erle - worst.erle).toFixed(1)} dB\x1b[0m attributable to the clock domain alone`);
    process.exit(0);
  }
  console.log(`\x1b[31mNOT DEMONSTRATED\x1b[0m  corrected=${fixed.erle.toFixed(1)}dB worst=${worst.erle.toFixed(1)}dB`);
  process.exit(1);
})();
