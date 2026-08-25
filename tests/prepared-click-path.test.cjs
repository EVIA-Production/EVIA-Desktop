/**
 * The prepared click path, asserted structurally on the files that ship.
 *
 * The behaviour under test is an ABSENCE - no /ask request, no stream - and an
 * absence is exactly what a mock-based test fails to notice when a new call is
 * added on a branch the test does not take. So these read the real sources.
 *
 * Two invariants:
 *   - AskView returns from the send-and-submit handler BEFORE any stream start
 *     when a prepared answer is present.
 *   - ListenView captures the transcript it SENT, not one read back after the
 *     await, and clears the snapshot once the answer has been shown.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const ASK = read('src', 'renderer', 'overlay', 'AskView.tsx');
const LISTEN = read('src', 'renderer', 'overlay', 'ListenView.tsx');

/** The body of handleSendAndSubmit, up to its closing. */
function sendAndSubmitBody() {
  const start = ASK.indexOf('const handleSendAndSubmit =');
  assert.ok(start > 0, 'handleSendAndSubmit not found');
  const end = ASK.indexOf('const handleSessionClosed', start);
  assert.ok(end > start, 'could not bound handleSendAndSubmit');
  return ASK.slice(start, end);
}

test('a prepared answer short-circuits before any stream is started', () => {
  const body = sendAndSubmitBody();
  const guard = body.indexOf('payload.preparedSuggestion');
  assert.ok(guard > 0, 'AskView must read payload.preparedSuggestion');

  const ret = body.indexOf('return;', guard);
  assert.ok(ret > guard, 'the prepared branch must return');

  // Every stream entry point in this handler must come AFTER that return.
  for (const starter of ['startStreamRef.current?.(', 'queueReplacementStart(']) {
    let at = body.indexOf(starter);
    while (at !== -1) {
      assert.ok(at > ret,
        `${starter} appears before the prepared branch returns - a prepared hit ` +
        'would still cost an /ask request, which is the whole cost being removed');
      at = body.indexOf(starter, at + 1);
    }
  }
});

test('the prepared branch enters response history like a generated answer', () => {
  const body = sendAndSubmitBody();
  const guard = body.indexOf('payload.preparedSuggestion');
  const ret = body.indexOf('return;', guard);
  const branch = body.slice(guard, ret);
  assert.ok(branch.includes('setResponseHistory'), 'history navigation must include prepared answers');
  assert.ok(branch.includes('setResponseIndex'), 'the new entry must be selected');
  assert.ok(branch.includes('setIsStreaming(false)'), 'a prepared answer is never "streaming"');
});

test('ListenView captures the transcript before awaiting the insights response', () => {
  const decl = LISTEN.indexOf('const requestTranscript =');
  const call = LISTEN.indexOf('await fetchInsights(');
  assert.ok(decl > 0 && call > decl,
    'the transcript must be captured BEFORE the await; reading it afterwards ' +
    'binds the answer to a transcript it was never generated for');
});

test('the snapshot is replaced wholesale on every refresh', () => {
  assert.ok(LISTEN.includes('preparedSnapshotRef.current = null;'),
    'a refresh must clear the old snapshot before storing a new one, so a ' +
    'stale answer cannot outlive the context it belongs to');
});

test('a displayed prepared answer is consumed, never shown twice', () => {
  const at = LISTEN.indexOf("preparedOutcome.kind === 'prepared_hit'");
  assert.ok(at > 0);
  const after = LISTEN.slice(at);
  const cleared = after.indexOf('preparedSnapshotRef.current = null;');
  assert.ok(cleared > 0 && cleared < 2000,
    'the snapshot must be cleared on a hit; serving one suggestion twice is ' +
    'the repetition failure already fixed twice on the interactive path');
});

test('the click path reports which delivery happened', () => {
  for (const kind of ['prepared_hit', 'prepared_miss', 'interactive_fallback']) {
    assert.ok(LISTEN.includes(kind), `telemetry must distinguish ${kind}`);
  }
});

test('the insights request carries the transcript and the claim', () => {
  const svc = read('src', 'renderer', 'services', 'insightsService.ts');
  const bodyAt = svc.indexOf('body: JSON.stringify({');
  const body = svc.slice(bodyAt, bodyAt + 400);
  assert.ok(body.includes('transcript'), 'the canonical transcript must be sent');
  assert.ok(body.includes('prepared_claimed'), 'claims ride on the next request, not their own');
  assert.ok(body.includes('...(transcript ?'),
    'the field must be omitted when absent so older behaviour is byte-identical');
});
