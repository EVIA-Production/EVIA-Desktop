const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const bridge = read('src/main/desktop-bridge.ts');
const main = read('src/main/main.ts');
const settings = read('src/renderer/overlay/SettingsView.tsx');
const builder = read('electron-builder.yml');

test('the web onboarding receives truthful local desktop and capture state', () => {
  assert.match(bridge, /version:\s*app\.getVersion\(\)/);
  assert.match(bridge, /platform:\s*process\.platform/);
  assert.match(bridge, /capture_state:\s*captureSessionController\.getSnapshot\(\)\.state/);
  assert.match(bridge, /req\.url === '\/status' && req\.method === 'GET'/);
});

test('the localhost bridge permits only Taylos web and loopback development origins', () => {
  assert.match(bridge, /origin === 'https:\/\/app\.taylos\.ai'/);
  assert.match(bridge, /localhost\|127\\\.0\\\.0\\\.1/);
  assert.match(bridge, /Access-Control-Allow-Private-Network/);
  assert.match(bridge, /verifyClient:[^\n]*allowedBridgeOrigin\([^)]*origin\)/);
  assert.doesNotMatch(bridge, /Access-Control-Allow-Origin['"],\s*['"]\*['"]/);
});

test('setup can be reopened from a localized native menu and desktop settings', () => {
  assert.match(main, /Taylos-Einrichtung erneut starten/);
  assert.match(main, /Run Taylos Setup Again/);
  assert.match(main, /registerNativeOnboarding\(\)/);
  assert.match(settings, /onboarding\?\.restart\(\)/);
  assert.doesNotMatch(settings, /onboarding\?restart=1/);
  assert.match(settings, /handleRunSetup/);
  assert.match(settings, /t\('runSetupAgain'\)/);
});

test('macOS permission copy names only audio capabilities Taylos actually requests', () => {
  assert.match(builder, /NSMicrophoneUsageDescription/);
  assert.match(builder, /NSScreenCaptureUsageDescription/);
  assert.match(builder, /NSAudioCaptureUsageDescription/);
  assert.doesNotMatch(builder, /NSCameraUsageDescription/);
});
