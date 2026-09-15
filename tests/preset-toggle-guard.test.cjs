/**
 * A deactivate click within two seconds of activating the same preset is a
 * double-click, not a decision. PostHog 2026-09: activate -> deactivate pairs
 * 543 ms (Desktop) and 711 ms (web) apart, both followed by a call on no preset.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRendererTs } = require('./_load-renderer-ts.cjs');

const { isAccidentalDeactivate, recordActivation, ACCIDENTAL_DEACTIVATE_WINDOW_MS } =
  loadRendererTs('lib/preset-toggle-guard.ts');

test('the measured production pairs are caught', () => {
  const recent = recordActivation(203, 1000);
  assert.equal(isAccidentalDeactivate(recent, 203, 1000 + 543), true);
  assert.equal(isAccidentalDeactivate(recent, 203, 1000 + 711), true);
});

test('a deliberate deactivate after the window goes through', () => {
  const recent = recordActivation(203, 1000);
  assert.equal(isAccidentalDeactivate(recent, 203, 1000 + ACCIDENTAL_DEACTIVATE_WINDOW_MS), false);
  assert.equal(isAccidentalDeactivate(recent, 203, 1000 + 60_000), false);
});

test('a different preset, no recent activation, or a clock that went backwards is never blocked', () => {
  const recent = recordActivation(203, 1000);
  assert.equal(isAccidentalDeactivate(recent, 211, 1200), false);
  assert.equal(isAccidentalDeactivate(null, 203, 1200), false);
  assert.equal(isAccidentalDeactivate(undefined, 203, 1200), false);
  assert.equal(isAccidentalDeactivate(recent, 203, 900), false);
});

test('ids compare as strings, so 203 and "203" are the same preset', () => {
  assert.equal(isAccidentalDeactivate(recordActivation('203', 0), 203, 100), true);
});
