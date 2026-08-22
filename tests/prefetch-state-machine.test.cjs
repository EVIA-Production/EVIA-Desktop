/**
 * The prefetch trigger policy, exercised as a state machine against the real
 * module rather than a copy of it.
 *
 * Context: production hit rate was 0/6. The dominant cause was that the click
 * and the prefetch built different strings (fixed separately, see
 * prefetch-context-parity.test.cjs). Fixing that makes a hit POSSIBLE; whether
 * one actually lands is decided here, by when the policy chooses to fire and
 * what it does when a generation fails or is superseded.
 *
 * The source is transpiled in-memory so these run against
 * src/renderer/lib/suggestion-prefetch.ts itself. That file is not in the
 * `src/main/**` tsconfig, and testing a hand-copied duplicate of a policy whose
 * defects are all timing-related would prove nothing.
 *
 * No wall-clock sleeps: Date.now is controlled, so cooldown behaviour is
 * asserted exactly rather than raced.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'lib', 'suggestion-prefetch.ts');

/** Load a fresh copy of the real module, with time and fetch under our control. */
function loadPrefetch({ now, fetchImpl }) {
  const source = fs.readFileSync(SRC, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = new Module(SRC, null);
  m.filename = SRC;
  m.paths = Module._nodeModulePaths(path.dirname(SRC));
  const realNow = Date.now;
  const realFetch = global.fetch;
  Date.now = now;
  global.fetch = fetchImpl;
  try {
    m._compile(js, SRC);
  } finally {
    Date.now = realNow;
    global.fetch = realFetch;
  }
  return { mod: m.exports, restore: () => { Date.now = realNow; global.fetch = realFetch; } };
}

/** Drive the module with a clock and a scripted transport. */
function harness({ fetchImpl }) {
  let t = 1_000_000;
  const clock = () => t;
  const { mod, restore } = loadPrefetch({ now: clock, fetchImpl });
  const realNow = Date.now;
  const realFetch = global.fetch;
  Date.now = clock;
  global.fetch = fetchImpl;
  return {
    mod,
    advance: (ms) => { t += ms; },
    at: () => t,
    done: () => { Date.now = realNow; global.fetch = realFetch; restore(); },
  };
}

const BASE = { baseUrl: 'https://api.example', chatId: 42, token: 'tok', language: 'de', question: 'Was soll ich als Nächstes sagen?' };
const LONG = 'Prospect: Wir haben schon eine Agentur und ehrlich gesagt bin ich skeptisch.';
const LONGER = LONG + '\nProspect: Und die Preise sind uns zu hoch.';

test('a failed prefetch does not suppress the retry for that same transcript', async () => {
  // The transcript used to be recorded as "already prefetched" BEFORE the
  // request, and the catch did not undo it. One network blip then permanently
  // poisoned the most valuable context: the seller could sit on that exact
  // transcript and no further generation would ever be attempted.
  let calls = 0;
  const h = harness({ fetchImpl: async () => { calls += 1; throw new Error('network'); } });
  try {
    h.mod.prefetchSuggestion({ ...BASE, transcript: LONG });
    await h.mod.flushPendingPrefetchForTest();
    assert.equal(calls, 1, 'the attempt was made');

    h.advance(60_000);
    assert.equal(h.mod.prefetchSuggestion({ ...BASE, transcript: LONG }), 'scheduled',
      'after a FAILED attempt the same transcript must be retryable - otherwise one blip ' +
      'permanently disables prefetch for the context the seller is actually sitting on');
    await h.mod.flushPendingPrefetchForTest();
    assert.equal(calls, 2);
  } finally { h.done(); }
});

test('the newest turn supersedes an older generation instead of being dropped', async () => {
  // A click can only ever hit the LATEST context. A policy that drops the
  // newest final to protect an older in-flight generation is protecting the one
  // thing that cannot be claimed.
  const seen = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({
    fetchImpl: async (_url, init) => {
      seen.push(JSON.parse(init.body).transcript);
      await gate;
      return { ok: true };
    },
  });
  try {
    h.mod.prefetchSuggestion({ ...BASE, transcript: LONG });
    const slow = h.mod.flushPendingPrefetchForTest();
    h.advance(5_000);

    assert.equal(h.mod.prefetchSuggestion({ ...BASE, transcript: LONGER }), 'scheduled',
      'an older in-flight generation must not veto the only context a click could match');
    // Both generations share the gate, so open it before awaiting either.
    const newest = h.mod.flushPendingPrefetchForTest();
    release();
    await Promise.all([slow, newest]);

    assert.ok(seen.includes(LONGER), 'the newest transcript must reach the backend');
  } finally { h.done(); }
});

test('the opener does not start a rate limit that swallows the first real turn', async () => {
  // prefetchOpener used to stamp lastPrefetchAt, so a prospect turn arriving
  // inside the cooldown after session start was dropped - and the first turn of
  // a call is exactly when a seller reaches for a line.
  const bodies = [];
  const h = harness({
    fetchImpl: async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true }; },
  });
  try {
    await h.mod.prefetchOpener({ ...BASE });
    assert.equal(bodies.length, 1, 'the opener is armed');

    h.advance(1_500); // a fast first prospect turn
    h.mod.prefetchSuggestion({ ...BASE, transcript: LONG });
    await h.mod.flushPendingPrefetchForTest();

    assert.equal(bodies.length, 2,
      'the first real turn after the opener must still be prefetched');
  } finally { h.done(); }
});

test('a burst of turns costs one generation, for the newest context', async () => {
  // The cost guard, restated as behaviour. Firing on every final in a fast
  // exchange would pay for contexts the conversation has already left.
  const seen = [];
  const h = harness({
    fetchImpl: async (_url, init) => { seen.push(JSON.parse(init.body).transcript); return { ok: true }; },
  });
  try {
    h.mod.prefetchSuggestion({ ...BASE, transcript: LONG });
    h.advance(100);
    h.mod.prefetchSuggestion({ ...BASE, transcript: LONG + ' Und?' });
    h.advance(100);
    h.mod.prefetchSuggestion({ ...BASE, transcript: LONGER });
    await h.mod.flushPendingPrefetchForTest();

    assert.equal(seen.length, 1, 'one generation for the burst, not three');
    assert.equal(seen[0], LONGER, 'and it covers the newest context');
  } finally { h.done(); }
});

test('the same unchanged transcript is never paid for twice', async () => {
  const h = harness({ fetchImpl: async () => ({ ok: true }) });
  try {
    h.mod.prefetchSuggestion({ ...BASE, transcript: LONG });
    await h.mod.flushPendingPrefetchForTest();
    h.advance(30_000);
    assert.equal(h.mod.prefetchSuggestion({ ...BASE, transcript: LONG }), 'skipped',
      'an unchanged transcript is already parked');
  } finally { h.done(); }
});

test('a session reset clears the policy so the next call starts clean', async () => {
  const h = harness({ fetchImpl: async () => ({ ok: true }) });
  try {
    h.mod.prefetchSuggestion({ ...BASE, transcript: LONG });
    await h.mod.flushPendingPrefetchForTest();
    h.mod.resetSuggestionPrefetch();
    h.advance(10);
    assert.equal(h.mod.prefetchSuggestion({ ...BASE, transcript: LONG }), 'scheduled',
      'a new session must be able to prefetch the same words again');
  } finally { h.done(); }
});

test('a short transcript is not worth a generation', () => {
  const h = harness({ fetchImpl: async () => ({ ok: true }) });
  try {
    assert.equal(h.mod.prefetchSuggestion({ ...BASE, transcript: 'Ja?' }), 'skipped');
  } finally { h.done(); }
});

test('the speculative stream is drained, so the answer is actually parked', async () => {
  // `fetch` resolves on HEADERS. The previous version awaited that and dropped
  // the response, so the backend was left writing into a body nobody read and
  // "in flight" was false while the model was still generating.
  let readToEnd = false;
  const h = harness({
    fetchImpl: async () => ({
      ok: true,
      body: {
        getReader() {
          let n = 0;
          return { read: async () => (n++ < 2 ? { done: false, value: 1 } : (readToEnd = true, { done: true })) };
        },
      },
    }),
  });
  try {
    h.mod.prefetchSuggestion({ ...BASE, transcript: LONG });
    await h.mod.flushPendingPrefetchForTest();
    assert.ok(readToEnd, 'the speculative response must be read to completion');
  } finally { h.done(); }
});
