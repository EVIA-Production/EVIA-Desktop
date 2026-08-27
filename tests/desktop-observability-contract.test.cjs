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

test('desktop replay records every session without recording customer content', () => {
  assert.match(analytics, /disable_session_recording:\s*false/);
  assert.match(analytics, /startSessionRecording\(\{\s*sampling:\s*true\s*\}\)/);
  assert.match(analytics, /maskAllInputs:\s*true/);
  assert.match(analytics, /maskTextSelector:\s*['"]\*['"]/);
  assert.match(analytics, /blockSelector:\s*['"]img, video, canvas, svg['"]/);
  assert.match(analytics, /enable_recording_console_log:\s*false/);
  assert.match(analytics, /recordHeaders:\s*false/);
  assert.match(analytics, /recordBody:\s*false/);
  assert.match(analytics, /recordCanvas:\s*false/);
  assert.match(analytics, /maskCapturedNetworkRequestFn:\s*\(\)\s*=>\s*null/);
});

test('all product events pass through the central privacy sanitizer', () => {
  const directCaptures = analytics.match(/posthog\.capture\(/g) || [];
  assert.equal(directCaptures.length, 2, 'only sendDesktopEvent and queue flushing may call posthog.capture');
  for (const key of [
    'chat_id',
    'context',
    'email',
    'error_message',
    'insight_text',
    'insight_text_preview',
    'name',
    'preset_name',
    'response_hash',
    'user_id',
    'username',
  ]) {
    assert.match(analytics, new RegExp(`['"]${key}['"]`));
  }
  assert.doesNotMatch(analytics, /insight_text_preview:\s*properties/);
  assert.doesNotMatch(analytics, /insight_text_hash:\s*hashText/);
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
