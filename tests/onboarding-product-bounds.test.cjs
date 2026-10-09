const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const runtime=path.join(__dirname,'../onboarding-runtime/output/onboarding-prototype');
function windowsHost() {
  const applied=[],updated=[],created=[];
  const ipcMain=new EventEmitter();ipcMain.handle=()=>{};ipcMain.removeHandler=()=>{};
  class Window extends EventEmitter {
    constructor(options) {
      super();this.options=options;this.bounds={x:0,y:0,width:options.width,height:Math.max(64,options.height)};
      this.visible=false;this.destroyed=false;created.push(this);
      const wc=this.webContents=new EventEmitter();
      wc.send=()=>{};wc.session={};wc.setWindowOpenHandler=()=>{};
      wc.getZoomFactor=()=>this.zoom||1;wc.setZoomFactor=value=>{this.zoom=value;};
    }
    getNativeWindowHandle(){return Buffer.from([created.indexOf(this)]);}
    getBounds(){return {...this.bounds};}
    setBounds(bounds){this.bounds={...bounds,height:Math.max(64,bounds.height)};this.emit('resize');}
    isVisible(){return this.visible;} isDestroyed(){return this.destroyed;}
    showInactive(){this.visible=true;} hide(){this.visible=false;}
    setAlwaysOnTop(){} setVisibleOnAllWorkspaces(){} setHasShadow(){} setOpacity(){} setIgnoreMouseEvents(){} moveTop(){}
    loadURL(){} destroy(){this.destroyed=true;this.emit('closed');}
    static getFocusedWindow(){return null;}
  }
  const bridge={isSupported:()=>true,apply:(handle,config)=>{applied.push({name:created[handle[0]].options.title,config});return {applied:true};},
    update:(handle,config)=>{updated.push({name:created[handle[0]].options.title,config});return {applied:true};},detach(){}};
  const area={x:0,y:0,width:1440,height:900};
  const owner={webContents:{session:{},send(){}},getBounds:()=>area,isVisible:()=>true,isDestroyed:()=>false};
  const deps={electron:{app:Object.assign(new EventEmitter(),{getGPUFeatureStatus:()=>({gpu_compositing:'enabled'})}),BrowserWindow:Window,ipcMain,
    screen:{getDisplayMatching:()=>({workArea:area})},shell:{}},'node:path':path,'node:fs':{existsSync:()=>true},
    './native-glass-policy.cjs':require(path.join(runtime,'native-glass-policy.cjs'))};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(runtime,'native-windows.cjs'),'utf8'),{
    require:id=>id.includes('taylos_windows_glass.node')?bridge:deps[id],module,__dirname:runtime,
    process:{platform:'win32',arch:'x64',env:{}},Buffer,console:{log(){},warn(){}},setImmediate,setTimeout,clearTimeout,setInterval,clearInterval,
  });
  const product=module.exports({root:'/isolated',origin:'http://127.0.0.1',owner,onVisibility(){}});
  const send=(sender,data)=>ipcMain.emit('onboarding-message',{sender},data);
  return {product,applied,updated,created,owner,send};
}

test('Windows onboarding clips the initial glass to 49px even with a 64px client host',()=>{
  const h=windowsHost();
  try {
    const bar=h.created[0];
    assert.equal(bar.getBounds().height,64);
    assert.equal(bar.options.thickFrame,false);
    assert.equal(bar.options.roundedCorners,false);
    const config=h.applied.find(item=>item.name==='Taylos · bar').config;
    assert.equal(config.materialHeight,49);
    assert.equal(config.materialWidth,500);
    assert.equal(config.radius,24);
  } finally {h.product.destroy();}
});

test('deferred material updates retain the intended size after state and content resizing',async()=>{
  const h=windowsHost();
  try {
    const bar=h.created[0];
    h.send(h.owner.webContents,{type:'taylos-preview-state',view:'goal',flow:'focus',visible:true,reducedMotion:true,stage:{x:0,y:0,width:1440,height:800}});
    h.send(bar.webContents,{type:'taylos-ready'});
    h.send(bar.webContents,{type:'surface-size',width:560,height:49});
    assert.equal(h.updated.length,0,'never enter the native bridge from the resize event');
    await new Promise(setImmediate);
    const config=h.updated.filter(item=>item.name==='Taylos · bar').at(-1).config;
    assert.equal(bar.getBounds().height,64);
    assert.equal(config.materialHeight,49);
    assert.equal(config.materialWidth,560);
    assert.equal(config.radius,24);
  } finally {h.product.destroy();}
});

test('packaged onboarding pins and clips the bar content and dimming layer, not the coach',()=>{
  const html=fs.readFileSync(path.join(runtime,'native-build/index.html'),'utf8');
  const css=fs.readFileSync(path.join(runtime,'native-product-bounds.css'),'utf8');
  assert.match(html,/href="\.\.\/native-product-bounds\.css"/);
  assert.match(css,/html\[data-native-surface=bar\] \.product-surface/);
  assert.match(css,/height: 49px/);
  assert.match(css,/overflow: hidden/);
  assert.match(css,/border-radius: 999px/);
  assert.doesNotMatch(css,/coach/);
});
