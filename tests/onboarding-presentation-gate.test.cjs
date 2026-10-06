// Behavioural contract for the onboarding owner window: hidden until its first
// paint is acknowledged, shown exactly once, never left waiting forever.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { createPresentationGate } = require(path.join(__dirname, '..', 'onboarding-runtime', 'output', 'onboarding-prototype', 'presentation-gate.cjs'));

function fakeWindow() {
  const calls = [];
  let destroyed = false;
  const record = name => (...args) => calls.push([name, ...args]);
  return {
    calls,
    count: name => calls.filter(([call]) => call === name).length,
    setOpacity: record('setOpacity'),
    setIgnoreMouseEvents: record('setIgnoreMouseEvents'),
    showInactive: record('showInactive'),
    show: record('show'),
    hide: record('hide'),
    isDestroyed: () => destroyed,
    destroy() { destroyed = true; },
  };
}

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimer(callback) { const id = next++; pending.set(id, callback); return id; },
    clearTimer(id) { pending.delete(id); },
    fire() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback()); },
    get pending() { return pending.size; },
  };
}

function gateFor(platform) {
  const window = fakeWindow(), timers = fakeTimers();
  const events = { present: [], fail: [] };
  const gate = createPresentationGate({
    window, platform, timeoutMs: 9000, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    onPresent: reason => events.present.push(reason), onFail: reason => events.fail.push(reason),
  });
  return { gate, window, timers, events };
}

test('macOS: the owner stays untouched until the renderer acknowledges, then presents once', async () => {
  const { gate, window, timers, events } = gateFor('darwin');
  assert.equal(gate.prime(), false, 'macOS keeps its existing hidden-until-painted flow');
  assert.equal(window.calls.length, 0);
  assert.equal(gate.acknowledge(), true);
  assert.deepEqual(await gate.outcome, { presented: true, reason: 'acknowledged' });
  assert.deepEqual(events.present, ['acknowledged']);
  assert.equal(timers.pending, 0, 'the fallback timer is cleared');
  assert.equal(gate.acknowledge(), false, 'a second acknowledgement cannot present again');
  assert.deepEqual(events.present, ['acknowledged']);
});

test('Windows: the owner is shown invisible and click-through first, then made visible on acknowledgement', async () => {
  const { gate, window, events } = gateFor('win32');
  assert.equal(gate.prime(), true);
  assert.equal(gate.prime(), false, 'priming happens once');
  assert.deepEqual(window.calls, [['setOpacity', 0], ['setIgnoreMouseEvents', true], ['showInactive']]);
  gate.acknowledge();
  assert.deepEqual((await gate.outcome).presented, true);
  assert.deepEqual(window.calls.slice(3), [['setIgnoreMouseEvents', false], ['setOpacity', 1]]);
  assert.equal(window.count('show'), 0, 'the caller focuses; the gate never shows twice');
  assert.deepEqual(events.present, ['acknowledged']);
});

test('a DOM render without first-paint acknowledgement fails, never reveals an unverified surface', async () => {
  const { gate, timers, events } = gateFor('win32');
  gate.prime();
  gate.markRendered();
  timers.fire();
  assert.deepEqual(await gate.outcome, { presented: false, reason: 'not-presentable' });
  assert.equal(gate.acknowledge(), false, 'a late acknowledgement cannot present again');
  assert.deepEqual(events.present, []);
  assert.deepEqual(events.fail, ['not-presentable']);
});

test('a renderer that never drew fails instead of waiting forever, and hides the invisible owner', async () => {
  const { gate, window, timers, events } = gateFor('win32');
  gate.prime();
  timers.fire();
  assert.deepEqual(await gate.outcome, { presented: false, reason: 'not-presentable' });
  assert.equal(window.count('hide'), 1);
  assert.equal(gate.acknowledge(), false, 'a late acknowledgement after failure shows nothing');
  assert.deepEqual(events.present, []);
  assert.deepEqual(events.fail, ['not-presentable']);
});

test('a load failure or renderer crash fails at once; the timer cannot act afterwards', async () => {
  const { gate, timers, events } = gateFor('darwin');
  assert.equal(gate.fail('renderer-gone'), true);
  assert.equal(timers.pending, 0);
  assert.equal(gate.fail('load-failed'), false);
  assert.deepEqual(await gate.outcome, { presented: false, reason: 'renderer-gone' });
  assert.deepEqual(events.fail, ['renderer-gone']);
});

test('a destroyed owner is never presented', async () => {
  const { gate, window, events } = gateFor('win32');
  window.destroy();
  assert.equal(gate.prime(), false);
  gate.acknowledge();
  assert.deepEqual(await gate.outcome, { presented: false, reason: 'window-destroyed' });
  assert.deepEqual(events.present, []);
});
