// Native window glass: on unless Windows reports software compositing, and
// TAYLOS_NATIVE_GLASS forces it either way. The app (TypeScript) and the
// bundled onboarding runtime (CommonJS) carry the same rule; both are checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

// 1.0.124: the onboarding updated the glass synchronously from its own resize
// and re-entered the bridge. The update must run after the resize returns.
test('onboarding product windows never update native glass inside the resize event', () => {
  // Windows checkouts may materialize CRLF.
  const source = fs.readFileSync(path.join(__dirname, '..', 'onboarding-runtime', 'output', 'onboarding-prototype', 'native-windows.cjs'), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf("win.on('resize',()=>{\n        if(resizeQueued)");
  assert.ok(start >= 0, 'deferred resize handler present');
  const handler = source.slice(start);
  assert.match(handler.slice(0, 400), /setImmediate\(\(\)=>\{[\s\S]*bridge\.update/);
  assert.doesNotMatch(source, /win\.on\('resize',\(\)=>\{if\(!win\.isDestroyed\(\)&&!scaledWindows\.has\(name\)\)bridge\.update/);
});

test('the Windows bridge skips nested calls and catches every exception', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'native', 'windows-liquid-glass', 'src', 'taylos_windows_glass.cpp'), 'utf8').replace(/\r\n/g, '\n');
  for (const entry of ['Napi::Value Apply(', 'Napi::Value Update(', 'Napi::Value SetVisible(', 'Napi::Value Detach(']) {
    const start = source.indexOf(entry);
    assert.ok(start >= 0, entry + ' exists');
    const body = source.slice(start, source.indexOf('\n}\n', start));
    assert.match(body, /BridgeCall::Nested\(\)/, entry + ' guards re-entry');
    assert.match(body, /catch \(\.\.\.\)/, entry + ' catches everything');
  }
});
