/**
 * The three legs of capture startup used to run one after another.
 *
 * Measured on five real presses (audio-diagnostics.log, 2026-08-22), the only
 * production evidence that exists for this path:
 *
 *   00:44:08  total=7634ms  mic=2987ms  chat_awaited=0ms  sockets=2550ms
 *   00:54:57  total=10415ms mic=429ms   chat_awaited=0ms  sockets=8686ms
 *   00:58:17  total=4137ms  mic=436ms   chat_awaited=0ms  sockets=2381ms
 *   01:24:02  total=5990ms  mic=1248ms  chat_awaited=0ms  sockets=2761ms
 *   01:25:30  total=3861ms  mic=450ms   chat_awaited=0ms  sockets=2137ms
 *
 * `mic` is a local CoreAudio device open and touches no network. `sockets` is
 * pure network - at the 195ms RTT measured to api.taylos.ai, three handshake
 * round trips before the backend even starts opening Deepgram. Neither leg
 * consumes anything the other produces, yet the rep was charged the SUM.
 *
 * So the socket handshake now starts BEFORE getUserMedia and is awaited after.
 * These tests pin the ordering, because the saving is entirely in the ordering
 * and nothing else about the code would look wrong if it were undone.
 *
 * The Glass-parity note in the source records a hang from an earlier attempt
 * that AWAITED the sockets before getUserMedia. The distinction this file
 * protects is exactly that one: start, do not await.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'audio-processor-glass-parity.ts');
const src = fs.readFileSync(SRC, 'utf8');

const at = (needle) => {
  const i = src.indexOf(needle);
  assert.notEqual(i, -1, `expected to find: ${needle}`);
  return i;
};

test('the socket handshake is started before getUserMedia, not after it', () => {
  const started = at('const socketsStarted = chatBound.then(');
  const getUserMedia = at('await navigator.mediaDevices.getUserMedia(');
  assert.ok(started < getUserMedia,
    'the handshake must be in flight while the microphone device opens - ' +
    'starting it afterwards is what made the rep pay mic + sockets in series');
});

test('the sockets are NOT awaited before getUserMedia', () => {
  // This is the failure the Glass-parity note in the source describes. Starting
  // a promise is safe; awaiting it here would put a network round trip in front
  // of the permission prompt again.
  const started = at('const socketsStarted = chatBound.then(');
  const getUserMedia = at('await navigator.mediaDevices.getUserMedia(');
  const between = src.slice(started, getUserMedia);
  assert.doesNotMatch(between, /await\s+socketsStarted/,
    'awaiting here re-serialises the two legs and reintroduces the hang');
  assert.doesNotMatch(between, /await\s+chatBound/,
    'awaiting the chat id here puts a network call in front of the microphone');
});

test('both legs are still awaited before any audio can reach Deepgram', () => {
  // Overlapping changes WHEN the handshake is paid for, never whether the
  // transport gate holds. Releasing before dg_open would replay a startup burst.
  const awaitSockets = at('const socketStatus = await socketsStarted;');
  const release = at('releaseCaptureTransport();');
  assert.ok(awaitSockets < release,
    'transport must not be released until the handshake has been awaited');
  const awaitChat = at('await chatBound;');
  assert.ok(awaitChat < awaitSockets,
    'the chat id must be settled before the socket result is consumed');
});

test('a microphone failure closes the sockets it raced against', () => {
  // The sockets are very likely open by the time getUserMedia rejects. Leaving
  // them would hold a backend transcription session, and a Deepgram
  // connection, open for a capture that will never send a sample.
  const deniedAt = at('Microphone permission denied:');
  const block = src.slice(Math.max(0, deniedAt - 900), deniedAt);
  assert.match(block, /socketsStarted/,
    'the mic failure path must dispose of the parallel sockets');
  assert.match(block, /closeCaptureWebSocket\('mic'\)/,
    'the mic socket must be closed explicitly');
  assert.match(block, /closeCaptureWebSocket\('system'\)/,
    'the system socket must be closed explicitly');
});

test('the started promise carries a rejection handler', () => {
  // Between the kickoff and the await, nothing is watching it. An unhandled
  // rejection in that window is a process-level warning at best and a crash
  // under strict settings.
  const started = at('const socketsStarted = chatBound.then(');
  const window = src.slice(started, started + 600);
  assert.match(window, /socketsStarted\.catch\(/,
    'an early rejection must not surface as an unhandled rejection');
});

test('the bounded chat wait survived the move', () => {
  // The 51-second failure this replaced was an unbounded await. Moving the
  // logic into the parallel kickoff must not have dropped the bound.
  const race = at('captureChatId = await Promise.race([');
  const after = src.slice(race, race + 300);
  assert.match(after, /setTimeout\(\(\) => resolve\(null\), 1500\)/,
    'the wait must stay bounded at 1500ms');
});
