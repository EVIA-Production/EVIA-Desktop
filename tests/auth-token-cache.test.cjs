/**
 * A cached token that survives logout is a security bug, not a speed win.
 *
 * The cache exists because every suggestion click read the OS Keychain through
 * an IPC round trip, on the DURING path where latency is the product. These
 * tests pin the half that makes it safe.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getCachedAuthToken, setCachedAuthToken, clearCachedAuthToken,
} = require('../dist/main/auth-token-cache.js');

test('a fresh cache reports itself unloaded, so the first read hits the keychain', () => {
  clearCachedAuthToken();
  assert.deepEqual(getCachedAuthToken(), { token: null, loaded: false });
});

test('a stored token is served without touching the keychain again', () => {
  clearCachedAuthToken();
  setCachedAuthToken('jwt-abc');
  assert.deepEqual(getCachedAuthToken(), { token: 'jwt-abc', loaded: true });
});

test('clearing forgets the token AND the loaded flag', () => {
  setCachedAuthToken('jwt-abc');
  clearCachedAuthToken();
  const { token, loaded } = getCachedAuthToken();
  assert.equal(token, null);
  // If `loaded` stayed true the reader would serve null forever instead of
  // going back to the keychain - a logged-in user permanently logged out.
  assert.equal(loaded, false, 'a cleared cache must fall through to the keychain');
});

test('an explicit null is a real cached value, not an empty cache', () => {
  // "There is no token" is worth caching: it stops a logged-out app hammering
  // the keychain on every click.
  clearCachedAuthToken();
  setCachedAuthToken(null);
  assert.deepEqual(getCachedAuthToken(), { token: null, loaded: true });
});

test('every keychain delete clears the cache', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'main', 'header-controller.ts'), 'utf8');
  const deletes = src.match(/keytar\.deletePassword\('taylos', 'token'\)/g) || [];
  assert.ok(deletes.length > 0, 'expected logout paths to exist');
  for (const m of src.matchAll(/keytar\.deletePassword\('taylos', 'token'\)([^\n]*)/g)) {
    assert.match(m[1], /clearCachedAuthToken/,
      'a logout that leaves the cache populated keeps the user authenticated');
  }
});
