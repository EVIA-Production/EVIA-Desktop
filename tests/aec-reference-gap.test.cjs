/**
 * The reference ring must position writes by TIME, not by sample count.
 *
 * `write()` used to append contiguously - `writeCursor += samples.length` -
 * while `positionAt()` mapped reads by elapsed wall-clock. Those two agree only
 * while the far end emits an unbroken stream. The far end is silent for most of
 * a sales call.
 *
 * Measured on the old implementation: one 2-second gap in capture time put
 * `positionAt` at sample 84000 while the audio actually sat at 36000, a 48000
 * sample skew that never recovered. Downstream that reads as either of the two
 * verdicts in the 2026-08-12 acceptance run - "reference window short,
 * canceller skipped" when the skew reads past the cursor, or "REFERENCE
 * UNRELATED TO MIC" with coherence near zero when it lands in real but wrong
 * audio.
 *
 * These tests pin the property that makes both impossible: audio written with a
 * timestamp must be readable at that timestamp.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { ReferenceRing } = require('../dist/main/aec-reference.js');

const T0 = 1_000_000;
const CHUNK = 480;      // 20ms at 24kHz, as the macOS helper delivers
const MIC_WINDOW = 2400; // 100ms

/** Fill `ms` of capture time starting at `fromMs`, with a recognisable value. */
function speak(ring, fromMs, durationMs, value) {
  for (let ms = fromMs; ms < fromMs + durationMs; ms += 20) {
    ring.write(new Float32Array(CHUNK).fill(value), T0 + ms);
  }
}

function peakAt(ring, atMs) {
  const result = ring.read(ring.positionAt(T0 + atMs), MIC_WINDOW);
  let peak = 0;
  for (const sample of result.samples) peak = Math.max(peak, Math.abs(sample));
  return { peak, missing: result.missingSamples };
}

test('audio is readable at the timestamp it was written with', () => {
  const ring = new ReferenceRing();
  speak(ring, 0, 1000, 0.5);
  const { peak, missing } = peakAt(ring, 500);
  assert.equal(missing, 0);
  assert.ok(Math.abs(peak - 0.5) < 1e-6, `expected the written value, got ${peak}`);
});

test('a silence gap does not shift every later read', () => {
  // The defect, as a property. The second burst must be found at its own
  // timestamp no matter how long the far end was quiet first.
  for (const gapMs of [200, 2_000, 8_000, 60_000]) {
    const ring = new ReferenceRing();
    speak(ring, 0, 1000, 0.5);
    const resume = 1000 + gapMs;
    speak(ring, resume, 1000, 0.9);

    const { peak, missing } = peakAt(ring, resume + 500);
    assert.equal(missing, 0, `${gapMs}ms gap left ${missing} samples missing`);
    assert.ok(Math.abs(peak - 0.9) < 1e-6,
      `${gapMs}ms gap returned ${peak} instead of the second burst`);
  }
});

test('the gap itself reads as silence, not as neighbouring speech', () => {
  // Zero-filling is the truthful content for a stretch the far end never
  // played. Returning the previous burst there would teach the canceller an
  // echo path that does not exist.
  const ring = new ReferenceRing();
  speak(ring, 0, 1000, 0.5);
  speak(ring, 3000, 1000, 0.9);
  const { peak } = peakAt(ring, 2000);
  assert.equal(peak, 0, `the silent stretch returned ${peak}`);
});

test('a duplicated delivery cannot inflate the timeline', () => {
  // Positioning by sample count meant a re-sent chunk advanced the cursor and
  // shifted everything after it. Positioning by time rewrites in place.
  const ring = new ReferenceRing();
  speak(ring, 0, 1000, 0.5);
  const before = ring.samplesWritten;
  ring.write(new Float32Array(CHUNK).fill(0.7), T0 + 500);
  assert.equal(ring.samplesWritten, before, 'a duplicate advanced the write cursor');
});

test('out-of-order arrival lands at its own timestamp', () => {
  const ring = new ReferenceRing();
  speak(ring, 0, 500, 0.5);
  speak(ring, 700, 300, 0.9);
  ring.write(new Float32Array(CHUNK).fill(0.3), T0 + 500); // the late straggler
  const result = ring.read(ring.positionAt(T0 + 500), CHUNK);
  let peak = 0;
  for (const sample of result.samples) peak = Math.max(peak, Math.abs(sample));
  assert.ok(Math.abs(peak - 0.3) < 1e-6, `straggler landed wrong, got ${peak}`);
});

test('a silence longer than the ring re-anchors instead of dying', () => {
  // Dropping the chunk would leave the origin pinned to a timeline the far end
  // has left, so every later read misses and the canceller never recovers for
  // the rest of the call.
  const ring = new ReferenceRing();
  speak(ring, 0, 1000, 0.5);
  speak(ring, 600_000, 1000, 0.9);   // ten minutes later
  const { peak, missing } = peakAt(ring, 600_500);
  assert.equal(missing, 0);
  assert.ok(Math.abs(peak - 0.9) < 1e-6, `after re-anchoring got ${peak}`);
});

test('reset clears the anchor so a new session cannot inherit one', () => {
  const ring = new ReferenceRing();
  speak(ring, 0, 1000, 0.5);
  ring.reset();
  assert.equal(ring.samplesWritten, 0);
  assert.equal(ring.positionAt(T0 + 500), null);
});
