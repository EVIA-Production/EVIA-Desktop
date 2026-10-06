/**
 * Setup errors must be readable where the person is looking.
 *
 *     npm run build:main && node --test tests/onboarding-setup-errors.test.cjs
 *
 * 2026-09-21: a new user clicked "Finish Setup" eighteen times and saw
 * "Could not save your context (400)" in a toast pinned outside the visible
 * onboarding card. The server had returned the reason (an unreadable website
 * or document); the app dropped it, and the unreadable source blocked setup.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { setupErrorMessage } = require('../dist/main/setup-error-message.js');
const reply = (status, body) => ({ status, json: async () => { if (body === undefined) throw new Error('no json'); return body; } });
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('the server reason is shown, not a status code', async () => {
  assert.equal(await setupErrorMessage(reply(400, { detail: 'This website could not be read. Remove it or use a document instead.' })),
    'This website could not be read. Remove it or use a document instead.');
  assert.equal(await setupErrorMessage(reply(429)), 'Too many attempts. Please wait a minute, then try again.');
  assert.equal(await setupErrorMessage(reply(401)), 'Please sign in again to finish setup.');
  assert.equal(await setupErrorMessage(reply(500)), 'Setup could not be saved (500). Please try again.');
  assert.equal(await setupErrorMessage(reply(400, { detail: [{ loc: ['body'], msg: 'x' }] })), 'Setup could not be saved (400). Please try again.');
});

test('an unreadable website or document does not block setup', () => {
  const native = read('src/main/native-onboarding.ts');
  assert.match(native, /error\.status === 400 && \(documents\.length \|\| context\?\.website\)/);
  assert.match(native, /typedOnly\.set\('website', ''\)/);
  assert.match(native, /Your typed profile is saved and active\./);
  assert.doesNotMatch(native, /Could not save your context/);
});

test('the onboarding card has no toast; messages are inline next to the action', () => {
  const js = read('onboarding-runtime/output/onboarding-prototype/goal-first-atlas-practice.js');
  const css = read('onboarding-runtime/output/onboarding-prototype/goal-first-atlas-practice.css');
  assert.doesNotMatch(js, /class="toast"/);
  assert.doesNotMatch(css, /^\.toast\s*\{/m);
  assert.match(js, /class="inline-notice" role="alert"/);
  assert.match(js, /escapeNotice\(t\(state\.toast\)\)/);
  assert.match(js, /state\.view==="personalize"\) return right\+notice/);
  assert.match(css, /\.inline-notice \{[^}]*font-size:12px/);
  assert.doesNotMatch(css, /\.inline-notice \{[^}]*(?:background:|border:)/);
  assert.doesNotMatch(js, /toastTimer=setTimeout/);
});
