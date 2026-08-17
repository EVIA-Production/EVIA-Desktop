const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'audio-processor-glass-parity.ts'),
  'utf8',
)

function functionBody(name, nextMarker) {
  const start = source.indexOf(name)
  assert.notEqual(start, -1, `missing ${name}`)
  const end = source.indexOf(nextMarker, start)
  assert.notEqual(end, -1, `missing marker after ${name}: ${nextMarker}`)
  return source.slice(start, end)
}

test('provided-stream startup uses one timeline and a strict two-sided barrier', () => {
  const body = functionBody(
    'export async function startCaptureWithStreams(',
    '\n}',
  )

  const begin = body.indexOf('const timeline = beginCaptureSession()')
  const socketBarrier = body.indexOf('await connectCaptureWebSockets(true)')
  const release = body.indexOf('releaseCaptureTransport()')
  const systemSetup = body.indexOf('setupSystemAudioProcessing(systemStream, timeline)')
  const firstSystem = body.indexOf("waitForFirstCaptureChunk(systemSetup.firstChunk, 'system')")
  const micSetup = body.indexOf('setupMicProcessing(micStream, timeline)')
  const firstMic = body.indexOf("waitForFirstCaptureChunk(micSetup.firstChunk, 'mic')")

  for (const [label, offset] of Object.entries({
    begin,
    systemSetup,
    socketBarrier,
    firstSystem,
    micSetup,
    firstMic,
    release,
  })) {
    assert.ok(offset >= 0, `missing ${label}`)
  }
  assert.ok(begin < socketBarrier)
  assert.ok(socketBarrier < release)
  assert.ok(release < systemSetup)
  assert.ok(systemSetup < firstSystem)
  assert.ok(firstSystem < micSetup)
  assert.ok(micSetup < firstMic)
  assert.match(body, /Required system-audio stream is absent/)
  assert.doesNotMatch(body, /starting mic-only|continuing with microphone/)
  assert.match(body, /await stopCapture\(\)/)
  assert.match(body, /throw error/)
})

test('all physical PCM callbacks are generation-pinned and emit metadata+binary pairs', () => {
  const mic = functionBody(
    'async function setupMicProcessing(',
    '// Glass parity: Setup system audio processing',
  )
  const system = functionBody(
    'function setupSystemAudioProcessing(',
    '// v1.0.0 FIX: No IPC routing needed for mic audio',
  )
  const mac = functionBody(
    'async function startMacSystemAudioCapture(',
    'async function stopMacSystemAudioCaptureOnly(',
  )

  for (const [name, body] of Object.entries({ mic, system, mac })) {
    assert.match(body, /isCurrentCaptureTimeline\(timeline\)/, `${name} lacks stale-generation guard`)
    assert.match(body, /sendCaptureChunk\(/, `${name} does not use paired transport`)
    assert.doesNotMatch(body, /sendBinaryData\(/, `${name} bypasses metadata transport`)
  }
  assert.match(mic, /timeline\.createFromMonotonicInterval\(/)
  assert.match(system, /timeline\.createFromMonotonicInterval\(/)
  assert.match(mac, /timeline\.createSystemFromEpochPts\(/)
  assert.doesNotMatch(mac, /timestamp=fallback|SYSTEM_CAPTURE_ASSUMED_LATENCY_MS;/)
})

test('startup buffering is bounded without double-counting overlapping sources', () => {
  const send = functionBody('function sendCaptureChunk(', 'function releaseCaptureTransport(')
  assert.match(send, /latestEndMs - earliestStartMs > MAX_PRE_READY_CAPTURE_MS/)
  assert.match(send, /bufferedBytes > MAX_PRE_READY_CAPTURE_BYTES/)
  assert.doesNotMatch(send, /reduce\([\s\S]*capture_end_ms - item\.metadata\.capture_start_ms/)
  assert.match(send, /capture_session_id !== timeline\.id/)
  assert.match(send, /capture_generation !== timeline\.generation/)
  assert.match(send, /metadata\.byte_length !== data\.byteLength/)
})

test('stop and failed startup fully invalidate session transport state', () => {
  const stop = functionBody(
    'export async function stopCapture(',
    '// Start capture from provided MediaStreams',
  )
  const reset = functionBody(
    'function resetCaptureSessionState(',
    'function requireCaptureTimeline(',
  )

  assert.match(stop, /finally \{/)
  assert.match(stop, /resetCaptureSessionState\(\)/)
  assert.match(stop, /micAudioProcessor = null/)
  assert.match(stop, /systemAudioProcessor = null/)
  assert.match(stop, /micWsInstance = null/)
  assert.match(stop, /systemWsInstance = null/)
  assert.match(reset, /captureTransportReady = false/)
  assert.match(reset, /preReadyCaptureChunks = \[\]/)
  assert.match(reset, /captureTimeline = null/)
  assert.match(reset, /referenceRing\.reset\(\)/)
  assert.match(reset, /micSamplesConsumed = 0/)
})
