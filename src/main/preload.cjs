const { contextBridge, ipcRenderer, shell } = require("electron");

function createWs(url) {
  const createdAt = Date.now();
  const ws = new WebSocket(url);
  console.log(`[preload][ws] create url=${url}`);

  // Simple handler registries
  const messageHandlers = [];
  const openHandlers = [];
  const closeHandlers = [];
  const errorHandlers = [];

  // Bridge native WebSocket events to registered handlers
  ws.onmessage = (event) => {
    try {
      messageHandlers.forEach((h) => h(event.data));
    } catch (e) {
      console.warn("[preload][ws] message handler error", e);
    }
  };
  ws.onopen = () => {
    console.log(
      `[preload][ws] open dt=${Date.now() - createdAt}ms readyState=${
        ws.readyState
      }`
    );
    try {
      openHandlers.forEach((h) => h());
    } catch (e) {
      console.warn("[preload][ws] open handler error", e);
    }
  };
  ws.onclose = (event) => {
    console.log(
      `[preload][ws] close code=${event.code} reason='${
        event.reason || ""
      }' wasClean=${event.wasClean}`
    );
    try {
      closeHandlers.forEach((h) => h(event));
    } catch (e) {
      console.warn("[preload][ws] close handler error", e);
    }
  };
  ws.onerror = (event) => {
    console.warn(
      "[preload][ws] error readyState=" + ws.readyState,
      event?.message || ""
    );
    try {
      errorHandlers.forEach((h) => h(event));
    } catch (e) {
      console.warn("[preload][ws] error handler error", e);
    }
  };

  return {
    sendBinary: (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      } else {
        /* drop */
      }
    },
    sendCommand: (cmd) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(cmd));
        } catch (e) {
          console.warn("[preload][ws] sendCommand error", e);
        }
      }
    },
    close: () => {
      try {
        ws.close();
      } catch {}
    },
    onMessage: (cb) => {
      if (typeof cb === "function") messageHandlers.push(cb);
    },
    onOpen: (cb) => {
      if (typeof cb === "function") openHandlers.push(cb);
    },
    onClose: (cb) => {
      if (typeof cb === "function") closeHandlers.push(cb);
    },
    onError: (cb) => {
      if (typeof cb === "function") errorHandlers.push(cb);
    },
  };
}

try {
  console.log("[preload.cjs] loaded, exposing window.evia");
  contextBridge.exposeInMainWorld("evia", {
    createWs,
    systemAudio: {
      start: () => ipcRenderer.invoke("system-audio:start"),
      stop: () => ipcRenderer.invoke("system-audio:stop"),
      onData: (cb) =>
        ipcRenderer.on("system-audio:data", (_e, line) => cb(line)),
      onStatus: (cb) =>
        ipcRenderer.on("system-audio:status", (_e, line) => cb(line)),
      getSources: () => ipcRenderer.invoke("system-audio:get-sources"),
    },
    overlay: {
      setClickThrough: (enabled) =>
        ipcRenderer.send("overlay:setClickThrough", !!enabled),
    },
    windows: {
      show: (name) => ipcRenderer.invoke("win:show", name),
      ensureShown: (name) => ipcRenderer.invoke("win:ensureShown", name),
      hide: (name) => ipcRenderer.invoke("win:hide", name),
      // EVIA handlers
      getHeaderPosition: () => ipcRenderer.invoke("win:getHeaderPosition"),
      moveHeaderTo: (x, y) => ipcRenderer.invoke("win:moveHeaderTo", x, y),
      resizeHeader: (w, h) => ipcRenderer.invoke("win:resizeHeader", w, h),
      // Glass-compatible aliases
      getHeaderPositionCompat: () => ipcRenderer.invoke("get-header-position"),
      moveHeaderToCompat: (x, y) => ipcRenderer.invoke("move-header-to", x, y),
      adjustWindowHeight: (winName, height) =>
        ipcRenderer.invoke("adjust-window-height", { winName, height }),
      showSettingsWindow: () => ipcRenderer.send("show-settings-window"),
      hideSettingsWindow: () => ipcRenderer.send("hide-settings-window"),
      cancelHideSettingsWindow: () =>
        ipcRenderer.send("cancel-hide-settings-window"),
      headerAnimationFinished: (state) =>
        ipcRenderer.send("header-animation-finished", state),
    },
    prefs: {
      get: () => ipcRenderer.invoke("prefs:get"),
      set: (prefs) => ipcRenderer.invoke("prefs:set", prefs),
    },
    openSystemPreferences: (section) => {
      if (section === "screen") {
        shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        );
      } else if (section === "mic") {
        shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        );
      }
    },
    openTerminal: (script) => {
      return ipcRenderer.invoke("open-terminal", script);
    },
    launchMain: () => ipcRenderer.invoke("launch-main"),
    launchAudioTest: () => ipcRenderer.invoke("launch-audio-test"),
  });
} catch (e) {
  console.error("[preload.cjs] expose failed", e);
}
