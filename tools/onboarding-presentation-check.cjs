// Isolated Electron visibility check: no real account, capture, permissions,
// checkout, model calls, analytics, or production profile writes.
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.TAYLOS_EMBEDDED_ONBOARDING = '1';
app.setName('Taylos Presentation Check');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'taylos-presentation-check-')));
const output = path.resolve(process.argv[2] || path.join(__dirname, '../../output/playwright/onboarding-presentation-2026-10-07'));
fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let closed = 0;
app.on('browser-window-created',(_event,win)=>{
  win.webContents.on('console-message',event=>{
    if(event.level==='error')console.error('[isolated-renderer]',event.message,event.sourceId,event.lineNumber);
  });
});
app.whenReady().then(async () => {
  const { startOnboarding } = require('../onboarding-runtime/output/onboarding-prototype/local-onboarding.cjs');
  const handle = await startOnboarding({
    analytics: false, diagnostics:true, readAccount: async () => null,
    requestHost: async () => ({ live:false }),
    onFinish: async () => { throw Error('Visibility check must not finish setup'); },
    onClose: ({ finished }) => { if(finished)throw Error('Visibility check cannot complete setup');closed++; },
  });
  if (!handle.window.isVisible()) throw Error('Owner is not visible');
  const capture = async name => {
    const image = await handle.window.webContents.capturePage();
    if (image.isEmpty()) throw Error('Empty owner capture');
    const pixels=image.toBitmap();
    let varied=false;
    for(let i=4;i<pixels.length;i+=64)
      if(pixels[i]!==pixels[0]||pixels[i+1]!==pixels[1]||pixels[i+2]!==pixels[2]){varied=true;break;}
    if(!varied)throw Error('Uniform blank owner capture: '+name);
    fs.writeFileSync(path.join(output, name+'.png'), image.toPNG());
  };
  await capture('opening');
  await delay(2700);await capture('expansion');
  await delay(1400);await capture('welcome');
  handle.close();
  if (closed !== 1) throw Error('Close was not exactly once');
  console.log(JSON.stringify({ result:'PASS', platform:process.platform, ownerVisible:true, closedOnce:true, screenshots:output, profile:app.getPath('userData') }));
  app.exit(0);
}).catch(error=>{console.error('Presentation check failed:',error.message);app.exit(1);});
