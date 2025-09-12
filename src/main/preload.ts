import { contextBridge, ipcRenderer } from 'electron'

type WsHandle = {
  sendBinary: (data: ArrayBuffer) => void
  sendCommand: (cmd: any) => void
  close: () => void
  onMessage: (cb: (data: string | ArrayBuffer | Blob) => void) => void
  onOpen: (cb: () => void) => void
  onClose: (cb: (event: CloseEvent) => void) => void
  onError: (cb: (event: Event) => void) => void
}

function createWs(url: string): WsHandle {
  const ws = new WebSocket(url)

  let onMessageCb: ((data: string | ArrayBuffer | Blob) => void) | null = null
  let onOpenCb: (() => void) | null = null
  let onCloseCb: ((event: CloseEvent) => void) | null = null
  let onErrorCb: ((event: Event) => void) | null = null

  ws.onmessage = (ev: MessageEvent) => {
    if (onMessageCb) onMessageCb(ev.data as any)
  }
  ws.onopen = () => { if (onOpenCb) onOpenCb() }
  ws.onclose = (ev: CloseEvent) => { if (onCloseCb) onCloseCb(ev) }
  ws.onerror = (ev: Event) => { if (onErrorCb) onErrorCb(ev) }

  return {
    sendBinary: (data: ArrayBuffer) => { if (ws.readyState === WebSocket.OPEN) ws.send(data) },
    sendCommand: (cmd: any) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd)) },
    close: () => ws.close(),
    onMessage: (cb) => { onMessageCb = cb },
    onOpen: (cb) => { onOpenCb = cb },
    onClose: (cb) => { onCloseCb = cb },
    onError: (cb) => { onErrorCb = cb },
  }
}

contextBridge.exposeInMainWorld('evia', {
  createWs,
  systemAudio: {
    start: () => ipcRenderer.invoke('system-audio:start'),
    stop: () => ipcRenderer.invoke('system-audio:stop'),
    onData: (cb: (jsonLine: string) => void) => ipcRenderer.on('system-audio:data', (_e, line) => cb(line)),
  },
  overlay: {
    setClickThrough: (enabled: boolean) => ipcRenderer.send('overlay:setClickThrough', enabled),
  },
  windows: {
    show: (name: 'listen' | 'ask' | 'settings' | 'shortcuts') => ipcRenderer.invoke('win:show', name),
    hide: (name: 'listen' | 'ask' | 'settings' | 'shortcuts') => ipcRenderer.invoke('win:hide', name),
    getHeaderPosition: () => ipcRenderer.invoke('win:getHeaderPosition'),
    moveHeaderTo: (x: number, y: number) => ipcRenderer.invoke('win:moveHeaderTo', x, y),
    resizeHeader: (w: number, h: number) => ipcRenderer.invoke('win:resizeHeader', w, h),
    cancelHideSettingsWindow: () => ipcRenderer.send('cancel-hide-settings-window'),
  },
})

export {}
