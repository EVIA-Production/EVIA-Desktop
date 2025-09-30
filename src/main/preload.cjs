const { contextBridge, ipcRenderer, shell } = require("electron");

console.log("Preload CJS script is loading - exposing evia API");

function createWs(url) {
  const ws = new WebSocket(url);

  // Simple handler registries
  const messageHandlers = [];
  const openHandlers = [];
  const closeHandlers = [];
  const errorHandlers = [];

  // Bridge native WebSocket events to registered handlers
  ws.onmessage = (event) => {
    const payload = event.data;
    try {
      messageHandlers.forEach((h) => h(payload));
    } catch {}
  };
  ws.onopen = () => {
    try {
      openHandlers.forEach((h) => h());
    } catch {}
  };
  ws.onclose = (event) => {
    try {
      closeHandlers.forEach((h) => h(event));
    } catch {}
  };
  ws.onerror = (event) => {
    try {
      errorHandlers.forEach((h) => h(event));
    } catch {}
  };

  return {
    sendBinary: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    sendCommand: (cmd) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
    },
    close: () => ws.close(),
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

// Seed auth token from prefs on load
try {
  ipcRenderer.invoke("prefs:get").then((res) => {
    const p = (res && res.prefs) || {};
    const token = p.auth_token;
    const tokenType = p.token_type || "Bearer";
    if (token) {
      try {
        localStorage.setItem("auth_token", token);
        if (tokenType) localStorage.setItem("token_type", tokenType);
        console.log("[preload.cjs] Seeded auth token from prefs");
      } catch {}
    }
  });
} catch {}

// Listen for global auth updates from main and apply to localStorage
ipcRenderer.on("auth:apply", (_e, payload) => {
  try {
    if (payload && payload.token) {
      localStorage.setItem("auth_token", payload.token);
      if (payload.tokenType)
        localStorage.setItem("token_type", payload.tokenType);
      console.log("[preload.cjs] Applied auth token from broadcast");
    } else {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("token_type");
      console.log("[preload.cjs] Cleared auth token from broadcast");
    }
  } catch (e) {
    console.error("[preload.cjs] Failed to apply auth token", e);
  }
});

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
    setAuthToken: (token, tokenType) => {
      try {
        const masked = token
          ? `${token.slice(0, 6)}...${token.slice(
              Math.max(0, token.length - 4)
            )}`
          : "";
        console.log(
          `[preload.cjs] setAuthToken (masked=${masked}) type=${tokenType}`
        );
        localStorage.setItem("auth_token", token);
        if (tokenType) localStorage.setItem("token_type", tokenType);
        ipcRenderer.invoke("auth:set-token", { token, tokenType });
      } catch (e) {
        console.error("[preload.cjs] setAuthToken failed", e);
      }
    },
    clearAuthToken: () => {
      try {
        console.log("[preload.cjs] clearAuthToken");
        localStorage.removeItem("auth_token");
        localStorage.removeItem("token_type");
        ipcRenderer.invoke("auth:clear-token");
      } catch (e) {
        console.error("[preload.cjs] clearAuthToken failed", e);
      }
    },
    settingsView: {
      getAllKeys: () => ipcRenderer.invoke("model:get-all-keys"),
      validateKey: (data) => ipcRenderer.invoke("model:validate-key", data),
      saveApiKey: (key) => ipcRenderer.invoke("model:set-api-key", key),
      removeApiKey: (provider) =>
        ipcRenderer.invoke("model:remove-api-key", provider),
      onSettingsUpdated: (cb) => ipcRenderer.on("settings-updated", cb),
      removeOnSettingsUpdated: (cb) =>
        ipcRenderer.removeListener("settings-updated", cb),
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
    app: {
      quit: () => {
        console.log("Preload CJS: quit() called - invoking app:quit IPC");
        return ipcRenderer.invoke("app:quit");
      },
    },
  });
} catch (e) {
  console.error("[preload.cjs] expose failed", e);
}
