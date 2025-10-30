import { contextBridge, ipcRenderer } from 'electron'
import * as keytar from 'keytar';

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

  ws.onmessage = (ev: MessageEvent) => { if (onMessageCb) onMessageCb(ev.data as any) }
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
  getDesktopCapturerSources: (options: Electron.SourcesOptions) => ipcRenderer.invoke('desktop-capturer:getSources', options),
  systemAudio: {
    start: () => ipcRenderer.invoke('system-audio:start'),
    stop: () => ipcRenderer.invoke('system-audio:stop'),
    isRunning: () => ipcRenderer.invoke('system-audio:is-running'),
    // Glass parity: system-audio-data event sends {data: base64String}
    onData: (cb: (data: { data: string }) => void) => {
      const wrappedCb = (_e: any, data: { data: string }) => cb(data);
      ipcRenderer.on('system-audio-data', wrappedCb);
      return wrappedCb; // Return for cleanup
    },
    removeOnData: (wrappedCb: any) => 
      ipcRenderer.removeListener('system-audio-data', wrappedCb),
    // Legacy status handler (can be used for debugging)
    onStatus: (cb: (line: string) => void) => 
      ipcRenderer.on('system-audio:status', (_e, line) => cb(line)),
  },
  overlay: {
    setClickThrough: (enabled: boolean) => ipcRenderer.send('overlay:setClickThrough', enabled),
  },
  windows: {
    show: (name: 'listen' | 'ask' | 'settings' | 'shortcuts') => ipcRenderer.invoke('win:show', name),
    ensureShown: (name: 'listen' | 'ask' | 'settings' | 'shortcuts') => ipcRenderer.invoke('win:ensureShown', name),
    hide: (name: 'listen' | 'ask' | 'settings' | 'shortcuts') => ipcRenderer.invoke('win:hide', name),
    getHeaderPosition: () => ipcRenderer.invoke('win:getHeaderPosition'),
    moveHeaderTo: (x: number, y: number) => ipcRenderer.invoke('win:moveHeaderTo', x, y),
    resizeHeader: (w: number, h: number) => ipcRenderer.invoke('win:resizeHeader', w, h),
    adjustWindowHeight: (winName: 'listen' | 'ask' | 'settings' | 'shortcuts', height: number) => ipcRenderer.invoke('adjust-window-height', { winName, height }),
    adjustAskHeight: (height: number) => ipcRenderer.invoke('adjust-window-height', { winName: 'ask', height }),
    showSettingsWindow: (buttonX?: number) => ipcRenderer.send('show-settings-window', buttonX),
    hideSettingsWindow: () => ipcRenderer.send('hide-settings-window'),
    cancelHideSettingsWindow: () => ipcRenderer.send('cancel-hide-settings-window'),
    toggleAllVisibility: () => ipcRenderer.invoke('header:toggle-visibility'),
    nudgeHeader: (dx: number, dy: number) => ipcRenderer.invoke('header:nudge', { dx, dy }),
    openAskWindow: () => ipcRenderer.invoke('header:open-ask'),
    // 🔧 NEW: Invisibility toggle (click-through)
    setClickThrough: (enabled: boolean) => ipcRenderer.invoke('window:set-click-through', enabled),
    // 🔧 NEW: Open external URL in browser
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },
  capture: {
    takeScreenshot: () => ipcRenderer.invoke('capture:screenshot'),
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (prefs: Record<string, any>) => ipcRenderer.invoke('prefs:set', prefs),
  },
  closeWindow: (name: string) => ipcRenderer.invoke('close-window', name),
  auth: {
    login: (username: string, password: string) => ipcRenderer.invoke('auth:login', {username, password}),
    getToken: () => ipcRenderer.invoke('auth:getToken'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    checkTokenValidity: () => ipcRenderer.invoke('auth:checkTokenValidity'),  // 🔧 NEW: Check token expiry
    validate: () => ipcRenderer.invoke('auth:validate')  // 🔧 UI IMPROVEMENT: Proactive auth validation
  },
  // 🌐 Shell API: Open external URLs
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
  },
  // 🚪 App control
  app: {
    quit: () => ipcRenderer.invoke('app:quit')
  },
  // 🔐 Permissions API (Phase 3: Permission window)
  permissions: {
    check: () => ipcRenderer.invoke('permissions:check'),
    requestMicrophone: () => ipcRenderer.invoke('permissions:request-microphone'),
    openSystemPreferences: (pane: string) => ipcRenderer.invoke('permissions:open-system-preferences', pane),
    markComplete: () => ipcRenderer.invoke('permissions:mark-complete')
  },
  // 🔧 FIX: IPC bridge for cross-window communication (Header → Listen)
  ipc: {
    send: (channel: string, ...args: any[]) => {
      console.log('[Preload] IPC send:', channel, args);
      ipcRenderer.send(channel, ...args);
    },
    on: (channel: string, listener: (...args: any[]) => void) => {
      console.log('[Preload] IPC listener registered for:', channel);
      // Remove the 'event' parameter that Electron provides
      ipcRenderer.on(channel, (_event, ...args) => listener(...args));
    },
    // 🔥 CRITICAL FIX: Add invoke method for Settings/Shortcuts IPC
    invoke: (channel: string, ...args: any[]) => {
      console.log('[Preload] IPC invoke:', channel, args);
      return ipcRenderer.invoke(channel, ...args);
    }
  }
})

// Export/WAV helpers
contextBridge.exposeInMainWorld('eviaExport', {
  saveSystemWav: () => ipcRenderer.send('export:save-system-wav'),
  onSaveSystemWav: (cb: () => void) => ipcRenderer.on('export:save-system-wav', cb),
})

// Electron IPC (for dynamic window sizing, etc.)
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
    send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
    on: (channel: string, listener: (event: any, ...args: any[]) => void) => 
      ipcRenderer.on(channel, listener),
  },
})

contextBridge.exposeInMainWorld('platformInfo', {
  platform: process.platform,                 // 'darwin' | 'win32' | 'linux'
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux'
});

export {}
