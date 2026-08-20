/**
 * The save-transcript button must reach the main-process write path.
 *
 * 9c28cc9 added the dialog and the write on `transcript:export`, and exposed
 * it as window.evia.windows.exportTranscript. The click handler called
 * window.api.listenView.exportTranscript instead. That object is a TypeScript
 * declaration only - nothing ever assigns it - so optional chaining returned
 * undefined, the save dialog never opened, and no error toast fired either.
 *
 * Trigger: switch to transcript view during or after a call, click the new
 * download button. The record the seller asked for on 2026-08-13 is lost.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...parts), 'utf8');

const listenView = read('renderer', 'overlay', 'ListenView.tsx');
const preload = read('main', 'preload.ts');
const main = read('main', 'overlay-windows.ts');

test('the click uses the bridged evia.windows API, not the unbridged window.api', () => {
  assert.match(
    listenView,
    /evia\?\.windows\?\.exportTranscript\?/,
    'the click must call the API preload actually exposes',
  );
  assert.doesNotMatch(
    listenView,
    /api\?\.listenView\?\.exportTranscript/,
    'window.api.listenView is never assigned; a call there is a silent no-op',
  );
});

test('preload forwards exportTranscript to the save handler', () => {
  assert.match(
    preload,
    /exportTranscript:\s*\(markdown:\s*string,\s*suggestedName\?:\s*string\)\s*=>\s*ipcRenderer\.invoke\('transcript:export'/,
  );
});

test('main writes the markdown the renderer built', () => {
  assert.match(main, /ipcMain\.handle\('transcript:export'/);
  assert.match(main, /fsPromises\.writeFile\(result\.filePath,\s*markdown,\s*'utf8'\)/);
});
