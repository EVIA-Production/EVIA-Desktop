// Alignment is the whole game. Speex can only subtract an estimate of the far
// end if the reference it is handed lines up with the echo actually present in
// the mic. These tests pin the alignment, and the arithmetic that sizes the
// filter around it.
//
// The configuration these replace was misaligned by a per-session random amount
// (independent AudioContexts, 100ms chunk quantisation, and a 100ms delay
// applied against a measured 60.3ms path), which is why cancellation appeared
// to work on some runs and not others.

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  ReferenceRing,
  requiredFilterSamples,
  AEC_SAMPLE_RATE,
  ACOUSTIC_DELAY_MS,
  ALIGNMENT_SKEW_MARGIN_MS,
  REVERB_TAIL_MS,
} = require('../dist/main/aec-reference.js')

const RATE = AEC_SAMPLE_RATE
const CHUNK = 2400 // 100ms, the pipeline's chunk
const T0 = 1_000_000

const ramp = (start, length) =>
  Float32Array.from({ length }, (_, i) => start + i)

test('a read returns exactly the samples written at that position', () => {
  const ring = new ReferenceRing()
  ring.write(ramp(0, CHUNK), T0)
  const { samples, missingSamples } = ring.read(0, 10)
  assert.equal(missingSamples, 0)
  assert.deepEqual(Array.from(samples), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('position is derived from the origin, not from each timestamp', () => {
  const ring = new ReferenceRing()
  ring.write(ramp(0, CHUNK), T0)
  // 100ms later is exactly one chunk of samples later.
  assert.equal(ring.positionAt(T0 + 100), CHUNK)
  assert.equal(ring.positionAt(T0), 0)
})

test('the reference window is contemporaneous with the mic chunk', () => {
  const ring = new ReferenceRing()
  for (let c = 0; c < 20; c += 1) ring.write(ramp(c * CHUNK, CHUNK), T0 + c * 100)
  const micAt = T0 + 1000
  const { samples } = ring.referenceFor(micAt, CHUNK)
  // delta = 0. Speex locates the echo inside its own filter history, so
  // pre-shifting the window only pushes the echo toward the non-causal edge.
  assert.equal(samples[0], ring.positionAt(micAt))
})

test('sub-chunk alignment is exact, not quantised to 100ms', () => {
  const ring = new ReferenceRing()
  for (let c = 0; c < 20; c += 1) ring.write(ramp(c * CHUNK, CHUNK), T0 + c * 100)
  const a = ring.referenceFor(T0 + 1000, CHUNK).samples[0]
  const b = ring.referenceFor(T0 + 1001, CHUNK).samples[0]
  // One millisecond of mic time moves the window by one millisecond of samples.
  // The chunk-index scheme this replaces moved it by 0 or by 2400.
  assert.equal(b - a, RATE / 1000)
})

test('the echo stays causal inside Speex history, not pre-compensated', () => {
  // With delta = 0 the echo sits at exactly the acoustic delay inside Speex's
  // history: positive, so causal, and inside the filter. An earlier draft read
  // the window at (micPosition - delay - lead), i.e. delta = -180ms, which
  // violates causality - this test exists to keep that from coming back.
  const ring = new ReferenceRing()
  for (let c = 0; c < 30; c += 1) ring.write(ramp(c * CHUNK, CHUNK), T0 + c * 100)
  const micAt = T0 + 2000
  const { samples } = ring.referenceFor(micAt, CHUNK)
  const delta = samples[0] - ring.positionAt(micAt)
  assert.equal(delta, 0, 'reference must be contemporaneous')

  const delaySamples = Math.round((ACOUSTIC_DELAY_MS / 1000) * RATE)
  const echoPositionInHistory = delaySamples + delta
  assert.ok(echoPositionInHistory >= 0, 'echo must not precede the history')
  assert.ok(echoPositionInHistory <= requiredFilterSamples(), 'echo must fit the filter')
})

test('positions outside history read as silence, never as stale audio', () => {
  const ring = new ReferenceRing(RATE, 200) // 200ms of history
  for (let c = 0; c < 10; c += 1) ring.write(ramp(c * CHUNK, CHUNK), T0 + c * 100)
  const { samples, missingSamples } = ring.read(0, 100) // long since evicted
  assert.equal(missingSamples, 100)
  assert.ok(samples.every((v) => v === 0), 'evicted audio must not be resurrected')
})

test('reading before any write is silent rather than throwing', () => {
  const ring = new ReferenceRing()
  const { samples, missingSamples } = ring.referenceFor(T0, CHUNK)
  assert.equal(samples.length, CHUNK)
  assert.equal(missingSamples, CHUNK)
})

test('the filter spans delay, skew margin and reverb tail', () => {
  const taps = requiredFilterSamples()
  const spanMs = (taps / RATE) * 1000
  assert.ok(
    spanMs >= ACOUSTIC_DELAY_MS + ALIGNMENT_SKEW_MARGIN_MS + REVERB_TAIL_MS - 1,
    `filter spans only ${spanMs}ms`,
  )
})

test('the old 1600-tap filter provably could not span the measured path', () => {
  const oldSpanMs = (1600 / RATE) * 1000
  assert.ok(
    oldSpanMs < ACOUSTIC_DELAY_MS + REVERB_TAIL_MS,
    `old filter spanned ${oldSpanMs}ms; delay plus tail alone is ${ACOUSTIC_DELAY_MS + REVERB_TAIL_MS}ms`,
  )
  assert.ok(requiredFilterSamples() > 1600)
})

test('the filter absorbs the worst-case positive skew', () => {
  // A positive alignment error only costs filter length; the budget must cover
  // the full callback-quantisation bound of 2048/24000 = 85ms.
  assert.ok(ALIGNMENT_SKEW_MARGIN_MS >= (2048 / RATE) * 1000 - 0.5)
})

test('writes survive wrapping the ring', () => {
  const ring = new ReferenceRing(RATE, 150) // smaller than the data written
  for (let c = 0; c < 10; c += 1) ring.write(ramp(c * CHUNK, CHUNK), T0 + c * 100)
  const newest = ring.samplesWritten
  const { samples, missingSamples } = ring.read(newest - 10, 10)
  assert.equal(missingSamples, 0)
  assert.deepEqual(Array.from(samples), Array.from(ramp(newest - 10, 10)))
})

test('reset clears the clock origin so a new session realigns', () => {
  const ring = new ReferenceRing()
  ring.write(ramp(0, CHUNK), T0)
  assert.equal(ring.positionAt(T0), 0)
  ring.reset()
  assert.equal(ring.hasData, false)
  assert.equal(ring.positionAt(T0), null, 'origin must not survive a session')
  // A later session starting at a different wall time must position from ITS
  // own origin, not the previous call's.
  ring.write(ramp(0, CHUNK), T0 + 900_000)
  assert.equal(ring.positionAt(T0 + 900_000), 0)
})

test('reset does not resurrect the previous session as reference audio', () => {
  const ring = new ReferenceRing()
  ring.write(Float32Array.from({ length: CHUNK }, () => 0.9), T0)
  ring.reset()
  ring.write(new Float32Array(10), T0 + 900_000)
  const { samples } = ring.read(0, 10)
  assert.ok(samples.every((v) => v === 0), 'stale loud audio must not leak into a new call')
})



