/**
 * The first suggestion is slower because of TCP and TLS, not the model.
 *
 * Measured 2026-08-18, Jakarta -> West Europe, against /health which does no
 * work at all:
 *
 *     req1 (cold):  tcp=294ms  tls=269ms  total=777ms
 *     req2 (warm):  tcp=0      tls=0      total=247ms
 *
 * ~530ms of handshake, paid by whichever request happens to be first - which
 * in a call is the seller's first suggestion, mid-sentence.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const warmup = read('renderer', 'lib', 'connection-warmup.ts');
const entry = read('renderer', 'overlay', 'overlay-entry.tsx');

test('the socket is primed at session start, before the slow work', () => {
  assert.match(entry, /startConnectionWarmup\(backend\)/);
  const priming = entry.indexOf('startConnectionWarmup(backend)');
  const capture = entry.indexOf('await startCapture(true)');
  assert.ok(priming !== -1 && capture !== -1);
  // startCapture takes long enough to hide the entire handshake behind it.
  assert.ok(priming < capture, 'warm-up must run before capture start');
});

test('a heartbeat keeps it from going idle mid-call', () => {
  // Chromium closes idle keep-alive sockets, so one warm-up at session start
  // is not enough for a call with pauses between clicks.
  assert.match(warmup, /setInterval/);
  const m = warmup.match(/HEARTBEAT_MS\s*=\s*([\d_]+)/);
  assert.ok(m, 'heartbeat interval must be named');
  const ms = Number(m[1].replace(/_/g, ''));
  assert.ok(ms > 5_000 && ms < 60_000, `interval ${ms} outside the useful window`);
});

test('a failed warm-up can never surface to the user', () => {
  // It is an optimisation. The real request carries its own error handling.
  assert.match(warmup, /catch\s*\{/);
  assert.doesNotMatch(warmup, /showToast|throw new Error/);
});

test('it stops when capture stops', () => {
  assert.match(warmup, /export function stopConnectionWarmup/);
  assert.match(entry, /stopConnectionWarmup\(\)/);
});
