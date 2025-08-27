const { contextBridge, ipcRenderer, shell } = require('electron')

function createWs(url) {
  const ws = new WebSocket(url)
  return {
    sendBinary: (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data) },
    sendCommand: (cmd) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd)) },
    close: () => ws.close(),
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


