/**
 * The microphone and the system reference must be on the SAME clock.
 *
 * The system reference is stamped with ScreenCaptureKit's presentation
 * timestamp, so it is true capture time. The microphone is timestamped from
 * `performance.now()` inside the ScriptProcessor callback, minus the samples
 * still buffered. That arithmetic treats the newest buffered sample as captured
 * at this instant - but it left the microphone `baseLatency` earlier and only
 * reached the callback after the driver and the render quantum.
 *
 * Mixing the two domains biases the microphone LATE. The window then requested
 * from the reference ring is newer than the echo it is meant to cancel, so the
 * echo precedes AEC3's entire reference history and cannot be modelled at all.
 *
 * That is the signature recorded in the 2026-08-12 acceptance run:
 *
 *     delay=0ms   coh=0.002-0.085   "REFERENCE UNRELATED TO MIC"
 *
 * against a bench that measures coherence 0.95 on the same canceller. These
 * tests model both domains and prove the correction restores causality.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const SAMPLE_RATE = 24_000;
const CHUNK_SAMPLES = 2400;                 // 100ms
const ACOUSTIC_DELAY_MS = 60.3;             // measured on this hardware
const MAX_MIC_INPUT_LATENCY_MS = 120;       // must match the renderer constant

/**
 * Where the microphone THINKS its chunk began, given a correction of
 * `appliedLatencyMs`, when the true input latency is `trueLatencyMs`.
 *
 * Positive return = the estimate is LATE relative to true capture time, which
 * is the dangerous direction: it makes the echo non-causal.
 */
function micEstimateErrorMs(trueLatencyMs, appliedLatencyMs) {
  return trueLatencyMs - appliedLatencyMs;
}

/** How far the echo sits outside the reference history, given that error. */
function nonCausalByMs(estimateErrorMs) {
  // The reference window starts at the mic estimate. An estimate that is late
  // by E pushes the window E past the echo; the echo is unreachable once that
  // exceeds the acoustic delay itself.
  return estimateErrorMs - ACOUSTIC_DELAY_MS;
}

function clampInputLatency(baseLatencySeconds) {
  return Math.min(
    Math.max((baseLatencySeconds || 0) * 1000, 0),
    MAX_MIC_INPUT_LATENCY_MS,
  );
}

test('uncorrected mic timestamps drift late by the whole input latency', () => {
  for (const trueLatency of [10, 25, 50, 85]) {
    const error = micEstimateErrorMs(trueLatency, 0);
    assert.equal(error, trueLatency,
      'without correction the mic estimate is late by exactly the input latency');
  }
});

test('the correction removes the drift when the platform figure is right', () => {
  for (const trueLatency of [10, 25, 50, 85]) {
    const error = micEstimateErrorMs(trueLatency, clampInputLatency(trueLatency / 1000));
    assert.equal(error, 0, 'corrected mic capture time matches true capture time');
  }
});

test('a large uncorrected latency makes the echo non-causal', () => {
  // This is the failure, stated as arithmetic. Past the acoustic delay the
  // echo precedes the reference history and no filter length can recover it.
  const uncorrected = nonCausalByMs(micEstimateErrorMs(85, 0));
  assert.ok(uncorrected > 0,
    `85ms of unmodelled input latency should break causality, got ${uncorrected}ms`);

  const corrected = nonCausalByMs(micEstimateErrorMs(85, clampInputLatency(0.085)));
  assert.ok(corrected < 0,
    `the correction should restore causality, still ${corrected}ms outside`);
});

test('causality holds across every plausible built-in input latency', () => {
  for (let trueLatency = 0; trueLatency <= 100; trueLatency += 5) {
    const applied = clampInputLatency(trueLatency / 1000);
    const outside = nonCausalByMs(micEstimateErrorMs(trueLatency, applied));
    assert.ok(outside <= 0,
      `true latency ${trueLatency}ms left the echo ${outside}ms outside the history`);
  }
});

test('the clamp refuses an absurd driver figure rather than trusting it', () => {
  // A virtual device reporting 4 seconds would shift the reference far enough
  // to destroy alignment. Clamping degrades to a bounded correction instead.
  assert.equal(clampInputLatency(4), MAX_MIC_INPUT_LATENCY_MS);
  assert.equal(clampInputLatency(0.5), MAX_MIC_INPUT_LATENCY_MS);
});

test('a missing or negative figure degrades to the old behaviour, never to a guess', () => {
  // Zero is the safe floor: it reproduces arrival-time behaviour rather than
  // inventing a shift, which is the failure mode this replaces.
  assert.equal(clampInputLatency(undefined), 0);
  assert.equal(clampInputLatency(0), 0);
  assert.equal(clampInputLatency(-1), 0);
});

test('over-correcting is safe, under-correcting is not', () => {
  // A reference that is OLDER than the mic window is absorbed by the filter as
  // leading taps. A reference that is NEWER is unrecoverable. So when the
  // platform figure is uncertain, erring high is the correct direction.
  const over = micEstimateErrorMs(20, 40);   // corrected by more than the truth
  const under = micEstimateErrorMs(40, 20);  // corrected by less
  assert.ok(over < 0, 'over-correction leaves the reference early, which is recoverable');
  assert.ok(nonCausalByMs(over) < 0, 'over-correction stays causal');
  assert.ok(under > 0, 'under-correction leaves the mic estimate late');
});

test('the renderer constant and this model agree', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(
    require('node:path').join(__dirname, '..', 'src/renderer/audio-processor-glass-parity.ts'),
    'utf8',
  );
  const match = source.match(/MAX_MIC_INPUT_LATENCY_MS\s*=\s*(\d+)/);
  assert.ok(match, 'MAX_MIC_INPUT_LATENCY_MS must exist in the renderer');
  assert.equal(Number(match[1]), MAX_MIC_INPUT_LATENCY_MS,
    'the model and the shipped clamp must not drift apart');
  assert.ok(
    /micOriginMs = performance\.now\(\) - micPendingMs - micChunkMs - micInputLatencyMs/.test(source),
    'the mic origin must still subtract the input latency',
  );
});
