/**
 * Logging out must stop recording. This is the privacy blocker.
 *
 * `captureSessionController.reset('logout')` only mutates an in-memory
 * snapshot to 'idle', and its single subscriber broadcasts that snapshot.
 * Nothing in that chain touched the ScreenCaptureKit helper or the renderer's
 * getUserMedia track, so a logged-out Taylos kept recording the microphone and
 * the system output - including the other party on the call, who never
 * consented to a logged-out app. In a German B2B tool that is §201 StGB
 * territory, and the exposure is the operator's, not a bug report.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...parts), 'utf8');

const main = read('main', 'main.ts');
const overlay = read('renderer', 'overlay', 'overlay-entry.tsx');

test('logout stops the native audio helpers', () => {
  const start = main.indexOf("ipcMain.handle('auth:logout'");
  assert.notEqual(start, -1, 'missing auth:logout handler');
  const body = main.slice(start, main.indexOf('});', start));

  assert.match(
    body,
    /await stopAllPhysicalCapture\('logout'\)/,
    'logout no longer stops physical capture',
  );

  // Ordering matters: reset() flips the snapshot to 'idle', and a renderer that
  // sees 'idle' first may conclude it has nothing to stop.
  assert.ok(
    body.indexOf('stopAllPhysicalCapture') < body.indexOf("captureSessionController.reset('logout')"),
    'capture must be stopped BEFORE the state snapshot is reset',
  );
});

test('the stop covers both platforms and survives a dead window', () => {
  const start = main.indexOf('async function stopAllPhysicalCapture(');
  assert.notEqual(start, -1);
  const body = main.slice(start, main.indexOf('\n}', start));

  assert.match(body, /systemAudioMacService\.stop\(\)/);
  assert.match(body, /systemAudioWindowsService\.stop\(\)/);
  // allSettled, not all: one platform helper failing must not strand the other.
  assert.match(body, /Promise\.allSettled/);
  assert.match(body, /capture:force-stop/);
  // A destroyed window must not throw past the helper shutdown.
  assert.match(body, /win\.isDestroyed\(\)/);
});

test('the renderer releases the microphone when told', () => {
  assert.match(overlay, /eviaIpc\.on\('capture:force-stop', handleForceStopCapture\)/);
  assert.match(overlay, /eviaIpc\.off\?\.\('capture:force-stop', handleForceStopCapture\)/);

  const start = overlay.indexOf('const handleForceStopCapture =');
  const body = overlay.slice(start, overlay.indexOf('\n    }', start));
  assert.match(body, /await stopCapture\(/);
  // The handle must be cleared even if stopCapture threw, or the next start
  // believes capture is already running and never re-acquires the mic.
  assert.match(body, /finally \{/);
  assert.match(body, /captureHandleRef\.current = null/);
});
