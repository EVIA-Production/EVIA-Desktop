// Native window glass needs GPU compositing on Windows: with software compositing
// the glass bridge crashed the main process (exit 0xFFFF7003, Windows signing PC,
// 2026-10-07). The app (TypeScript) and the bundled onboarding runtime (CommonJS)
// carry the same rule; both are checked here.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = require(path.join(__dirname, '..', 'onboarding-runtime', 'output', 'onboarding-prototype', 'native-glass-policy.cjs'));
const app = require(path.join(__dirname, '..', 'dist', 'main', 'native-glass-policy.js'));

for (const [name, policy] of [['onboarding runtime', runtime], ['app', app]]) {
  test(`${name}: Windows without GPU compositing uses the CSS material`, () => {
    assert.equal(policy.nativeGlassAllowed('win32', 'disabled_software'), false);
    assert.equal(policy.nativeGlassAllowed('win32', 'disabled_off'), false);
  });
  test(`${name}: GPU machines and macOS keep native glass, also when the status is unknown`, () => {
    assert.equal(policy.nativeGlassAllowed('win32', 'enabled'), true);
    assert.equal(policy.nativeGlassAllowed('win32', ''), true);
    assert.equal(policy.nativeGlassAllowed('darwin', 'disabled_software'), true);
  });
  test(`${name}: TAYLOS_NATIVE_GLASS forces it either way`, () => {
    assert.equal(policy.nativeGlassAllowed('win32', 'disabled_software', '1'), true);
    assert.equal(policy.nativeGlassAllowed('win32', 'enabled', '0'), false);
  });
}
