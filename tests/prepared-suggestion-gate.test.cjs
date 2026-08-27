/**
 * The one rule that makes a prepared answer safe to show: the transcript has
 * not moved since it was written.
 *
 * These run against src/renderer/lib/prepared-suggestion.ts itself, transpiled
 * in memory. Testing a hand-copied gate would prove nothing about the gate that
 * actually ships - and this is the exact place where a copy already drifted
 * once: the speculative prefetch compared a Python-side hash to a
 * TypeScript-side string, and every one of 18 clicks missed.
 *
 * The transcript strings here are real `buildTranscriptContext` output shapes,
 * including the two markers that made the prefetch fingerprints diverge: the
 * '⁇' low-confidence marker and the '[...spricht noch]' still-speaking marker.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'lib', 'prepared-suggestion.ts');

function load() {
  const js = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new Module(SRC, null);
  m.filename = SRC;
  m.paths = Module._nodeModulePaths(path.dirname(SRC));
  m._compile(js, SRC);
  return m.exports;
}

const { decidePrepared, isCanonicalLiveAction, CANONICAL_LIVE_ACTIONS } = load();

const DE = '💬 Was soll ich als Nächstes sagen?';
const EN = '💬 What should I say next?';
const T1 = 'Seller: Guten Tag, hier ist Ben.\nProspect: Was kostet das?';
const T2 = 'Seller: Guten Tag, hier ist Ben.\nProspect: Was kostet das?\nSeller: Der Einstieg liegt bei 3.990 Euro.';

const snap = (transcript, fields) => ({ requestTranscript: transcript, fields });
const ok = { prepared_suggestion: 'Der Einstieg liegt bei 3.990 Euro.', suggestion_id: 'abc', context_fingerprint: 'fp1' };

test('an unchanged transcript is a hit and returns the text verbatim', () => {
  const r = decidePrepared(DE, snap(T1, ok), T1);
  assert.equal(r.kind, 'prepared_hit');
  assert.equal(r.text, 'Der Einstieg liegt bei 3.990 Euro.');
  assert.equal(r.suggestionId, 'abc');
  assert.equal(r.fingerprint, 'fp1');
});

test('both canonical labels are recognised, nothing else is', () => {
  assert.equal(isCanonicalLiveAction(DE), true);
  assert.equal(isCanonicalLiveAction(EN), true);
  assert.equal(isCanonicalLiveAction('📖 ROI erklaeren'), false);
  assert.equal(isCanonicalLiveAction('Was soll ich als Nächstes sagen?'), false, 'emoji is part of the label');
  assert.equal(isCanonicalLiveAction(undefined), false);
  assert.equal(CANONICAL_LIVE_ACTIONS.length, 2);
});

test('one more turn invalidates the prepared answer', () => {
  const r = decidePrepared(DE, snap(T1, ok), T2);
  assert.equal(r.kind, 'prepared_miss');
  assert.equal(r.reason, 'context_moved');
});

test('a single added character invalidates it - no partial credit', () => {
  const r = decidePrepared(DE, snap(T1, ok), T1 + '.');
  assert.equal(r.kind, 'prepared_miss');
  assert.equal(r.reason, 'context_moved');
});

test('the uncertainty marker that broke prefetch is not ignored here', () => {
  // '⁇' is appended per low-confidence word on one path only. Treating the two
  // strings as equal is precisely the defect that made 18/18 clicks miss.
  const withMarker = 'Seller: Guten Tag, hier ist Ben.\nProspect: Was kostet das⁇';
  const r = decidePrepared(DE, snap(withMarker, ok), T1);
  assert.equal(r.kind, 'prepared_miss');
  assert.equal(r.reason, 'context_moved');
});

test('the still-speaking marker also counts as a different context', () => {
  const speaking = T1 + ' […spricht noch]';
  assert.equal(decidePrepared(DE, snap(speaking, ok), T1).reason, 'context_moved');
  assert.equal(decidePrepared(DE, snap(T1, ok), speaking).reason, 'context_moved');
});

test('a non-canonical action never takes the prepared path', () => {
  const r = decidePrepared('📖 ROI erklaeren', snap(T1, ok), T1);
  assert.equal(r.kind, 'prepared_miss');
  assert.equal(r.reason, 'not_canonical_action');
});

test('no snapshot means interactive, not an error', () => {
  assert.equal(decidePrepared(DE, null, T1).reason, 'no_snapshot');
});

test('a snapshot without a prepared field is a miss, not a blank display', () => {
  const r = decidePrepared(DE, snap(T1, { suggestion_id: 'x' }), T1);
  assert.equal(r.kind, 'prepared_miss');
  assert.equal(r.reason, 'no_prepared_suggestion');
});

test('whitespace-only text never reaches the seller', () => {
  const r = decidePrepared(DE, snap(T1, { prepared_suggestion: '   \n  ' }), T1);
  assert.equal(r.kind, 'prepared_miss');
  assert.equal(r.reason, 'empty_after_trim');
});

test('an empty transcript on both sides still requires equality, not truthiness', () => {
  const r = decidePrepared(DE, snap('', ok), '');
  assert.equal(r.kind, 'prepared_hit', 'equal contexts match even when empty');
  assert.equal(decidePrepared(DE, snap('', ok), T1).reason, 'context_moved');
});

test('a hit never mutates the snapshot it was decided from', () => {
  const s = snap(T1, ok);
  const before = JSON.stringify(s);
  decidePrepared(DE, s, T1);
  assert.equal(JSON.stringify(s), before);
});

test('the English canonical label works identically', () => {
  const r = decidePrepared(EN, snap(T1, ok), T1);
  assert.equal(r.kind, 'prepared_hit');
});
