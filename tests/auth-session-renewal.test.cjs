/**
 * An active user must never be asked to sign in again.
 *
 * Tokens last 24h and nothing renewed them. checkTokenValidity even returned
 * "expiring_soon - refresh recommended" and no caller acted on it, so every
 * user was pushed back to a username and password on a fixed cycle no matter
 * how continuously they were using the product. Reported 2026-08-18 as having
 * to sign in several times a day.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
const main = read('main', 'main.ts');
const preload = read('main', 'preload.ts');
const entry = read('renderer', 'overlay', 'overlay-entry.tsx');

test('the session renews on launch and on a schedule', () => {
  assert.match(main, /async function refreshAuthTokenSilently/);
  assert.match(main, /refreshAuthTokenSilently\('startup'\)/);
  assert.match(main, /refreshAuthTokenSilently\('interval'\)/);

  // The interval must sit well inside the 24h token window, or a laptop that
  // slept through the weekend wakes up logged out.
  const m = main.match(/AUTH_REFRESH_INTERVAL_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.ok(m, 'refresh interval must be named');
  assert.ok(Number(m[1]) <= 12, `interval ${m[1]}h is too close to the 24h window`);
});

test('a renewed token replaces the stored one', () => {
  const start = main.indexOf('async function refreshAuthTokenSilently');
  const body = main.slice(start, main.indexOf('\n}', main.indexOf('return false;\n  }', start)));
  assert.match(body, /keytar\.setPassword\('taylos', 'token', next\)/);
  // Renewal must never surface: the old token is still valid for hours.
  assert.doesNotMatch(body, /showToast|dialog\.show/);
});

test('a session start renews rather than prompting', () => {
  // A token lapsing mid-call costs the seller the call.
  assert.match(entry, /expiring_soon/);
  assert.match(entry, /eviaAuth\.refresh\?\.\(\)/);
  assert.match(preload, /refresh: \(\) => ipcRenderer\.invoke\('auth:refresh'\)/);
});
