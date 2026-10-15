// The menu-bar (macOS) / tray (Windows) icon is the visible way back to a hidden
// Taylos bar. Until v1.0.122 shortcut re-registration, which runs on every
// transition to ready, disposed the tray and with it the restore action, so the
// icon reappeared on the next hide but its click did nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');

function trayHarness(platform) {
  const trays = [];
  let ready = true;
  class FakeTray extends EventEmitter {
    constructor() { super(); this.destroyed = false; trays.push(this); }
    setToolTip(value) { this.tooltip = value; }
    destroy() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  const image = { isEmpty: () => false, setTemplateImage() {}, getSize: () => ({ width: 0, height: 0 }), toBitmap: () => Buffer.alloc(0), resize() { return this; }, toPNG: () => Buffer.alloc(0), toDataURL: () => 'data:image/png;base64,', addRepresentation() {} };
  const electron = { app: { getLocale: () => 'en', isReady: () => ready, isPackaged: false }, nativeImage: { createFromPath: () => image }, Tray: FakeTray };
  const file = path.join(__dirname, '..', 'src/main/tray.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Buffer, __dirname: path.dirname(file), process: { platform },
    require: name => name === 'electron' ? electron : require(name),
    console: { log() {}, error() {} },
  });
  return { tray: exports, trays, setReady: value => { ready = value; } };
}

test('Windows hidden tray restores after repeated hide/show cycles', () => {
  const { tray, trays } = trayHarness('win32');
  let restored = 0;
  tray.initTray(() => { restored++; });
  tray.syncTray(true);
  trays.at(-1).emit('click');
  tray.syncTray(false);
  assert.equal(trays.filter(item => !item.destroyed).length, 0);
  tray.syncTray(true);
  assert.equal(trays.filter(item => !item.destroyed).length, 1, 'one icon at a time');
  trays.at(-1).emit('click');
  assert.equal(restored, 2);
  tray.disposeTray();
});

test('macOS keeps one menu-bar icon for successive hide/show clicks with translated tooltips', () => {
  const { tray, trays } = trayHarness('darwin');
  let hidden = false;
  tray.initTray(() => { hidden = !hidden; tray.syncTray(hidden); });
  tray.syncTray(false);
  const icon = trays[0];
  assert.equal(icon.tooltip, 'Hide Taylos');
  for (let i = 0; i < 4; i++) {
    icon.emit('click');
    assert.equal(hidden, i % 2 === 0);
    assert.equal(icon.tooltip, hidden ? 'Show Taylos' : 'Hide Taylos');
    assert.equal(icon.destroyed, false);
    assert.equal(trays.length, 1);
  }
  tray.setTrayLanguage('de');
  assert.equal(icon.tooltip, 'Taylos ausblenden');
  icon.emit('click');
  assert.equal(icon.tooltip, 'Taylos einblenden');
  tray.disposeTray();
  assert.equal(icon.destroyed, true);
});

test('initial visibility observation cannot create a tray before Electron is ready', () => {
  for (const platform of ['darwin', 'win32']) {
    const { tray, trays, setReady } = trayHarness(platform);
    setReady(false);
    tray.initTray(() => {});
    tray.syncTray(false);
    tray.syncTray(true);
    assert.equal(trays.length, 0);
    setReady(true);
    tray.syncTray(true);
    assert.equal(trays.length, 1);
    tray.disposeTray();
  }
});

test('shortcut re-registration keeps the tray and its restore action', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'overlay-windows.ts'), 'utf8');
  const start = source.indexOf('function registerShortcuts()');
  const end = source.indexOf('const shortcuts = loadShortcuts()', start);
  assert.ok(start > 0 && end > start, 'registerShortcuts re-registration block found');
  assert.equal(source.slice(start, end).includes('disposeTray('), false, 'only shutdown may dispose the tray');
});

test('suspending shortcuts for setup/logout does not clear the tray restore callback', () => {
 const source=fs.readFileSync(path.join(__dirname,'..','src/main/overlay-windows.ts'),'utf8');
 const start=source.indexOf('function unregisterShortcuts()');
 const end=source.indexOf('function synchronizeWindowGroupFocus',start);
 assert.equal(source.slice(start,end).includes('disposeTray('),false);
 assert.match(source,/app\.on\('will-quit', \(\) => \{\s*unregisterShortcuts\(\)\s*disposeTray\(\)/);
});
