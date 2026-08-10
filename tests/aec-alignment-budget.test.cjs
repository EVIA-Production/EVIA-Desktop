/**
 * Does the reference alignment survive a real timeline, for every plausible
 * helper latency?
 *
 * Two constraints pull in opposite directions, and both are fatal if broken:
 *
 *   CAUSALITY    the reference window handed to the canceller must not be
 *                OLDER than the microphone window by more than the acoustic
 *                delay. Past that the echo precedes the canceller's entire
 *                reference history and no filter of any length can model it.
 *                The bench measures the cliff: 42.7dB at -60ms, 2.9dB at
 *                -120ms.
 *
 *   AVAILABILITY the far-end audio covering the window has to have ARRIVED.
 *                Assuming more helper latency reads further ahead, so the
 *                safety that buys causality is spent against the microphone
 *                reserve. Reading past the write cursor skips the canceller.
 *
 * SYSTEM_CAPTURE_ASSUMED_LATENCY_MS sits between them and the true latency is
 * not measurable from the renderer, so this sweeps it and asserts both hold.
 *
 * The timeline is the measured one: the macOS helper starts ~409ms late and
 * then delivers 20ms chunks in real time; the mic cuts 100ms chunks and holds
 * four in reserve.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ReferenceRing,
  AEC_SAMPLE_RATE,
  ACOUSTIC_DELAY_MS,
  SYSTEM_CAPTURE_ASSUMED_LATENCY_MS,
} = require('../dist/main/aec-reference.js');

const RATE = AEC_SAMPLE_RATE;
const MIC_CHUNK = 2400;                 // 100ms
const RESERVE_CHUNKS = 4;               // what the pipeline holds back
const SYS_CHUNK = 480;                  // 20ms, as the macOS helper delivers
const SYSTEM_START_DELAY_MS = 409;      // measured
const T0 = 1_000_000;

/** Each sample carries its own absolute index, so a read can be traced back. */
const indexed = (start, length) => Float32Array.from({ length }, (_, i) => start + i);

/**
 * @param trueLatencyMs how stale a chunk really is when the renderer sees it,
 *                      beyond its own duration. Unknown in production; swept here.
 */
function runSession(seconds, trueLatencyMs) {
  const ring = new ReferenceRing();
  const sysChunkMs = (SYS_CHUNK / RATE) * 1000;
  const reserveMs = ((MIC_CHUNK / RATE) * 1000) * RESERVE_CHUNKS;

  const events = [];
  let written = 0;
  for (let t = SYSTEM_START_DELAY_MS; t < seconds * 1000; t += sysChunkMs) {
    events.push({ kind: 'sys', at: t, start: written });
    written += SYS_CHUNK;
  }
  let consumed = 0;
  for (let t = 0; t < seconds * 1000; t += (MIC_CHUNK / RATE) * 1000) {
    events.push({ kind: 'mic', at: t + reserveMs, consumed });
    consumed += MIC_CHUNK;
  }
  events.sort((a, b) => a.at - b.at || (a.kind === 'sys' ? -1 : 1));

  // True capture time of ring sample 0: the first chunk's first sample.
  const firstArrivalMs = SYSTEM_START_DELAY_MS;
  const trueOriginMs = T0 + firstArrivalMs - sysChunkMs - trueLatencyMs;

  let micOriginMs = null;
  const reads = [];
  for (const event of events) {
    if (event.kind === 'sys') {
      // Exactly what the renderer does now.
      ring.write(
        indexed(event.start, SYS_CHUNK),
        T0 + event.at - sysChunkMs - SYSTEM_CAPTURE_ASSUMED_LATENCY_MS,
      );
    } else {
      if (micOriginMs === null) micOriginMs = T0 + event.at - reserveMs;
      const micChunkStartedAtMs = micOriginMs + (event.consumed / RATE) * 1000;
      const { samples, missingSamples } = ring.referenceFor(micChunkStartedAtMs, MIC_CHUNK);

      // The first sample carries its own ring index, so its TRUE render time is
      // known, and with it how much older than the mic window it really is.
      const ringIndex = samples[0];
      const trueRenderMs = trueOriginMs + (ringIndex / RATE) * 1000;
      reads.push({
        atMs: event.at,
        missingSamples,
        // > 0 means the reference is older than the mic window: the dangerous side.
        olderByMs: missingSamples === 0 ? micChunkStartedAtMs - trueRenderMs : null,
      });
    }
  }
  return reads;
}

const LATENCIES = [0, 10, 25, 50, 80, 120, 160, 180, 220, 240, 260, 280];
const SECONDS = 20;

/**
 * Reads from the steady state.
 *
 * Excludes the first second, where the helper genuinely has not started yet and
 * there is correctly no reference, and the trailing reserve, where the model
 * stops feeding the helper but mic chunks keep being processed. Both ends are
 * artefacts of a finite simulation; in production the equivalent chunks are
 * skipped and logged rather than cancelled against nothing.
 */
const settledReads = (trueLatencyMs) => runSession(SECONDS, trueLatencyMs).filter(
  (r) => r.atMs > SYSTEM_START_DELAY_MS + 1000 && r.atMs < SECONDS * 1000,
);

test('the reserve covers the latency the alignment assumes', () => {
  // The exact constraint, stated once so a future edit to either constant is a
  // failing test rather than a canceller that is quietly skipped every chunk.
  const chunkMs = (MIC_CHUNK / RATE) * 1000;
  const reserveMs = chunkMs * RESERVE_CHUNKS;
  assert.ok(
    reserveMs >= chunkMs + SYSTEM_CAPTURE_ASSUMED_LATENCY_MS,
    `a ${reserveMs}ms reserve cannot cover a ${chunkMs}ms chunk plus ` +
    `${SYSTEM_CAPTURE_ASSUMED_LATENCY_MS}ms of assumed helper latency - every window would be ` +
    `read before the far end arrived and the canceller would be skipped`,
  );
});

test('the reference is always available once the helper has started', () => {
  for (const trueLatencyMs of LATENCIES) {
    const settled = settledReads(trueLatencyMs);
    const short = settled.filter((r) => r.missingSamples > 0);
    assert.equal(
      short.length, 0,
      `true latency ${trueLatencyMs}ms: ${short.length}/${settled.length} windows were not ` +
      `fully written, so the canceller would be skipped. The assumed latency ` +
      `(${SYSTEM_CAPTURE_ASSUMED_LATENCY_MS}ms) is reading further ahead than the ` +
      `${RESERVE_CHUNKS}-chunk mic reserve covers.`,
    );
  }
});

test('the reference is never older than the mic window by more than the acoustic delay', () => {
  for (const trueLatencyMs of LATENCIES) {
    const settled = settledReads(trueLatencyMs).filter((r) => r.olderByMs !== null);
    assert.ok(settled.length > 0, `no usable reads at true latency ${trueLatencyMs}ms`);

    const worst = Math.max(...settled.map((r) => r.olderByMs));
    assert.ok(
      worst <= ACOUSTIC_DELAY_MS,
      `true latency ${trueLatencyMs}ms: reference ran ${worst.toFixed(1)}ms older than the mic ` +
      `window, past the ${ACOUSTIC_DELAY_MS}ms acoustic delay. The echo is then non-causal and ` +
      `cancellation is arithmetically impossible - raise SYSTEM_CAPTURE_ASSUMED_LATENCY_MS.`,
    );
  }
});

test('the total lag stays inside what AEC3 can track', () => {
  const { AEC3_MAX_TRACKABLE_DELAY_MS } = require('../dist/main/aec3-canceller.js');
  for (const trueLatencyMs of LATENCIES) {
    const settled = settledReads(trueLatencyMs).filter((r) => r.olderByMs !== null);
    // A reference NEWER than the mic window is safe, but AEC3 then has to search
    // that much further for the echo, on top of the acoustic delay itself.
    const newestLeadMs = -Math.min(...settled.map((r) => r.olderByMs));
    const totalLagMs = ACOUSTIC_DELAY_MS + Math.max(0, newestLeadMs);
    assert.ok(
      totalLagMs <= AEC3_MAX_TRACKABLE_DELAY_MS,
      `true latency ${trueLatencyMs}ms: total render-to-capture lag ${totalLagMs.toFixed(0)}ms ` +
      `exceeds the ${AEC3_MAX_TRACKABLE_DELAY_MS}ms AEC3 was measured to track`,
    );
  }
});
