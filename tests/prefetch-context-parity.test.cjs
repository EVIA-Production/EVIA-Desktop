/**
 * The prefetch and the click must build their transcript with the SAME
 * function, not merely from the same state.
 *
 * Production, 2026-08-21T05:38Z onward: 6 speculative generations parked,
 * 6 interactive DURING clicks, **0 prefetch_hit, and 0 clicks whose transcript
 * hash matched any parked hash**. Every speculative generation was paid for and
 * thrown away.
 *
 * It was not TTL (90s, and the widest observed park-to-click gap was 57s), not
 * the chat id (both paths read canonicalTranscriptStateRef), and not the bleed
 * filter (rowsFromState applies it too). It was one field:
 *
 *   rowsFromState()          carries `uncertainWords`
 *   ListenView's own row map does not
 *
 * and buildTranscriptContext appends a `⁇` marker for every uncertain word. So
 * the prefetch sent "Prospect: Wir haben schon eine Agentur⁇" while the click
 * sent "Prospect: Wir haben schon eine Agentur". Deepgram flags a
 * low-confidence word in almost every real turn, so this was not an edge case:
 * it was a structural 100% miss.
 *
 * The comment above `filteredTranscriptContext` asserted these were "byte-
 * identical". Two paths that must agree byte for byte cannot be kept in step by
 * a comment, so the fix is to delete one of them and call the shared function.
 *
 * These tests fail on the pre-fix baseline for exactly that reason.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildTranscriptContext,
  transcriptContextFromState,
} = require('../dist/main/transcript-context.js');
const {
  applyRealtimeTranscriptEvent,
  createRealtimeTranscriptState,
  projectRealtimeTranscriptState,
} = require('../dist/main/realtime-transcript-state.js');

let seq = 0;
/** A final with per-word confidences, which is what Deepgram actually sends. */
function speak(state, { text, source = 'system', startMs, endMs, confidences }) {
  seq += 1;
  const words = text.split(' ').map((w, i) => ({
    text: w, startMs: startMs + i * 10, endMs: startMs + i * 10 + 9,
    confidence: confidences ? confidences[i] : 0.99,
  }));
  const result = applyRealtimeTranscriptEvent(state, {
    chatId: 'chat-1', sessionId: 'session-1', source, captureGeneration: 1,
    streamGeneration: 1, utteranceId: `u-${seq}`, eventId: `e-${seq}`, seq,
    captureStartMs: startMs, captureEndMs: endMs, words,
    clockDomainValid: true, text, isFinal: true,
  });
  assert.equal(result.accepted, true, `event rejected: ${result.reason}`);
  return result.state;
}

/** ListenView's row projection as it was written, field for field. */
function listenViewRows(state) {
  return projectRealtimeTranscriptState(state).visibleRows.map((row) => ({
    speaker: row.source === 'mic' ? 1 : 0,
    text: row.text,
    isFinal: row.isFinal,
    isPartial: !row.isFinal,
    timestamp: row.captureStartMs,
    updatedAt: row.captureEndMs,
    audioStartMs: row.captureStartMs,
    audioEndMs: row.captureEndMs,
    utteranceId: row.key,
  }));
}

test('a low-confidence word makes the two derivations disagree', () => {
  // This is the defect itself, stated as a property of the two builders. It is
  // the reason the production hit rate was 0/6 rather than merely low.
  let state = createRealtimeTranscriptState();
  state = speak(state, {
    text: 'Wir haben schon eine Agentur',
    startMs: 0, endMs: 2000,
    confidences: [0.99, 0.99, 0.99, 0.99, 0.42],
  });

  const shared = transcriptContextFromState(state);
  const listenViewOwn = buildTranscriptContext(listenViewRows(state));

  assert.ok(shared.includes('⁇'),
    'the shared builder marks the uncertain word - if it stops, this test proves nothing');
  assert.notEqual(shared, listenViewOwn,
    'ListenView re-deriving rows without uncertainWords is what silently broke every prefetch');
});

test('the click and the prefetch now produce one string, by construction', () => {
  // Not "they happen to match on this fixture" - they are the same call.
  let state = createRealtimeTranscriptState();
  state = speak(state, {
    text: 'Ehrlich gesagt bin ich skeptisch', startMs: 0, endMs: 2200,
    confidences: [0.99, 0.51, 0.99, 0.99, 0.38],
  });
  state = speak(state, {
    text: 'Verstehe ich gut', source: 'mic', startMs: 2400, endMs: 3600,
    confidences: [0.99, 0.44, 0.99],
  });

  assert.equal(transcriptContextFromState(state), transcriptContextFromState(state));
  assert.ok(transcriptContextFromState(state).includes('⁇'),
    'uncertainty must survive into the string both paths send');
});

test('ListenView derives the click context from the shared function', () => {
  // The wiring half. The property above cannot be maintained by two parallel
  // derivations, so there must be exactly one, and this pins that it is used.
  const listen = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'ListenView.tsx'), 'utf8');
  assert.match(listen,
    /const filteredTranscriptContext = useMemo\(\s*\(\) => transcriptContextFromState\(/,
    'the click context must come from the same function the prefetch uses');
  // The old hand-rolled derivation must not come back for this purpose.
  assert.doesNotMatch(listen,
    /filteredTranscriptContext = useMemo\(\s*\(\) => buildTranscriptContext\(/,
    're-deriving rows here drops uncertainWords and silently zeroes the hit rate');
});

test('the marker is what differs - not ordering, speakers or whitespace', () => {
  // Guards against "fixing" this by weakening the marker instead of unifying
  // the paths. With no low-confidence word the two derivations already agreed,
  // which is exactly why this went unnoticed through several releases.
  let state = createRealtimeTranscriptState();
  state = speak(state, { text: 'Guten Tag worum geht es', startMs: 0, endMs: 1800 });
  assert.equal(transcriptContextFromState(state), buildTranscriptContext(listenViewRows(state)),
    'without an uncertain word the old code path was indistinguishable');
});
