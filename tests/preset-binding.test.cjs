/**
 * The Listen-start check: does the chat this window would reuse still match
 * the preset the user has active? Fails OPEN on every uncertainty - the one
 * thing it may never do is hold or break the Listen click.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRendererTs } = require('./_load-renderer-ts.cjs');

const { presetBindingMismatch, ensureSessionMatchesActivePreset } = loadRendererTs('lib/preset-binding.ts');

const prefs = (data) => async () => ({ ok: true, data });
const presets = (list) => async () => ({ ok: true, prompts: list });
const never = () => new Promise(() => {});

function harness({ prefsData, presetList, idle = true, listPresets, readPrefs }) {
  const calls = { cleared: 0 };
  const deps = {
    readPrefs: readPrefs ?? prefs(prefsData),
    listPresets: listPresets ?? presets(presetList ?? []),
    clearBinding: () => { calls.cleared += 1; },
    isIdle: () => idle,
    log: () => {},
  };
  return { deps, calls };
}

test('mismatch rule: unknown binding is never a mismatch; null vs id is', () => {
  assert.equal(presetBindingMismatch(undefined, 210), false);
  assert.equal(presetBindingMismatch(null, null), false);
  assert.equal(presetBindingMismatch(null, 210), true);
  assert.equal(presetBindingMismatch(164, 210), true);
  assert.equal(presetBindingMismatch('210', 210), false);
  assert.equal(presetBindingMismatch(164, null), true, 'bound to A while nothing is active: the next chat must be unbound');
});

test('web-app activation after the chat was minted resets the binding', async () => {
  const { deps, calls } = harness({
    prefsData: { current_chat_id: '1903', current_chat_preset_id: null },
    presetList: [{ id: 210, is_active: true }, { id: 164, is_active: false }],
  });
  assert.equal(await ensureSessionMatchesActivePreset(deps, { timeoutMs: 50 }), 'reset');
  assert.equal(calls.cleared, 1);
});

test('a chat bound to the active preset is left alone', async () => {
  const { deps, calls } = harness({
    prefsData: { current_chat_id: '1929', current_chat_preset_id: 210 },
    presetList: [{ id: 210, is_active: true }],
  });
  assert.equal(await ensureSessionMatchesActivePreset(deps, { timeoutMs: 50 }), 'match');
  assert.equal(calls.cleared, 0);
});

test('no reusable chat means nothing to compare - the next chat binds correctly anyway', async () => {
  const { deps, calls } = harness({ prefsData: { current_chat_id: null }, presetList: [{ id: 210, is_active: true }] });
  assert.equal(await ensureSessionMatchesActivePreset(deps, { timeoutMs: 50 }), 'match');
  assert.equal(calls.cleared, 0);
});

test('a chat from a build that did not record its binding is not touched', async () => {
  const { deps, calls } = harness({ prefsData: { current_chat_id: '1800' }, presetList: [{ id: 210, is_active: true }] });
  assert.equal(await ensureSessionMatchesActivePreset(deps, { timeoutMs: 50 }), 'unknown');
  assert.equal(calls.cleared, 0);
});

test('a slow preset list fails open within the budget', async () => {
  const { deps, calls } = harness({
    prefsData: { current_chat_id: '1903', current_chat_preset_id: null },
    listPresets: never,
  });
  const started = Date.now();
  assert.equal(await ensureSessionMatchesActivePreset(deps, { timeoutMs: 40 }), 'unknown');
  assert.ok(Date.now() - started < 400, 'must not wait past the budget');
  assert.equal(calls.cleared, 0);
});

test('a failed preset list (401, 503) fails open', async () => {
  const { deps, calls } = harness({
    prefsData: { current_chat_id: '1903', current_chat_preset_id: null },
    listPresets: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(await ensureSessionMatchesActivePreset(deps, { timeoutMs: 50 }), 'unknown');
  assert.equal(calls.cleared, 0);
});

test('a live call is never touched', async () => {
  const { deps, calls } = harness({
    prefsData: { current_chat_id: '1903', current_chat_preset_id: null },
    presetList: [{ id: 210, is_active: true }],
    idle: false,
  });
  assert.equal(await ensureSessionMatchesActivePreset(deps, { timeoutMs: 50 }), 'skipped');
  assert.equal(calls.cleared, 0);
});

test('deactivating everything in the web app also resets a chat bound to a preset', async () => {
  const { deps, calls } = harness({
    prefsData: { current_chat_id: '1903', current_chat_preset_id: 164 },
    presetList: [{ id: 164, is_active: false }],
  });
  assert.equal(await ensureSessionMatchesActivePreset(deps, { timeoutMs: 50 }), 'reset');
  assert.equal(calls.cleared, 1);
});

test('prefs may arrive bare or in the { ok, data } envelope', async () => {
  const { deps } = harness({
    readPrefs: async () => ({ current_chat_id: '1929', current_chat_preset_id: 210 }),
    presetList: [{ id: 210, is_active: true }],
  });
  assert.equal(await ensureSessionMatchesActivePreset(deps, { timeoutMs: 50 }), 'match');
});

test('a call that started while the preset list was in flight is not touched', async () => {
  let idle = true;
  const calls = { cleared: 0 };
  const deps = {
    readPrefs: async () => ({ ok: true, data: { current_chat_id: '1903', current_chat_preset_id: null } }),
    listPresets: async () => { idle = false; return { ok: true, prompts: [{ id: 210, is_active: true }] }; },
    clearBinding: () => { calls.cleared += 1; },
    isIdle: () => idle,
    log: () => {},
  };
  assert.equal(await ensureSessionMatchesActivePreset(deps, { timeoutMs: 50 }), 'skipped');
  assert.equal(calls.cleared, 0);
});
