const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const root = path.join(__dirname, '..');

function evaluate(file, stubs, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Buffer, __dirname: path.join(root, path.dirname(file)),
    process: { platform: 'win32', arch: 'x64', resourcesPath: '/fixture', env: { TAYLOS_NATIVE_GLASS: '1' } },
    require: name => stubs(name), console: { log() {}, warn() {}, error() {} },
    ...globals,
  }, { filename: file });
  return exports;
}

test('Windows tray has a white glyph, black outer/internal outlines and DPI representations', () => {
  const bitmaps = [];
  class Image {
    constructor(width = 5, pixels) {
      this.width = width;
      this.pixels = pixels || Buffer.alloc(width * width * 4);
      if (!pixels) this.pixels[(Math.floor(width / 2) * width + Math.floor(width / 2)) * 4 + 3] = 255;
      this.representations = [];
    }
    getSize() { return { width: this.width, height: this.width }; }
    toBitmap() { return this.pixels; }
    toPNG() { return this.pixels; }
    toDataURL() { return 'data:image/png;base64,' + this.pixels.toString('base64'); }
    isEmpty() { return false; }
    resize({ width }) { return new Image(width); }
    addRepresentation(rep) { this.representations.push(rep); }
  }
  let trayImage;
  const electron = {
    app: { isPackaged: false, getLocale: () => 'en' },
    nativeImage: {
      createFromPath: () => {
        const pixels = Buffer.alloc(9 * 9 * 4);
        for (let y = 3; y <= 5; y++) {
          for (let x = 3; x <= 5; x++) {
            if (x !== 4 || y !== 4) pixels[(y * 9 + x) * 4 + 3] = 255;
          }
        }
        pixels[(3 * 9 + 2) * 4 + 3] = 128;
        return new Image(9, pixels);
      },
      createFromBitmap: (pixels, { width }) => { const result = new Image(width, pixels); bitmaps.push(result); return result; },
    },
    Tray: class extends EventEmitter {
      constructor(image) { super(); trayImage = image; }
      setToolTip() {}
    },
  };
  const tray = evaluate('src/main/tray.ts', name => name === 'electron' ? electron : require(name));
  tray.initTray(() => {});
  tray.syncTray(true);
  const pixels = trayImage.toBitmap();
  const pixelAt = (x, y) => [...pixels.subarray((y * 9 + x) * 4, (y * 9 + x) * 4 + 4)];
  assert.deepEqual(pixelAt(3, 3), [255, 255, 255, 255], 'glyph stays white');
  assert.deepEqual(pixelAt(2, 2), [0, 0, 0, 255], 'outer outline is black');
  assert.deepEqual(pixelAt(4, 4), [0, 0, 0, 255], 'internal gap has a black outline');
  assert.deepEqual(pixelAt(2, 3), [128, 128, 128, 255], 'antialiased white edge retains the black backing');
  assert.equal(pixels[3], 0, 'outside the mark stays transparent');
  assert.deepEqual(trayImage.representations.map(rep => rep.scaleFactor), [2, 3]);
  assert.deepEqual(bitmaps.slice(1).map(image => image.width), [32, 48]);
});

function materialHarness() {
  const updates = [];
  const applies = [];
  const events = [];
  const pending = [];
  const bridge = {
    isSupported: () => true,
    apply: (_handle, config) => { applies.push(config); return { applied: true }; },
    update: (_handle, config) => { updates.push(config); events.push('geometry'); return { applied: true }; },
    setVisible: (_handle, visible) => { events.push(`visible:${visible}`); },
  };
  const electron = { app: { getAppPath: () => '/fixture', getGPUFeatureStatus: () => ({ gpu_compositing: 'enabled' }) } };
  const material = evaluate('src/main/window-material.ts', name => {
    if (name === 'electron') return electron;
    if (name === 'fs') return { existsSync: () => true };
    if (name.endsWith('.node')) return bridge;
    if (name === './native-glass-policy') return { nativeGlassAllowed: () => true };
    return require(name);
  }, { setImmediate: fn => pending.push(fn) });
  const win = new EventEmitter();
  Object.assign(win, {
    getBounds: () => ({ width: 338, height: 64 }),
    getNativeWindowHandle: () => Buffer.alloc(8),
    isDestroyed: () => false,
    setHasShadow() {},
    webContents: { isLoading: () => false },
  });
  return { material, win, applies, updates, events, flush: () => { while (pending.length) pending.shift()(); } };
}

test('49px product bounds survive 64px Windows host, focus, resize and reveal', () => {
  const h = materialHarness();
  h.material.setWindowMaterialBounds(h.win, { width: 338, height: 49 });
  h.material.applyWindowMaterial(h.win, 'overlay', 'native', false);
  assert.equal(h.applies[0].materialHeight, 49);
  h.flush();
  for (const active of [true, false, true, false]) {
    h.material.setWindowMaterialActive(h.win, active);
    assert.equal(h.updates.at(-1).materialHeight, 49);
    assert.equal(h.updates.at(-1).active, active);
    h.win.emit('resize');
    h.flush();
    assert.equal(h.updates.at(-1).materialHeight, 49);
  }
  h.events.length = 0;
  h.material.setWindowMaterialVisible(h.win, true);
  assert.deepEqual(h.events, ['geometry', 'visible:true'], 'repair the region before exposing its backdrop');
  assert.equal(h.updates.at(-1).active, false, 'reveal preserves focus state');
  h.material.setWindowMaterialBounds(h.win, { width: 420, height: 49 });
  h.flush();
  assert.equal(h.updates.at(-1).materialWidth, 420);
  assert.equal(h.updates.at(-1).materialHeight, 49);
});

test('invalid product dimensions cannot corrupt the native clip', () => {
  const h = materialHarness();
  h.material.setWindowMaterialBounds(h.win, { width: 338, height: 49 });
  h.material.applyWindowMaterial(h.win, 'overlay', 'native');
  h.flush();
  for (const height of [NaN, Infinity, 0, -1]) h.material.setWindowMaterialBounds(h.win, { width: 338, height });
  h.material.setWindowMaterialActive(h.win, true);
  assert.equal(h.updates.at(-1).materialHeight, 49);
});

function revealHarness() {
  const source = fs.readFileSync(path.join(root, 'src/main/overlay-windows.ts'), 'utf8');
  const start = source.indexOf('const composedFirstPaintReady');
  const end = source.indexOf('function setComposedWindowOpacity', start);
  assert.ok(start > 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const events = [];
  const timers = [];
  const captures = [];
  let visible = false;
  const win = {
    isDestroyed: () => false, isVisible: () => visible,
    show: () => { visible = true; events.push('show'); },
    showInactive: () => { visible = true; events.push('showInactive'); },
    hide: () => { visible = false; events.push('hide'); },
    focus: () => events.push('focus'),
    setOpacity: value => events.push(`opacity:${value}`),
    webContents: {
      invalidate: () => events.push('invalidate'),
      capturePage: () => new Promise(resolve => captures.push(resolve)),
    },
  };
  const context = {
    process: { platform: 'win32' },
    setWindowMaterialVisible: (_win, value) => events.push(`material:${value}`),
    setTimeout: fn => timers.push(fn),
  };
  vm.createContext(context);
  vm.runInContext(code + '\nglobalThis.api={showComposedWindow,hideComposedWindow,ready:win=>composedFirstPaintReady.add(win)};', context);
  context.api.ready(win);
  return { ...context.api, win, events, captures, flushTimers: () => { while (timers.length) timers.shift()(); } };
}

test('every Windows restore requests a fresh full frame before and after material reveal', async () => {
  const h = revealHarness();
  for (let cycle = 0; cycle < 20; cycle++) {
    h.events.length = 0;
    h.showComposedWindow(h.win);
    assert.equal(h.events.includes('show'), false, 'never reveal before the hidden capture settles');
    h.captures.shift()();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.ok(h.events.indexOf('show') >= 0);
    assert.equal(h.events[h.events.indexOf('show') + 1], 'invalidate');
    h.flushTimers();
    assert.deepEqual(h.events.slice(-2), ['material:true', 'invalidate']);
    h.hideComposedWindow(h.win);
  }
});

test('a late capture cannot undo hide or reveal an obsolete surface', async () => {
  const h = revealHarness();
  h.showComposedWindow(h.win);
  h.hideComposedWindow(h.win);
  h.captures.shift()();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  h.flushTimers();
  assert.equal(h.events.includes('show'), false);
  assert.equal(h.events.includes('material:true'), false);
});

test('header initial, persisted and renderer-requested bounds stay product-owned', () => {
  const source = fs.readFileSync(path.join(root, 'src/main/overlay-windows.ts'), 'utf8');
  assert.match(source, /setWindowMaterialBounds\(headerWindow, HEADER_SIZE\)/);
  assert.match(source, /productBounds = \{ \.\.\.restoreBounds, height: HEADER_SIZE\.height \}/);
  assert.match(source, /if \(isHeader\) setWindowMaterialBounds\(targetWin, newBounds\)/);
  assert.doesNotMatch(source, /headerWindow\.minimize\(\)/);
  const native = fs.readFileSync(path.join(root, 'native/windows-liquid-glass/src/taylos_windows_glass.cpp'), 'utf8');
  assert.match(native, /GetWindowRgn\(hwnd, current_region\)/);
  assert.match(native, /EqualRgn\(current_region, region\)/);
});
