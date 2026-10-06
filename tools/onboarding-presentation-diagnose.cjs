// Diagnostic twin of onboarding-presentation-check.cjs, for the Windows signing PC.
// Same isolated profile and options (no account, capture, checkout, analytics or
// profile writes), plus what the release gate cannot tell us when the renderer
// stalls: every renderer console line, load and CPU state, and, if the owner has
// not acknowledged after a few seconds, the renderer's JavaScript call stack
// via the DevTools protocol. Never part of a release; exits 0 with a summary.
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.TAYLOS_EMBEDDED_ONBOARDING = '1';
if (process.env.TAYLOS_DIAG_DISABLE_GPU === '1') app.disableHardwareAcceleration();
app.setName('Taylos Presentation Diagnosis');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'taylos-presentation-diag-')));
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'taylos-presentation-diagnosis'));
fs.mkdirSync(output, { recursive: true });
const started = Date.now();
const log = (event, detail = {}) => console.log('[diag]', JSON.stringify({ ms: Date.now() - started, event, ...detail }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let owner = null, acknowledged = false;

app.on('browser-window-created', (_event, win) => {
  const wc = win.webContents;
  wc.on('console-message', event => log('console', { level: event.level, message: String(event.message).slice(0, 400), source: String(event.sourceId || '').split('/').pop(), line: event.lineNumber }));
  wc.on('did-start-navigation', details => {
    const url = String(details?.url || '');
    if (url.includes('goal-first-atlas-practice.html') && !owner) { owner = win; log('owner-navigation', { transparent: true }); watch(win); }
  });
  wc.on('render-process-gone', (_e, details) => log('render-process-gone', { reason: details?.reason, exitCode: details?.exitCode }));
  wc.on('unresponsive', () => log('unresponsive'));
  wc.on('responsive', () => log('responsive'));
});

function metricsFor(win) {
  try {
    const pid = win.webContents.getOSProcessId();
    const metric = app.getAppMetrics().find(item => item.pid === pid);
    return { pid, cpu: metric?.cpu?.percentCPUUsage, idleWakeups: metric?.cpu?.idleWakeupsPerSecond };
  } catch (error) { return { error: error.message }; }
}

async function captureStack(win) {
  const dbg = win.webContents.debugger;
  try {
    dbg.attach('1.3');
    const paused = new Promise(resolve => {
      dbg.on('message', (_event, method, params) => {
        if (method !== 'Debugger.paused') return;
        resolve((params.callFrames || []).slice(0, 12).map(frame => ({
          fn: frame.functionName || '(anonymous)',
          url: String(frame.url || '').split('/').pop(),
          line: frame.location?.lineNumber, column: frame.location?.columnNumber,
        })));
      });
    });
    await dbg.sendCommand('Debugger.enable');
    await dbg.sendCommand('Debugger.pause');
    const frames = await Promise.race([paused, delay(4000).then(() => null)]);
    log(frames ? 'renderer-js-stack' : 'renderer-not-pausable-within-4s', frames ? { frames } : { note: 'main thread blocked outside JavaScript (native/sync wait) or idle' });
    try { await dbg.sendCommand('Debugger.resume'); } catch {}
    try {
      const probe = await Promise.race([dbg.sendCommand('Runtime.evaluate', { expression: 'JSON.stringify({ready:document.readyState,bridge:!!window.taylosLocal,awaiting:!!document.querySelector(".awaiting-presentation"),fonts:document.fonts.status})', returnByValue: true }), delay(3000).then(() => null)]);
      log('renderer-probe', { value: probe?.result?.value ?? null });
    } catch (error) { log('renderer-probe-error', { message: error.message }); }
    dbg.detach();
  } catch (error) { log('debugger-error', { message: error.message }); }
}

function watch(win) {
  const wc = win.webContents;
  let ticks = 0, stackTaken = false;
  const timer = setInterval(async () => {
    if (win.isDestroyed()) { clearInterval(timer); return; }
    ticks++;
    log('tick', { loading: wc.isLoading(), waiting: wc.isWaitingForResponse(), crashed: wc.isCrashed(), visible: win.isVisible(), ...metricsFor(win) });
    if (!acknowledged && !stackTaken && ticks >= 3) { stackTaken = true; await captureStack(win); }
    if (ticks >= 9) clearInterval(timer);
  }, 2000);
}

app.whenReady().then(async () => {
  log('start', { platform: process.platform, arch: process.arch, electron: process.versions.electron, os: os.release(), gpuDisabled: process.env.TAYLOS_DIAG_DISABLE_GPU === '1' });
  try { log('gpu-feature-status', app.getGPUFeatureStatus()); } catch {}
  const { startOnboarding } = require('../onboarding-runtime/output/onboarding-prototype/local-onboarding.cjs');
  let result = 'FAIL', reason = null;
  try {
    const handle = await startOnboarding({
      analytics: false, diagnostics: true, readAccount: async () => null,
      requestHost: async () => ({ live: false }),
      onFinish: async () => { throw Error('Diagnosis must not finish setup'); },
      onClose: () => {},
    });
    acknowledged = true;
    log('presented', { visible: handle.window.isVisible() });
    await delay(1500);
    const image = await handle.window.webContents.capturePage();
    fs.writeFileSync(path.join(output, 'presented.png'), image.toPNG());
    result = 'PASS';
    handle.close();
  } catch (error) {
    reason = error.message;
    log('start-onboarding-error', { message: error.message });
  }
  await delay(4000);
  console.log(JSON.stringify({ result, reason, platform: process.platform, gpuDisabled: process.env.TAYLOS_DIAG_DISABLE_GPU === '1', output }));
  app.exit(0);
}).catch(error => { console.error('Diagnosis crashed:', error.message); app.exit(0); });
