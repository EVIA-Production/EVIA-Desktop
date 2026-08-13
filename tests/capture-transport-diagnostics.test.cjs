/**
 * A capture source must not be able to fail silently, and a capture session
 * must not be able to address two different chats.
 *
 * On 2026-08-12 a call produced hundreds of "mic WebSocket unavailable" and
 * nothing about system audio. That was read as "mic broken, system fine" and
 * two sessions were spent looking for a microphone-specific defect. There was
 * none. Both sources share one send function, one chat id, and one socket
 * registry; what differed was that the mic catch forwarded its error over the
 * `debug-log` IPC channel that the main process prints, while both system
 * catches wrote to `console.error`, which this renderer never forwards.
 *
 * So the log asymmetry was evidence about the LOGGING, not about the transport.
 * These tests make that class of mistake impossible to repeat: every source
 * reports, the session pin cannot be overridden, and the failure message names
 * the id it actually resolved.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CaptureSendFailureReporter } = require('../dist/main/capture-send-failures.js');

// Overridable so the structural assertions can be pointed at an older revision
// of this file and shown to FAIL on it. A guard nobody has watched fail is not
// known to guard anything; see docs/ for the recorded pre-fix run.
const source = fs.readFileSync(
  process.env.CAPTURE_SOURCE_PATH ||
    path.join(__dirname, '..', 'src', 'renderer', 'audio-processor-glass-parity.ts'),
  'utf8',
);

function functionBody(name, nextMarker) {
  const start = source.indexOf(name);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `missing marker after ${name}: ${nextMarker}`);
  return source.slice(start, end);
}

// ── the reporter itself ───────────────────────────────────────────────────────

test('the first failure of a source is reported immediately', () => {
  const reporter = new CaptureSendFailureReporter(1000);
  const line = reporter.record('mic', new Error('mic WebSocket unavailable'), 0);
  // The moment a source STARTS failing is the only timestamp that locates the
  // trigger. Throttling it away would hide exactly the line worth having.
  assert.match(line, /MIC SEND FAILED/);
  assert.match(line, /mic WebSocket unavailable/);
  assert.doesNotMatch(line, /x\d/, 'the first report carries no tally');
});

test('a flood collapses to one line per window, carrying the running count', () => {
  const reporter = new CaptureSendFailureReporter(1000);
  const emitted = [];
  // 10 chunks a second for 3 seconds, the real cadence of the failing call.
  for (let i = 0; i < 30; i++) {
    const line = reporter.record('mic', new Error('boom'), i * 100);
    if (line) emitted.push(line);
  }
  assert.equal(reporter.failureCount('mic'), 30, 'every failure is counted');
  assert.equal(emitted.length, 3, 'reported at t=0, t=1000, t=2000 only');
  assert.match(emitted[1], /\(x11\)/);
  assert.match(emitted[2], /\(x21\)/);
});

test('the two sources are throttled independently', () => {
  const reporter = new CaptureSendFailureReporter(1000);
  // A noisy mic must never throttle away the first word from system audio -
  // that is the exact silence this whole file exists to prevent.
  reporter.record('mic', new Error('boom'), 0);
  reporter.record('mic', new Error('boom'), 10);
  const system = reporter.record('system', new Error('boom'), 20);
  assert.ok(system, 'system reports even while mic is inside its window');
  assert.match(system, /SYSTEM SEND FAILED/);
});

test('a session reset clears the tally', () => {
  const reporter = new CaptureSendFailureReporter(1000);
  reporter.record('mic', new Error('boom'), 0);
  reporter.record('mic', new Error('boom'), 5000);
  reporter.reset();
  assert.equal(reporter.failureCount('mic'), 0);
  const line = reporter.record('mic', new Error('boom'), 6000);
  assert.doesNotMatch(line, /x\d/, 'the next call starts clean, not at x3');
});

test('a non-Error throw is still reported', () => {
  const reporter = new CaptureSendFailureReporter(1000);
  assert.match(reporter.record('system', 'plain string', 0), /plain string/);
});

// ── the wiring in the renderer ────────────────────────────────────────────────

test('every send-failure path reports; no source can fail silently', () => {
  const mic = functionBody(
    'async function setupMicProcessing(',
    '// Glass parity: Setup system audio processing',
  );
  const system = functionBody(
    'function setupSystemAudioProcessing(',
    '// v1.0.0 FIX: No IPC routing needed for mic audio',
  );
  const mac = functionBody(
    'async function startMacSystemAudioCapture(',
    'async function stopMacSystemAudioCaptureOnly(',
  );

  // The mac helper path is the one that carried system audio in the failing
  // run, so its silence is not a theoretical gap.
  for (const [name, body] of Object.entries({ mic, system, mac })) {
    assert.match(
      body,
      /reportCaptureSendFailure\(/,
      `${name} swallows its send failure instead of reporting it`,
    );
  }
});

test('no capture path lets localStorage override the session pin', () => {
  // Every call site used to pass localStorage into ensureSystemWs, which
  // overrode the pin at precisely the moment the pin exists to survive: with
  // the key moved on and the socket closed, system audio would reconnect to a
  // different chat than the microphone and split one conversation in half.
  const chunk = functionBody('function sendCaptureChunk(', 'function releaseCaptureTransport(');
  const release = functionBody('function releaseCaptureTransport(', 'async function waitForFirstCaptureChunk(');
  const connect = functionBody('async function connectCaptureWebSockets(', 'async function startMacSystemAudioCapture(');

  for (const [name, body] of Object.entries({ chunk, release, connect })) {
    assert.doesNotMatch(
      body,
      /ensureSystemWs\(\s*localStorage/,
      `${name} overrides the session pin with localStorage`,
    );
  }

  const ensure = functionBody('function ensureSystemWs()', 'function closeCaptureWebSocket(');
  assert.match(ensure, /const cid = activeChatId\(\)/);
  // No parameter to pass means no way to reintroduce the override.
  assert.match(source, /function ensureSystemWs\(\)/);
});

test('both sockets resolve their chat id through the same pinned accessor', () => {
  const mic = functionBody('function ensureMicWs()', '// Ensure WebSocket for system audio');
  const system = functionBody('function ensureSystemWs()', 'function closeCaptureWebSocket(');
  for (const [name, body] of Object.entries({ mic, system })) {
    assert.match(body, /activeChatId\(\)/, `${name} does not use the pinned id`);
    assert.doesNotMatch(
      body,
      /localStorage\.getItem/,
      `${name} reads localStorage directly and can be stranded mid-call`,
    );
  }
});

test('the unavailable-socket message names the resolved id and both inputs', () => {
  const chunk = functionBody('function sendCaptureChunk(', 'function releaseCaptureTransport(');
  // Reporting only localStorage mislabels a factory failure as a missing id
  // whenever the pin is holding and the key is gone - which routes the next
  // reader to the wrong branch of the handoff, the exact cost this avoids.
  assert.match(chunk, /const resolved = activeChatId\(\)/);
  assert.match(chunk, /pin=\$\{JSON\.stringify\(captureChatId\)\}/);
  assert.match(chunk, /localStorage=\$\{JSON\.stringify\(localStorage\.getItem\('current_chat_id'\)\)\}/);
});

test('the capture session pins its chat id once, and releases it', () => {
  const start = functionBody('async function startCaptureInternal(', 'AUDIO DEBUG: Check IMMEDIATELY');
  assert.match(start, /captureChatId = boundChatId && boundChatId !== '0' \? boundChatId : null/);
  assert.match(start, /capture bound to chat_id=/);

  const reset = functionBody('function resetCaptureSessionState(', 'function requireCaptureTimeline(');
  assert.match(reset, /captureChatId = null/, 'the next call must bind its own chat');
  assert.match(reset, /resetCaptureSendFailures\(\)/);
});

// ── the remembered chat id must not outlive its session ───────────────────────

const {
  applyRealtimeTranscriptEvent,
  createRealtimeTranscriptState,
} = require('../dist/main/realtime-transcript-state.js');

const transcriptEvent = (overrides = {}) => ({
  chatId: 'chat-1',
  sessionId: 'session-1',
  source: 'system',
  captureGeneration: 3,
  streamGeneration: 7,
  utteranceId: 'utterance-1',
  eventId: 'event-1',
  seq: 1,
  captureStartMs: 1000,
  captureEndMs: 1400,
  words: [{ text: 'Hallo', startMs: 1000, endMs: 1400 }],
  clockDomainValid: true,
  text: 'Hallo',
  isFinal: false,
  ...overrides,
});

test('binding the reducer to a stale chat id rejects the whole call', () => {
  // Why ListenView must release its remembered id at a session boundary. The
  // reducer binds state.chatId to the FIRST event it accepts and then refuses
  // every event carrying a different one, with no recovery path. So labelling
  // one early segment of a NEW call with the PREVIOUS call's chat id is not a
  // cosmetic slip - it empties the transcript for the rest of the session.
  let state = createRealtimeTranscriptState();
  state = applyRealtimeTranscriptEvent(state, transcriptEvent({ chatId: 'chat-OLD' })).state;

  const next = applyRealtimeTranscriptEvent(
    state,
    transcriptEvent({ chatId: 'chat-NEW', eventId: 'event-2', utteranceId: 'utterance-2', seq: 2 }),
  );
  assert.equal(next.accepted, false);
  assert.equal(next.reason, 'different-session');
});

test('a session boundary releases the remembered chat id', () => {
  const start = listenView.indexOf('const resetSessionPresentation = (reason: string) => {');
  assert.notEqual(start, -1, 'missing resetSessionPresentation');
  const body = listenView.slice(start, listenView.indexOf('\n    };', start));
  assert.match(
    body,
    /lastKnownChatIdRef\.current = null/,
    'the next call would inherit this one\'s chat id and reject its own transcript',
  );
});

test('the transcript falls back to the last chat id seen, not to dropping the row', () => {
  const start = listenView.indexOf('const storedChatId = localStorage.getItem');
  assert.notEqual(start, -1);
  const body = listenView.slice(start, listenView.indexOf('applyRealtimeTranscriptEvent(', start));
  assert.match(body, /if \(storedChatId\) lastKnownChatIdRef\.current = storedChatId/);
  assert.match(body, /adaptServerTranscriptEvent\(msg, chatIdForEvent\)/);
  // The reason must reach the terminal; requiring the Listen window's DevTools
  // is why a 100% rejection rate survived two sessions undiagnosed.
  assert.match(body, /transcript REJECTED/);
});

// ── the reconciler that completed live sessions ───────────────────────────────

const eviaBar = fs.readFileSync(
  process.env.EVIA_BAR_PATH ||
    path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'EviaBar.tsx'),
  'utf8',
);

const listenView = fs.readFileSync(
  process.env.LISTEN_VIEW_PATH ||
    path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'ListenView.tsx'),
  'utf8',
);

test('the stale-session reconciler re-checks capture state after its round trips', () => {
  const start = eviaBar.indexOf('const reconcileStaleBackendSession = async () => {');
  assert.notEqual(start, -1, 'missing reconcileStaleBackendSession');
  const end = eviaBar.indexOf('// Sync on mount', start);
  assert.notEqual(end, -1);
  const body = eviaBar.slice(start, end);

  // The guard is only meaningful where it sits. Checked once at the top it is
  // a TOCTOU race: this function is triggered by `chat-changed`, which fires
  // when a call creates its chat, and startCapture needs ~3.5s to leave 'idle'
  // (mic permission, then the helper). Two Azure round trips later the user's
  // call is live, the backend correctly answers 'during', and the pre-fix code
  // completed that live session, deleted its chat id and broadcast
  // clear-session - stranding both sockets and emptying the transcript ~5s in.
  const firstGuard = body.indexOf("captureSessionRef.current.state !== 'idle'");
  const statusFetch = body.indexOf('/session/status');
  const recheck = body.indexOf("captureSessionRef.current.state !== 'idle'", statusFetch);
  const completeFetch = body.indexOf('/session/complete');
  const removal = body.indexOf("localStorage.removeItem('current_chat_id')");
  const clearSession = body.indexOf("send?.('clear-session')");

  for (const [label, offset] of Object.entries({
    firstGuard, statusFetch, recheck, completeFetch, removal, clearSession,
  })) {
    assert.ok(offset >= 0, `missing ${label}`);
  }

  assert.ok(firstGuard < statusFetch, 'the cheap guard still runs before any network call');
  assert.ok(statusFetch < recheck, 'the state is re-read AFTER the status round trip');
  assert.ok(
    recheck < completeFetch,
    'a live session must not be completed: re-check before /session/complete',
  );
  assert.ok(
    body.indexOf("captureSessionRef.current.state !== 'idle'", completeFetch) < removal,
    'the chat id must not be deleted without a final check after completion',
  );
  assert.ok(removal < clearSession, 'unchanged: removal still precedes the broadcast');
});

test('transport progress is forwarded, so success has positive evidence', () => {
  const mic = functionBody(
    'async function setupMicProcessing(',
    '// Glass parity: Setup system audio processing',
  );
  // "No SEND FAILED appeared" is not evidence in this renderer: a silent path
  // and a working path look identical from the terminal. A rising count for
  // BOTH sources is what actually distinguishes them.
  assert.match(mic, /sendDebugLog\(\s*\n?\s*`transport ok: mic \$\{pipelineMetrics\.micChunksSent\}/);
  assert.match(mic, /system \$\{pipelineMetrics\.systemChunksSent\} chunks sent/);
  assert.match(mic, /chat=\$\{activeChatId\(\)\}/);
});
