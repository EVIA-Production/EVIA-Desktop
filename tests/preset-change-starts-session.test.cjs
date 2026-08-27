/**
 * Changing preset must start a fresh session.
 *
 * The preset is bound to a chat as an immutable SNAPSHOT when the session
 * starts. Switching preset while an old chat id was still in localStorage left
 * every following suggestion grounded in the preset the user had just moved
 * away from - silently, and for the rest of that conversation. The settings
 * screen updated its own state and the cached context and stopped there.
 *
 * Pinned against the reset EviaBar already uses, so there is one definition of
 * "fresh" rather than two that drift.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'overlay', f), 'utf8');
const SETTINGS = read('SettingsView.tsx');
const BAR = read('EviaBar.tsx');

const STEPS = [
  "removeItem('current_chat_id')",
  'current_chat_id: null',
  'liveTranscript?.clear?.()',
  "ipc?.send?.('clear-session')",
];

test('the settings screen performs the same four reset steps EviaBar does', () => {
  const at = SETTINGS.indexOf('startFreshSessionAfterPresetChange = ');
  assert.ok(at > 0, 'no reset helper on the settings screen');
  const body = SETTINGS.slice(at, at + 900);
  for (const step of STEPS) {
    assert.ok(body.includes(step), `settings reset is missing: ${step}`);
    assert.ok(BAR.includes(step), `EviaBar no longer does ${step} - the two have drifted`);
  }
});

test('both activating and deactivating start a fresh session', () => {
  assert.match(SETTINGS, /startFreshSessionAfterPresetChange\('activated'\)/);
  assert.match(SETTINGS, /startFreshSessionAfterPresetChange\('deactivated'\)/,
    'deactivating also changes what the next call is grounded in');
});

test('the reset runs only after the backend confirmed the change', () => {
  // Resetting on a failed activation would throw away the session for nothing.
  const act = SETTINGS.indexOf("startFreshSessionAfterPresetChange('activated')");
  const ok = SETTINGS.lastIndexOf('result?.ok && result.activation', act);
  assert.ok(ok > 0 && ok < act, 'activation reset must sit inside the success branch');
});

test('preset changes are still refused during a live recording', () => {
  // The reset is only safe because it can never run mid-call.
  assert.match(SETTINGS, /if \(isSessionActive\)/);
  const guard = SETTINGS.indexOf('if (isSessionActive)');
  const handler = SETTINGS.indexOf('const handlePresetSelect');
  assert.ok(guard > handler && guard - handler < 400,
    'the live-session guard must remain at the top of the handler');
});
