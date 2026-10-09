// Real bar/renderer/visibility paths, but no account, capture, external network,
// analytics, checkout or production profile. Windows screenshots contain only
// the fixture window and its own white backing.
const { app, BrowserWindow, ipcMain, session, screen, desktopCapturer } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
process.env.NODE_ENV = 'production';
process.env.TAYLOS_NATIVE_GLASS = '1';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'taylos-overlay-check-'));
app.setName('Taylos Overlay Check');
app.setPath('userData', profile);
const output = path.resolve(process.argv[2] || path.join(profile, 'evidence'));
fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Overlay check timed out'); app.exit(1); }, 90000);
const assert = (condition, message) => { if (!condition) throw Error(message); };

function windowsRegion(win) {
  const handle = win.getNativeWindowHandle().readBigUInt64LE().toString();
  const code = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TaylosRegionCheck {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
  [DllImport("gdi32.dll")] static extern int GetRgnBox(IntPtr r, out Rect box);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr r);
  [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr h, IntPtr r);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  public static string Inspect(long handle) {
    var h = new IntPtr(handle); var r = CreateRectRgn(0,0,0,0);
    try { Rect box; int kind=GetWindowRgn(h,r); GetRgnBox(r,out box);
      return "{\\"kind\\":"+kind+",\\"width\\":"+(box.Right-box.Left)+",\\"height\\":"+(box.Bottom-box.Top)+",\\"dpi\\":"+GetDpiForWindow(h)+"}";
    } finally { DeleteObject(r); }
  }
}
'@
[TaylosRegionCheck]::Inspect(${handle})`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', code], { encoding: 'utf8', timeout: 15000 }).trim());
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, reply) => reply({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, reply) => reply(false));
  const controller = require.resolve('../dist/main/header-controller.js');
  require.cache[controller] = { id: controller, filename: controller, loaded: true, exports: { headerController: { getCurrentState: () => 'ready', validateAuthentication: async () => false } } };
  ipcMain.handle('auth:getToken', () => null);
  ipcMain.handle('auth:checkTokenValidity', () => ({ valid: false }));
  ipcMain.handle('telemetry:capture', () => ({ ok: true }));
  ipcMain.handle('capture-session:get', () => ({ state: 'idle', generation: 0, changedAt: 0, reason: 'fixture', errorCode: null }));
  ipcMain.handle('audio-debug:check-flag', () => false);
  ipcMain.handle('subscription:getStatus', () => ({ is_active: true, status: 'active' }));
  const overlay = require('../dist/main/overlay-windows.js');
  const display = screen.getPrimaryDisplay();
  const backing = new BrowserWindow({ x: display.workArea.x + 40, y: display.workArea.y + 20, width: 1000, height: 180, frame: false, backgroundColor: '#ffffff', show: true });
  await backing.loadURL('data:text/html,<html><body style="margin:0;background:white">Overlay QA fixture</body></html>');
  const bar = overlay.createHeaderWindow();
  let crash;
  bar.webContents.on('render-process-gone', (_event, details) => { crash = details; });
  const readyDeadline = Date.now() + 10000;
  let metrics;
  do {
    metrics = await bar.webContents.executeJavaScript(`(()=>{const bar=document.querySelector('.evia-main-header');return bar?{width:bar.getBoundingClientRect().width,height:bar.getBoundingClientRect().height,clip:getComputedStyle(bar).overflow,text:bar.textContent}:null})()`);
    if (metrics && bar.isVisible() && !bar.isMinimized() && bar.getBounds().width < 850) break;
    await delay(100);
  } while (Date.now() < readyDeadline);
  assert(metrics && bar.isVisible(), 'Regular bar never became visible');
  bar.setPosition(display.workArea.x + 100, display.workArea.y + 60);
  const capture = async name => {
    assert(!crash, 'Renderer exited: ' + JSON.stringify(crash));
    assert(bar.isVisible() && !bar.isMinimized(), 'Bar is hidden/minimized: ' + name);
    metrics = await bar.webContents.executeJavaScript(`(()=>{const bar=document.querySelector('.evia-main-header');return{width:bar.getBoundingClientRect().width,height:bar.getBoundingClientRect().height,clip:getComputedStyle(bar).overflow,text:bar.textContent}})()`);
    assert(Math.abs(metrics.height - 47) < 1 && metrics.text.includes('Listen'), 'Incomplete bar: ' + JSON.stringify(metrics));
    if (process.platform === 'win32') {
      assert(metrics.clip === 'hidden', 'Renderer optical layer is not clipped');
      const region = windowsRegion(bar);
      assert(region.kind > 0 && Math.abs(region.height - 49 * region.dpi / 96) <= 2, 'Wrong physical material region: ' + JSON.stringify(region));
      console.log(JSON.stringify({ checkpoint: name, region, bounds: bar.getBounds() }));
    }
    const image = await bar.webContents.capturePage();
    assert(!image.isEmpty(), 'Empty renderer capture');
    const pixels = image.toBitmap(), size = image.getSize();
    const viewport = await bar.webContents.executeJavaScript('({width:innerWidth,height:innerHeight})');
    const outside = Math.ceil(49 * size.height / viewport.height);
    for (let y = outside; y < size.height; y++) for (let x = 0; x < size.width; x++)
      assert(pixels[(y * size.width + x) * 4 + 3] === 0, 'Renderer paints below capsule: ' + name);
    fs.writeFileSync(path.join(output, name + '-renderer.png'), image.toPNG());
    if (process.platform === 'win32') {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) } });
      const source = sources.find(item => item.display_id === String(display.id));
      assert(source && !source.thumbnail.isEmpty(), 'No physical screen evidence');
      const dimensions = source.thumbnail.getSize(), ratio = dimensions.width / display.bounds.width;
      const bounds = bar.getBounds();
      const crop = source.thumbnail.crop({ x: Math.round((bounds.x - display.bounds.x) * ratio), y: Math.round((bounds.y - display.bounds.y) * ratio), width: Math.round(bounds.width * ratio), height: Math.round(49 * ratio) });
      const physical = crop.toBitmap(), cropSize = crop.getSize();
      // A stale restored surface showed only one corner. Every interior band
      // must contain the dark bar, not the fixture's white backing.
      for (const fraction of [0.15, 0.4, 0.6, 0.85]) {
        const x = Math.floor(cropSize.width * fraction), y = Math.floor(cropSize.height * 0.7);
        const offset = (y * cropSize.width + x) * 4;
        assert(Math.min(physical[offset], physical[offset + 1], physical[offset + 2]) < 200, 'Missing physical bar band at ' + fraction + ': ' + name);
      }
      fs.writeFileSync(path.join(output, name + '-desktop.png'), crop.toPNG());
    }
  };
  await delay(500);
  await capture('initial');
  for (let cycle = 1; cycle <= 5; cycle++) {
    await bar.webContents.executeJavaScript('window.evia.windows.toggleAllVisibility()');
    await delay(150);
    assert(!bar.isVisible() && !bar.isMinimized(), 'Show/Hide must hide, not minimize, the transparent HWND');
    overlay.restoreOverlayUi();
    await delay(500);
    await capture('restored-' + cycle);
    await bar.webContents.executeJavaScript("window.evia.ipc.send('window-group:clicked')");
    await delay(100);
    await capture('focused-' + cycle);
  }
  clearTimeout(timeout);
  console.log(JSON.stringify({ result: 'PASS', platform: process.platform, realBar: true, restoreCycles: 5, screenshots: output }));
  app.exit(0);
}).catch(error => { console.error('Overlay check failed:', error.stack); app.exit(1); });
