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
 * Which direction actually hurts was MEASURED, not reasoned, by
 * `tools/aec-clock-domain-bench.cjs` driving the real ring and the real
 * canceller:
 *
 *     mic timestamps LATE   by 25ms   +40.7 dB   absorbed
 *     mic timestamps LATE   by 85ms   +40.7 dB   absorbed
 *     mic timestamps EARLY  by 60ms   +41.6 dB   absorbed
 *     mic timestamps EARLY  by 80ms    +9.0 dB   collapsed
 *     mic timestamps EARLY  by 100ms   +5.0 dB   collapsed
 *
 * AEC3 keeps its own reference history and searches it, so a LATE microphone
 * estimate is simply absorbed. The fatal direction is the other one: requesting
 * a window EARLIER than the acoustic delay means the newest reference AEC3 has
 * still predates the echo, and no filter length recovers that.
 *
 * So aligning the clocks is correct, but it is a refinement worth about 1 dB in
 * the plausible range - NOT the explanation for the 2026-08-12 run, where
 * telemetry showed a silent or unrelated reference rather than a small offset.
 * These tests pin the correction and, more importantly, keep the clamp on the
 * safe side of the measured cliff.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const SAMPLE_RATE = 24_000;
const CHUNK_SAMPLES = 2400;                 // 100ms
const ACOUSTIC_DELAY_MS = 60.3;             // measured on this hardware
const MAX_MIC_INPUT_LATENCY_MS = 40;        // must match the renderer constant
const OVERSHOOT_CLIFF_MS = 60.3;            // measured: past the acoustic delay the echo is unreachable

/**
 * Signed error of the microphone's own estimate of when its chunk began.
 *
 * Positive = LATE (the uncorrected state). Negative = EARLY (over-corrected),
 * which the bench shows is the direction that actually breaks cancellation.
 */
function micEstimateErrorMs(trueLatencyMs, appliedLatencyMs) {
  return trueLatencyMs - appliedLatencyMs;
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

test('the drift is removed exactly within the clamp', () => {
  for (const trueLatency of [0, 5, 10, 25, 40]) {
    const error = micEstimateErrorMs(trueLatency, clampInputLatency(trueLatency / 1000));
    assert.equal(error, 0, 'corrected mic capture time matches true capture time');
  }
});

test('beyond the clamp the residual error stays on the SAFE side', () => {
  // A device reporting more than the clamp is only partially corrected, on
  // purpose: the remaining error leaves the estimate LATE, which AEC3 absorbs,
  // rather than risking the early-side cliff to chase an exact match.
  for (const trueLatency of [50, 85, 200]) {
    const error = micEstimateErrorMs(trueLatency, clampInputLatency(trueLatency / 1000));
    assert.ok(error > 0,
      `true ${trueLatency}ms should leave a late residual, got ${error}ms`);
  }
});

test('the correction never pushes the estimate early enough to matter', () => {
  // The only dangerous outcome is an EARLY estimate past the acoustic delay.
  // Whatever the platform reports, the applied value is clamped, so the worst
  // reachable earliness is the clamp itself.
  for (let trueLatency = 0; trueLatency <= 200; trueLatency += 5) {
    const error = micEstimateErrorMs(trueLatency, clampInputLatency(trueLatency / 1000));
    assert.ok(error > -OVERSHOOT_CLIFF_MS,
      `true ${trueLatency}ms produced an estimate ${-error}ms early, past the cliff`);
  }
});

test('the clamp refuses an absurd driver figure rather than trusting it', () => {
  // A virtual device reporting 4 seconds would shift the reference far enough
  // to destroy alignment. Clamping degrades to a bounded correction instead.
  assert.equal(clampInputLatency(4), MAX_MIC_INPUT_LATENCY_MS);
  assert.equal(clampInputLatency(0.5), MAX_MIC_INPUT_LATENCY_MS);
});

test('the clamp cannot over-correct past the measured cliff', () => {
  // aec-clock-domain-bench measures +41.6 dB at 60ms of overshoot and +9.0 dB
  // at 80ms. The worst overshoot this clamp permits is the full clamp, applied
  // when the true latency is zero, so the clamp itself must stay under it.
  assert.ok(MAX_MIC_INPUT_LATENCY_MS < OVERSHOOT_CLIFF_MS,
    `a ${MAX_MIC_INPUT_LATENCY_MS}ms clamp can overshoot past the ${OVERSHOOT_CLIFF_MS}ms cliff`);
  for (let trueLatency = 0; trueLatency <= 100; trueLatency += 5) {
    const overshoot = clampInputLatency(trueLatency / 1000) - trueLatency;
    assert.ok(overshoot < OVERSHOOT_CLIFF_MS,
      `true ${trueLatency}ms overshoots by ${overshoot}ms, past the cliff`);
  }
});

test('a missing or negative figure degrades to the old behaviour, never to a guess', () => {
  // Zero is the safe floor: it reproduces arrival-time behaviour rather than
  // inventing a shift, which is the failure mode this replaces.
  assert.equal(clampInputLatency(undefined), 0);
  assert.equal(clampInputLatency(0), 0);
  assert.equal(clampInputLatency(-1), 0);
});

test('under-correcting is the SAFE direction, not the dangerous one', () => {
  // Measured, and the opposite of what this file first claimed. A late estimate
  // is absorbed by AEC3's own search (+40.7 dB at 85ms late); an early one past
  // the acoustic delay is not (+9.0 dB at 80ms early). When the platform figure
  // is uncertain, erring LOW is correct.
  const under = micEstimateErrorMs(40, 20);  // corrected by less than the truth
  const over = micEstimateErrorMs(20, 40);   // corrected by more
  assert.ok(under > 0, 'under-correction leaves the estimate late, which is absorbed');
  assert.ok(over < 0, 'over-correction leaves the estimate early, which is the risk');
  assert.ok(over > -OVERSHOOT_CLIFF_MS, 'and the clamp keeps it short of the cliff');
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
