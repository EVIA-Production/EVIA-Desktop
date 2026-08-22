/**
 * A failed chat call must not cost the rep the whole start.
 *
 * Measured in the user's own audio-diagnostics.log, 2026-08-21:
 *
 *   23:25:05  STARTUP FAILURE: TypeError: Failed to fetch
 *   23:25:16  STARTUP FAILURE: TypeError: Failed to fetch
 *   23:25:56  first sign of a working capture
 *
 * Fifty-one seconds. Seven startup failures in that log; five were this. The
 * same session shows five PostHog resources failing ERR_CONNECTION_CLOSED, so
 * the connection was degraded - exactly when a rep needs Listen to work rather
 * than silently do nothing.
 *
 * Two separate holes had to be closed:
 *
 * 1. overlay-entry awaited getOrCreateChatId BEFORE startCapture. A throw there
 *    never reached the inner try/catch, so the inner "survive chat failure"
 *    patch was dead code at the only production Listen path.
 *
 * 2. startCapture then raced the id against a 1500ms timeout and "adopted"
 *    whatever arrived later. The websocket URL contains the chat id, so that
 *    rebind splits one call across two chats. The fetch is already bounded
 *    (AbortSignal.timeout). The pin must be the promise's real answer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'audio-processor-glass-parity.ts'), 'utf8');
const entry = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'overlay-entry.tsx'), 'utf8');
const ws = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'services', 'websocketService.ts'), 'utf8');

test('the Listen button does not await chat creation before startCapture', () => {
  // This is the hole that kept the inner fix unreachable. The only production
  // caller awaited getOrCreateChatId, and a throw there became STARTUP FAILURE
  // without ever opening the microphone.
  const startAt = entry.indexOf('await startCapture(true)');
  assert.notEqual(startAt, -1, 'overlay-entry must still start capture');
  const before = entry.slice(0, startAt);
  assert.doesNotMatch(before, /await getOrCreateChatId\(/,
    'awaiting chat creation here puts the microphone behind a network call and ' +
    'turns a failed POST into a failed Listen');
  // The dynamic import that existed only to make that await was the tell.
  assert.doesNotMatch(entry, /await import\('\.\.\/services\/websocketService'\)/,
    'the only reason overlay-entry imported websocketService at start was the blocking await');
});

test('awaiting the chat id cannot abort capture start', () => {
  const at = src.indexOf('captureChatId = await chatIdPromise;');
  assert.notEqual(at, -1, 'the chat id is still awaited somewhere');
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

test('the pin is the real chat id, not a timed-out null that gets adopted later', () => {
  // A 1500ms Promise.race that resolves null, then `if (late && !captureChatId)
  // captureChatId = late`, rebinds a live session after the sockets are already
  // open against whatever activeChatId() fell back to. Audio stays on the
  // original websocket; transcript tags / Ask / insights follow the new pin.
  assert.doesNotMatch(src, /captureChatId = await Promise\.race/,
    'do not race the chat id against a timeout that resolves null');
  assert.doesNotMatch(src, /adopted late chat id/,
    'late adoption after sockets exist splits one call across two chats');
  const at = src.indexOf('captureChatId = await chatIdPromise;');
  assert.notEqual(at, -1, 'the pin must come from the in-flight chat call');
});

test('the chat fetch itself is bounded, so a dead socket cannot hold the mic forever', () => {
  // Measured before this bound existed: 51 s from press to a working capture,
  // because fetch() sat on a dead socket until macOS gave up.
  assert.match(ws, /AbortSignal\.timeout\((\d+)\)/);
  const ms = Number(ws.match(/AbortSignal\.timeout\((\d+)\)/)[1]);
  assert.ok(ms > 0 && ms <= 5000,
    `the fetch bound is ${ms}ms; tens of seconds is the defect this replaced`);
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
