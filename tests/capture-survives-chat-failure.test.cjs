/**
 * A failed chat call must not cost the rep the whole start.
 *
 * Measured in the user's own audio-diagnostics.log, 2026-08-21:
 *
 *   23:25:05  STARTUP FAILURE: TypeError: Failed to fetch
 *   23:25:16  STARTUP FAILURE: TypeError: Failed to fetch
 *   23:25:56  first sign of a working capture
 *
 * Fifty-one seconds, for a chat id that only LABELS events. Seven startup
 * failures in that log; five were this. The same session shows five PostHog
 * resources failing ERR_CONNECTION_CLOSED, so the connection was degraded -
 * exactly when a rep needs Listen to work rather than silently do nothing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'audio-processor-glass-parity.ts'), 'utf8');

test('awaiting the chat id cannot abort capture start', () => {
  const at = src.indexOf('captureChatId = await Promise.race([');
  assert.notEqual(at, -1, 'the chat id must be awaited with a bound, not open-ended');
  // The await must sit inside a try, with a catch that continues.
  const before = src.slice(Math.max(0, at - 900), at);
  assert.match(before, /try\s*\{\s*$/m, 'the await must be guarded by try');
  const after = src.slice(at, at + 700);
  assert.match(after, /catch/, 'a failed chat call must be caught');
  assert.match(after, /captureChatId = null/, 'and must fall through with no id');
  // It must NOT rethrow - that would restore the 51-second failure.
  const catchBlock = after.slice(after.indexOf('catch'), after.indexOf('startTimer.mark'));
  assert.doesNotMatch(catchBlock, /\bthrow\b/,
    'rethrowing puts the whole start back behind one network call');
});

test('the wait for the chat id is bounded, so a bad network cannot hold the mic', () => {
  // Measured before this bound existed: 51 s from press to a working capture,
  // because fetch() sat on a dead socket until macOS gave up.
  const at = src.indexOf('captureChatId = await Promise.race([');
  const block = src.slice(at, at + 700);
  assert.match(block, /setTimeout\(\(\) => resolve\(null\), (\d+)\)/,
    'the race must have a timeout arm');
  const ms = Number(block.match(/resolve\(null\), (\d+)\)/)[1]);
  assert.ok(ms > 0 && ms <= 2000,
    `the bound is ${ms}ms; beyond ~2s the rep is waiting on a label, not a recording`);
  // And the late answer must still be adopted, or a slow network loses the id.
  assert.match(block, /adopted late chat id|captureChatId = late/,
    'a late chat id must still be picked up');
});

test('a missing chat id degrades instead of breaking', () => {
  // activeChatId() is what every consumer reads.
  const at = src.indexOf('function activeChatId()');
  assert.notEqual(at, -1);
  const body = src.slice(at, at + 260);
  assert.match(body, /captureChatId/, 'it prefers the bound id');
  assert.match(body, /localStorage\.getItem\('current_chat_id'\)/,
    'and falls back rather than throwing');
});
