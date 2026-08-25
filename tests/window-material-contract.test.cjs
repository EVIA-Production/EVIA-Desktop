const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'main', 'window-material.ts'),
  'utf8'
);
const nativeWindowsSource = fs.readFileSync(
  path.join(__dirname, '..', 'native', 'windows-liquid-glass', 'src', 'taylos_windows_glass.cpp'),
  'utf8'
);
const windowsBuilder = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'build-windows-glass.js'),
  'utf8'
);
const electronBuilder = fs.readFileSync(
  path.join(__dirname, '..', 'electron-builder.yml'),
  'utf8'
);
const liquidGlass = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'overlay', 'liquid-glass.css'),
  'utf8'
);

test('every native material follows the shared Taylos application focus state', () => {
  assert.match(
    source,
    /function nativeMaterialActiveState[\s\S]*return windowIsActive/
  );
  assert.match(
    source,
    /applyNativeBridge\([\s\S]*nativeMaterialActiveState\(surface, applicationActive\)/
  );
  assert.match(source, /export function setWindowMaterialActive/);
  assert.match(source, /export function setWindowMaterialVisible/);
  assert.doesNotMatch(source, /win\.on\('focus',[\s\S]*updateActiveState/);
  assert.doesNotMatch(source, /BrowserWindow\.getFocusedWindow/);
  assert.match(source, /updateActiveState\(currentApplicationActive\)/);
  assert.match(
    source,
    /active: nativeMaterialActiveState\(configured\.surface, active\)/
  );
});

test('Windows uses the packaged native bridge and never the rectangular Electron backdrop', () => {
  assert.match(source, /windows-liquid-glass[\s\S]*`win32-\$\{process\.arch\}`/);
  assert.match(source, /process\.platform !== 'darwin' && process\.platform !== 'win32'/);
  assert.match(source, /hasShadow: true/);
  assert.match(source, /roundedCorners: false, thickFrame: false/);
  assert.match(source, /Do not call setBackgroundMaterial/);
  assert.doesNotMatch(source, /setBackgroundMaterial\(policy\.windowsMaterial\)/);
  assert.match(source, /Buffer\.from\(win\.getNativeWindowHandle\(\)\)/);
  assert.match(source, /materialWidth: materialBounds\.width/);
  assert.match(source, /materialHeight: materialBounds\.height/);
  assert.match(source, /bridge\.detach\(nativeHandle\)/);
});

test('Windows glass is a live clipped blur built only from documented Composition APIs', () => {
  assert.match(nativeWindowsSource, /CreateHostBackdropBrush\(\)/);
  assert.match(nativeWindowsSource, /GaussianBlurEffect/);
  assert.match(nativeWindowsSource, /CreateRoundedRectangleGeometry\(\)/);
  assert.match(nativeWindowsSource, /CreateRoundRectRgn\(/);
  assert.match(nativeWindowsSource, /SetWindowRgn\(hwnd, region, TRUE\)/);
  assert.match(nativeWindowsSource, /state\.root\.Opacity\(visible \? 1\.0f : 0\.0f\)/);
  assert.match(nativeWindowsSource, /exports\.Set\("setVisible"/);
  assert.match(nativeWindowsSource, /requested_height[\s\S]*std::min\(client_height/);
  assert.match(nativeWindowsSource, /DWMWINDOWATTRIBUTE>\(kDwmUseHostBackdropBrush\)/);
  assert.doesNotMatch(nativeWindowsSource, /SetWindowCompositionAttribute|GetProcAddress\([^\n]*user32[^\n]*SetWindow/);
});

test('Windows glass refracts the live backdrop progressively inward', () => {
  assert.match(nativeWindowsSource, /struct BackdropLayer/);
  assert.match(nativeWindowsSource, /\{0\.0f, 18\.0f\}/);
  assert.match(nativeWindowsSource, /\{4\.0f, 0\.0f\}/);
  assert.match(nativeWindowsSource, /layer\.logical_inset \* dpi_scale/);
  assert.match(nativeWindowsSource, /layer\.geometry\.CornerRadius/);
  assert.match(nativeWindowsSource, /CreateHostBackdropBrush\(\)/);
});

test('Windows native glass has three contrast-preserving optical rim bands', () => {
  assert.match(
    liquidGlass,
    /data-platform='win32'[\s\S]*inset 0 0 0 1px rgba\(255, 255, 255, 0\.34\)[\s\S]*inset 0 0 0 2px rgba\(0, 0, 0, 0\.58\)[\s\S]*inset 0 0 0 3px rgba\(255, 255, 255, 0\.11\)/,
  );
});

test('the native Windows bridge is rebuilt and shipped for x64 and ARM64', () => {
  assert.match(windowsBuilder, /architecture: 'x64', machine: 0x8664/);
  assert.match(windowsBuilder, /architecture: 'arm64', machine: 0xaa64/);
  assert.match(windowsBuilder, /expectedEffectHeaderSha256/);
  assert.match(windowsBuilder, /readFileSync\(effectHeader, 'utf8'\)\.replace\(\/\\r\\n\/g, '\\n'\)/);
  assert.match(windowsBuilder, /readPeMachine/);
  assert.match(windowsBuilder, /prebuilds/);
  assert.match(
    electronBuilder,
    /win:[\s\S]*extraResources:[\s\S]*from: "native\/windows-liquid-glass\/prebuilds"[\s\S]*"\*\*\/taylos_windows_glass\.node"/,
  );
  const globalFiles = electronBuilder.match(/^files:\r?\n([\s\S]*?)^asarUnpack:/m)?.[1] ?? '';
  const globalAsarUnpack = electronBuilder.match(/^asarUnpack:\r?\n([\s\S]*?)^# Run afterPack/m)?.[1] ?? '';
  assert.doesNotMatch(globalFiles, /windows-liquid-glass/);
  assert.doesNotMatch(globalAsarUnpack, /windows-liquid-glass/);
});
