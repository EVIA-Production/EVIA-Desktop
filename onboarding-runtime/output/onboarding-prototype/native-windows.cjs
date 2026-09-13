// Local harness: production components and the existing native material bridge,
// with fixture services. No authentication, capture or billing process is loaded.
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('node:path');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

module.exports = function createProductWindows({ root, origin, owner, onVisibility, readAccount = async()=>null, requestHost }) {
  const windows = new Map();
  const dimensions = { bar: [500,49], ask:[640,180], listen:[400,420], settings:[240,320], shortcuts:[380,520] };
  const surfaces = {bar:'overlay',ask:'content',listen:'content',settings:'popover',shortcuts:'utility'};
  const radii = {bar:24,ask:18,listen:18,settings:14,shortcuts:18};
  let bridge, nativeControls, state, offset = {x:0,y:0}, target = {x:0,y:0}, spring, dragAnchor;
  let settingsVisible = false, settingsPointerInside = false, shortcutsVisible = false, settingsTimer;
  let shortcutMap = {}, autoUpdate = true, destroyed=false, askClosed=false;
  let coachTarget=null, coachContent='', revealTimer, revealPending=false, revealProgress=1, geometryKey='', slideTimer, slideX=0, slideOpacity=1;
  let pendingBarSize=null;
  let coachSize={width:270,height:76};
  const ready = new Set();
  let inputDiagnosticTimer, pointerTimer;
  const pointerIgnored=new Map(), scaledWindows=new Set();
  const layoutBounds = new Map(), productBounds = new Map();
  try {
    const platformPath = process.platform === 'darwin'
      ? 'macos-liquid-glass/build/Release/taylos_liquid_glass.node'
      : `windows-liquid-glass/prebuilds/win32-${process.arch}/taylos_windows_glass.node`;
    bridge = require(process.env.TAYLOS_EMBEDDED_ONBOARDING === '1' && app.isPackaged
      ? process.platform === 'darwin' ? path.join(app.getAppPath(),'native',platformPath) : path.join(process.resourcesPath,'native',platformPath)
      : path.join(root,'EVIA-Desktop/native',platformPath));
    if (!bridge.isSupported()) bridge = null;
  } catch (error) { console.warn('Product material fallback:',error.message); }
  console.log('Product native glass:', Boolean(bridge));
  if(process.platform==='darwin')try {
    nativeControls=require(path.join(__dirname,'native-controls.node'));
    console.log('Native SF draw-on available:',nativeControls.drawOnAvailable);
  } catch(error) {console.warn('Native controls fallback:',error.message);}
  if(process.env.TAYLOS_INPUT_DIAGNOSTICS==='1') {
    let previous='';
    inputDiagnosticTimer=setInterval(()=>{
      const win=windows.get('listen');if(!win?.isVisible())return;
      const next=JSON.stringify({view:state?.view,visible:state?.visible,offset,
        windows:[...windows].filter(([name])=>['bar','ask','listen'].includes(name)).map(([name,w])=>({name,visible:w.isVisible(),actual:w.getBounds(),expected:layoutBounds.get(name),product:productBounds.get(name)})),
        hit:nativeControls?.inputGeometry?.(win.getNativeWindowHandle())});
      if(next!==previous){previous=next;console.log('Native hit',next);}
    },500);
  }
  function send(win, message) { if (win && !win.isDestroyed()) win.webContents.send('onboarding-message',message); }
  function activeNames() {
    if (!owner.isVisible() || !state?.visible || state.launching || ['welcome','permissions','personalize'].includes(state.view)) return [];
    const names = ['bar'];
    if (state.view !== 'ask' && !askClosed) names.push('ask');
    if (['transcript','insights','suggestion','review'].includes(state.view)) names.push('listen');
    if (settingsVisible) names.push('settings');
    if (shortcutsVisible) names.push('shortcuts');
    return names;
  }
  function updatePointerRegions() {
    if(destroyed)return;
    const pointer=screen.getCursorScreenPoint();
    for(const [name,win] of windows) {
      if(name==='coach'||win.isDestroyed()||!win.isVisible())continue;
      if(!scaledWindows.has(name)){
        if(pointerIgnored.get(name)){win.setIgnoreMouseEvents(false);pointerIgnored.set(name,false);}
        continue;
      }
      const rect=productBounds.get(name);if(!rect)continue;
      const scale=name==='bar'&&state?.view==='ask' ? .5+.5*(1-Math.pow(1-revealProgress,3)) : 1;
      const halfW=rect.width*scale/2,halfH=rect.height*scale/2;
      const dx=Math.abs(pointer.x-(rect.x+rect.width/2)),dy=Math.abs(pointer.y-(rect.y+rect.height/2));
      const radius=Math.min(radii[name]*scale,halfW,halfH);
      const inside=dx<=halfW&&dy<=halfH&&Math.hypot(Math.max(0,dx-halfW+radius),Math.max(0,dy-halfH+radius))<=radius;
      // The transparent shadow margin must not cover the adjacent product or
      // instruction buttons. Pointer capture remains intact during group drag.
      const ignore=!inside&&dragAnchor?.name!==name;
      if(pointerIgnored.get(name)!==ignore){pointerIgnored.set(name,ignore);win.setIgnoreMouseEvents(ignore,{forward:true});}
    }
  }
  function layout() {
    if (destroyed || !state?.stage || owner.isDestroyed()) return;
    const area = owner.getBounds(), stage = state.stage;
    const active = activeNames();
    if(revealPending && active.includes('bar') && ready.has('bar')) {
      revealPending=false;
      if(!state.reducedMotion) {
        revealProgress=0;
        const start=Date.now();
        send(owner,{type:'bar-introduction',active:true});
        // The renderer runs the same curve from the same wall clock, so its
        // scale never trails the native pill by an IPC round trip.
        const barWin=windows.get('bar'); if(barWin&&!barWin.isDestroyed())send(barWin,{type:'bar-reveal',startedAt:start,duration:1100});
        revealTimer=setInterval(()=>{
          if(destroyed){clearInterval(revealTimer);return;}
          revealProgress=Math.min(1,(Date.now()-start)/1100);
          if(revealProgress===1){
            clearInterval(revealTimer);
            if(pendingBarSize){const d=pendingBarSize;pendingBarSize=null;
              dimensions.bar[0]=clamp(Math.ceil(d.width),300,900);dimensions.bar[1]=clamp(Math.ceil(d.height||49),32,80);}
            // Never rely on the dedupe to deliver the closing frame.
            geometryKey='';
            send(owner,{type:'bar-introduction',active:false});
            const barWin=windows.get('bar'); if(barWin&&!barWin.isDestroyed())send(barWin,{type:'bar-reveal',startedAt:0});
          }
          layout();
        },16);
      }
    }
    // Requested compact call panels; Ask keeps production width and content sizing.
    dimensions.listen[1]=320;
    if(state.view==='goal')dimensions.ask[1]=254;
    dimensions.ask[0]=640;
    const paired = active.includes('listen') && active.includes('ask');
    const width = paired ? dimensions.ask[0] + dimensions.listen[0] + 8 : active.includes('ask') ? dimensions.ask[0] : active.includes('listen') ? Math.max(dimensions.listen[0],dimensions.bar[0]) : dimensions.bar[0];
    const panelHeight = paired ? Math.max(dimensions.ask[1],dimensions.listen[1]) : active.includes('ask') ? dimensions.ask[1] : active.includes('listen') ? dimensions.listen[1] : 0;
    const height = dimensions.bar[1] + (panelHeight ? panelHeight + 8 : 0);
    const cx = area.x + stage.x + stage.width/2;
    // Center the union of the visible bar and call panels in the blue field.
    const baseY = area.y + stage.y + (stage.height-height)/2;
    const safe = screen.getDisplayMatching(area).workArea;
    const x = clamp(cx-width/2+offset.x,safe.x+12,safe.x+safe.width-width-12)+slideX;
    const y = clamp(baseY+offset.y,safe.y+16,safe.y+safe.height-height-20);
    const scale=state.view==='ask' ? .5+.5*(1-Math.pow(1-revealProgress,3)) : 1;
    // AppKit composites the complete bar inside a fixed-size window. Resizing
    // its host during the reveal makes NSGlassEffectView relayout its content.
    const windowScale=scale;
    const barWidth=Math.round(dimensions.bar[0]*windowScale),barHeight=Math.round(dimensions.bar[1]*windowScale);
    const rects = {
      bar:[Math.round(x+width/2-barWidth/2),Math.round(y+(dimensions.bar[1]-barHeight)/2),barWidth,barHeight],
      ask:[Math.round(x+(paired ? dimensions.listen[0]+8 : 0)),Math.round(y+dimensions.bar[1]+8),...dimensions.ask],
      listen:[Math.round(x),Math.round(y+dimensions.bar[1]+8),...dimensions.listen],
      settings:[Math.round(clamp(x+width/2+dimensions.bar[0]/2-70,safe.x+12,safe.x+safe.width-252)),Math.round(y+57),...dimensions.settings],
      shortcuts:[Math.round(cx-190+offset.x+slideX),Math.round(area.y+stage.y+15+offset.y),...dimensions.shortcuts],
    };
    for (const [name,win] of windows) {
      if (name === 'coach') continue;
      const [rx,ry,rw,rh] = rects[name];
      const productRect = {x:rx,y:ry,width:Math.round(rw),height:Math.round(rh)};
      productBounds.set(name, productRect);
      const scaling=false;
      const padding=scaling?40:0;
      if(scaling)scaledWindows.add(name);
      else if(scaledWindows.delete(name)) {
        nativeControls?.restoreProduct?.(win.getNativeWindowHandle(),{width:dimensions[name][0],height:dimensions[name][1]});
      }
      const bounds = {x:rx-padding,y:ry-padding,width:Math.round(rw)+2*padding,height:Math.round(rh)+2*padding};
      if(name==='bar' && Math.abs((win.webContents.getZoomFactor?.()||1)-scale)>.001)win.webContents.setZoomFactor(scale);
      layoutBounds.set(name,bounds);
      const old = win.getBounds();
      if (Object.keys(bounds).some(k=>bounds[k] !== old[k])) {win.setBounds(bounds);nativeControls?.refreshProductAppearance?.(win.getNativeWindowHandle());}
      if(scaling)nativeControls.layoutProduct(win.getNativeWindowHandle(),{
        width:dimensions[name][0],height:dimensions[name][1],radius:radii[name],scale:name==='bar'?scale:1,padding});

      if (active.includes(name) && ready.has(name)) {
        win.setOpacity(slideOpacity*(name==='bar'?(.3+.7*(1-Math.pow(1-revealProgress,3))):1));
        if (!win.isVisible()) {
          win.showInactive();
          // AppKit may reposition a hidden child while ordering it onto a
          // smaller display. Commit the group geometry after that operation.
          const shown=win.getBounds();
          if(Object.keys(bounds).some(k=>shown[k]!==bounds[k]))win.setBounds(bounds,false);
          nativeControls?.refreshProductAppearance?.(win.getNativeWindowHandle());
          const focused=BrowserWindow.getFocusedWindow();
          if(focused===owner || [...windows.values()].includes(focused))win.moveTop();
        }
      } else win.hide();
    }
    const shadowRects=active.filter(name=>ready.has(name)).map(name=>{
      const [x,y,width,height]=rects[name];return {x:x-area.x,y:y-area.y,width,height,radius:radii[name]};
    });
    const emphasis=active.includes('bar') && state.view==='ask' && !state.reducedMotion ? 1-Math.pow(revealProgress,4) : 0;
    const nextGeometry=JSON.stringify({rects:shadowRects,emphasis});
    if(nextGeometry!==geometryKey){geometryKey=nextGeometry;send(owner,{type:'product-geometry',rects:shadowRects,emphasis});}
    positionCoach();
    if(nativeControls?.layoutProduct) {
      updatePointerRegions();
      if(active.length&&scaledWindows.size){if(!pointerTimer)pointerTimer=setInterval(updatePointerRegions,16);}
      else {clearInterval(pointerTimer);pointerTimer=null;}
    }
    // Tray visibility follows the user's hide/show choice, not app activation.
    onVisibility(Boolean(state.visible && !['welcome','permissions','personalize'].includes(state.view)));
  }
  function animateSlide(phase,direction=1) {
    clearInterval(slideTimer);
    if(state?.reducedMotion){slideX=0;slideOpacity=1;layout();return;}
    const duration=phase==='out'?250:420, start=Date.now();
    const distance=96;
    const frame=()=>{
      const p=Math.min(1,(Date.now()-start)/duration);
      const ease=phase==='out'?p*p*p:1-Math.pow(1-p,3);
      slideX=phase==='out'?-direction*distance*ease:direction*distance*(1-ease);
      slideOpacity=phase==='out'?1-ease:ease;
      if(p===1)clearInterval(slideTimer);
      layout();
    };
    slideTimer=setInterval(frame,16);frame();
  }
  function positionCoach() {
    const coach=windows.get('coach');
    if(state?.view==='ask' && revealProgress<.85){coach?.hide();return;}
    if(!coach || !coachTarget || !activeNames().includes(coachTarget.name) || !ready.has('coach')){coach?.hide();return;}
    const {name,data}=coachTarget, b=productBounds.get(name)||windows.get(name).getBounds();
    let r=data.rect;
    // Renderer content and its native resize arrive independently. Keep the
    // answer tip attached through that handoff instead of hiding for one frame.
    if(name==='ask' && ['prepare','suggestion'].includes(state?.view) && r.y>=0 && r.y<b.height)
      r={...r,width:Math.min(r.width,b.width-r.x),height:Math.min(r.height,b.height-r.y)};
    // Do not point at a scrolled-out control or cover another product surface.
    if(r.y<0 || r.y+r.height>b.height || r.x<0 || r.x+r.width>b.width){coach.hide();return;}
    const work=screen.getDisplayMatching(b).workArea, {width,height}=coachSize;
    const old=coach.getBounds();
    if(old.x!==work.x||old.y!==work.y||old.width!==work.width||old.height!==work.height)
      coach.setBounds({x:work.x,y:work.y,width:work.width,height:work.height});
    const center=clamp(b.x+r.x+r.width/2-width/2,work.x+8,work.x+work.width-width-8);
    const above=(left)=>({left,top:b.y-height-12,side:'above'});
    const below=(left)=>({left,top:b.y+b.height+12,side:'below'});
    // Shift a bubble above the host when necessary so it clears the central bar.
    // It remains attached to its real target and never covers product controls.
    const sideTop=clamp(b.y+r.y+r.height/2-height/2,work.y+8,work.y+work.height-height-8);
    const vertical=[above(center),above(b.x),above(b.x+b.width-width)];
    const sides=[
      {left:b.x-width-12,top:sideTop,side:'left'},
      {left:b.x+b.width+12,top:sideTop,side:'right'},
      ];
    const candidates=name==='bar'?[...vertical,...sides,below(center)]:[...sides,...vertical,below(center)];
    const fits=c=>c.left>=work.x+8 && c.left+width<=work.x+work.width-8 && c.top>=work.y+8 && c.top+height<=work.y+work.height-8;
    const avoids=c=>activeNames().every(key=>{const o=productBounds.get(key)||windows.get(key).getBounds();return !(c.left<o.x+o.width && c.left+width>o.x && c.top<o.y+o.height && c.top+height>o.y);});
    const chosen=candidates.find(c=>fits(c)&&avoids(c));
    if(!chosen){coach.hide();return;}
    const {left,top,side}=chosen;
    // window-local coordinates: the bubble is translated inside the overlay
    const content={type:'coach',title:data.title,body:data.body,side,
      x:Math.round(left-work.x),y:Math.round(top-work.y),width,
      arrow:side==='left'||side==='right'?clamp(b.y+r.y+r.height/2-top,18,height-18):clamp(b.x+r.x+r.width/2-left,28,width-28)};
    const key=JSON.stringify(content);
    if(key!==coachContent){coachContent=key;send(coach,content);}
    if(!coach.isVisible())coach.showInactive();
    if(nativeControls)nativeControls.raiseCoach();
    else {
      const focused=BrowserWindow.getFocusedWindow();
      if(focused===owner || [...windows.values()].includes(focused))coach.moveTop();
    }
  }
  function maintainCoachOrder(_event,focused) {
    if(destroyed || (focused!==owner && ![...windows.values()].includes(focused)))return;
    // Re-activating the full-display shell must not put it in front of its products.
    // Raise within this app without changing the user's typing focus.
    if(focused===owner)for(const name of activeNames()) {
      const product=windows.get(name);if(product?.isVisible())product.moveTop();
    }
    positionCoach();
    const coach=windows.get('coach');
    if(coach?.isVisible()) {
      if(nativeControls)nativeControls.raiseCoach();else coach.moveTop();
    }
  }
  // Child windows follow the onboarding's Space and stacking order naturally.
  // App/monitor focus changes never hide them or turn them into global overlays.
  app.on('browser-window-focus',maintainCoachOrder);
  function move(dx,dy,elastic=false) {
    if (!state?.stage) return;
    const maxX = Math.max(20,state.stage.width/2-220), maxY = Math.max(30,state.stage.height/2);
    const rubber = (n,limit) => Math.abs(n)<=limit ? n : Math.sign(n)*(limit+Math.sqrt(Math.abs(n)-limit)*2);
    target = {x:elastic ? rubber(dx,maxX) : clamp(dx,-maxX,maxX), y:elastic ? rubber(dy,maxY) : clamp(dy,-maxY,maxY)};
    if(state.reducedMotion){offset={...target};layout();return;}
    if (spring) return;
    spring = setInterval(()=>{
      offset.x += (target.x-offset.x)*.28; offset.y += (target.y-offset.y)*.28;
      layout();
      if (Math.abs(offset.x-target.x)+Math.abs(offset.y-target.y)<.4) {offset={...target};clearInterval(spring);spring=null;layout();}
    },16);
  }
  function forward(message) { send(owner,message); }
  function message(event, data) {
    const name = [...windows].find(([,w])=>w.webContents===event.sender)?.[0];
    if (event.sender !== owner.webContents && !name) return;
    if (!data || typeof data.type !== 'string') return;
    if(data.type==='input-diagnostics') {
      if(process.env.TAYLOS_INPUT_DIAGNOSTICS==='1')console.log('Input geometry',name,JSON.stringify(data));
      return;
    }
    if(data.type==='coach-size' && name==='coach'){
      const width=clamp(Math.ceil(data.width)||270,180,340),height=clamp(Math.ceil(data.height)||76,40,180);
      if(width!==coachSize.width||height!==coachSize.height){coachSize={width,height};positionCoach();}return;
    }
    if(data.type==='product-transition' && event.sender===owner.webContents){animateSlide('out',data.direction);return;}
    if(data.type==='coach-front'){maintainCoachOrder(null,windows.get(name)||owner);return;}
    if (data.type === 'taylos-preview-state' && event.sender === owner.webContents) {
      const changed = state?.view !== data.view;
      const previous=state;
      state = data;
      if(changed) {clearInterval(revealTimer);clearInterval(slideTimer);slideX=0;slideOpacity=1;revealProgress=1;revealPending=data.view==='ask';send(owner,{type:'bar-introduction',active:false});}
      if (changed) {coachTarget=null;coachContent='';windows.get('coach')?.hide();clearTimeout(settingsTimer);settingsPointerInside=false;settingsVisible=false;shortcutsVisible=false;askClosed=false;offset={x:0,y:0};target={...offset};dragAnchor=null;
        if(!['ask','prepare','transcript','insights','suggestion','review'].includes(state.view))coachTarget=null;
      }
      // Geometry-only updates must not rerender product content or restart tips.
      const contentKey=({stage,stageArea,...rest})=>JSON.stringify(rest);
      if(!previous || contentKey(previous)!==contentKey(data))for (const [key,win] of windows) if (key!=='coach') send(win,data);
      if(changed && previous)animateSlide('in',data.direction||1);
      else layout(); return;
    }
    if (data.type === 'taylos-ready' && name) {ready.add(name);if(state)send(windows.get(name),state);layout();return;}
    if (data.type === 'taylos-history' || data.type === 'taylos-post-action') {send(windows.get('ask'),data);return;}
    if(data.type==='toggle-ask' && event.sender===owner.webContents){askClosed=!askClosed;layout();return;}
    if (data.type === 'taylos-key') {forward(data);return;}
    if (data.type === 'taylos-move') {
      move(target.x+(data.code==='ArrowRight'?40:data.code==='ArrowLeft'?-40:0),target.y+(data.code==='ArrowDown'?40:data.code==='ArrowUp'?-40:0));return;
    }
    if (data.type === 'surface-size' && name && dimensions[name]) {
      if(name==='bar') {
        // The bar window must not resize while it is being scaled in, but the
        // report is the bar's only one — dropping it left the window at its
        // default width with the content clipped. Hold it, apply it after.
        if(revealProgress<1){pendingBarSize=data;return;}
        pendingBarSize=null;
        dimensions.bar[0]=clamp(Math.ceil(data.width),300,900);dimensions.bar[1]=clamp(Math.ceil(data.height||49),32,80);
      }
      else if(name==='ask') dimensions.ask[1]=state?.view==='goal'?254:clamp(Math.ceil(data.height),58,Math.max(420,screen.getDisplayMatching(owner.getBounds()).workArea.height-160));
      else if(name==='listen') dimensions.listen[1]=320;
      else if(name==='settings') dimensions.settings[1]=clamp(Math.ceil(data.height),240,360);
      layout();return;
    }
    if (data.type==='drag-start' && name) {dragAnchor={name,x:data.x,y:data.y,offset:{...offset}};return;}
    if (data.type==='drag-move' && dragAnchor) {move(dragAnchor.offset.x+data.x-dragAnchor.x,dragAnchor.offset.y+data.y-dragAnchor.y,true);return;}
    if (data.type==='drag-end') {dragAnchor=null;move(target.x,target.y);return;}
    if (data.type==='coach-target' && name) {
      if(data.view!==state?.view)return;
      if(data.hidden && name==='ask' && ['prepare','suggestion'].includes(data.view) && coachTarget?.name==='ask'){positionCoach();return;}
      coachTarget=data.hidden?null:{name,data};positionCoach();return;
    }
    if(data.type==='settings-open') {clearTimeout(settingsTimer);settingsVisible=true;layout();return;}
    if(data.type==='settings-close') {
      // The bar's delayed mouseleave can arrive AFTER the pointer entered the menu.
      // That stale close must never dismiss a menu the user is currently using.
      if(name==='settings')settingsPointerInside=false;
      clearTimeout(settingsTimer);
      if(settingsPointerInside)return;
      settingsTimer=setTimeout(()=>{if(!settingsPointerInside){settingsVisible=false;layout();}},250);return;
    }
    if(data.type==='settings-keep' && name==='settings') {settingsPointerInside=true;clearTimeout(settingsTimer);return;}
    if(data.type==='show-shortcuts') {shortcutsVisible=true;settingsVisible=false;layout();windows.get('shortcuts').focus();return;}
    if(data.type==='close-surface') {if(name==='shortcuts')shortcutsVisible=false;else if(name==='ask')askClosed=true;else settingsVisible=false;layout();return;}
    if(data.type==='language' && ['en','de'].includes(data.language)) {forward(data);return;}
    if(data.type==='navigate' && /^https:\/\/app\.taylos\.ai\//.test(data.url)) {shell.openExternal(data.url);return;}
    if(data.type==='taylos-action') {
      if(data.action==='ask' && state?.view!=='ask' && state?.view!=='welcome') {askClosed=!askClosed;layout();return;}
      forward(data);
    }
  }
  ipcMain.on('onboarding-message',message);
  ipcMain.handle('onboarding-request',async(event,channel,payload)=>{
    if(event.sender===owner.webContents && ['onboarding:permissions','onboarding:request-microphone','onboarding:request-screen','onboarding:initial-state'].includes(channel)) {
      return requestHost ? requestHost(channel) : {live:false};
    }
    if(event.sender===owner.webContents && channel==='website-symbol') {
      if(!nativeControls)return {ok:false};
      return {ok:nativeControls.updateSymbol(owner.getNativeWindowHandle(),payload)};
    }
    if(![...windows.values()].some(w=>w.webContents===event.sender))return {ok:false};
    if(channel==='auth:identity'){const account=await readAccount();return account ? {authenticated:true,user:account} : {authenticated:false};}
    if(channel==='shortcuts:get')return {ok:true,shortcuts:shortcutMap};
    if(channel==='shortcuts:set') {shortcutMap={...payload};for(const w of windows.values())send(w,{type:'shortcuts',shortcuts:shortcutMap});send(owner,{type:'shortcuts',shortcuts:shortcutMap});return {ok:true};}
    if(channel==='settings:get-auto-update')return {enabled:autoUpdate};
    if(channel==='settings:set-auto-update'){autoUpdate=!!payload;return {enabled:autoUpdate};}
    if(channel==='content-protection') {for(const w of windows.values())w.setContentProtection(!!payload);return {success:true};}
    return {ok:false,success:false};
  });
  for(const name of [...Object.keys(dimensions),'coach']) {
    const [width,height]=dimensions[name] || [270,100];
    const win = new BrowserWindow({parent:owner,width,height,show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:name!=='coach',resizable:false,skipTaskbar:true,focusable:name!=='coach',acceptFirstMouse:true,visualEffectState:'active',
      title:'Taylos · '+name,webPreferences:{additionalArguments:process.env.TAYLOS_INPUT_DIAGNOSTICS==='1'?['--taylos-input-diagnostics']:[],session:name==='bar'?undefined:owner.webContents.session,partition:name==='bar'?'taylos-review-bar':undefined,preload:path.join(__dirname,'local-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    windows.set(name,win);
    if(name!=='coach')win.on('move',()=>{
      const expected=layoutBounds.get(name);
      if(destroyed||!expected||!win.isVisible()||!activeNames().includes(name))return;
      const actual=win.getBounds(),dx=actual.x-expected.x,dy=actual.y-expected.y;
      if(!dx&&!dy)return;
      // Native region dragging may bypass DOM pointer events. Rejoin the group.
      clearInterval(spring);spring=null;
      offset={x:offset.x+dx,y:offset.y+dy};target={...offset};layout();
    });
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);
    if(name==='coach'){win.setIgnoreMouseEvents(true);nativeControls?.attachCoach(win.getNativeWindowHandle());}
    if(name!=='coach'){win.setHasShadow(true);for(const event of ['focus','blur','resize'])win.on(event,()=>{if(!win.isDestroyed())nativeControls?.refreshProductAppearance?.(win.getNativeWindowHandle());});}
    if(process.platform==='darwin')win.setWindowButtonVisibility(false);
    if(bridge && name!=='coach') {
      const config={surface:surfaces[name],radius:radii[name],active:true,interactive:false};
      const result=bridge.apply(win.getNativeWindowHandle(),config);
      console.log(name,'native material',JSON.stringify(result));
      win.on('resize',()=>{if(!win.isDestroyed()&&!scaledWindows.has(name))bridge.update(win.getNativeWindowHandle(),{...config,radius:radii[name]*(name==='bar'?(win.webContents.getZoomFactor?.()||1):1)});});
    } else if(name!=='coach'&&process.platform==='darwin')win.setVibrancy('under-window');
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith(origin+'/'))e.preventDefault();});
    win.loadURL(origin+'/output/onboarding-prototype/native-build/index.html?surface='+name+'&material='+(bridge?'native':'custom')+'&platform='+(process.env.TAYLOS_PREVIEW_PLATFORM||(process.platform==='darwin'?'mac':'win')));
  }
  return {windows, bridge, setShortcuts(map){shortcutMap=map;}, destroy(){if(destroyed)return;destroyed=true;clearInterval(inputDiagnosticTimer);clearInterval(pointerTimer);nativeControls?.dispose();clearInterval(spring);clearInterval(slideTimer);clearInterval(revealTimer);clearTimeout(settingsTimer);app.removeListener('browser-window-focus',maintainCoachOrder);ipcMain.removeListener('onboarding-message',message);ipcMain.removeHandler('onboarding-request');const coach=windows.get('coach');if(coach&&!coach.isDestroyed())coach.destroy();for(const w of windows.values())if(!w.isDestroyed())w.destroy();}};
};
