const { contextBridge, ipcRenderer, shell } = require('electron')

function createWs(url) {
  const ws = new WebSocket(url)

  // Simple handler registries
  const messageHandlers = []
  const openHandlers = []
  const closeHandlers = []
  const errorHandlers = []

  // Bridge native WebSocket events to registered handlers
  ws.onmessage = (event) => {
    const payload = event.data
    try { messageHandlers.forEach((h) => h(payload)) } catch {}
  }
  ws.onopen = () => {
    try { openHandlers.forEach((h) => h()) } catch {}
  }
  ws.onclose = (event) => {
    try { closeHandlers.forEach((h) => h(event)) } catch {}
  }
  ws.onerror = (event) => {
    try { errorHandlers.forEach((h) => h(event)) } catch {}
  }

  return {
    sendBinary: (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data) },
    sendCommand: (cmd) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd)) },
    close: () => ws.close(),
    onMessage: (cb) => { if (typeof cb === 'function') messageHandlers.push(cb) },
    onOpen: (cb) => { if (typeof cb === 'function') openHandlers.push(cb) },
    onClose: (cb) => { if (typeof cb === 'function') closeHandlers.push(cb) },
    onError: (cb) => { if (typeof cb === 'function') errorHandlers.push(cb) },
  }
}

try {
  console.log('[preload.cjs] loaded, exposing window.evia')
  contextBridge.exposeInMainWorld('evia', {
    createWs,
    systemAudio: {
      start: () => ipcRenderer.invoke('system-audio:start'),
      stop: () => ipcRenderer.invoke('system-audio:stop'),
      onData: (cb) => ipcRenderer.on('system-audio:data', (_e, line) => cb(line)),
      onStatus: (cb) => ipcRenderer.on('system-audio:status', (_e, line) => cb(line)),
    },
    overlay: {
      setClickThrough: (enabled) => ipcRenderer.send('overlay:setClickThrough', !!enabled),
    },
    windows: {
      show: (name) => ipcRenderer.invoke('win:show', name),
      hide: (name) => ipcRenderer.invoke('win:hide', name),
      // EVIA handlers
      getHeaderPosition: () => ipcRenderer.invoke('win:getHeaderPosition'),
      moveHeaderTo: (x, y) => ipcRenderer.invoke('win:moveHeaderTo', x, y),
      resizeHeader: (w, h) => ipcRenderer.invoke('win:resizeHeader', w, h),
      // Glass-compatible aliases
      getHeaderPositionCompat: () => ipcRenderer.invoke('get-header-position'),
      moveHeaderToCompat: (x, y) => ipcRenderer.invoke('move-header-to', x, y),
      adjustWindowHeight: (winName, height) => ipcRenderer.invoke('adjust-window-height', { winName, height }),
      showSettingsWindow: () => ipcRenderer.send('show-settings-window'),
      hideSettingsWindow: () => ipcRenderer.send('hide-settings-window'),
      cancelHideSettingsWindow: () => ipcRenderer.send('cancel-hide-settings-window'),
      headerAnimationFinished: (state) => ipcRenderer.send('header-animation-finished', state),
    },
    prefs: {
      get: () => ipcRenderer.invoke('prefs:get'),
      set: (prefs) => ipcRenderer.invoke('prefs:set', prefs),
    },
    openSystemPreferences: (section) => {
      if (section === 'screen') {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
      } else if (section === 'mic') {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
      }
    },
    openTerminal: (script) => {
      return ipcRenderer.invoke('open-terminal', script)
    },
    launchMain: () => ipcRenderer.invoke('launch-main'),
    launchAudioTest: () => ipcRenderer.invoke('launch-audio-test'),
  })
} catch (e) {
  console.error('[preload.cjs] expose failed', e)
}


