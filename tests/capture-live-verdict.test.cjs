/**
 * The capture-live banner tells the rep their recording dropped. It has to be
 * right in both directions, and for two years it was right in neither: it could
 * not fire at all, and the code that stopped it firing was itself a fix for it
 * firing when nothing was wrong.
 *
 * Both failures come from one bug. `getWebSocketInstance()` was called with no
 * arguments, so it keyed on the literal string "undefined" and returned a
 * placeholder socket nothing ever connects. Subscribing to that reported "not
 * live" forever (the false alarm, measured 2026-08-20 with mic partials landing
 * at 1095 ms), and the fix for the false alarm - ignore a socket that was never
 * live - silenced the banner permanently, because the placeholder never was.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CaptureLiveTracker } = require('../dist/main/capture-live-verdict.js');

const MIC = '1869:mic';
const SYS = '1869:system';

test('says nothing until something has actually been live', () => {
  const tracker = new CaptureLiveTracker();
  assert.equal(tracker.verdict(), null, 'a fresh tracker has nothing to report');

  // onLiveStateChange reports current truth on subscribe. A socket that exists
  // but has not connected yet arrives here as false, and must stay silent.
  tracker.observe(MIC, false);
  tracker.observe(SYS, false);
  assert.equal(tracker.verdict(), null, 'never-live sockets are not a drop');
});

test('reports a drop only for a source that was carrying audio', () => {
  const tracker = new CaptureLiveTracker();
  tracker.observe(MIC, true);
  assert.equal(tracker.verdict(), true);

  tracker.observe(MIC, false);
  assert.equal(tracker.verdict(), false, 'a live mic going down is the real alarm');

  tracker.observe(MIC, true);
  assert.equal(tracker.verdict(), true, 'and it clears when audio comes back');
});

test('a system socket that never opens cannot alarm a mic-only setup', () => {
  // The regression this guards: judging both sources against one global flag
  // makes a legitimately absent system socket look like a lost recording.
  const tracker = new CaptureLiveTracker();
  tracker.observe(MIC, true);
  tracker.observe(SYS, false);
  assert.equal(tracker.verdict(), true, 'mic is up and system was never up');
});

test('losing either half of the call is a drop', () => {
  for (const dropped of [MIC, SYS]) {
    const tracker = new CaptureLiveTracker();
    tracker.observe(MIC, true);
    tracker.observe(SYS, true);
    assert.equal(tracker.verdict(), true);
    tracker.observe(dropped, false);
    assert.equal(tracker.verdict(), false, `${dropped} dropping must be reported`);
  }
});

test('a new chat does not inherit the previous call as a drop', () => {
  const tracker = new CaptureLiveTracker();
  tracker.observe(MIC, true);
  tracker.observe(MIC, false);
  assert.equal(tracker.verdict(), false);

  tracker.reset();
  assert.equal(tracker.verdict(), null, 'the next recording starts clean');
});

// --- and that the view actually wires it to the real sockets -----------------

const listenSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'ListenView.tsx'),
  'utf8',
);

test('the banner observes the real sockets and never creates one', () => {
  const start = listenSource.indexOf('if (!isSessionActive) { setCaptureLive(null); return; }');
  assert.notEqual(start, -1, 'the capture-live effect moved');
  const end = listenSource.indexOf('}, [isSessionActive]);', start);
  assert.notEqual(end, -1, 'the capture-live effect lost its dependency list');
  // Comments in here discuss the old bug by name; assert on code, not prose.
  const effect = listenSource.slice(start, end).replace(/\/\/[^\n]*/g, '');

  // The bug: no chat id, so the key was "undefined".
  assert.doesNotMatch(effect, /getWebSocketInstance/);
  assert.match(effect, /peekWebSocketInstance\(chatKey, source\)/);
  assert.match(effect, /canonicalTranscriptStateRef\.current\.chatId \?\? lastKnownChatIdRef\.current/);

  // Both halves of the call are watched.
  assert.match(effect, /\['mic', 'system'\] as const/);

  // Re-attach must be idempotent: the old version pushed a new subscription
  // every 2s and grew `offs` for the length of the call.
  assert.match(effect, /if \(attached\.has\(key\)\) continue;/);

  assert.match(effect, /tracker\.observe\(key, live\)/);
  assert.match(effect, /setCaptureLive\(tracker\.verdict\(\)\)/);
});

test('peek never constructs a socket', () => {
  const service = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'services', 'websocketService.ts'),
    'utf8',
  );
  const start = service.indexOf('export const peekWebSocketInstance');
  assert.notEqual(start, -1);
  const body = service.slice(start, service.indexOf('export const closeWebSocketInstance', start));
  assert.doesNotMatch(body, /new ChatWebSocket/, 'an observer must not build a transport');
  assert.match(body, /wsInstances\.get\(/);
});
