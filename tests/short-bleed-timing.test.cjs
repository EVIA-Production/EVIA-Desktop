/**
 * The short bleeds from the 2026-08-20 call, which all survived.
 *
 * Every one the user reported was 2-7 words, so every one took the SHORT path,
 * which requires 45% temporal overlap with the far-end row it echoes. The
 * microphone timestamps LATE - measured, see aec-clock-domain.test.cjs - so a
 * bled row slides past its source and the overlap test fails.
 *
 * The consequence is not cosmetic. Prospect words wearing the seller's label
 * carry the seller's timestamps, so they interleave as if the seller had said
 * them - which is the "my sentence above my prospect's" report - and Taylos
 * then reasons about the call from the wrong speaker's mouth. In the same
 * session it addressed the SELLER by his own surname in a line the seller was
 * meant to read aloud.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { dropBledMicRows, farEndTextOf } = require('../dist/main/transcript-order.js');

/** far end speaks [t, t+dur); the mic hears it back LATE by `lag`. */
function pair(text, t, dur, lag) {
  return [
    { speaker: 0, text, timestamp: t, updatedAt: t + dur, audioStartMs: t, audioEndMs: t + dur, isFinal: true },
    { speaker: 1, text, timestamp: t + lag, updatedAt: t + lag + dur,
      audioStartMs: t + lag, audioEndMs: t + lag + dur, isFinal: true },
  ];
}

const REPORTED = [
  'sondern die die Transparent Wahrheit gesagt wird.',
  'Es gibt nur diesen einen Grund.',
  'Das mach noch mal. Stopp.',
  'Mir ist sehr mir',
  'gestorben ist. Also',
  'Ich bin',
];

test('the short bleeds from the real call are removed at a realistic mic lag', () => {
  for (const text of REPORTED) {
    const rows = pair(text, 10_000, 1_400, 300);   // 300 ms late
    const kept = dropBledMicRows(rows, farEndTextOf(rows));
    assert.equal(kept.length, 1, `not removed: "${text}"`);
    assert.equal(kept[0].speaker, 0, 'the far-end row must be the survivor');
  }
});

test('a genuine short reply is NOT deleted', () => {
  // The safety property. The seller answering "Ja, genau." while the prospect
  // says something else must survive - the word test is what guarantees this.
  const rows = [
    { speaker: 0, text: 'Wir haben schon eine Agentur im Haus.', timestamp: 0, updatedAt: 2000,
      audioStartMs: 0, audioEndMs: 2000, isFinal: true },
    { speaker: 1, text: 'Ja, genau.', timestamp: 2100, updatedAt: 2900,
      audioStartMs: 2100, audioEndMs: 2900, isFinal: true },
  ];
  const kept = dropBledMicRows(rows, farEndTextOf(rows));
  assert.equal(kept.length, 2, 'a real reply was deleted as bleed');
});

test('an unrelated far-end row far away in time does not swallow the mic row', () => {
  // The widening is bounded. A mic row a full minute later must not be matched
  // to an old far-end row just because the words repeat.
  const rows = [
    { speaker: 0, text: 'Es gibt nur diesen einen Grund.', timestamp: 0, updatedAt: 1500,
      audioStartMs: 0, audioEndMs: 1500, isFinal: true },
    { speaker: 1, text: 'Es gibt nur diesen einen Grund.', timestamp: 60_000, updatedAt: 61_500,
      audioStartMs: 60_000, audioEndMs: 61_500, isFinal: true },
  ];
  const kept = dropBledMicRows(rows, farEndTextOf(rows));
  assert.equal(kept.length, 2, 'a row a minute later must not be treated as bleed');
});
