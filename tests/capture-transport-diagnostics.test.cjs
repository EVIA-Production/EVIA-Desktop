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
  // Pinned once, from ONE call. The call was moved off the critical path on
  // 2026-08-21 - started before getUserMedia and awaited only where the sockets
  // consume it - so this asserts the invariant rather than the old spelling: a
  // single getOrCreateChatId, assigned to captureChatId exactly once.
  assert.equal((start.match(/getOrCreateChatId\(/g) || []).length, 1,
    'the chat id must come from exactly one call');
  assert.match(start, /const chatIdPromise = getOrCreateChatId\(BACKEND_URL, authToken\)/);
  // The pin sits further down, where the sockets consume it, so it is asserted
  // against the whole module rather than the opening slice.
  //
  // The spelling here was `await chatIdPromise` until v1.0.88 bounded the wait
  // with Promise.race, and this assertion silently went to zero matches at that
  // moment - it was red across three shipped releases before anyone read it.
  // Matching the ASSIGNMENT rather than the exact await keeps it honest against
  // whatever the wait is wrapped in next.
  const pins = source.match(/captureChatId = await [^;]+;/g) || [];
  assert.equal(pins.length, 1, 'it must be pinned from an await exactly once');
  assert.match(pins[0], /chatIdPromise/,
    'the pin must come from the single in-flight chat call, not a second one');
  // Emitted where the id is resolved, which is now below the opening slice.
  assert.match(source, /capture bound to chat_id=/);
  assert.doesNotMatch(start, /localStorage\.getItem\('current_chat_id'\)/);

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

const {
  normalizeRealtimeTranscriptEvent,
  normalizeRealtimeTranscriptEventWithReason,
} = require('../dist/main/realtime-transcript-state.js');

test('a word outside the proven window no longer deletes the whole utterance', () => {
  // The exact shape that emptied Bene's 2026-08-13 call: real speech, valid
  // clock, one boundary word ending 3ms past the utterance it belongs to.
  const event = normalizeRealtimeTranscriptEvent(transcriptEvent({
    text: 'Ja genau das haben wir auch gedacht',
    captureStartMs: 1000,
    captureEndMs: 1400,
    words: [
      { text: 'Ja', startMs: 1000, endMs: 1100 },
      { text: 'genau', startMs: 1100, endMs: 1403 },
    ],
  }));
  assert.ok(event, 'the utterance survives');
  assert.equal(event.words.length, 2, 'no word is dropped');
  assert.deepEqual(event.words.map(w => w.text), ['Ja', 'genau']);
  assert.equal(event.words[1].endMs, 1400, 'the stray word is clamped into the proven window');
  assert.equal(event.text, 'Ja genau das haben wir auch gedacht');
});

test('an inverted or zero-width word is repaired, not fatal', () => {
  // Deepgram emits start == end for short function words, and the backend
  // copies mapped capture times through without max(start, end).
  const event = normalizeRealtimeTranscriptEvent(transcriptEvent({
    words: [
      { text: 'und', startMs: 1200, endMs: 1200 },
      { text: 'ja', startMs: 1300, endMs: 1250 },
    ],
  }));
  assert.ok(event, 'the utterance survives a degenerate word');
  assert.equal(event.words[0].endMs, 1200);
  assert.ok(event.words[1].endMs >= event.words[1].startMs);
});

test('genuine integrity failures are still refused, and now say why', () => {
  // The repair must not become a licence to accept unprovable events.
  const bad = normalizeRealtimeTranscriptEventWithReason(
    transcriptEvent({ captureStartMs: -5 }),
  );
  assert.equal(bad.event, null);
  assert.match(bad.reason, /captureStartMs-negative/);

  const inverted = normalizeRealtimeTranscriptEventWithReason(
    transcriptEvent({ captureStartMs: 2000, captureEndMs: 1000 }),
  );
  assert.equal(inverted.event, null);
  assert.match(inverted.reason, /captureEnd-before-captureStart/);

  const noText = normalizeRealtimeTranscriptEventWithReason(transcriptEvent({ text: '   ' }));
  assert.equal(noText.event, null);
  assert.match(noText.reason, /text-not-a-nonempty-string/);
});

test('the adapter carries the precise predicate, not just the function name', () => {
  const { adaptServerTranscriptEvent } = require('../dist/main/realtime-transcript-adapter.js');
  const result = adaptServerTranscriptEvent({
    type: 'transcript_segment',
    _source: 'mic',
    data: {
      source: 'mic',
      clock_domain_valid: true,
      capture_session_id: 'c98f2151',
      utterance_id: 1,
      event_id: 'c98f2151:1:mic:1:1',
      text: 'Hallo',
      capture_generation: 1,
      stream_generation: 1,
      seq: 1,
      session_epoch_ms: 100,
      capture_start_ms: 2000,
      capture_end_ms: 1000,
      words: [{ text: 'Hallo', capture_start_ms: 2000, capture_end_ms: 2100 }],
    },
  }, 'chat-1');
  assert.equal(result.event, null);
  // "invalid-normalized-event" alone is what the console could say while every
  // live mic segment was being dropped. It names the function, not the fault.
  assert.match(result.reason, /invalid-normalized-event: captureEnd-before-captureStart/);
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

test('the transcript labels rows with the capture session chat, not the global key', () => {
  const start = listenView.indexOf('const capturedChatId =');
  assert.notEqual(start, -1, 'ListenView ignores the chat id the capture session stamped');
  const body = listenView.slice(start, listenView.indexOf('applyRealtimeTranscriptEvent(', start));
  // Precedence matters: Ask moves current_chat_id during a live call, so the
  // stamped id must WIN over localStorage, not merely be a fallback for it.
  assert.match(body, /msg\._chatId/);
  assert.match(body, /capturedChatId \?\? localStorage\.getItem\('current_chat_id'\)/);
  assert.match(body, /if \(storedChatId\) lastKnownChatIdRef\.current = storedChatId/);
  assert.match(body, /adaptServerTranscriptEvent\(msg, chatIdForEvent\)/);
  // The reason must reach the terminal; requiring the Listen window's DevTools
  // is why a 100% rejection rate survived two sessions undiagnosed.
  assert.match(body, /transcript REJECTED/);
});

test('both capture sockets stamp forwarded segments with the pinned chat', () => {
  const mic = functionBody('function ensureMicWs()', '// Ensure WebSocket for system audio');
  const system = functionBody('function ensureSystemWs()', 'function closeCaptureWebSocket(');
  for (const [name, body] of Object.entries({ mic, system })) {
    assert.match(
      body,
      /_chatId: activeChatId\(\)/,
      `${name} forwards transcripts without saying which chat produced them`,
    );
  }
});

// ── what the canonical rewrite left behind ────────────────────────────────────

test('turns are separated, not merged into one endless bubble', () => {
  const { projectRealtimeTranscriptState, createRealtimeTranscriptState, applyRealtimeTranscriptEvent } =
    require('../dist/main/realtime-transcript-state.js');

  // Two mic utterances 5 seconds apart. Before the fix, projectionRows merged
  // every consecutive atom of the SAME SOURCE with no gap and no utterance
  // check, so a new bubble began only when the speaker alternated. With the far
  // end producing no transcript, an entire call collapsed into one row.
  let state = createRealtimeTranscriptState();
  state = applyRealtimeTranscriptEvent(state, transcriptEvent({
    source: 'mic', utteranceId: '0', eventId: 'e0', seq: 1, isFinal: true,
    text: 'Guten Tag', captureStartMs: 1000, captureEndMs: 1500,
    words: [{ text: 'Guten', startMs: 1000, endMs: 1200 }, { text: 'Tag', startMs: 1200, endMs: 1500 }],
  })).state;
  state = applyRealtimeTranscriptEvent(state, transcriptEvent({
    source: 'mic', utteranceId: '1', eventId: 'e1', seq: 2, isFinal: true,
    text: 'Wie geht es', captureStartMs: 6000, captureEndMs: 6600,
    words: [
      { text: 'Wie', startMs: 6000, endMs: 6200 },
      { text: 'geht', startMs: 6200, endMs: 6400 },
      { text: 'es', startMs: 6400, endMs: 6600 },
    ],
  })).state;

  const rows = projectRealtimeTranscriptState(state).visibleRows;
  assert.equal(rows.length, 2, 'a 4.5s pause is a turn boundary, not one bubble');
  assert.equal(rows[0].text, 'Guten Tag');
  assert.equal(rows[1].text, 'Wie geht es');
});

test('words inside one utterance still join into a single row', () => {
  const { projectRealtimeTranscriptState, createRealtimeTranscriptState, applyRealtimeTranscriptEvent } =
    require('../dist/main/realtime-transcript-state.js');
  // The turn split must not fragment a sentence into one bubble per word.
  let state = createRealtimeTranscriptState();
  state = applyRealtimeTranscriptEvent(state, transcriptEvent({
    source: 'mic', utteranceId: '0', eventId: 'e0', seq: 1, isFinal: true,
    text: 'Das ist gut', captureStartMs: 1000, captureEndMs: 2000,
    words: [
      { text: 'Das', startMs: 1000, endMs: 1300 },
      { text: 'ist', startMs: 1300, endMs: 1600 },
      { text: 'gut', startMs: 1600, endMs: 2000 },
    ],
  })).state;
  const rows = projectRealtimeTranscriptState(state).visibleRows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'Das ist gut');
});

test('the bleed filter is wired into what the user actually sees', () => {
  // The rewrite carried only groupIntoBlocks across from transcript-order and
  // left dropBledMicRows/farEndTextOf behind, so loudspeaker echo transcribed
  // on the mic stream had nothing left to remove it.
  assert.match(listenView, /dropBledMicRows,/);
  assert.match(listenView, /farEndTextOf,/);
  assert.match(listenView, /return dropBledMicRows\(rows, farEndTextOf\(rows\)\)/);
});

// ── no layer between the microphone and the transcriber may delete audio ──────

test('the transport never drops a captured frame', () => {
  const ws = fs.readFileSync(
    process.env.WEBSOCKET_SERVICE_PATH ||
      path.join(__dirname, '..', 'src', 'renderer', 'services', 'websocketService.ts'),
    'utf8',
  );
  // The gate sat at RMS 0.003, and RMS here is normalised to 0..1, so it cut
  // everything below -50.5 dBFS. The 2026-08-13 session measured the mic at
  // -53..-59 dBFS across most windows: a normal speaking voice on a MacBook Air
  // lives BELOW that gate, so the user's speech was deleted as "silence".
  //
  // It also removed the cue Deepgram uses to END an utterance, which is why
  // everything merged into one bubble and finals arrived 10-15s late.
  assert.doesNotMatch(
    ws,
    /return 'dropped'/,
    'audio is being discarded before it reaches the transcriber',
  );
  assert.doesNotMatch(ws, /droppedSilentChunks/, 'silence suppression is back');
  // Voice activity is the transcriber's decision - it has a real VAD and
  // vad_events is enabled. An amplitude threshold in the transport cannot tell
  // a quiet talker from an empty room.
  assert.match(ws, /NO SILENCE SUPPRESSION/);
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
