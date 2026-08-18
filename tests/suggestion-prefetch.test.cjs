/**
 * Finish before the click.
 *
 * Measured 2026-08-18, Jakarta -> West Europe against /health, which does no
 * work: 225ms warm, 777ms cold. That is 11,000km of fibre, and model TTFT
 * lands on top. As long as the generation STARTS at the click, a distant
 * seller can never see a sub-second suggestion. So it starts when the prospect
 * stops talking instead.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const mod = read('renderer', 'lib', 'suggestion-prefetch.ts');
const listen = read('renderer', 'overlay', 'ListenView.tsx');

test('it fires on a completed turn from EITHER side, not on partials', () => {
  // Prospect-only coverage left two common clicks paying full price: the first
  // click of a call, and a click right after the seller speaks - their own
  // words change the transcript and therefore the fingerprint.
  assert.match(listen, /adapted\.event\.isFinal && isSessionActiveRef\.current/);
  // Partials must not trigger it - a fast exchange would fire constantly.
  assert.match(listen, /isFinal/);
});

test('the first click of a call is covered too', () => {
  // The one click guaranteed to have no prior turn behind it.
  assert.match(mod, /export async function prefetchOpener/);
  assert.match(listen, /prefetchOpener\(/);
  // Armed at recording start, right after the session state is reset.
  const resetAt = listen.indexOf('resetSuggestionPrefetch()');
  const openerAt = listen.indexOf('prefetchOpener(');
  assert.ok(resetAt !== -1 && openerAt > resetAt);
});

test('it sends prefetch:true and never renders the result', () => {
  assert.match(mod, /prefetch: true/);
  assert.match(mod, /session_state: 'during'/);
  // It must not touch any UI state - this is speculative work.
  assert.doesNotMatch(mod, /setState|showToast|setResponse/);
});

test('cost is bounded: no repeat for the same transcript, and a cooldown', () => {
  assert.match(mod, /if \(transcript === lastPrefetchedTranscript\) return 'skipped'/);
  assert.match(mod, /PREFETCH_COOLDOWN_MS/);
  assert.match(mod, /if \(inFlight/);
  // Too little transcript cannot ground a suggestion worth paying for.
  assert.match(mod, /PREFETCH_MIN_TRANSCRIPT_CHARS/);
});

test('a failure can never disturb a live call', () => {
  assert.match(mod, /catch \{/);
  assert.doesNotMatch(mod, /throw /);
  // The caller swallows too - speculative work is never load-bearing.
  const start = listen.indexOf('void (async () => {');
  const block = listen.slice(start, listen.indexOf('})();', start));
  assert.match(block, /catch \{/);
});

test('a new session starts from a clean slate', () => {
  // Otherwise the first prefetch of call two is suppressed by call one's
  // transcript still sitting in module state.
  assert.match(mod, /export function resetSuggestionPrefetch/);
  assert.match(listen, /resetSuggestionPrefetch\(\)/);
});
