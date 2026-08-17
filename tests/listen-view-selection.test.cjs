/**
 * A session STARTING must not take away a view the user picked.
 *
 * Reported 2026-08-17: press Listen, switch to transcript while the button is
 * still grey, and the moment recording actually starts the view flips back to
 * insights. Two reset reasons fire during startup - 'recording-started' and
 * 'session-state-before-to-during' - and both ran the same
 * resetSessionPresentation() that forces setViewMode('insights').
 *
 * Someone had already noticed and added an "Undo" button instead of fixing the
 * cause; setShowUndoButton(true) was never called anywhere, so that band-aid
 * could not even render. It is gone.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  process.env.LISTEN_VIEW_PATH ||
    path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'ListenView.tsx'),
  'utf8',
);

test('a deliberate view choice survives the session starting', () => {
  assert.match(source, /userSelectedViewRef = useRef\(false\)/);

  // Only the two STARTUP reasons may be overridden by a user choice. The
  // others ('clear-session', 'session-state-before') are genuine data resets
  // where returning to insights is correct.
  const setStart = source.indexOf('const SESSION_START_REASONS = new Set([');
  assert.notEqual(setStart, -1, 'startup reasons are not enumerated');
  const setBody = source.slice(setStart, source.indexOf(']', setStart));
  assert.match(setBody, /'recording-started'/);
  assert.match(setBody, /'session-state-before-to-during'/);

  assert.match(
    source,
    /if \(SESSION_START_REASONS\.has\(reason\) && userSelectedViewRef\.current\)/,
    'resetSessionPresentation still forces insights unconditionally',
  );
});

test('choosing a view is what marks it deliberate', () => {
  const toggle = source.slice(source.indexOf('const toggleView = async () => {'));
  const body = toggle.slice(0, toggle.indexOf('\n  };'));
  assert.match(body, /userSelectedViewRef\.current = true/);
  // The flag must be set BEFORE the state change, or a re-render can race it.
  assert.ok(
    body.indexOf('userSelectedViewRef.current = true') < body.indexOf('setViewMode(newMode)'),
  );
});

test('the unreachable Undo band-aid is gone', () => {
  // setShowUndoButton(true) was never called, so the button could never render.
  // Leaving dead UI around a fixed bug invites someone to "restore" it.
  assert.doesNotMatch(source, /showUndoButton/);
});

test('session END still returns to insights', () => {
  // The fix must not make a finished call stick on the transcript: after a
  // call, insights are the product.
  assert.match(source, /if \(newState === 'after'\) \{\s*\n\s*setViewMode\('insights'\)/);
});
