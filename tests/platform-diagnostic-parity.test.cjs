/**
 * Windows must record at least what macOS records.
 *
 * Measured 2026-08-27, on the code shipped as v1.0.97: the macOS system-audio
 * service made SIX appendAudioDiagnostic calls and the Windows one made ZERO.
 * So audio-diagnostics.log was empty on Windows and every capture forensic
 * that exists for the Mac - start-to-first-audio latency, stalls, helper
 * status, failure codes - simply did not exist there. A Windows capture bug
 * had no trail to follow, which is exactly the state a first Windows test day
 * must not start in.
 *
 * This pins event-NAME parity rather than call counts, because Windows
 * legitimately has states macOS does not (the helper auto-restarts, macOS's
 * does not) and should be free to record more. It may never record less.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'main', f), 'utf8');
const MAC = read('system-audio-mac-service.ts');
const WIN = read('system-audio-windows-service.ts');

const events = (src) =>
  new Set([...src.matchAll(/appendAudioDiagnostic\(\s*'([a-z_]+)'/g)].map((m) => m[1]));

test('every diagnostic event macOS records, Windows records too', () => {
  const mac = events(MAC);
  const win = events(WIN);
  assert.ok(mac.size >= 5, 'the mac baseline should not have shrunk');
  const missing = [...mac].filter((e) => !win.has(e));
  assert.deepEqual(missing, [],
    `Windows is missing ${missing.join(', ')} - a Windows capture failure would ` +
    'leave no trail, which is how v1.0.97 shipped');
});

test('Windows writes to the same diagnostics file, not a parallel one', () => {
  assert.match(WIN, /from '\.\/audio-diagnostics'/,
    'a second log file would mean two places to look and one of them forgotten');
  assert.match(MAC, /from '\.\/audio-diagnostics'/);
});

test('Windows measures start-to-first-audio the way macOS does', () => {
  // Without readyInMs there is no Windows number to compare against the mac
  // startup figure at all.
  assert.match(WIN, /system_audio_ready/);
  assert.match(WIN, /readyInMs/);
  assert.match(MAC, /readyInMs/);
});

test('the events Windows has that macOS does not are additive, never renamed', () => {
  // Windows auto-restarts its helper; macOS does not. Those extra states must
  // ride on the shared event names so one query finds both platforms.
  const win = events(WIN);
  for (const shared of ['system_audio_start_requested', 'system_audio_ready',
                        'system_audio_stall', 'system_audio_start_failed',
                        'system_audio_helper_status']) {
    assert.ok(win.has(shared), `Windows dropped the shared event ${shared}`);
  }
});

test('both services record the failure code, not just a message', () => {
  for (const [name, src] of [['mac', MAC], ['windows', WIN]]) {
    const at = src.indexOf('system_audio_start_failed');
    assert.ok(at > 0, `${name} never records a start failure`);
    assert.match(src.slice(at, at + 400), /code:/,
      `${name} records a failure without a code - unqueryable`);
  }
});
