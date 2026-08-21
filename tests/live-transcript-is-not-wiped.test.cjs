/**
 * The words already spoken belong to the rep.
 *
 * overlay-entry.tsx broadcasts `clear-session` from the LANGUAGE TOGGLE. The
 * ListenView handler cleared unconditionally: transcript wiped, session flipped
 * to 'before', timer stopped - while audio kept flowing and the header still
 * looked like it was recording.
 *
 * That is the report from 2026-08-20, verbatim: "Wenn die Transkription
 * abbricht sieht man das nicht. Es läuft einfach weiter und sieht optisch so
 * aus als wenn es aufnimmt, am Ende fehlt aber das Transkript."
 *
 * Clearing is correct when a session ENDS. It is never correct while one runs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const listen = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'ListenView.tsx'), 'utf8');

function handlerBody(name) {
  const at = listen.indexOf(`const ${name} = () => {`);
  assert.notEqual(at, -1, `missing handler ${name}`);
  return listen.slice(at, listen.indexOf('\n    };', at));
}

test('clear-session is ignored while a recording is live', () => {
  const body = handlerBody('onClearSession');
  assert.match(body, /isSessionActiveRef\.current/,
    'the handler must consult whether a session is running');
  const guardAt = body.indexOf('isSessionActiveRef.current');
  const resetAt = body.indexOf('resetSessionPresentation');
  assert.ok(guardAt !== -1 && resetAt > guardAt,
    'the guard must come BEFORE the reset, or it does nothing');
  assert.match(body.slice(guardAt, resetAt), /return/,
    'the guarded branch must return without clearing');
});

test('a language toggle mid-call keeps the transcript', () => {
  const body = handlerBody('onLanguageChanged');
  const guardAt = body.indexOf('isSessionActiveRef.current');
  const resetAt = body.indexOf('resetSessionPresentation');
  assert.ok(guardAt !== -1, 'language changes must consult session state too');
  assert.ok(resetAt > guardAt && /return/.test(body.slice(guardAt, resetAt)),
    'a language change must not reset a running session');
});

test('the language toggle really is a clear-session sender', () => {
  // If this ever stops being true the tests above still pass but describe
  // nothing, so the link itself is pinned.
  const entry = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'overlay-entry.tsx'), 'utf8');
  assert.match(entry, /eviaIpc\.send\('clear-session'\)/,
    'overlay-entry is expected to broadcast clear-session');
});

test('ending a session still clears - the guard must not break Fertig', () => {
  const body = handlerBody('onClearSession');
  assert.match(body, /setIsSessionActive\(false\)/);
  assert.match(body, /localStorage\.setItem\('evia_session_state', 'before'\)/);
  assert.match(body, /stopTimer\(\)/);
});
