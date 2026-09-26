const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const analytics = read('src/renderer/services/posthogService.ts');
const askView = read('src/renderer/overlay/AskView.tsx');
const listenView = read('src/renderer/overlay/ListenView.tsx');
const overlayEntry = read('src/renderer/overlay/overlay-entry.tsx');
const overlayWindows = read('src/main/overlay-windows.ts');

test('desktop replay captures the full session, text included, once the account consented', () => {
  // With consent the replay is full-fidelity: a masked replay cannot answer
  // whether a suggestion was any good. Guarded as a contract so nobody
  // silently re-masks it - the reverse of what this test asserted before
  // 2026-08-27. Since 2026-09-26 it runs only with consent (§ 25 TDDDG).
  assert.match(analytics, /^import posthog from 'posthog-js';$/m);
  assert.doesNotMatch(analytics, /^import posthog from 'posthog-js\/dist\/module\.full\.no-external';$/m);
  assert.match(analytics, /POSTHOG_HOST\s*=\s*'https:\/\/api\.taylos\.ai\/telemetry'/);
  assert.match(analytics, /disable_session_recording:\s*!consentGranted/);
  assert.match(analytics, /startSessionRecording\(true\)/, 'all sampling and trigger gates must be overridden');
  assert.match(analytics, /sessionRecordingStarted\(\)/, 'recorder startup must be verified');
  assert.match(analytics, /desktop_replay_health/, 'recorder health must be observable');
  assert.doesNotMatch(overlayEntry, /requestIdleCallback\(startAnalytics/, 'short sessions must not disappear before replay starts');
  assert.match(overlayEntry, /root\.render\(<App \/>\)[\s\S]*startAnalytics\(\)/);
  assert.match(analytics, /maskAllInputs:\s*false/);
  assert.match(analytics, /maskTextSelector:\s*undefined/);
  assert.match(analytics, /blockSelector:\s*'\[data-telemetry-secret\]'/);
  assert.match(analytics, /maskInputOptions:\s*\{ password:\s*true \}/);
  assert.match(analytics, /enable_recording_console_log:\s*true/);
  assert.match(analytics, /recordHeaders:\s*true/);
  assert.match(analytics, /recordBody:\s*true/);
  assert.match(analytics, /maskCapturedNetworkRequestFn:\s*sanitizeCapturedNetworkRequest/);
});

test('every product event carries its full context', () => {
  const directCaptures = analytics.match(/posthog\.capture\(/g) || [];
  assert.equal(directCaptures.length, 2, 'only sendDesktopEvent and queue flushing may call posthog.capture');

  // The sanitizer used to DROP these keys and cut every string at 80 chars,
  // so an event proved a click happened and nothing about what was clicked.
  assert.doesNotMatch(analytics, /SENSITIVE_PROPERTY_KEYS/, 'the drop-list is gone by design');
  assert.doesNotMatch(analytics, /slice\(0,\s*80\)/, '80 chars truncated away the content');
  assert.match(analytics, /MAX_PROPERTY_CHARS\s*=\s*20000/, 'the only cap left is PostHog ingestion');

  // The suggestion and what produced it must both travel.
  assert.match(analytics, /export function trackSuggestionContext/);
  for (const field of ['suggestion', 'transcript', 'preset_name', 'question', 'chat_id']) {
    assert.match(analytics, new RegExp(`${field}\\??:`), `suggestion context must carry ${field}`);
  }
  assert.match(listenView, /trackSuggestionContext\(/, 'insights must report their context');
  assert.match(askView, /trackSuggestionContext\(/, 'ask must report its context');
});

test('desktop call, transcript, insights and ask lifecycles are wired to analytics', () => {
  assert.match(overlayEntry, /beginAnalyticsCall\(\)/);
  assert.match(overlayEntry, /trackRecordingStarted\(/);
  assert.match(listenView, /trackRecordingStopped\(/);
  assert.match(listenView, /trackTranscriptFirstVisible\(/);
  assert.match(listenView, /trackInsightsRequested\(/);
  assert.match(listenView, /trackInsightsLoaded\(/);
  assert.match(listenView, /trackInsightsFailed\(/);
  assert.match(askView, /trackAskSubmitted\(/);
  assert.match(askView, /trackAskRequestReady\(/);
  assert.match(askView, /trackAskResponseReceived\(/);
  assert.match(askView, /trackAskFailed\(/);
});

test('every overlay window receives the exact application version', () => {
  assert.match(overlayWindows, /appVersion:\s*app\.getVersion\(\)/);
  assert.match(analytics, /app_version:\s*currentAppVersion\(\)/);
});

test('desktop reports its exact version to the backend independently of PostHog', () => {
  const main = read('src/main/main.ts');
  assert.match(main, /\/client\/telemetry/);
  assert.match(main, /app_version:\s*app\.getVersion\(\)/);
  assert.match(main, /platform:\s*process\.platform/);
  assert.match(main, /event:\s*event/);
  assert.match(main, /\/client\/telemetry\/events/);
  assert.match(main, /DESKTOP_RELAY_BATCH_SIZE\s*=\s*25/);
  assert.match(main, /DESKTOP_RELAY_RETRY_MS/);
  assert.match(main, /ipcMain\.handle\('telemetry:capture'/);
  assert.match(analytics, /\$insert_id:\s*eventId/);
  // PostHog merges the direct and the relayed copy only when uuid, event,
  // distinct id and timestamp match: both copies share the id and the moment.
  assert.match(analytics, /relayDesktopEvent\(eventName, eventId, payload, timestamp\)/);
  assert.match(analytics, /posthog\.capture\(eventName, payload, \{ timestamp \}\)/);
  assert.match(analytics, /before_send:\s*useInsertIdAsUuid/);
  assert.match(analytics, /event\.uuid = insertId/);
  assert.match(main, /timestamp,\s*\n\s*attempts: 0/);
});


test('without the account consent the desktop keeps analytics in memory and records no replay (§ 25 TDDDG)', () => {
  assert.match(analytics, /persistence:\s*consentGranted \? 'localStorage' : 'memory'/);
  assert.match(analytics, /if \(consentGranted\) verifyReplayRecording\(\)/, 'the health check force-starts the recorder, so only with consent');
  assert.match(analytics, /\/users\/me\/analytics-consent/, 'the choice comes from the account');
  assert.match(analytics, /if \(consentGranted\) localStorage\.setItem\('posthog_distinct_id'/, 'no device id without consent');
  assert.match(analytics, /posthog\.stopSessionRecording\(\)/, 'withdrawing consent stops the recorder');
});
