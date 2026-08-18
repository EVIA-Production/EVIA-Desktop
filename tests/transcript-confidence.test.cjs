/**
 * A word the recogniser was unsure of must not be quoted back.
 *
 * Deepgram scores every word and the backend normaliser discarded it, so the
 * client saw a confident-looking transcript. On 2026-08-18 "schlafe" arrived
 * as "laufe" and Taylos built its next move on the wrong verb.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lowConfidenceWords } = require('../dist/main/realtime-transcript-state.js');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const listen = read('renderer', 'overlay', 'ListenView.tsx');
const state = read('main', 'realtime-transcript-state.ts');

const w = (text, confidence) => ({ text, startMs: 0, endMs: 1, confidence });

test('only words below the threshold are flagged', () => {
  assert.deepEqual(lowConfidenceWords([w('Ich', 0.99), w('laufe', 0.41), w('sechs', 0.95)]), ['laufe']);
  assert.deepEqual(lowConfidenceWords([w('alles', 0.9), w('klar', 0.88)]), []);
});

test('a missing score reads as no reason to doubt', () => {
  // An older backend sends no confidence. Treating that as uncertain would
  // mark every word and make the signal meaningless.
  assert.deepEqual(lowConfidenceWords([w('Ich', undefined), w('laufe', undefined)]), []);
  assert.deepEqual(lowConfidenceWords([]), []);
});

test('the threshold is low enough to stay meaningful', () => {
  // Marking too much is the failure mode: the cost of a false positive is one
  // clarifying question, but a marker on every third word is noise.
  const m = state.match(/LOW_CONFIDENCE_THRESHOLD\s*=\s*([\d.]+)/);
  assert.ok(m, 'threshold must be named');
  const t = Number(m[1]);
  assert.ok(t > 0.3 && t <= 0.7, `threshold ${t} is outside the useful band`);
});

test('markers reach the prompt copy and never the screen', () => {
  // row.text is what the seller reads. A transcript peppered with markers is
  // worse than one that is occasionally wrong - and the seller HEARD the call.
  assert.match(listen, /uncertainWords/);
  assert.match(listen, /\\u2047/);
  const ctx = listen.indexOf('const filteredTranscriptContext');
  const block = listen.slice(ctx, ctx + 1400);
  assert.match(block, /uncertainWords/, 'the prompt copy must add markers');
});
