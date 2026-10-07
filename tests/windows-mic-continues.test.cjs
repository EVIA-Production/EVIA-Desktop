// Launch day, Windows candidate: the mic, socket and Deepgram were live, then
// Electron's loopback failed in DXGI and the whole capture rolled back to idle.
// On Windows a system-audio failure must leave the microphone capture running;
// macOS keeps its required-system-audio contract.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'audio-processor-glass-parity.ts'), 'utf8').replace(/\r\n/g, '\n');

test('a failed Windows system-audio start continues microphone-only instead of throwing', () => {
  const marker = source.indexOf("console.error('[AudioCapture] System audio capture failed:', error);");
  assert.ok(marker >= 0, 'system-audio failure handler present');
  const handler = source.slice(marker, source.indexOf("console.log('[AudioCapture] Setting up mic audio processing", marker));
  assert.match(handler, /platformInfo\?\.isWindows[\s\S]*systemStream = null[\s\S]*microphone capture continues[\s\S]*\} else \{\s*throw error;/);
  // The mic is set up after this handler, so a Windows failure reaches it.
  assert.ok(source.indexOf("const micSetup = await setupMicProcessing(micStream, timeline);", marker) > marker);
});

test('the overlay already warns and keeps recording when system audio is unavailable', () => {
  const overlay = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'overlay-entry.tsx'), 'utf8');
  assert.match(overlay, /if \(!handle\.systemAudioAvailable\) \{[\s\S]*systemAudioWarning\(handle\.systemAudioStatus, language\)[\s\S]*capture_start_mic_continues/);
});
