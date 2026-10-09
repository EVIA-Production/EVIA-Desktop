// The menu-bar (macOS) / tray (Windows) icon is the visible way back to a hidden
// Taylos bar. Until v1.0.122 shortcut re-registration, which runs on every
// transition to ready, disposed the tray and with it the restore action, so the
// icon reappeared on the next hide but its click did nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const trays = [];
class FakeTray extends EventEmitter {
  constructor() { super(); this.destroyed = false; trays.push(this); }
  setToolTip() {}
  destroy() { this.destroyed = true; }
  isDestroyed() { return this.destroyed; }
}
const image = { isEmpty: () => false, setTemplateImage() {}, getSize: () => ({ width: 0, height: 0 }), toBitmap: () => Buffer.alloc(0) };
require.cache[require.resolve('electron')] = { exports: { app: { getLocale: () => 'en', isPackaged: false }, nativeImage: { createFromPath: () => image }, Tray: FakeTray } };
const tray = require(path.join(__dirname, '..', 'dist', 'main', 'tray.js'));
const supported = process.platform === 'darwin' || process.platform === 'win32';

test('a click on the icon restores, also after the bar was shown and hidden again', { skip: !supported }, () => {
  let restored = 0;
  tray.initTray(() => { restored++; });
  tray.syncTray(true);
  trays.at(-1).emit('click');
  tray.syncTray(false);
  tray.syncTray(true);
  assert.equal(trays.filter(item => !item.destroyed).length, 1, 'one icon at a time');
  trays.at(-1).emit('click');
  assert.equal(restored, 2);
  tray.disposeTray();
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
