/**
 * A trial limit reaches the rep as one sentence and an Upgrade link.
 *
 * Before 2026-09-22 a limit showed as "HTTP 402", then "Request failed.
 * Reconnect?" in Ask, and as nothing at all in Listen. These pin the server
 * codes to the founder's sentences, the upgrade target, and the wiring that
 * stops refused work from repeating.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRendererTs } = require('./_load-renderer-ts.cjs');

const trial = loadRendererTs('lib/trial-limit.ts');
const en = require('../src/renderer/i18n/en.json');
const de = require('../src/renderer/i18n/de.json');
const tFor = (dict) => (key) => key.split('.').reduce((v, k) => (v && v[k] !== undefined ? v[k] : key), dict);
const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('the suggestion limit says exactly the founder\'s sentence', () => {
  const notice = trial.trialLimitFrom({
    detail: { code: 'SUGGESTION_LIMIT_REACHED', upgrade_url: 'https://app.taylos.ai/settings/billing?upgrade=now' },
  });
  assert.equal(notice.code, 'suggestion_limit_reached');
  assert.equal(trial.trialLimitMessage(notice, tFor(en)), "You've reached your suggestion limit. Upgrade to continue.");
  assert.equal(trial.trialLimitMessage(notice, tFor(de)), 'Du hast dein Vorschlagslimit erreicht. Upgrade, um weiterzumachen.');
  assert.equal(trial.upgradeLabel(tFor(en)), 'Upgrade');
});

test('the minutes limit names the trial\'s minutes, from the server when it says so', () => {
  const fromServer = trial.trialLimitFrom({ code: 'MEETING_LIMIT_REACHED', limits: { max_meeting_seconds: 7200 } });
  assert.equal(trial.trialLimitMessage(fromServer, tFor(en)), "You've used your 120 trial minutes. Upgrade to continue.");
  const websocketStop = trial.trialLimitFrom({ code: 'limit_reached', message: 'x' });
  assert.equal(websocketStop.code, 'meeting_limit_reached');
  assert.match(trial.trialLimitMessage(websocketStop, tFor(de)), /^Du hast deine 120 Testminuten verbraucht\./);
});

test('every server spelling of a limit maps to one code; anything else is not a limit', () => {
  const codes = {
    SUGGESTION_LIMIT_REACHED: 'suggestion_limit_reached',
    suggestion_limit_reached: 'suggestion_limit_reached',
    MEETING_LIMIT_REACHED: 'meeting_limit_reached',
    meeting_limit_reached: 'meeting_limit_reached',
    limit_reached: 'meeting_limit_reached',
    TRIAL_EXPIRED: 'trial_expired',
    trial_expired: 'trial_expired',
    TRIAL_USAGE_LIMIT_REACHED: 'trial_usage_limit_reached',
    trial_limit_reached: 'trial_usage_limit_reached',
  };
  for (const [raw, expected] of Object.entries(codes)) {
    assert.equal(trial.trialLimitFrom({ code: raw }).code, expected, raw);
    assert.equal(trial.isTrialLimitCode(raw), true, raw);
  }
  for (const other of ['trial_budget_unavailable', 'trial_meeting_conflict', 'rate_limit', '', undefined, 42]) {
    assert.equal(trial.trialLimitFrom({ code: other }), null, String(other));
    assert.equal(trial.isTrialLimitCode(other), false, String(other));
  }
  assert.equal(trial.trialLimitFrom(null), null);
});

test('upgrade opens our own web app only, never a URL someone else supplied', () => {
  assert.equal(trial.trialLimitFrom({ code: 'trial_expired' }).upgradeUrl, trial.DEFAULT_UPGRADE_URL);
  assert.equal(trial.trialLimitFrom({ code: 'trial_expired', upgrade_url: 'https://evil.example/pay' }).upgradeUrl, trial.DEFAULT_UPGRADE_URL);
  assert.equal(trial.trialLimitFrom({ code: 'trial_expired', upgrade_url: 'http://app.taylos.ai/x' }).upgradeUrl, trial.DEFAULT_UPGRADE_URL);
  assert.equal(
    trial.trialLimitFrom({ code: 'trial_expired', upgrade_url: 'https://app.taylos.ai/settings/billing?upgrade=now' }).upgradeUrl,
    'https://app.taylos.ai/settings/billing?upgrade=now',
  );
  assert.equal(trial.DEFAULT_UPGRADE_URL, 'https://app.taylos.ai/settings/billing?upgrade=now', 'checkout sends trial users back');
});

test('a limit survives the trip through an Error, and only real limits do', () => {
  const notice = trial.trialLimitFrom({ code: 'SUGGESTION_LIMIT_REACHED' });
  const error = trial.trialLimitError(notice);
  assert.deepEqual(trial.trialLimitFromError(error), notice);
  assert.equal(trial.trialLimitFromError(new Error('TRIAL_LIMIT:suggestion_limit_reached')).code, 'suggestion_limit_reached');
  assert.equal(trial.trialLimitFromError(new Error('HTTP 402')), null);
  assert.equal(trial.trialLimitFromError(new Error('SUGGESTION_UNAVAILABLE:timeout')), null);
});

test('only minutes, expiry and the guard stop live work; the suggestion limit does not', () => {
  const seen = [];
  const stop = trial.onTrialLimit((notice) => seen.push(notice && notice.code));
  assert.equal(trial.stopsLiveWork(trial.trialLimitFrom({ code: 'SUGGESTION_LIMIT_REACHED' })), false);
  trial.reportTrialLimit(trial.trialLimitFrom({ code: 'MEETING_LIMIT_REACHED' }));
  trial.reportTrialLimit(trial.trialLimitFrom({ code: 'MEETING_LIMIT_REACHED' }));
  assert.equal(trial.stopsLiveWork(trial.currentTrialLimit()), true);
  trial.clearTrialLimit();
  assert.equal(trial.currentTrialLimit(), null);
  stop();
  trial.reportTrialLimit(trial.trialLimitFrom({ code: 'TRIAL_EXPIRED' }));
  trial.clearTrialLimit();
  assert.deepEqual(seen, ['meeting_limit_reached', null], 'one notice per change; unsubscribed listeners hear nothing');
});

test('every surface is wired: Ask, insights, the call stream, Listen', () => {
  const askStream = read('src/renderer/lib/evia-ask-stream.ts');
  assert.match(askStream, /res\.status === 402/);
  assert.match(askStream, /route\?\.type === 'trial_budget_error'/);
  const askView = read('src/renderer/overlay/AskView.tsx');
  assert.match(askView, /trialLimitFromError\(e\)/);
  assert.match(askView, /openUpgrade\(errorToast\.upgrade!\)/);
  const insights = read('src/renderer/services/insightsService.ts');
  assert.match(insights, /response\.status === 402/);
  assert.match(insights, /stopsLiveWork\(currentTrialLimit\(\)\)/);
  const capture = read('src/renderer/audio-processor-glass-parity.ts');
  assert.equal((capture.match(/type: 'trial_limit'/g) || []).length, 2, 'mic and system both relay the stop');
  const socket = read('src/renderer/services/websocketService.ts');
  assert.match(socket, /isTrialLimitCode\(payload\?\.data\?\.code\)[\s\S]{0,200}this\.shouldReconnect = false/);
  const listen = read('src/renderer/overlay/ListenView.tsx');
  assert.match(listen, /msg\.type === 'trial_limit'/);
  assert.match(listen, /<TrialLimitNoticeView notice=\{trialLimit\} \/>/);
  for (const dict of [en, de]) {
    for (const key of ['suggestionLimit', 'meetingLimit', 'expired', 'usageLimit', 'upgrade']) {
      assert.equal(typeof dict.overlay.trial[key], 'string', key);
    }
  }
});
