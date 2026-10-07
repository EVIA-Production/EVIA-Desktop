// Native window glass is off on Windows unless explicitly forced on: the glass
// bridge crashed the main process (exit 0xFFFF7003) with software compositing
// and in the installed 1.0.124 (2026-10-07). The app (TypeScript) and the
// bundled onboarding runtime (CommonJS) carry the same rule; both are checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = require(path.join(__dirname, '..', 'onboarding-runtime', 'output', 'onboarding-prototype', 'native-glass-policy.cjs'));
const app = require(path.join(__dirname, '..', 'dist', 'main', 'native-glass-policy.js'));

for (const [name, policy] of [['onboarding runtime', runtime], ['app', app]]) {
  test(`${name}: Windows uses the CSS material, with or without GPU compositing`, () => {
    for (const status of ['enabled', 'disabled_software', 'disabled_off', ''])
      assert.equal(policy.nativeGlassAllowed('win32', status), false, status);
  });
  test(`${name}: macOS keeps native glass`, () => {
    assert.equal(policy.nativeGlassAllowed('darwin', 'enabled'), true);
    assert.equal(policy.nativeGlassAllowed('darwin', 'disabled_software'), true);
  });
  test(`${name}: TAYLOS_NATIVE_GLASS forces it either way`, () => {
    assert.equal(policy.nativeGlassAllowed('win32', 'enabled', '1'), true);
    assert.equal(policy.nativeGlassAllowed('darwin', 'enabled', '0'), false);
  });
}
