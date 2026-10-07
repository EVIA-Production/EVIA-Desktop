// A finished Ask stream with no usable text collapsed the window to the bare
// input without a word (Windows 1.0.126 candidate: "test" before a call, the
// server streamed nothing). The empty branch must tell the rep and offer Retry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('an empty finished answer shows a retryable message instead of collapsing silently', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'AskView.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('handle.onDone(() => {');
  assert.ok(start >= 0, 'onDone handler present');
  const done = source.slice(start, source.indexOf('// Final measurement from the actual visible DOM', start));
  const emptyBranch = done.slice(done.lastIndexOf('} else {'));
  assert.match(emptyBranch, /trackFailure\('backend', 'unavailable'\)/);
  assert.match(emptyBranch, /showError\([\s\S]*kein verlässlicher Vorschlag[\s\S]*No reliable suggestion[\s\S]*true,?\s*\)/);
});
