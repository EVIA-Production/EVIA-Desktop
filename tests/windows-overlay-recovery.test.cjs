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
    app: { isPackaged: false, isReady: () => true, getLocale: () => 'en' },
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
      isDestroyed() { return false; }
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
  const shadows = [];
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
    setHasShadow(value) { shadows.push(value); },
    webContents: { isLoading: () => false },
  });
  return { material, win, applies, updates, events, shadows, flush: () => { while (pending.length) pending.shift()(); } };
}

function nativeVisibilityHarness(platform = 'win32') {
  const source = fs.readFileSync(path.join(root, 'src/main/overlay-windows.ts'), 'utf8');
  const visibility = evaluate('src/main/overlay-visibility-controller.ts', name => require(name));
  const overlayVisibility = new visibility.OverlayVisibilityController();
  overlayVisibility.set({ ask: true, listen: true });
  const header = new EventEmitter();
  Object.assign(header, {
    visible: true, minimized: false, isDestroyed: () => false,
    isVisible: () => header.visible, isMinimized: () => header.minimized,
  });
  const children = new Map(['ask', 'listen', 'settings'].map(name => [name, { visible: name !== 'settings', isDestroyed: () => false }]));
  const trayStates = [];
  let trayClick;
  let reopened = 0;
  let state = 'ready';
  const context = {
    headerWindow: header, childWindows: children, overlayVisibility,
    restoreChildWindowsOnHeaderRestore: false, isAppQuitting: false,
    process: { platform }, console: { log() {}, error() {} },
    headerController: { getCurrentState: () => state, reopen: async () => { reopened++; } },
    initTray: callback => { trayClick = callback; },
    syncTray: hidden => trayStates.push(hidden),
    setWindowMaterialVisible() {},
    getVisibleChildWindowNames: () => [...children].filter(([, win]) => win.visible).map(([name]) => name),
    hideComposedWindow: win => { win.visible = false; win.emit?.('hide'); },
    ensureHeaderWindowVisible: () => {
      if (header.minimized) { header.minimized = false; header.emit('restore'); }
      header.visible = true;
      header.emit('show');
      return header;
    },
    restoreLastVisibleChildWindows: () => {
      for (const [name, win] of children) win.visible = overlayVisibility.isDesired(name);
    },
  };
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const code = [
    section('initTray(() => {', 'function getWindowIconPath'),
    section('export function restoreOverlayUi()', 'function getVisibleChildWindowNames'),
    section('  const createdHeaderWindow = headerWindow', "  headerWindow.once('ready-to-show'"),
    section('function handleHeaderToggle()', 'let isAnimating ='),
  ].join('\n').replace('export function restoreOverlayUi', 'function restoreOverlayUi');
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return {
    header, children, overlayVisibility, trayStates, context,
    clickTray: () => trayClick(), reopened: () => reopened, setState: value => { state = value; },
  };
}

for (const event of ['minimize', 'hide']) {
  test(`Windows native ${event} exposes tray recovery and restores exactly the desired panels`, () => {
    const h = nativeVisibilityHarness();
    for (let cycle = 0; cycle < 3; cycle++) {
      h.header.minimized = event === 'minimize';
      h.header.visible = event !== 'hide';
      h.header.emit(event);
      assert.equal(h.overlayVisibility.isUiHidden(), true);
      assert.equal(h.trayStates.at(-1), true);
      assert.equal([...h.children.values()].some(win => win.visible), false);
      h.clickTray();
      assert.equal(h.overlayVisibility.isUiHidden(), false);
      assert.equal(h.trayStates.at(-1), false);
      assert.equal(h.header.minimized, false);
      assert.equal(h.header.visible, true);
      assert.equal(h.children.get('ask').visible, true);
      assert.equal(h.children.get('listen').visible, true);
      assert.equal(h.children.get('settings').visible, false);
    }
  });
}

test('restoring from the Windows taskbar also clears hidden state and restores panels', () => {
  const h = nativeVisibilityHarness();
  h.header.minimized = true;
  h.header.emit('minimize');
  h.header.minimized = false;
  h.header.emit('restore');
  assert.equal(h.overlayVisibility.isUiHidden(), false);
  assert.equal(h.trayStates.at(-1), false);
  assert.equal(h.children.get('ask').visible, true);
});

test('Windows Close window preserves the renderer and reopens the same window group', () => {
  const h = nativeVisibilityHarness();
  let prevented = 0;
  for (let cycle = 0; cycle < 3; cycle++) {
    h.header.emit('close', { preventDefault() { prevented++; } });
    assert.equal(h.context.headerWindow, h.header, 'do not replace the capture renderer or its glass host');
    assert.equal(h.header.visible, false);
    assert.equal(h.overlayVisibility.isUiHidden(), true);
    assert.equal([...h.children.values()].some(win => win.visible), false);
    h.context.restoreOverlayUi();
    assert.equal(h.header.visible, true);
    assert.equal(h.children.get('ask').visible, true);
    assert.equal(h.children.get('listen').visible, true);
  }
  assert.equal(prevented, 3);
});

test('native Close window remains destructive for shutdown, setup, stale windows and macOS', () => {
  for (const mode of ['quitting', 'setup', 'replaced', 'macos']) {
    const h = nativeVisibilityHarness(mode === 'macos' ? 'darwin' : 'win32');
    if (mode === 'quitting') h.context.isAppQuitting = true;
    if (mode === 'setup') h.setState('onboarding');
    if (mode === 'replaced') h.context.headerWindow = {};
    h.header.emit('close', { preventDefault() { assert.fail('must allow the native close: ' + mode); } });
  }
});

test('Windows material never enables an OS shadow on the oversized transparent host', () => {
  const h = materialHarness();
  assert.equal(h.material.materialWindowOptions('overlay').hasShadow, false);
  h.material.applyWindowMaterial(h.win, 'overlay', 'native');
  h.material.applyWindowMaterial(h.win, 'overlay', 'custom');
  h.material.setWindowMaterialVisible(h.win, true);
  assert.ok(h.shadows.length > 0);
  assert.ok(h.shadows.every(value => value === false));
});

test('native header events ignore shutdown, setup, and obsolete native windows', () => {
  for (const mode of ['quitting', 'setup', 'replaced']) {
    const h = nativeVisibilityHarness();
    if (mode === 'quitting') h.context.isAppQuitting = true;
    if (mode === 'setup') h.setState('onboarding');
    if (mode === 'replaced') h.context.headerWindow = {};
    h.header.emit('minimize');
    assert.equal(h.overlayVisibility.isUiHidden(), false, mode);
    assert.equal(h.children.get('ask').visible, true, mode);
  }
});

test('macOS tray callback toggles the whole group and reopens setup instead of toggling it', () => {
  const h = nativeVisibilityHarness('darwin');
  h.clickTray();
  assert.equal(h.overlayVisibility.isUiHidden(), true);
  assert.equal(h.header.visible, false);
  h.clickTray();
  assert.equal(h.overlayVisibility.isUiHidden(), false);
  assert.equal(h.header.visible, true);
  assert.equal(h.children.get('ask').visible, true);
  h.setState('onboarding');
  h.clickTray();
  assert.equal(h.reopened(), 1);
  assert.equal(h.overlayVisibility.isUiHidden(), false);
});

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

function attachedLayoutHarness() {
  const source = fs.readFileSync(path.join(root, 'src/main/overlay-windows.ts'), 'utf8');
  const start = source.indexOf('function layoutChildWindows(');
  const end = source.indexOf('function animateShow(', start);
  const geometry = evaluate('src/main/window-anchor-geometry.ts', name => require(name));
  const header = { x: 500, y: 100, width: 338, height: 64 };
  const windows = new Map();
  const work = { x: 0, y: 0, width: 1920, height: 1040 };
  const createChildWindow = name => {
    if (!windows.has(name)) {
      let bounds = { x: 0, y: 0, width: name === 'ask' ? 640 : 400, height: 300 };
      windows.set(name, { getBounds: () => ({ ...bounds }), setBounds: value => { bounds = { ...value }; } });
    }
    return windows.get(name);
  };
  const context = {
    getOrCreateHeaderWindow: () => ({ getBounds: () => ({ ...header }) }),
    getWorkAreaBounds: () => work,
    screen: { getDisplayNearestPoint: () => ({ bounds: { ...work, height: 1080 } }) },
    HEADER_SIZE: { width: 900, height: 49 },
    headerVisualCenterOffset: 169,
    PAD: 8,
    WINDOW_DATA: { ask: { width: 640, height: 58 }, listen: { width: 400, height: 420 } },
    centerWindowGroupX: geometry.centerWindowGroupX,
    centerWindowX: geometry.centerWindowX,
    createChildWindow,
    clampBounds: bounds => geometry.clampRectToDisplay(bounds, { bounds: { ...work, height: 1080 }, workArea: work }),
    console: { log() {} },
  };
  vm.createContext(context);
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(code + '\nglobalThis.layout = layoutChildWindows;', context);
  return { header, window: createChildWindow, layout: context.layout };
}

test('Ask anchors eight pixels below the visible bar on first show and after host resizing', () => {
  const h = attachedLayoutHarness();
  for (const hostHeight of [64, 49, 64, 80, 49]) {
    h.header.height = hostHeight;
    h.layout({ ask: true, listen: false });
    assert.equal(h.window('ask').getBounds().y - (h.header.y + 49), 8);
  }
});

test('streaming growth and side-by-side panels keep the same visible header gap', () => {
  const h = attachedLayoutHarness();
  for (const askHeight of [58, 168, 320, 600]) {
    const ask = h.window('ask');
    ask.setBounds({ ...ask.getBounds(), height: askHeight });
    h.layout({ ask: true, listen: true });
    for (const name of ['ask', 'listen']) assert.equal(h.window(name).getBounds().y, 157);
    assert.equal(ask.getBounds().height, askHeight);
    assert.equal(ask.getBounds().x - (h.window('listen').getBounds().x + 400), 8);
  }
});

test('panels above the bar retain their bottom anchor while growing', () => {
  const h = attachedLayoutHarness();
  h.header.y = 900;
  for (const height of [58, 320, 600]) {
    const ask = h.window('ask');
    ask.setBounds({ ...ask.getBounds(), height });
    h.layout({ ask: true, listen: true });
    for (const name of ['ask', 'listen']) {
      const bounds = h.window(name).getBounds();
      assert.equal(h.header.y - (bounds.y + bounds.height), 8);
    }
  }
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

test('native restore invalidates the entire HWND and Chromium child surfaces, without focus redraw loops', () => {
  const source = fs.readFileSync(path.join(root, 'native/windows-liquid-glass/src/taylos_windows_glass.cpp'), 'utf8');
  const start = source.indexOf('void SynchronizeVisibility(');
  const end = source.indexOf('// SetWindowRgn', start);
  const reveal = source.slice(start, end);
  assert.match(reveal, /const bool revealing = visible && !state\.visible/);
  assert.match(reveal, /state\.visible = visible/);
  assert.match(reveal, /if \(revealing && IsWindowVisible\(hwnd\)\)/);
  assert.match(reveal, /RedrawWindow\(\s*hwnd, nullptr, nullptr,\s*RDW_INVALIDATE \| RDW_FRAME \| RDW_ALLCHILDREN \| RDW_UPDATENOW\)/);
  assert.match(source, /SynchronizeVisibility\(hwnd, \*state->second, info\[1\]/);
  assert.match(source, /if \(BridgeCall::Nested\(\)\) return Result/);
});

test('additional native capture cannot delay or replace the original physical restore assertion', () => {
  const source = fs.readFileSync(path.join(root, 'tools/overlay-presentation-check.cjs'), 'utf8');
  const electronSample = source.indexOf('const sources = await desktopCapturer.getSources');
  const nativeSample = source.indexOf('const nativeCapture = windowsScreenCrop');
  assert.ok(electronSample > 0 && nativeSample > electronSample);
  assert.match(source, /for \(const band of bands\)\s*assert\(Math\.min\(\.\.\.band\.rgb\) < 200/);
  assert.match(source, /for \(const band of nativeBands\)\s*assert\(Math\.min\(\.\.\.band\.rgb\) < 200/);
  assert.match(source, /BitBlt\(destination,[\s\S]*0x00CC0020u \| 0x40000000u/);
  assert.match(source, /PixelFormat\.Format24bppRgb/);
  assert.doesNotMatch(source, /CopyPixelOperation/);
  assert.match(source, /SetThreadDpiAwarenessContext\(new IntPtr\(-4\)\)/);
  assert.match(source, /finally \{ SetThreadDpiAwarenessContext\(previous\); \}/);
});
