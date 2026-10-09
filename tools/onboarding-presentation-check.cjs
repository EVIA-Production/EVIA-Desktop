// Isolated Electron visibility check: no real account, capture, permissions,
// checkout, model calls, analytics, or production profile writes.
const { app, BrowserWindow } = require('electron');
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
  // Exercise the product windows too: first-paint alone did not cover the
  // surplus Windows client backing visible below the 49px tutorial bar.
  const goal={choice:'Prepare a practice call',opener:'What would make this call useful?',suggestion:'Confirm the next step.',action:'Suggest a next step',insight:'Practice context only',customer:'A practice customer',seller:'A practice seller',worked:'A clear opening',next:'Confirm the next call'};
  const ownerBounds=handle.window.getBounds();
  const surfaceWindow=name=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('?surface='+name+'&'));
  for(const view of ['goal','prepare','suggestion']) {
    const state={type:'taylos-preview-state',view,flow:'focus',visible:true,reducedMotion:true,platform:process.platform==='darwin'?'mac':'win',language:'en',goal,goals:{meeting:goal},goalId:'meeting',history:1,
      stage:{x:20,y:20,width:ownerBounds.width-40,height:ownerBounds.height-40}};
    await handle.window.webContents.executeJavaScript(`window.taylosLocal.send(${JSON.stringify(state)})`);
    const bar=surfaceWindow('bar');
    if(!bar)throw Error('Missing product bar host');
    const deadline=Date.now()+8000;
    let metrics;
    while(Date.now()<deadline) {
      metrics=await bar.webContents.executeJavaScript(`(()=>{const surface=document.querySelector('.product-surface'),header=document.querySelector('.evia-main-header');return surface&&header?{view:document.documentElement.dataset.view,height:surface.getBoundingClientRect().height,headerHeight:header.getBoundingClientRect().height,clip:getComputedStyle(surface).overflow}:null})()`);
      if(bar.isVisible()&&metrics?.view===view)break;
      await delay(50);
    }
    if(!bar.isVisible()||metrics?.view!==view||Math.abs(metrics.height-49)>1||metrics.clip!=='hidden')throw Error('Unbounded product bar: '+JSON.stringify(metrics));
    await delay(1100);
    for(const name of ['bar','ask']) {
      const win=surfaceWindow(name);
      if(!win?.isVisible())throw Error('Missing '+name+' in '+view);
      const image=await win.webContents.capturePage();
      if(image.isEmpty())throw Error('Empty '+name+' in '+view);
      if(name==='bar') {
        const viewportHeight=await win.webContents.executeJavaScript('window.innerHeight');
        const size=image.getSize(),pixels=image.toBitmap();
        const firstOutsideRow=Math.ceil(49*size.height/viewportHeight);
        for(let y=firstOutsideRow;y<size.height;y++)for(let x=0;x<size.width;x++)
          if(pixels[(y*size.width+x)*4+3]!==0)throw Error('Paint below product bar in '+view);
      }
      fs.writeFileSync(path.join(output,view+'-'+name+'.png'),image.toPNG());
    }
    console.log(JSON.stringify({view,bar:metrics,host:bar.getBounds()}));
  }
  handle.close();
  if (closed !== 1) throw Error('Close was not exactly once');
  console.log(JSON.stringify({ result:'PASS', platform:process.platform, ownerVisible:true, closedOnce:true, screenshots:output, profile:app.getPath('userData') }));
  app.exit(0);
}).catch(error=>{console.error('Presentation check failed:',error.message);app.exit(1);});
