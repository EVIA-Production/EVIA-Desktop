const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const readiness = import(pathToFileURL(path.join(__dirname, '../onboarding-runtime/output/onboarding-prototype/renderer-readiness.mjs')));
const never = () => new Promise(() => {});

async function fixture(overrides = {}) {
  const { prepareFirstPaint, boundedReadiness } = await readiness;
  const events = [], messages = [], views = [];
  const initial = { checkpoint: { view: 'personalize', fields: { company: 'Keep these answers' } } };
  const options = {
    native: true, bridge: { request: async () => initial, send: message => messages.push(message) },
    render: value => views.push(value), image: async () => {}, fonts: async () => {}, nextFrame: async () => {},
    trace: step => events.push(step), wait: (task, step, settings) => boundedReadiness(task, step, { ...settings, timeoutMs: 10 }),
    ...overrides,
  };
  return { run: () => prepareFirstPaint(options), options, events, messages, views, initial };
}

test('first-paint acknowledgement follows the resumed view, image, fonts and two frames', async () => {
  let frames = 0;
  const f = await fixture({ nextFrame: async () => { frames++; } });
  assert.deepEqual(await f.run(), f.initial);
  assert.deepEqual(f.views, [f.initial]);
  assert.equal(frames, 2);
  assert.deepEqual(f.messages, [{ type: 'onboarding-presentable' }]);
  for (const step of ['bridge-available', 'initial-state-end', 'rendered', 'image-end', 'fonts-end', 'assets-ready', 'frames-end', 'acknowledged']) assert.ok(f.events.includes(step), step);
  assert.ok(f.events.indexOf('acknowledged') > f.events.indexOf('assets-ready'));
});
test('a hanging initial-state fails without rendering a fresh profile or acknowledging', async () => {
  const f = await fixture({ bridge: { request: never, send: () => assert.fail('must not acknowledge') } });
  await assert.rejects(f.run(), { code: 'READINESS_TIMEOUT' });
  assert.deepEqual(f.views, []);
  assert.ok(f.events.includes('initial-state-timeout'));
});
test('a native renderer without preload bridge fails, not browser-preview success', async () => {
  const f = await fixture({ bridge: null });
  await assert.rejects(f.run(), /bridge unavailable/);
  assert.deepEqual(f.views, []);
});
test('image failure cannot acknowledge a blank launch mark', async () => {
  const f = await fixture({ image: async () => { throw Error('missing'); } });
  await assert.rejects(f.run(), /missing/);
  assert.deepEqual(f.messages, []);
  assert.ok(f.events.includes('image-error'));
});
test('hanging image decode fails within its budget', async () => {
  const f = await fixture({ image: never });
  await assert.rejects(f.run(), { code: 'READINESS_TIMEOUT' });
  assert.deepEqual(f.messages, []);
});
test('hanging fonts can fall back to system fonts', async () => {
  const f = await fixture({ fonts: never });
  await f.run();
  assert.ok(f.events.includes('fonts-timeout'));
  assert.equal(f.messages.length, 1);
});
test('missing compositor frames are bounded after the actual view and launch mark are ready', async () => {
  const f = await fixture({ nextFrame: never });
  await f.run();
  assert.ok(f.events.includes('frames-timeout'));
  assert.equal(f.views.length, 1);
  assert.equal(f.messages.length, 1);
});
test('a render exception is not mistaken for first paint', async () => {
  const f = await fixture({ render: () => { throw Error('render failed'); } });
  await assert.rejects(f.run(), /render failed/);
  assert.deepEqual(f.messages, []);
});
test('late resolution after timeout cannot produce a second outcome', async () => {
  const { boundedReadiness } = await readiness;
  let finish, fire, cleared = 0;
  const events = [];
  const promise = boundedReadiness(() => new Promise(resolve => { finish = resolve; }), 'test', {
    setTimer: callback => { fire = callback; return 1; }, clearTimer: () => { cleared++; }, trace: step => events.push(step),
  });
  await Promise.resolve();fire();
  await assert.rejects(promise, { code: 'READINESS_TIMEOUT' });
  finish('late');await Promise.resolve();await Promise.resolve();
  assert.equal(cleared, 1);
  assert.deepEqual(events, ['test-start', 'test-timeout']);
});
test('a fresh first run without a checkpoint renders and acknowledges the same way', async () => {
  const f = await fixture({ bridge: { request: async () => ({ checkpoint: null }), send: message => f.messages.push(message) } });
  await f.run();
  assert.deepEqual(f.views, [{ checkpoint: null }]);
  assert.deepEqual(f.messages, [{ type: 'onboarding-presentable' }]);
  assert.ok(f.events.indexOf('rendered') > f.events.indexOf('initial-state-end'));
});
