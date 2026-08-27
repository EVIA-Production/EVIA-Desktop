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

test('desktop replay captures the full session, text included', () => {
  // Deliberate pre-launch decision: these accounts are free in exchange for
  // their data, and a masked replay cannot answer whether a suggestion was
  // any good. Guarded as a contract so nobody silently re-masks it - the
  // reverse of what this test asserted before 2026-08-27.
  assert.match(analytics, /disable_session_recording:\s*false/);
  assert.match(analytics, /startSessionRecording\(\)/, 'no sampling: every session must record');
  assert.match(analytics, /maskAllInputs:\s*false/);
  assert.match(analytics, /maskTextSelector:\s*undefined/);
  assert.match(analytics, /blockSelector:\s*undefined/);
  assert.match(analytics, /enable_recording_console_log:\s*true/);
  assert.match(analytics, /recordHeaders:\s*true/);
  assert.match(analytics, /recordBody:\s*true/);
  assert.doesNotMatch(analytics, /maskCapturedNetworkRequestFn:\s*\(\)\s*=>\s*null/);
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
