/**
 * A preset change ARMS a session reset; the next interaction performs it.
 *
 * The first version cleared on the toggle. That is safe but destructive:
 * browsing presets, or activating the wrong one by accident, threw away the Ask
 * content with no way back - the same mistake as the settings page discarding
 * typed text on "set active", punishing a reversible action with an
 * irreversible one.
 *
 * The guarantee that matters is narrower: no suggestion generated under preset
 * A may end up in a session bound to preset B. Resetting immediately BEFORE the
 * next question or recording preserves that exactly, and costs nothing when the
 * user only toggled to look.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', ...p), 'utf8');
const HELPER = read('lib', 'pending-preset-reset.ts');
const SETTINGS = read('overlay', 'SettingsView.tsx');
const ASK = read('overlay', 'AskView.tsx');
const BAR = read('overlay', 'EviaBar.tsx');

test('activating or deactivating arms, and clears nothing', () => {
  assert.match(SETTINGS, /armFreshSessionForNextInteraction\(preset\.id, 'activated'\)/);
  assert.match(SETTINGS, /armFreshSessionForNextInteraction\(preset\.id, 'deactivated'\)/);
  // The destructive calls must not be back.
  assert.ok(!SETTINGS.includes("send?.('session:closed')"),
    'the settings screen must not clear the Ask window on a toggle');
  assert.ok(!SETTINGS.includes("removeItem('current_chat_id')"),
    'the settings screen must not drop the chat binding on a toggle');
});

test('the flag survives the window it was set in', () => {
  // Settings, Ask and Listen are separate renderers. A flag that lives in one
  // of them is not a flag at all.
  assert.match(HELPER, /localStorage\.setItem\(KEY/);
  assert.match(HELPER, /prefs\?\.set\?\.\(\{ \[KEY\]: value \}\)/);
  assert.match(HELPER, /prefs\?\.getSync\?\.\(KEY\)/);
});

test('the flag is consumed once, not read repeatedly', () => {
  const at = HELPER.indexOf('export function consumePresetSessionReset');
  const body = HELPER.slice(at, at + 900);
  assert.match(body, /removeItem\(KEY\)/, 'a flag that is never cleared resets every turn');
  assert.match(body, /\[KEY\]: null/);
});

test('asking a question performs the reset before the request', () => {
  const at = ASK.indexOf('consumePresetSessionReset()');
  assert.ok(at > 0, 'the Ask box never checks for a pending preset change');
  const send = ASK.indexOf('streamAsk(', at);
  assert.ok(send === -1 || at < send, 'the reset must land before the request is built');
  const body = ASK.slice(at, at + 900);
  for (const cleared of ['setResponse(', 'setResponseHistory([])', 'setResponseIndex(-1)', 'clearSessionBinding()']) {
    assert.ok(body.includes(cleared), `Ask reset is missing ${cleared}`);
  }
});

test('starting a recording performs the reset too', () => {
  const at = BAR.indexOf('consumePresetSessionReset()');
  assert.ok(at > 0, 'Listen never checks for a pending preset change');
  const body = BAR.slice(at, at + 400);
  assert.ok(body.includes('clearSessionBinding()'));
  assert.ok(body.includes("send?.('session:closed')"),
    'the Ask window still holds the previous session\'s answers and must be cleared');
});

test('the recording reset only fires from idle', () => {
  // Consuming the flag on a stop or a mid-call transition would spend it on the
  // wrong edge and leave the next real start unbound.
  const at = BAR.indexOf('consumePresetSessionReset()');
  const line = BAR.slice(BAR.lastIndexOf('\n', at), at + 40);
  assert.match(line, /state === 'idle'/);
});

test('clear-session is still the wrong signal for this', () => {
  // clear-session says so in its own log line - it exists for before->during,
  // where preparation notes must survive.
  assert.match(ASK, /Received clear-session - cancelling active stream, keeping content/);
});
