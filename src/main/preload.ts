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
  // Settings management
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: any) => ipcRenderer.invoke('settings:set', settings),
  },
  // Backend API calls
  api: {
    ask: (question: string, language: string) => ipcRenderer.invoke('api:ask', { question, language }),
    getSettings: () => ipcRenderer.invoke('api:getSettings'),
    updateSettings: (settings: any) => ipcRenderer.invoke('api:updateSettings', settings),
  },
  // WebSocket management
  websocket: {
    connect: (url: string) => ipcRenderer.invoke('websocket:connect', url),
    disconnect: () => ipcRenderer.invoke('websocket:disconnect'),
    send: (data: any) => ipcRenderer.invoke('websocket:send', data),
    onMessage: (cb: (data: any) => void) => ipcRenderer.on('websocket:message', (_e, data) => cb(data)),
    onError: (cb: (error: any) => void) => ipcRenderer.on('websocket:error', (_e, error) => cb(error)),
  },
})

export {}
