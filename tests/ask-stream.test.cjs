const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');

const entry = path.resolve(__dirname, '../src/renderer/lib/evia-ask-stream.ts');
const compiled = buildSync({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs' });
const loaded = new Module(entry, module);
loaded._compile(compiled.outputFiles[0].text, entry);
const { streamAsk } = loaded.exports;
const params = { baseUrl: 'https://api.test.invalid', chatId: 1, prompt: 'Next?', language: 'en', sessionState: 'during', token: 'test-token' };
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(t, fetchImpl) {
  const original = global.fetch;
  let push;
  let end;
  let fail;
  let calls = 0;
  let payload;
  let cancelled = false;
  const body = new ReadableStream({
    start(c) { push = data => c.enqueue(new TextEncoder().encode(data)); end = () => c.close(); fail = error => c.error(error); },
    cancel() { cancelled = true; },
  });
  global.fetch = async (_url, init) => {
    calls++;
    payload = JSON.parse(init.body);
    return fetchImpl ? fetchImpl(init, calls) : new Response(body);
  };
  t.after(() => { global.fetch = original; });
  const events = [];
  const handle = streamAsk(params);
  handle.onDelta(text => events.push(['delta', text]));
  handle.onReplace(text => events.push(['replace', text]));
  handle.onDone(() => events.push(['done']));
  handle.onError(error => events.push(['error', error.message]));
  t.after(() => handle.abort());
  return { handle, events, push, end, fail, get calls() { return calls; }, get payload() { return payload; }, get cancelled() { return cancelled; } };
}

test('Ask displays tokens while the response is still open, then replaces with the checked final', async t => {
  const h = harness(t);
  h.push('{"delta":"If we"}\n');
  await tick();
  assert.deepEqual(h.events, [['delta', 'If we']]);
  assert.equal(h.payload.stream_live_advice, true);
  h.push('{"delta":" agree"}\n{"replace":true,"text":"What would make this work?"}\n{"done":true}\n');
  await tick();
  assert.deepEqual(h.events, [['delta', 'If we'], ['delta', ' agree'], ['replace', 'What would make this work?'], ['done']]);
  assert.equal(h.cancelled, true);
});

test('fragmented UTF-8 and a final record without newline are not lost', async t => {
  const bytes = new TextEncoder().encode('{"delta":"Möchten Sie"}\n{"done":true}');
  const split = bytes.indexOf(0xc3) + 1;
  const h = harness(t, () => new Response(new ReadableStream({ start(c) {
    c.enqueue(bytes.slice(0, split)); c.enqueue(bytes.slice(split, split + 8)); c.enqueue(bytes.slice(split + 8)); c.close();
  } })));
  await tick();
  assert.deepEqual(h.events, [['delta', 'Möchten Sie'], ['done']]);
});

test('an empty authoritative replacement retracts the preview', async t => {
  const h = harness(t);
  h.push('{"delta":"Draft"}\n{"replace":true,"text":""}\n{"done":true}\n');
  await tick();
  assert.deepEqual(h.events, [['delta', 'Draft'], ['replace', ''], ['done']]);
});

test('provider rejection after partial text is an error, never a completed answer', async t => {
  const h = harness(t);
  h.push('{"delta":"Draft"}\n{"meta":{"type":"provider_error","reason":"guard_rejected"}}\n{"done":true}\n');
  await tick();
  assert.deepEqual(h.events, [['delta', 'Draft'], ['error', 'SUGGESTION_UNAVAILABLE:guard_rejected']]);
  assert.equal(h.cancelled, true);
});

test('a dropped stream never silently completes or starts a second generation after tokens', async t => {
  const h = harness(t);
  h.push('{"delta":"Draft"}\n');
  await tick();
  h.fail(new TypeError('Failed to fetch'));
  await tick();
  assert.deepEqual(h.events, [['delta', 'Draft'], ['error', 'Failed to fetch']]);
  assert.equal(h.calls, 1);
});

test('EOF without a done event is an error, not a completed partial answer', async t => {
  const h = harness(t);
  h.push('{"delta":"Draft"}\n'); h.end();
  await tick();
  assert.deepEqual(h.events, [['delta', 'Draft'], ['error', 'Incomplete Ask stream']]);
});

test('malformed JSON terminates the stream instead of delivering later records', async t => {
  const h = harness(t);
  h.push('not json\n{"delta":"Must not appear"}\n{"done":true}\n');
  await tick();
  assert.deepEqual(h.events, [['error', 'Malformed JSONL line']]);
});

test('aborting during delivery suppresses even coalesced later records', async t => {
  const h = harness(t);
  h.handle.onDelta(text => { h.events.push(['delta', text]); h.handle.abort(); });
  h.push('{"delta":"First"}\n{"delta":"Stale"}\n{"done":true}\n');
  await tick();
  assert.deepEqual(h.events, [['delta', 'First']]);
  assert.equal(h.cancelled, true);
});

test('trace metadata does not hide a delta or completion on the same record', async t => {
  const h = harness(t);
  h.push('{"meta":{"type":"request_trace"},"delta":"Hello","done":true}\n');
  await tick();
  assert.deepEqual(h.events, [['delta', 'Hello'], ['done']]);
});
