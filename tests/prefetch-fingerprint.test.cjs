/**
 * A prefetch that cannot be claimed is a wasted generation.
 *
 * The backend keys the speculative cache on
 * `_context_fingerprint(session_state, transcript, question)` and deletes on
 * read. The guarantee that buys - a prefetch made against a different
 * conversation state can never be served - only pays off if the click and the
 * prefetch agree on the transcript string byte for byte.
 *
 * They did not. The prefetch fired inside the transcript event handler, right
 * after `setCanonicalTranscriptState(transition.state)`, and read the context
 * off a ref assigned during RENDER. React does not apply a state update during
 * the handler that schedules it, so the ref still held the transcript from
 * BEFORE the final that triggered the prefetch, while the seller's later click
 * sent the transcript WITH it. Every prefetch missed.
 *
 * These tests pin the two halves: the strings must match when the state has
 * not moved, and the stale-by-one-final string must be visibly different -
 * otherwise this test would pass even with the bug reintroduced.
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
} = require('../dist/main/realtime-transcript-state.js');

let seq = 0;
/** A transcript event with every field the state machine actually requires. */
function speak(state, { text, source = 'system', isFinal = true, startMs, endMs }) {
  seq += 1;
  const result = applyRealtimeTranscriptEvent(state, {
    chatId: 'chat-1',
    sessionId: 'session-1',
    source,
    captureGeneration: 1,
    streamGeneration: 1,
    utteranceId: `utterance-${seq}`,
    eventId: `event-${seq}`,
    seq,
    captureStartMs: startMs,
    captureEndMs: endMs,
    words: text.split(' ').map((w, i) => ({ text: w, startMs: startMs + i, endMs: startMs + i + 1 })),
    clockDomainValid: true,
    text,
    isFinal,
  });
  assert.equal(result.accepted, true, `event rejected: ${result.reason}`);
  return result.state;
}

test('one more final changes the context, so a stale prefetch can never be claimed', () => {
  const before = speak(createRealtimeTranscriptState(), {
    text: 'Wir haben schon eine Agentur.', startMs: 0, endMs: 1800,
  });
  const after = speak(before, {
    text: 'Und ehrlich gesagt bin ich skeptisch.', startMs: 2000, endMs: 4200,
  });

  const staleContext = transcriptContextFromState(before);
  const clickContext = transcriptContextFromState(after);

  assert.notEqual(staleContext, clickContext,
    'if these were equal the bug could not have existed and this test proves nothing');
  assert.ok(clickContext.includes('skeptisch'), 'the click sends the newest final');
  assert.ok(!staleContext.includes('skeptisch'), 'the render-lagged ref did not');
});

test('the prefetch and the click derive the context from the same state the same way', () => {
  let state = createRealtimeTranscriptState();
  state = speak(state, { text: 'Guten Tag, worum geht es?', startMs: 0, endMs: 1500 });
  state = speak(state, { text: 'Kurz zur Einordnung.', source: 'mic', startMs: 1600, endMs: 2900 });
  state = speak(state, { text: 'Ich habe nur zwei Minuten.', startMs: 3000, endMs: 4800 });

  // What the handler now sends at prefetch time, from the fully-updated state.
  const prefetch = transcriptContextFromState(state);
  // What the render path produces for that same state on the seller's click.
  const { rowsFromState } = require('../dist/main/transcript-context.js');
  const click = buildTranscriptContext(rowsFromState(state));

  assert.equal(prefetch, click, 'the fingerprint is only stable if these agree exactly');
  assert.ok(prefetch.includes('Prospect:') && prefetch.includes('Seller:'),
    'both sides are labelled, which the model relies on');
});

test('the prefetch call site reads the event state, never a render-lagged ref', () => {
  const listen = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'ListenView.tsx'), 'utf8');
  assert.match(listen, /transcript: transcriptContextFromState\(transition\.state\)/);
  // The ref was the defect. It must not come back for this purpose.
  assert.ok(!/prefetchTranscriptRef/.test(listen),
    'a render-assigned ref lags the handler by one final and guarantees a miss');
});
