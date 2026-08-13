/**
 * One call must produce one answer.
 *
 * The per-window telemetry line is right for watching a call and wrong for
 * deciding whether AEC works. In the 2026-08-12 acceptance run 89% of the lines
 * read "mic silent" or "REFERENCE SILENT" - both correct, both carrying no
 * information - and the run was read as an AEC failure. Re-measured offline
 * from the saved tracks, the reference was byte-identical to the system track
 * and the mic-to-system correlation was 0.042: there was no echo in the room to
 * cancel. Nothing was broken and nothing was proven.
 *
 * These tests pin the distinction the per-window line cannot make.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AecSessionAccumulator,
  describeSessionVerdict,
} = require('../dist/main/aec-telemetry.js');

/** A telemetry window. Defaults describe a healthy, cancelling one. */
function windowReport(overrides = {}) {
  return {
    erleDb: 20,
    delayMs: 60,
    delayConfidence: 100,
    coherence: 0.5,
    referenceGapRatio: 0,
    micLevelDb: -22,
    refLevelDb: -22,
    ...overrides,
  };
}

function verdictFor(reports) {
  const accumulator = new AecSessionAccumulator();
  for (const report of reports) accumulator.add(report);
  return describeSessionVerdict(accumulator.summarise());
}

test('silent windows never count as usable', () => {
  const accumulator = new AecSessionAccumulator();
  for (let i = 0; i < 50; i += 1) {
    accumulator.add(windowReport({ micLevelDb: -70, refLevelDb: -120 }));
  }
  const summary = accumulator.summarise();
  assert.equal(summary.totalWindows, 50);
  assert.equal(summary.usableWindows, 0, 'silence cannot demonstrate anything');
});

test('a reference gap disqualifies the window even at a healthy level', () => {
  const accumulator = new AecSessionAccumulator();
  accumulator.add(windowReport({ referenceGapRatio: 0.9 }));
  assert.equal(accumulator.summarise().usableWindows, 0);
});

test('a call with almost no overlap reports UNTESTABLE, not failure', () => {
  // The exact shape of the 2026-08-12 run: plenty of windows, mic active for
  // some, far end active for a few, the two almost never together.
  const reports = [];
  for (let i = 0; i < 100; i += 1) {
    reports.push(windowReport({ micLevelDb: -70, refLevelDb: -120, erleDb: 0.3 }));
  }
  for (let i = 0; i < 20; i += 1) {
    reports.push(windowReport({ micLevelDb: -24, refLevelDb: -120, erleDb: 0.4 }));
  }
  const verdict = verdictFor(reports);
  assert.match(verdict, /UNTESTABLE/);
  assert.doesNotMatch(verdict, /REAL DEFECT/, 'an empty call is not a defect');
  assert.match(verdict, /talk continuously/, 'must say how to get a usable call');
});

test('echo-free but audible on both sides is diagnosed as headphones', () => {
  // Both sides loud, coherence at the noise floor. This is the measured 0.042
  // case, and it must NOT be reported as a broken canceller.
  const verdict = verdictFor(
    Array.from({ length: 30 }, () => windowReport({ coherence: 0.005, erleDb: 1.1 })),
  );
  assert.match(verdict, /NO ECHO REACHED THE MIC/);
  assert.match(verdict, /speakers/, 'must name the fix');
  assert.doesNotMatch(verdict, /REAL DEFECT/);
});

test('echo present and linear but uncancelled is the one real defect', () => {
  const verdict = verdictFor(
    Array.from({ length: 30 }, () => windowReport({ coherence: 0.6, erleDb: 1.0 })),
  );
  assert.match(verdict, /REAL DEFECT/);
  assert.match(verdict, /worth reporting/);
});

test('a working canceller says so plainly', () => {
  const verdict = verdictFor(
    Array.from({ length: 30 }, () => windowReport({ coherence: 0.6, erleDb: 22 })),
  );
  assert.match(verdict, /WORKING/);
  assert.doesNotMatch(verdict, /UNTESTABLE|DEFECT/);
});

test('partial cancellation is distinguished from working and from broken', () => {
  const verdict = verdictFor(
    Array.from({ length: 30 }, () => windowReport({ coherence: 0.4, erleDb: 9 })),
  );
  assert.match(verdict, /PARTIALLY/);
});

test('weak linearity is reported as acoustics, not as a filter fault', () => {
  const verdict = verdictFor(
    Array.from({ length: 30 }, () => windowReport({ coherence: 0.08, erleDb: 4 })),
  );
  assert.match(verdict, /WEAKLY LINEAR/);
  assert.match(verdict, /volume/);
});

test('the summary reports medians over usable windows only', () => {
  const accumulator = new AecSessionAccumulator();
  // Noise that must be excluded.
  for (let i = 0; i < 40; i += 1) {
    accumulator.add(windowReport({ micLevelDb: -80, refLevelDb: -120, erleDb: 0 }));
  }
  // Signal.
  for (const erle of [10, 20, 30]) {
    accumulator.add(windowReport({ erleDb: erle }));
  }
  const summary = accumulator.summarise();
  assert.equal(summary.usableWindows, 3);
  assert.equal(summary.medianErleDb, 20, 'silent windows must not drag the median down');
  assert.equal(summary.bestErleDb, 30);
});
