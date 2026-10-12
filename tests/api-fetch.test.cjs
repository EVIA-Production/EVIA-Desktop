const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/main/api-fetch.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: exportsObject, Request, URL, Date });
const { createApiFetch } = exportsObject;

test('API requests use Chromium and preserve request body, headers and response', async () => {
  const body = new FormData(); body.set('answers', 'private context');
  const init = { method: 'POST', body, headers: { Authorization: 'Bearer private-token' } };
  const reply = new Response('{}');
  const wrapped = createApiFetch(async (url, options) => { assert.equal(options, init); return reply; },
    () => { throw Error('Node fetch must not be used'); }, 'https://api.taylos.ai', () => { throw Error('unexpected error'); });
  assert.equal(await wrapped('https://api.taylos.ai/onboarding/profile/draft', init), reply);
});

test('network errors retain the original rejection and report endpoint without secrets', async () => {
  const original = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  const events = [];
  const wrapped = createApiFetch(async () => { throw original; }, fetch, 'https://api.taylos.ai', e => events.push(e));
  await assert.rejects(wrapped('https://api.taylos.ai/prompts?token=private-token'), e => e === original);
  assert.equal(events[0].error_code, 'ENOTFOUND');
  assert.equal(events[0].status_code, 0);
  assert.equal(events[0].endpoint, '/prompts');
  assert.doesNotMatch(JSON.stringify(events), /private-token|token=/);
});

test('HTTP errors are reported without reading or changing the response', async () => {
  const response = new Response('sensitive response', { status: 500 });
  const events = [];
  const wrapped = createApiFetch(async () => response, fetch, 'https://api.taylos.ai', e => events.push(e));
  assert.equal(await wrapped('https://api.taylos.ai/prompts'), response);
  assert.equal(response.bodyUsed, false);
  assert.equal(events[0].status_code, 500);
  assert.doesNotMatch(JSON.stringify(events), /sensitive/);
});

test('telemetry failures cannot recursively report themselves', async () => {
  let count = 0;
  const wrapped = createApiFetch(async () => new Response('', { status: 500 }), fetch, 'https://api.taylos.ai', () => count++);
  await wrapped('https://api.taylos.ai/client/telemetry/events');
  await wrapped('https://api.taylos.ai/telemetry/e/');
  assert.equal(count, 0);
});

test('reporting failures do not replace network errors; other origins retain Node fetch', async () => {
  const original = new Error('network');
  let fallback = false;
  const wrapped = createApiFetch(async () => { throw original; }, async () => { fallback = true; return new Response(); },
    'https://api.taylos.ai', () => { throw Error('disk unavailable'); });
  await assert.rejects(wrapped('https://api.taylos.ai/prompts'), e => e === original);
  await wrapped('https://example.com');
  assert.equal(fallback, true);
});
