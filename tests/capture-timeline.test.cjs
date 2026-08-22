const assert = require('node:assert/strict')
const test = require('node:test')

const {
  CaptureSessionTimeline,
  createAudioChunkMetaControlEnvelope,
  serializeAudioChunkMetaControlEnvelope,
} = require('../dist/main/capture-timeline.js')

const SESSION_ID = '018f0f89-8b5b-7c3d-8a91-123456789abc'

function timeline(overrides = {}) {
  return new CaptureSessionTimeline({
    id: SESSION_ID,
    generation: 7,
    epochUnixMs: 1_800_000_000_000,
    originPerformanceMs: 10_000,
    ...overrides,
  })
}

test('mixed 100ms mic and 20ms system chunks share one comparable timeline', () => {
  const session = timeline()
  const mic = session.createFromMonotonicInterval({
    source: 'mic',
    startPerformanceMs: 10_100,
    endPerformanceMs: 10_200,
    sampleRate: 24_000,
    byteLength: 4_800,
  })
  const system = session.createSystemFromEpochPts({
    capturedAtUnixMs: 1_800_000_000_120,
    observedAtUnixMs: 1_800_000_000_145,
    observedAtPerformanceMs: 10_145,
    sampleRate: 24_000,
    byteLength: 960,
  })

  assert.deepEqual(
    [mic.capture_start_ms, mic.capture_end_ms, system.capture_start_ms, system.capture_end_ms],
    [100, 200, 120, 140],
  )
  assert.equal(mic.sample_count, 2_400)
  assert.equal(system.sample_count, 480)
  assert.equal(mic.capture_session_id, system.capture_session_id)
  assert.equal(mic.capture_generation, system.capture_generation)
})

test('sequence numbers increment independently per source', () => {
  const session = timeline()
  const interval = (source, start, duration, byteLength) =>
    session.createFromMonotonicInterval({
      source,
      startPerformanceMs: 10_000 + start,
      endPerformanceMs: 10_000 + start + duration,
      sampleRate: 24_000,
      byteLength,
    })

  assert.equal(interval('mic', 0, 100, 4_800).chunk_seq, 0)
  assert.equal(interval('system', 0, 20, 960).chunk_seq, 0)
  assert.equal(interval('system', 20, 20, 960).chunk_seq, 1)
  assert.equal(interval('mic', 100, 100, 4_800).chunk_seq, 1)
})

test('epoch PTS fails closed for old, future, pre-session, and foreign-clock values', () => {
  const session = timeline({
    maxPtsAgeMs: 1_000,
    maxFuturePtsSkewMs: 50,
    maxClockDomainSkewMs: 25,
  })
  const base = {
    sampleRate: 24_000,
    byteLength: 960,
    observedAtUnixMs: 1_800_000_002_000,
    observedAtPerformanceMs: 12_000,
  }

  assert.throws(
    () => session.createSystemFromEpochPts({ ...base, capturedAtUnixMs: base.observedAtUnixMs - 1_001 }),
    /implausible age/,
  )
  assert.throws(
    () => session.createSystemFromEpochPts({ ...base, capturedAtUnixMs: base.observedAtUnixMs + 51 }),
    /implausible age/,
  )
  assert.throws(
    () =>
      session.createSystemFromEpochPts({
        ...base,
        capturedAtUnixMs: session.epochUnixMs - 1,
        observedAtUnixMs: session.epochUnixMs + 500,
        observedAtPerformanceMs: session.originPerformanceMs + 500,
      }),
    /captureStartMs/,
  )
  assert.throws(
    () =>
      session.createSystemFromEpochPts({
        ...base,
        capturedAtUnixMs: base.observedAtUnixMs,
        observedAtPerformanceMs: 12_026,
      }),
    /foreign clock domains/,
  )
})

test('PCM byte length and monotonic duration must match sample rate exactly', () => {
  const session = timeline()
  assert.throws(
    () =>
      session.createFromMonotonicInterval({
        source: 'mic',
        startPerformanceMs: 10_000,
        endPerformanceMs: 10_100,
        sampleRate: 24_000,
        byteLength: 4_799,
      }),
    /exact number of PCM frames/,
  )
  assert.throws(
    () =>
      session.createFromMonotonicInterval({
        source: 'mic',
        startPerformanceMs: 10_000,
        endPerformanceMs: 10_099,
        sampleRate: 24_000,
        byteLength: 4_800,
      }),
    /exactly match PCM duration/,
  )
})

test('a new capture generation resets source sequences and identity', () => {
  const first = timeline()
  const firstChunk = first.createFromMonotonicInterval({
    source: 'mic',
    startPerformanceMs: 10_000,
    endPerformanceMs: 10_100,
    sampleRate: 24_000,
    byteLength: 4_800,
  })
  const second = timeline({
    id: '118f0f89-8b5b-7c3d-8a91-123456789abc',
    generation: 8,
    epochUnixMs: 1_800_000_010_000,
    originPerformanceMs: 20_000,
  })
  const secondChunk = second.createFromMonotonicInterval({
    source: 'mic',
    startPerformanceMs: 20_000,
    endPerformanceMs: 20_100,
    sampleRate: 24_000,
    byteLength: 4_800,
  })

  assert.equal(firstChunk.chunk_seq, 0)
  assert.equal(secondChunk.chunk_seq, 0)
  assert.notEqual(firstChunk.capture_session_id, secondChunk.capture_session_id)
  assert.equal(secondChunk.capture_generation, 8)
})

test('timeline preserves gaps and allows overlap between different sources', () => {
  const session = timeline()
  const firstMic = session.createFromMonotonicInterval({
    source: 'mic',
    startPerformanceMs: 10_100,
    endPerformanceMs: 10_200,
    sampleRate: 24_000,
    byteLength: 4_800,
  })
  const overlappingSystem = session.createFromMonotonicInterval({
    source: 'system',
    startPerformanceMs: 10_150,
    endPerformanceMs: 10_170,
    sampleRate: 24_000,
    byteLength: 960,
  })
  const gappedMic = session.createFromMonotonicInterval({
    source: 'mic',
    startPerformanceMs: 10_300,
    endPerformanceMs: 10_400,
    sampleRate: 24_000,
    byteLength: 4_800,
  })

  assert.equal(firstMic.capture_start_ms, 100)
  assert.equal(overlappingSystem.capture_start_ms, 150)
  assert.equal(gappedMic.capture_start_ms, 300)
})

test('timeline snaps harmless same-source clock jitter to a non-overlapping boundary', () => {
  const session = timeline()
  const first = session.createSystemFromEpochPts({
    capturedAtUnixMs: 1_800_000_000_120,
    observedAtUnixMs: 1_800_000_000_145,
    observedAtPerformanceMs: 10_145,
    sampleRate: 24_000,
    byteLength: 960,
  })
  const jittered = session.createSystemFromEpochPts({
    capturedAtUnixMs: 1_800_000_000_139.75,
    observedAtUnixMs: 1_800_000_000_165,
    observedAtPerformanceMs: 10_165,
    sampleRate: 24_000,
    byteLength: 960,
  })

  assert.equal(first.capture_end_ms, 140)
  assert.equal(jittered.capture_start_ms, first.capture_end_ms)
  assert.equal(jittered.capture_end_ms, 160)
  assert.equal(jittered.chunk_seq, 1)
})

/*
 * This test used to call a 50ms backwards move "a reversal". The measurement
 * that arrived on 2026-08-22 retired that number: on real hardware the system
 * channel moved backwards by 5 / 10 / 15 / 18 / 27 / 46.8 ms inside ONE
 * session - 24 times - and every one of those was ordinary ScreenCaptureKit
 * callback jitter, not a broken clock. 46.8 and 50 are not separable, so a
 * threshold that rejects 50 also rejects real prospect audio, which is exactly
 * what it was doing.
 *
 * So the boundary moved to 250 ms (matching maxClockDomainSkewMs) and this test
 * now pins BOTH sides of it: jitter within the measured band is clamped, and a
 * move far outside it still throws. The clamp is no longer silent either -
 * `clampedJitter` records what it absorbed, which is the part that makes the
 * wider tolerance safe rather than merely convenient.
 */
test('default timeline clamps measured ScreenCaptureKit jitter and records it', () => {
  const session = timeline()
  session.createFromMonotonicInterval({
    source: 'system',
    startPerformanceMs: 10_100,
    endPerformanceMs: 10_120,
    sampleRate: 24_000,
    byteLength: 960,
  })
  const snapped = session.createFromMonotonicInterval({
    source: 'system',
    startPerformanceMs: 10_114.979,
    endPerformanceMs: 10_134.979,
    sampleRate: 24_000,
    byteLength: 960,
  })
  assert.equal(snapped.capture_start_ms, 120)
  assert.equal(snapped.capture_end_ms, 140)

  // 50ms back: inside the measured jitter band, so it is clamped. Before this
  // change it threw, and the chunk - the prospect's voice - was discarded.
  const clamped50 = session.createFromMonotonicInterval({
    source: 'system',
    startPerformanceMs: 10_090,
    endPerformanceMs: 10_110,
    sampleRate: 24_000,
    byteLength: 960,
  })
  assert.equal(clamped50.capture_start_ms, 140,
    'a 50ms backwards move must continue from the previous end, not be dropped')

  // And it is visible afterwards rather than absorbed silently.
  assert.equal(session.clampedJitter.system.count, 2)
  assert.ok(session.clampedJitter.system.worstMs >= 50,
    'the worst clamp must be recorded so a degrading clock can be seen')
  assert.equal(session.clampedJitter.mic.count, 0,
    'the microphone channel had no clamps and must not be credited with any')

  // A genuine reset is still fatal. Advance the clock first so the reversal can
  // be expressed without running before the session origin, then jump back
  // 420ms - far outside the 46.8ms ceiling anything real has ever produced.
  session.createFromMonotonicInterval({
    source: 'system',
    startPerformanceMs: 11_000,
    endPerformanceMs: 11_020,
    sampleRate: 24_000,
    byteLength: 960,
  })
  assert.throws(
    () => session.createFromMonotonicInterval({
      source: 'system',
      startPerformanceMs: 10_600,
      endPerformanceMs: 10_620,
      sampleRate: 24_000,
      byteLength: 960,
    }),
    /system capture interval moved backwards by \d+\.\d+ms/,
  )
})

test('timeline fails closed for a genuine same-source reversal', () => {
  const session = timeline({ maxCaptureClockJitterMs: 5 })
  session.createFromMonotonicInterval({
    source: 'mic',
    startPerformanceMs: 10_300,
    endPerformanceMs: 10_400,
    sampleRate: 24_000,
    byteLength: 4_800,
  })

  assert.throws(
    () =>
      session.createFromMonotonicInterval({
        source: 'mic',
        startPerformanceMs: 10_350,
        endPerformanceMs: 10_450,
        sampleRate: 24_000,
        byteLength: 4_800,
      }),
    /mic capture interval moved backwards by 50\.000ms/,
  )
})

test('audio_chunk_meta control envelope serializes without changing metadata', () => {
  const session = timeline()
  const metadata = session.createFromMonotonicInterval({
    source: 'system',
    startPerformanceMs: 10_000,
    endPerformanceMs: 10_020,
    sampleRate: 24_000,
    byteLength: 960,
  })
  const envelope = createAudioChunkMetaControlEnvelope(metadata)

  assert.deepEqual(envelope, { command: 'audio_chunk_meta', ...metadata })
  assert.deepEqual(JSON.parse(serializeAudioChunkMetaControlEnvelope(metadata)), envelope)
})

test('constructor safely generates an id and rejects mismatched clocks or ids', () => {
  const generated = new CaptureSessionTimeline({ generation: 0 })
  assert.match(generated.id, /^[0-9a-f-]{36}$/)

  assert.throws(
    () => new CaptureSessionTimeline({ generation: 1, epochUnixMs: Date.now() }),
    /supplied together/,
  )
  assert.throws(
    () => timeline({ id: 'not-a-session-id' }),
    /must be a UUID/,
  )
})
