/**
 * Every ask request must declare which control the user pressed.
 *
 * The backend cannot recover this from the text. `_is_direct_question_to_taylos`
 * ends with "or it ends with '?'", so a summary bullet Taylos itself wrote -
 * "Wie steht es um das Budget?" - was read as a question put to Taylos, and
 * tapping it returned a definition instead of a line the seller could say. A
 * typed question and a tapped bullet are the same string on the wire; only the
 * client knows they came from different handlers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...parts), 'utf8').replace(/\r\n/g, '\n');

const stream = read('renderer', 'lib', 'evia-ask-stream.ts');
const askView = read('renderer', 'overlay', 'AskView.tsx');
const listenView = read('renderer', 'overlay', 'ListenView.tsx');
const relay = read('main', 'overlay-windows.ts');

test('the source reaches the wire', () => {
  // A field that never makes it into the payload leaves the backend inferring.
  assert.match(stream, /query_source: querySource/);
  for (const source of ['user_typed', 'quick_action', 'insight_click', 'shortcut']) {
    assert.match(stream, new RegExp(`'${source}'`), `${source} missing from the union`);
  }
});

test('the typed box is the only default', () => {
  // startStream is reached directly by the form, the Enter key and the submit
  // button - all of them the ask box. Every other caller states its own.
  assert.match(askView, /querySource: AskQuerySource = 'user_typed'/);
  assert.match(askView, /querySource,\n\s*\}\);/);
});

test('each control declares what it is', () => {
  // The two authored buttons are requests to Taylos; the two bullet lists are
  // excerpts of the seller's own call. Same channel, opposite meaning.
  assert.match(listenView, /querySource: AskQuerySource = 'insight_click'/);
  assert.match(
    listenView,
    /handleInsightClick\(action\.label, action\.prompt, 'quick_action'\)/,
  );
  assert.match(listenView, /whatToSayNextPrompt'\), 'quick_action'\)/);
  // Anchored to the send call itself rather than to "querySource," being the
  // last line before the closing brace. The old form broke the moment another
  // field was added after it, which asserted field ORDER while claiming to
  // assert presence.
  const sendAt = listenView.indexOf("eviaIpc.send('ask:send-and-submit', {");
  assert.ok(sendAt > 0, 'the send-and-submit call is gone');
  const payload = listenView.slice(sendAt, listenView.indexOf('});', sendAt));
  assert.match(payload, /\bquerySource,/, 'the IPC payload drops the source');

  // The two summary lists must NOT relabel themselves - they are the case the
  // backend gets wrong without provenance.
  assert.match(listenView, /handleInsightClick\(point\)\}/);
  assert.match(listenView, /handleInsightClick\(bullet\)\}/);
});

test('the shortcut is never mistaken for a typed question', () => {
  assert.match(askView, /startStream\(false, undefined, 'shortcut'\)/);
});

test('a retry resends the original source', () => {
  // Relabelling a retried insight click as 'user_typed' would flip the
  // backend's reading of the very request that already failed once.
  assert.match(askView, /lastQuerySourceRef\.current = querySource/);
  assert.match(askView, /startStreamRef\.current\?\.\(false, undefined, lastQuerySourceRef\.current\)/);
});

test('the main-process relay carries the field', () => {
  // The relay re-types the payload; a stale type silently drops the field.
  const line = relay.split('\n').find((l) => l.includes("ipcMain.on('ask:send-and-submit'"));
  assert.ok(line, 'relay handler missing');
  assert.match(line, /querySource\?: string/);
});

test('an insights payload without a source is still an insights payload', () => {
  // Older senders emit a bare string on this channel. Defaulting it to
  // 'user_typed' would reintroduce the exact bug for them.
  assert.match(askView, /\?\?\s*'insight_click'/);
});
