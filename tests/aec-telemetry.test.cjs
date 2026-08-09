// Every previous attempt at the canceller failed the same way: it was changed
// and the only feedback was a transcript, which cannot distinguish "misaligned"
// from "filter too short" from "reference never fed" from "module never
// initialised". All four have been wrong at some point and two were wrong at
// once. These are the numbers that tell them apart, so they have to be right.

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  erleDb,
  levelDb,
  estimateDelay,
  linearExplainability,
  AecTelemetry,
  describeReport,
} = require('../dist/main/aec-telemetry.js')

const RATE = 24000

// Deterministic pseudo-noise: real speech is not needed to validate the maths,
// and a fixed sequence keeps the assertions exact.
function noise(length, seed = 1) {
  const out = new Float32Array(length)
  let s = seed
  for (let i = 0; i < length; i += 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    out[i] = (s / 0x7fffffff) * 2 - 1
  }
  return out
}

test('ERLE is zero when nothing is removed', () => {
  const signal = noise(4096)
  assert.equal(erleDb(signal, signal), 0)
})

test('halving amplitude is about 6dB of ERLE', () => {
  const before = noise(4096)
  const after = Float32Array.from(before, (v) => v / 2)
  assert.ok(Math.abs(erleDb(before, after) - 6.02) < 0.1, erleDb(before, after))
})

test('a tenth of the amplitude is about 20dB of ERLE', () => {
  const before = noise(4096)
  const after = Float32Array.from(before, (v) => v / 10)
  assert.ok(Math.abs(erleDb(before, after) - 20) < 0.1, erleDb(before, after))
})

test('silence in gives no ERLE claim', () => {
  assert.equal(erleDb(new Float32Array(1024), new Float32Array(1024)), 0)
})

test('a known delay is recovered exactly', () => {
  const reference = noise(8192)
  const delay = 1440 // 60ms at 24kHz, the measured path
  const captured = new Float32Array(reference.length)
  for (let i = delay; i < captured.length; i += 1) captured[i] = reference[i - delay] * 0.3
  const { lagSamples, confidence } = estimateDelay(reference, captured, 4096)
  assert.equal(lagSamples, delay)
  assert.ok(confidence > 10, `confidence ${confidence}`)
})

test('several different delays are each recovered exactly', () => {
  const reference = noise(8192, 7)
  for (const delay of [0, 240, 1440, 2400, 3600]) {
    const captured = new Float32Array(reference.length)
    for (let i = delay; i < captured.length; i += 1) captured[i] = reference[i - delay] * 0.25
    const { lagSamples } = estimateDelay(reference, captured, 4096)
    assert.equal(lagSamples, delay, `delay ${delay} recovered as ${lagSamples}`)
  }
})

test('unrelated audio yields low confidence, not a false delay', () => {
  const reference = noise(8192, 1)
  const captured = noise(8192, 999)
  const { confidence } = estimateDelay(reference, captured, 4096)
  assert.ok(confidence < 10, `unrelated audio claimed confidence ${confidence}`)
})

test('a clean echo is fully explainable, unrelated audio is not', () => {
  const reference = noise(8192)
  const delay = 1440
  const captured = new Float32Array(reference.length)
  for (let i = delay; i < captured.length; i += 1) captured[i] = reference[i - delay] * 0.3
  assert.ok(linearExplainability(reference, captured, delay) > 0.95)
  assert.ok(linearExplainability(reference, noise(8192, 555), delay) < 0.2)
})

test('the report names a missing reference before anything else', () => {
  const line = describeReport({
    erleDb: 0, delayMs: 0, delayConfidence: 0, coherence: 0,
    referenceGapRatio: 1, micLevelDb: -20,
  })
  assert.match(line, /REFERENCE MISSING/)
})

test('the report names the exact shipped failure: cancellable but not cancelled', () => {
  const line = describeReport({
    erleDb: 0.2, delayMs: 60, delayConfidence: 400, coherence: 0.9,
    referenceGapRatio: 0, micLevelDb: -25,
  })
  assert.match(line, /NOT BEING CANCELLED/)
})

test('a silent mic invalidates the other numbers rather than reporting them', () => {
  const line = describeReport({
    erleDb: 0, delayMs: 0, delayConfidence: 0, coherence: 0,
    referenceGapRatio: 0, micLevelDb: -100,
  })
  assert.match(line, /mic silent/)
})

test('good cancellation is reported as such', () => {
  const line = describeReport({
    erleDb: 18, delayMs: 60, delayConfidence: 300, coherence: 0.95,
    referenceGapRatio: 0, micLevelDb: -25,
  })
  assert.match(line, /cancelling well/)
})

test('telemetry withholds a report until the window is full', () => {
  const telemetry = new AecTelemetry(RATE)
  const chunk = noise(2400)
  telemetry.record(chunk, chunk, chunk, 0)
  assert.equal(telemetry.report(10_000, 4096), null, 'reported on a partial window')
})

test('telemetry reports the real delay and ERLE once the window fills', () => {
  const telemetry = new AecTelemetry(RATE)
  const delay = 1440
  const reference = noise(48_000, 3)
  for (let offset = 0; offset + 2400 <= 48_000; offset += 2400) {
    const ref = reference.slice(offset, offset + 2400)
    const before = new Float32Array(2400)
    for (let i = 0; i < 2400; i += 1) {
      const source = offset + i - delay
      before[i] = source >= 0 ? reference[source] * 0.3 : 0
    }
    const after = Float32Array.from(before, (v) => v / 10) // 20dB of cancellation
    telemetry.record(before, after, ref, 0)
  }
  const report = telemetry.report(10_000, 4096)
  assert.ok(report, 'expected a report once the window was full')
  assert.ok(Math.abs(report.erleDb - 20) < 0.5, `erle ${report.erleDb}`)
  assert.ok(Math.abs(report.delayMs - 60) < 2, `delay ${report.delayMs}ms`)
  assert.ok(report.coherence > 0.9, `coherence ${report.coherence}`)
  assert.match(describeReport(report), /cancelling well/)
})
