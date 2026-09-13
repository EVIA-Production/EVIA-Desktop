const { contextBridge, ipcRenderer } = require('electron');
if(process.argv.includes('--taylos-input-diagnostics')) {
  for(const type of ['pointerdown','click'])document.addEventListener(type,event=>{
    const rect=event.target?.getBoundingClientRect?.();
    ipcRenderer.send('onboarding-message',{type:'input-diagnostics',event:type,
      x:event.clientX,y:event.clientY,screenX:event.screenX,screenY:event.screenY,
      tag:event.target?.tagName,classes:String(event.target?.className||''),
      target:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,
      viewport:{width:innerWidth,height:innerHeight}});
  },true);
}
contextBridge.exposeInMainWorld('taylosLocal', {
  onAction(callback) {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('onboarding-action', listener);
    return () => ipcRenderer.removeListener('onboarding-action', listener);
  },
  // true while the pointer is over the card or its light field; false lets the
  // click reach the desktop behind the transparent window.
  setPointerInside(inside) { ipcRenderer.send('onboarding-pointer', !!inside); },
  send(message) { ipcRenderer.send('onboarding-message', message); },
  onMessage(callback) {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('onboarding-message', listener);
    return () => ipcRenderer.removeListener('onboarding-message', listener);
  },
  request(channel, payload) { return ipcRenderer.invoke('onboarding-request', channel, payload); },
  close() { ipcRenderer.send('onboarding-close'); },
  native: true,
});
