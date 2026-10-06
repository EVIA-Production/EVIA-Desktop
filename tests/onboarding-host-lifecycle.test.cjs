const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createPresentationGate } = require('../onboarding-runtime/output/onboarding-prototype/presentation-gate.cjs');

function host(mode = 'acknowledge', { armAtCreation = false } = {}) {
  const windows = [], closed = [], failures = [], traces = [];
  let productDestroyed = 0, serverClosed = 0;
  const ipcMain = new EventEmitter();ipcMain.removeHandler = () => {};
  class Window extends EventEmitter {
    constructor(options) {
      super();this.options = options;this.calls = [];this.destroyed = false;windows.push(this);
      const wc = this.webContents = new EventEmitter();
      wc.session = { setPermissionRequestHandler() {}, webRequest: { onBeforeRequest() {} } };
      wc.setWindowOpenHandler = () => {};
      wc.send = (channel, message) => this.calls.push([channel, message]);
      wc.loadURL = async () => {};
    }
    isDestroyed() { return this.destroyed; }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents(value) { this.calls.push(['pointer', value]); }
    setOpacity(value) { this.calls.push(['opacity', value]); }
    showInactive() { this.calls.push(['prime']); }
    hide() { this.calls.push(['hide']); }
    show() { this.calls.push(['show']); }
    focus() { this.calls.push(['focus']); }
    destroy() { if(this.destroyed)return;this.destroyed = true;this.emit('closed'); }
    loadURL() {
      (mode === 'slow-product' ? callback => setTimeout(callback, 5) : queueMicrotask)(() => {
        const wc = this.webContents;
        if(mode === 'load-fail') { wc.emit('did-fail-load', {}, -2, 'failed', '', true);return; }
        if(mode === 'preload-fail') { wc.emit('preload-error', {}, 'preload', Error('private account data'));return; }
        if(mode === 'crash') { wc.emit('render-process-gone', {}, { reason:'crashed', exitCode:1 });return; }
        if(mode === 'readiness-fail') { ipcMain.emit('onboarding-message', {sender:wc}, {type:'onboarding-presentation-failed'});return; }
        if(mode === 'close') { this.destroy();return; }
        if(mode === 'never-load')return;
        wc.emit('did-finish-load');
        if(mode === 'untrusted')ipcMain.emit('onboarding-message', { sender:{} }, {type:'onboarding-presentable'});
        if(mode === 'incidental-error')ipcMain.emit('onboarding-message',{sender:wc},{type:'onboarding-readiness',step:'renderer-rejection'});
        if(!['acknowledge','incidental-error','slow-product'].includes(mode))return;
        ipcMain.emit('onboarding-message', { sender:wc }, {type:'onboarding-readiness',step:'rendered'});
        ipcMain.emit('onboarding-message', { sender:wc }, {type:'onboarding-presentable'});
      });
      return mode === 'never-load' ? new Promise(() => {}) : Promise.resolve();
    }
  }
  class Tray extends EventEmitter { destroy() {} setToolTip() {} }
  const app = new EventEmitter();Object.assign(app, { whenReady:async()=>{},getPath:()=>'/isolated',getVersion:()=> '1.0.119',focus() {},quit() {} });
  const mockFs = { existsSync:()=>false,mkdirSync() {},appendFileSync() {},writeFileSync() {} };
  const deps = {
    electron:{app,BrowserWindow:Window,Tray,ipcMain,screen:{getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({bounds:{x:0,y:0,width:1440,height:900}})},nativeImage:{createFromPath:()=>({resize:()=>({})})},shell:{openExternal:()=>assert.fail('visibility must not open checkout')},Menu:{}},
    'node:fs':mockFs,'node:path':path,'node:http':{createServer:()=>({listen(_port,_host,callback){callback();},address:()=>({port:1234}),close(){serverClosed++;}})},
    './presentation-gate.cjs':{createPresentationGate:options=>createPresentationGate({...options,platform:'win32',timeoutMs:20,...(armAtCreation?{autoArm:true}:{})})},
    './display-fit.cjs':()=>()=>{},
    './native-windows.cjs':()=>{if(mode==='product-fail')throw Error('native bridge unavailable');if(mode==='slow-product'){const until=Date.now()+40;while(Date.now()<until);}return {destroy(){productDestroyed++;}};},
  };
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../onboarding-runtime/output/onboarding-prototype/local-onboarding.cjs'),'utf8'),{
    require:id=>{if(!(id in deps))throw Error(id);return deps[id];},module,exports:module.exports,__dirname:path.join(__dirname,'../onboarding-runtime/output/onboarding-prototype'),
    process:{platform:'win32',env:{TAYLOS_EMBEDDED_ONBOARDING:'1'}},console:{log:(...args)=>traces.push(args)},setTimeout,clearTimeout,URL,Buffer,queueMicrotask,
  });
  return {run:()=>module.exports.startOnboarding({onClose:value=>closed.push(value),onPresentationError:reason=>failures.push(reason)}),windows,ipcMain,closed,failures,traces,
    cleanup:()=>({productDestroyed,serverClosed})};
}

test('the real host waits for owner acknowledgement, shows once, preserves security, and ignores later ack', async () => {
  const h=host();const handle=await h.run();const win=h.windows[0];
  assert.equal(win.calls.filter(([name])=>name==='show').length,1);
  assert.deepEqual(win.options.webPreferences.sandbox,true);
  assert.equal(win.options.webPreferences.contextIsolation,true);
  assert.equal(win.options.webPreferences.nodeIntegration,false);
  h.ipcMain.emit('onboarding-message',{sender:win.webContents},{type:'onboarding-presentable'});
  assert.equal(win.calls.filter(([name])=>name==='show').length,1);
  handle.close();handle.close();
  assert.deepEqual(h.closed.map(value=>value.finished),[false]);
  assert.deepEqual(h.cleanup(),{productDestroyed:1,serverClosed:1});
});
for(const mode of ['never-load','never-ack','load-fail','preload-fail','crash','readiness-fail','untrusted'])
  test('the real host recovers and tears down all resources for '+mode,async()=>{
    const h=host(mode);await assert.rejects(h.run(),{code:'ONBOARDING_NOT_PRESENTABLE'});
    assert.equal(h.windows.length,1);
    assert.equal(h.windows[0].destroyed,true);
    assert.equal(h.windows[0].calls.filter(([name])=>name==='show').length,0);
    assert.deepEqual(h.cleanup(),{productDestroyed:1,serverClosed:1});
    assert.equal(h.ipcMain.listenerCount('onboarding-message'),0);
    assert.equal(h.ipcMain.listenerCount('onboarding-close'),0);
    assert.equal(JSON.stringify(h.traces).includes('private account data'),false);
  });
test('closing before readiness resolves startup and notifies cancellation exactly once',async()=>{
  const h=host('close');await assert.rejects(h.run(),{code:'ONBOARDING_CLOSED'});
  assert.deepEqual(h.closed.map(value=>value.finished),[false]);
  assert.deepEqual(h.cleanup(),{productDestroyed:1,serverClosed:1});
});
test('incidental global renderer errors do not reject a valid readiness acknowledgement',async()=>{
  const h=host('incidental-error');await h.run();
  const win=h.windows[0];
  h.ipcMain.emit('onboarding-message',{sender:win.webContents},{type:'onboarding-readiness',step:'renderer-rejection'});
  assert.equal(win.destroyed,false);
  assert.deepEqual(h.failures,[]);
  assert.equal(JSON.stringify(h.traces).includes('renderer-renderer-rejection'),true);
  win.destroy();
});
test('native product construction failure still destroys the owner and cleans up IPC and server',async()=>{
  const h=host('product-fail');await assert.rejects(h.run(),/native bridge unavailable/);
  assert.equal(h.windows[0].destroyed,true);
  assert.deepEqual(h.cleanup(),{productDestroyed:0,serverClosed:1});
  assert.equal(h.ipcMain.listenerCount('onboarding-message'),0);
  assert.equal(h.ipcMain.listenerCount('onboarding-close'),0);
  assert.deepEqual(h.closed,[]);
});
test('a post-presentation renderer crash closes the owner and calls visible recovery',async()=>{
  const h=host();await h.run();
  h.windows[0].webContents.emit('render-process-gone',{}, {reason:'crashed',exitCode:1});
  assert.deepEqual(h.failures,['renderer-gone']);
  assert.deepEqual(h.closed.map(value=>value.finished),[false]);
  assert.deepEqual(h.cleanup(),{productDestroyed:1,serverClosed:1});
});

test('slow product-window setup does not use up the first-paint deadline (v1.0.120 Windows gate)', async () => {
  const h=host('slow-product');const handle=await h.run();const win=h.windows[0];
  assert.equal(win.calls.filter(([name])=>name==='show').length,1);
  assert.deepEqual(h.failures,[]);
  handle.close();
});
test('with the deadline armed at creation, the same slow setup fails presentation (the v1.0.120 failure)', async () => {
  const h=host('slow-product',{armAtCreation:true});
  await assert.rejects(h.run(),/not-presentable/);
  assert.equal(h.windows[0].calls.filter(([name])=>name==='show').length,0);
});
