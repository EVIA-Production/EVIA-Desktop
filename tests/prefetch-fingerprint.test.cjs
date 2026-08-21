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
  // Derived once from the event state and reused; the string it sends must be
  // the same one the snapshot gets, which the test below pins.
  assert.match(listen, /const prefetchContext = transcriptContextFromState\(transition\.state\)/);
  assert.match(listen, /transcript: prefetchContext/);
  // The ref was the defect. It must not come back for this purpose.
  assert.ok(!/prefetchTranscriptRef/.test(listen),
    'a render-assigned ref lags the handler by one final and guarantees a miss');
});


// ── The other half of the contract: the two payloads ─────────────────────────
//
// The transcript string matching is necessary but not sufficient. The server
// builds the cache key from THREE things (backend ask.py):
//
//   _context_fingerprint(session_state,
//                        body.transcript or (body.prompt if body.prompt_override else ""),
//                        prompt_override)
//
// and the prefetch and the click are built by two different files that have
// never been compared. A mismatch in ANY component is a silent 100% miss: no
// error, no log, just a feature that quietly does nothing - which is exactly
// how the render-lagged ref survived a release.

const I18N_DE = require('../src/renderer/i18n/de.json');
const I18N_EN = require('../src/renderer/i18n/en.json');

/** What suggestion-prefetch.ts posts. */
function prefetchPayload(transcript, question) {
  return {
    prompt: transcript,
    prompt_override: question,
    transcript,
    session_state: 'during',
  };
}

/** What evia-ask-stream.ts posts on a click. `transcript` field is never set. */
function clickPayload(transcript, question) {
  const payload = { prompt: transcript || question, session_state: 'during' };
  if (transcript && question && transcript !== question) payload.prompt_override = question;
  return payload;
}

/** The server's own resolution, mirrored from backend/api/routes/ask.py. */
function serverFingerprintInputs(body) {
  return [
    body.session_state || 'during',
    body.transcript || (body.prompt_override ? body.prompt : ''),
    body.prompt_override || '',
  ];
}

test('the prefetch and the click produce the same cache key', () => {
  const transcript = 'Prospect: Wir haben schon eine Agentur.\nSeller: Verstehe.';
  // ListenView trims the clicked prompt; the prefetch does not. Reproduce both.
  const asked = I18N_DE.overlay.listen.whatToSayNextPrompt;
  const pre = serverFingerprintInputs(prefetchPayload(transcript, asked));
  const click = serverFingerprintInputs(clickPayload(transcript, asked.trim()));
  assert.deepEqual(pre, click,
    'prefetch and click disagree on a fingerprint component - every prefetch would miss');
});

test('a stray space in a translation cannot silently kill the prefetch', () => {
  // ListenView sends (promptOverride || insightText || '').trim() on the click
  // and the raw string on the prefetch, so surrounding whitespace in the
  // translation makes the two disagree. Nothing would report it.
  for (const [name, bundle] of [['de', I18N_DE], ['en', I18N_EN]]) {
    const q = bundle.overlay.listen.whatToSayNextPrompt;
    assert.equal(q, q.trim(), `${name}: whatToSayNextPrompt has surrounding whitespace`);
    assert.ok(q.length > 0, `${name}: whatToSayNextPrompt is empty`);
  }
});

test('one more prospect word must MISS - the safety property, not a bug', () => {
  // The fingerprint covering the transcript is what makes a stale suggestion
  // impossible to serve. A test that only proves hits would happily pass on a
  // cache that serves the wrong answer.
  const asked = I18N_DE.overlay.listen.whatToSayNextPrompt;
  const a = serverFingerprintInputs(clickPayload('Prospect: Wir haben schon eine Agentur.', asked));
  const b = serverFingerprintInputs(clickPayload('Prospect: Wir haben schon eine Agentur. Und?', asked));
  assert.notDeepEqual(a, b, 'a changed transcript must produce a different key');
});


test('the prefetch publishes the SAME string the click will read', () => {
  // The click does not use the handler's transcript. It reads the live
  // snapshot, which ListenView publishes during render - so sending a fresher
  // string to the prefetch only inverted the mismatch: prefetch fresh, click
  // one final behind, fingerprints still never equal.
  //
  // Confirmed in a real call 2026-08-20: every /ask logged reason=primary and
  // not one prefetch_hit, while [Prefetch] parked a suggestion repeatedly.
  //
  // The handler must therefore write the snapshot before it prefetches, so both
  // paths read one value.
  const listen = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'ListenView.tsx'), 'utf8');
  const at = listen.indexOf('const prefetchContext = transcriptContextFromState(transition.state)');
  assert.notEqual(at, -1, 'the prefetch must derive its context once, from the event state');
  const block = listen.slice(at, at + 900);
  assert.match(block, /liveTranscript\?\.set\?\.\(/,
    'the snapshot must be updated with that same string');
  assert.match(block, /transcriptContext: prefetchContext/,
    'the snapshot must carry the string that was prefetched, not a re-derived one');
  const setAt = block.indexOf('liveTranscript?.set?.(');
  const sendAt = block.indexOf('prefetchSuggestion({');
  assert.ok(setAt !== -1 && sendAt > setAt,
    'the snapshot must be published BEFORE the prefetch is sent');
  assert.match(block, /transcript: prefetchContext/,
    'the prefetch must send that same string too');
});
