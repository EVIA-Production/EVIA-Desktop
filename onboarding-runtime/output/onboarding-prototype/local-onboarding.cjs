// Standalone review build. Only account display reads the existing Taylos login;
// no token reaches the renderer, and no capture, subscription or model is started.
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell, dialog } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const { createPresentationGate } = require('./presentation-gate.cjs');
const embedded = process.env.TAYLOS_EMBEDDED_ONBOARDING === '1';
if(!embedded) {
  app.setName('Taylos');
  app.setPath('userData', path.join(app.getPath('appData'), 'Taylos Onboarding Preview'));
}
let window, tray, server, product;
const action = name => window?.webContents.send('onboarding-action', name);
const types = { '.html':'text/html', '.js':'application/javascript', '.mjs':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.jpeg':'image/jpeg', '.webp':'image/webp', '.woff2':'font/woff2', '.json':'application/json' };

async function startOnboarding(options={}) {
  await app.whenReady();
  server = http.createServer((request, response) => {
    let file;
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep)) throw new Error('path');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      else if (!path.extname(file)) file += '.html';
    } catch { response.writeHead(400).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404).end(); return; }
      response.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
      response.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const display = process.env.TAYLOS_PREVIEW_DISPLAY==='primary' ? screen.getPrimaryDisplay() : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  // Let the existing shadow fill the display, including behind system chrome.
  // macOS retains control of the menu bar; no separate tint window is used.
  const area = display.bounds;
  // The onboarding is NOT a fullscreen black app. It covers the screen so the light
  // beams can run off every edge, but the surface is transparent: the desktop stays
  // visible behind a scrim, and only the card in the middle is solid.
  window = new BrowserWindow({ ...area, frame:false, show:false, transparent:true,
    backgroundColor:'#00000000', hasShadow:false, roundedCorners:false, resizable:false,
    title:'Taylos', icon:path.join(root,'EVIA-Desktop/src/main/assets/icon-mac.png'),
    webPreferences:{partition:'taylos-native-setup-review',additionalArguments:!app.isPackaged&&options.diagnostics?['--taylos-presentation-diagnostics']:[],preload:path.join(__dirname,'local-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,paintWhenInitiallyHidden:true} });
  // Presentation trace: event names and timings only (no account
  // data), in the console and in <userData>/logs/onboarding-presentation.log.
  const traceStart=Date.now();
  const traceFile=path.join(app.getPath('userData'),'logs','onboarding-presentation.log');
  const trace=(event,detail={})=>{
    const line=JSON.stringify({at:new Date().toISOString(),ms:Date.now()-traceStart,event,platform:process.platform,...detail});
    console.log('[onboarding-presentation]',line);
    try{fs.mkdirSync(path.dirname(traceFile),{recursive:true});if(fs.existsSync(traceFile)&&fs.statSync(traceFile).size>256*1024)fs.writeFileSync(traceFile,'');fs.appendFileSync(traceFile,line+'\n',{mode:0o600});}catch{}
  };
  trace('owner-created',{width:area.width,height:area.height});
  for(const name of ['did-start-loading','dom-ready','did-finish-load','unresponsive','responsive'])window.webContents.on(name,()=>trace(name));
  window.once('ready-to-show',()=>trace('ready-to-show'));
  window.webContents.on('console-message',details=>{if(details?.level==='error'||details?.level==='warning')trace('renderer-console',{level:details.level,line:details.lineNumber});});
  window.setAlwaysOnTop(false);
  window.setVisibleOnAllWorkspaces(false);
  // Keep shadow-area clicks in onboarding: forwarding them to the desktop
  // triggers macOS Show Desktop / Stage Manager and moves the window away.
  window.setIgnoreMouseEvents(false);
  const stopFittingDisplay=require('./display-fit.cjs')(window,screen,display);
  window.once('closed',stopFittingDisplay);
  // External checkout stays in the browser. No payment details enter this app.
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin + '/')) {
      event.preventDefault();
      if (url.startsWith('https://app.taylos.ai/') || url==='https://taylos.ai/legal') shell.openExternal(url);
    }
  });
  window.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith('https://app.taylos.ai/') || url==='https://taylos.ai/legal') shell.openExternal(url);
    return {action:'deny'};
  });
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  // Everything stays on the local origin, with one exception: PostHog EU
  // ingestion, so the onboarding leaves the same events and replay as the
  // overlay and the web app. Until 2026-09-16 this window sent nothing.
  const analyticsHosts = ['https://eu.i.posthog.com/', 'https://eu-assets.i.posthog.com/'];
  const analytics = (embedded || process.env.TAYLOS_ONBOARDING_ANALYTICS === '1') && options.analytics !== false;
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(origin+'/') || details.url.startsWith('data:') || details.url.startsWith('blob:')
      || (analytics && analyticsHosts.some(host => details.url.startsWith(host)));
    callback({cancel:!allowed});
  });
  if(process.env.TAYLOS_ONBOARDING_ANALYTICS_DEBUG==='1'){
    // Prints what the analytics allowlist let through and what came back.
    window.webContents.session.webRequest.onCompleted(details=>{if(!details.url.startsWith(origin))console.log('[onboarding-analytics]',details.method,details.statusCode,details.url.slice(0,140));});
    window.webContents.session.webRequest.onErrorOccurred(details=>{if(!details.url.startsWith(origin))console.log('[onboarding-analytics] ERROR',details.error,details.url.slice(0,140));});
    window.webContents.on('console-message',(_e,level,message)=>console.log('[onboarding-renderer]',level,String(message).slice(0,200)));
  }
  const image = nativeImage.createFromPath(path.join(root,'EVIA-Desktop/src/renderer/overlay/assets/taylos_mark.png')).resize({width:18,height:18});
  if (process.platform==='darwin') image.setTemplateImage(true);
  const setTray = visible => {
    if (visible) { tray?.destroy(); tray=null;return; }
    if (tray) return;
    tray=new Tray(image);tray.setToolTip('Show Taylos');
    tray.on('click',()=>{focus();if(presented)action('show');});
  };
  setTray(false);
  if(!embedded)Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Taylos',submenu:[{label:'Quit Taylos',role:'quit'}]},{role:'editMenu'}]));
  // Same display-only identity source as production SettingsView. Reading it
  // never refreshes/deletes credentials or checks whether a card is attached.
  const readAccount=async()=>{
    try {
      const keytar=require(path.join(root,'EVIA-Desktop/node_modules/keytar'));
      const token=await keytar.getPassword('taylos','token');
      if(!token)return null;
      const parts=token.split('.');
      if(parts.length!==3)return null;
      const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
      if(typeof payload.exp!=='number'||payload.exp*1000<=Date.now())return null;
      return {email:payload.email||null,username:payload.sub||payload.username||'User'};
    } catch {return null;}
  };
  let presented=false;
  // The deadline is armed when the page starts loading, after the product windows exist.
  const gate=createPresentationGate({window,trace,autoArm:false,timeoutMs:15000});
  window.webContents.on('preload-error',()=>{trace('preload-error');gate.fail('preload-failed');});
  window.webContents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(!isMainFrame)return;trace('did-fail-load',{code});gate.fail('load-failed');});
  window.webContents.on('render-process-gone',(_event,details)=>{
    trace('render-process-gone',{reason:details?.reason,exitCode:details?.exitCode});
    // Before presentation the gate reports the failure; afterwards the blank owner
    // is closed so the regular Taylos window comes back.
    if(!gate.fail('renderer-gone') && presented && !closed){close();options.onPresentationError?.('renderer-gone');}
  });
  const focus=()=>{if(!presented||window.isDestroyed())return;window.show();window.focus();if(process.platform==='darwin')app.focus({steal:true});};
  const permissionReturn=options.requestHost ? require('./permission-return.cjs')({
    check:()=>options.requestHost('onboarding:permissions'),request:options.requestHost,
    notify:()=>{if(!window.isDestroyed())window.webContents.send('onboarding-message',{type:'permissions-updated'});},restore:focus,
  }):null;
  const refreshPermissions=()=>void permissionReturn?.refresh();
  window.on('focus',refreshPermissions);
  app.on('activate',focus);
  let finishing=false;
  let closed=false;
  let finished=false;
  function close(notify=true) {
    if(closed)return;
    closed=true;
    gate.fail('closed');
    ipcMain.removeListener('onboarding-message',finish);
    ipcMain.removeListener('onboarding-close',requestClose);
    permissionReturn?.close();app.removeListener('activate',focus);
    product?.destroy();tray?.destroy();tray=null;server.close();
    if(!window.isDestroyed())window.destroy();
    if(embedded){if(notify)options.onClose?.({finished});}else app.quit();
  }
  window.once('closed',()=>close());
  const readinessSteps=new Set(['bridge-exposed','bridge-available','bridge-missing','initial-state-start','initial-state-end','initial-state-error','initial-state-timeout','rendered','image-start','image-end','image-error','image-timeout','fonts-start','fonts-end','fonts-error','fonts-timeout','assets-ready','frames-start','frames-end','frames-error','frames-timeout','acknowledged','failed','identity-start','identity-end','identity-error','identity-timeout','renderer-error','renderer-rejection','render-checkpoint-applied','render-view','render-layout-started','render-permissions-started','render-layout-read']);
  async function finish(event,data) {
    if(event.sender!==window?.webContents)return;
    if(data?.type==='onboarding-presentable'){trace('renderer-acknowledged');gate.acknowledge();return;}
    if(data?.type==='onboarding-presentation-failed'){gate.fail('renderer-readiness-failed');return;}
    if(data?.type==='onboarding-readiness'){
      if(!readinessSteps.has(data.step))return;
      // The renderer sends only the error's type and message on failure; cap it and drop anything else.
      trace('renderer-'+data.step,{rendererMs:Number.isFinite(data.ms)?data.ms:undefined,error:data.step==='failed'&&typeof data.error==='string'?data.error.slice(0,200):undefined});
      if(data.step==='rendered')gate.markRendered();
      // Global errors can originate in Electron's development warning code.
      // Only the explicit readiness contract, preload/load failure, or a crash
      // should fail presentation; unrelated errors remain diagnostic events.
      return;
    }
    if(data?.type==='taylos-preview-state') {if(data.checkpoint)options.onCheckpoint?.(data.checkpoint);tray?.setToolTip(data.language==='de'?'Taylos einblenden':'Show Taylos');return;}
    // The only non-http destination the shell may open: the exact Windows Settings
    // page for microphone privacy. Nothing else in the ms-settings: space.
    if(data?.type==='navigate') {
      if(data.url==='ms-settings:privacy-microphone' && process.platform==='win32')
        shell.openExternal(data.url);
      return;
    }
    if(data?.type!=='finish-setup' || finishing)return;
    finishing=true;
    try {
      if (options.onFinish) await options.onFinish(data.context || {});
      else {
        fs.writeFileSync(path.join(app.getPath('userData'),'onboarding-context.json'),JSON.stringify(data.context||{}));
        await shell.openExternal('https://app.taylos.ai/checkout?source=desktop');
      }
      finished=true;
      // The page sent its final event with send_instantly; give the request a
      // moment to leave before the window is destroyed.
      if(analytics) await new Promise(resolve=>setTimeout(resolve,600));
      close();
    } catch (error) {
      finishing=false;
      if(!window.isDestroyed())window.webContents.send('onboarding-message',{type:'finish-error',message:error.message});
    }
  }
  const requestClose=event=>{if(event.sender!==window.webContents)return;if(analytics)setTimeout(close,600);else close();};
  ipcMain.on('onboarding-message',finish);
  ipcMain.on('onboarding-close',requestClose);
  // Install cleanup handlers before constructing native product surfaces: a
  // missing bridge must not throw again while trying to clean up its owner.
  product=null;
  try {
    product=require('./native-windows.cjs')({root,origin,owner:window,onVisibility:setTray,readAccount:options.readAccount||readAccount,requestHost:channel=>channel==='onboarding:initial-state'?{checkpoint:options.resume||null}:permissionReturn?permissionReturn.request(channel):{live:false}});
  } catch(error) {gate.fail('product-load-failed');close(false);throw error;}
  // OS login-item notices are generated by macOS, not by this renderer. Never
  // register the shared development Electron executable as a persistent login item.
  const startView = (process.env.TAYLOS_PREVIEW_LANGUAGE ? '&lang='+encodeURIComponent(process.env.TAYLOS_PREVIEW_LANGUAGE) : '') + (process.env.TAYLOS_PREVIEW_VIEW ? '&view='+encodeURIComponent(process.env.TAYLOS_PREVIEW_VIEW) : '')
    + (process.env.TAYLOS_PREVIEW_PLATFORM ? '&platform='+encodeURIComponent(process.env.TAYLOS_PREVIEW_PLATFORM) : '');
  const analyticsQuery = analytics ? '&analytics=1&app_version='+encodeURIComponent(app.getVersion()) : '';
  // TAYLOS_ONBOARDING_FLOW=classic opens the review build on the previous card-copy flow.
  const flowQuery = (process.env.TAYLOS_ONBOARDING_FLOW === 'classic' ? '&flow=classic' : '') + (process.env.TAYLOS_PREVIEW_TAP === '1' ? '&tap=1' : '');
  window.webContents.once('did-finish-load',()=>gate.prime());
  gate.arm();
  // Do not await loadURL before the gate: a hung navigation must also time out.
  void window.loadURL(origin+'/output/onboarding-prototype/goal-first-atlas-practice.html?native=1'+startView+analyticsQuery+flowQuery).catch(()=>{trace('load-url-error');gate.fail('load-failed');});
  const outcome=await gate.outcome;
  if(!outcome.presented){
    // Never leave Taylos running with nothing on screen: tear the onboarding down
    // without marking it closed by the user, and let the caller restore the
    // regular window and tell the user how to retry.
    close(false);
    const error=new Error('Taylos setup could not be shown ('+outcome.reason+')');
    error.code=outcome.reason==='closed'?'ONBOARDING_CLOSED':'ONBOARDING_NOT_PRESENTABLE';
    throw error;
  }
  presented=true;
  focus();
  window.webContents.send('onboarding-message',{type:'onboarding-presented'});
  console.log('Native onboarding preview:', origin);
  if(process.env.TAYLOS_PREVIEW_SCREENSHOT) setTimeout(async()=>{
    const capture=await window.webContents.capturePage();
    fs.writeFileSync(process.env.TAYLOS_PREVIEW_SCREENSHOT,capture.toPNG());
    console.log('Native screenshot:',process.env.TAYLOS_PREVIEW_SCREENSHOT);
  },Number(process.env.TAYLOS_PREVIEW_DELAY || 6200));
  return {window,close,focus};
}
module.exports={startOnboarding};
if(!embedded)app.whenReady().then(()=>startOnboarding()).catch(()=>{
  const german=app.getLocale().startsWith('de');
  dialog.showErrorBox(german?'Taylos konnte nicht geöffnet werden':'Taylos could not open',german?'Bitte starte Taylos erneut. Deine Einrichtung wurde nicht als abgeschlossen gespeichert.':'Please restart Taylos. Your setup has not been marked complete.');
  app.quit();
});
if(!embedded)app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>product?.destroy());
app.on('will-quit',()=>{product?.destroy();tray?.destroy();server?.close();});
