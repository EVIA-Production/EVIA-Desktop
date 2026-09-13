// Standalone review build. Only account display reads the existing Taylos login;
// no token reaches the renderer, and no capture, subscription or model is started.
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const embedded = process.env.TAYLOS_EMBEDDED_ONBOARDING === '1';
if(!embedded) {
  app.setName('Taylos');
  app.setPath('userData', path.join(app.getPath('appData'), 'Taylos Onboarding Preview'));
}
let window, tray, server, product;
const action = name => window?.webContents.send('onboarding-action', name);
const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.jpeg':'image/jpeg', '.webp':'image/webp', '.woff2':'font/woff2', '.json':'application/json' };

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
    webPreferences:{partition:'taylos-native-setup-review',preload:path.join(__dirname,'local-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false} });
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
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({cancel:!details.url.startsWith(origin+'/') && !details.url.startsWith('data:') && !details.url.startsWith('blob:')});
  });
  const image = nativeImage.createFromPath(path.join(root,'EVIA-Desktop/src/renderer/overlay/assets/taylos_mark.png')).resize({width:18,height:18});
  if (process.platform==='darwin') image.setTemplateImage(true);
  const setTray = visible => {
    if (visible) { tray?.destroy(); tray=null;return; }
    if (tray) return;
    tray=new Tray(image);tray.setToolTip('Show Taylos');
    tray.on('click',()=>{window.show();action('show');});
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
  let presented=false, markPresentable;
  const presentable=new Promise(resolve=>{markPresentable=resolve;});
  const focus=()=>{if(!presented||window.isDestroyed())return;window.show();window.focus();if(process.platform==='darwin')app.focus({steal:true});};
  const permissionReturn=options.requestHost ? require('./permission-return.cjs')({
    check:()=>options.requestHost('onboarding:permissions'),request:options.requestHost,
    notify:()=>{if(!window.isDestroyed())window.webContents.send('onboarding-message',{type:'permissions-updated'});},restore:focus,
  }):null;
  const refreshPermissions=()=>void permissionReturn?.refresh();
  window.on('focus',refreshPermissions);
  app.on('activate',focus);
  product=require('./native-windows.cjs')({root,origin,owner:window,onVisibility:setTray,readAccount:options.readAccount||readAccount,requestHost:channel=>channel==='onboarding:initial-state'?{checkpoint:options.resume||null}:permissionReturn?permissionReturn.request(channel):{live:false}});
  let finishing=false;
  let closed=false;
  let finished=false;
  function close() {
    if(closed)return;
    closed=true;
    ipcMain.removeListener('onboarding-message',finish);
    ipcMain.removeListener('onboarding-close',requestClose);
    permissionReturn?.close();app.removeListener('activate',focus);
    product.destroy();tray?.destroy();tray=null;server.close();
    if(!window.isDestroyed())window.destroy();
    if(embedded)options.onClose?.({finished});else app.quit();
  }
  async function finish(event,data) {
    if(event.sender!==window?.webContents)return;
    if(data?.type==='onboarding-presentable'){markPresentable();return;}
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
      close();
    } catch (error) {
      finishing=false;
      if(!window.isDestroyed())window.webContents.send('onboarding-message',{type:'finish-error',message:error.message});
    }
  }
  const requestClose=event=>{if(event.sender===window.webContents)close();};
  ipcMain.on('onboarding-message',finish);
  ipcMain.on('onboarding-close',requestClose);
  // OS login-item notices are generated by macOS, not by this renderer. Never
  // register the shared development Electron executable as a persistent login item.
  const startView = (process.env.TAYLOS_PREVIEW_LANGUAGE ? '&lang='+encodeURIComponent(process.env.TAYLOS_PREVIEW_LANGUAGE) : '') + (process.env.TAYLOS_PREVIEW_VIEW ? '&view='+encodeURIComponent(process.env.TAYLOS_PREVIEW_VIEW) : '')
    + (process.env.TAYLOS_PREVIEW_PLATFORM ? '&platform='+encodeURIComponent(process.env.TAYLOS_PREVIEW_PLATFORM) : '');
  await window.loadURL(origin+'/output/onboarding-prototype/goal-first-atlas-practice.html?native=1'+startView);
  await presentable;
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
if(!embedded)app.whenReady().then(()=>startOnboarding());
if(!embedded)app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>product?.destroy());
app.on('will-quit',()=>{product?.destroy();tray?.destroy();server?.close();});
