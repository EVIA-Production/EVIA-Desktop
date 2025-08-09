import { contextBridge, ipcRenderer } from 'electron'

type WsHandle = {
  sendBinary: (data: ArrayBuffer) => void
  sendCommand: (cmd: any) => void
  close: () => void
}

function createWs(url: string): WsHandle {
  const ws = new WebSocket(url)
  return {
    sendBinary: (data: ArrayBuffer) => { if (ws.readyState === WebSocket.OPEN) ws.send(data) },
    sendCommand: (cmd: any) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd)) },
    close: () => ws.close(),
  }
}

contextBridge.exposeInMainWorld('evia', {
  createWs,
  systemAudio: {
    start: () => ipcRenderer.invoke('system-audio:start'),
    stop: () => ipcRenderer.invoke('system-audio:stop'),
    onData: (cb: (jsonLine: string) => void) => ipcRenderer.on('system-audio:data', (_e, line) => cb(line)),
  },
})

export {}
