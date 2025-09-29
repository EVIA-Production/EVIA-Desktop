import { contextBridge, ipcRenderer, desktopCapturer } from "electron";

type WsHandle = {
  sendBinary: (data: ArrayBuffer) => void;
  sendCommand: (cmd: any) => void;
  close: () => void;
  onMessage: (cb: (data: string | ArrayBuffer | Blob) => void) => void;
  onOpen: (cb: () => void) => void;
  onClose: (cb: (event: CloseEvent) => void) => void;
  onError: (cb: (event: Event) => void) => void;
};

function createWs(url: string): WsHandle {
  const ws = new WebSocket(url);

  let onMessageCb: ((data: string | ArrayBuffer | Blob) => void) | null = null;
  let onOpenCb: (() => void) | null = null;
  let onCloseCb: ((event: CloseEvent) => void) | null = null;
  let onErrorCb: ((event: Event) => void) | null = null;

  ws.onmessage = (ev: MessageEvent) => {
    if (onMessageCb) onMessageCb(ev.data as any);
  };
  ws.onopen = () => {
    if (onOpenCb) onOpenCb();
  };
  ws.onclose = (ev: CloseEvent) => {
    if (onCloseCb) onCloseCb(ev);
  };
  ws.onerror = (ev: Event) => {
    if (onErrorCb) onErrorCb(ev);
  };

  return {
    sendBinary: (data: ArrayBuffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    sendCommand: (cmd: any) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
    },
    close: () => ws.close(),
    onMessage: (cb) => {
      onMessageCb = cb;
    },
    onOpen: (cb) => {
      onOpenCb = cb;
    },
    onClose: (cb) => {
      onCloseCb = cb;
    },
    onError: (cb) => {
      onErrorCb = cb;
    },
  };
}

console.log("Preload script is loading - exposing evia API");

contextBridge.exposeInMainWorld("evia", {
  createWs,
  getDesktopCapturerSources: (options: Electron.SourcesOptions) =>
    desktopCapturer.getSources(options),
  systemAudio: {
    start: () => ipcRenderer.invoke("system-audio:start"),
    stop: () => ipcRenderer.invoke("system-audio:stop"),
    onData: (cb: (jsonLine: string) => void) =>
      ipcRenderer.on("system-audio:data", (_e, line) => cb(line)),
    onStatus: (cb: (line: string) => void) =>
      ipcRenderer.on("system-audio:status", (_e, line) => cb(line)),
  },
  overlay: {
    setClickThrough: (enabled: boolean) =>
      ipcRenderer.send("overlay:setClickThrough", enabled),
  },
  windows: {
    show: (name: "listen" | "ask" | "settings" | "shortcuts") =>
      ipcRenderer.invoke("win:show", name),
    ensureShown: (name: "listen" | "ask" | "settings" | "shortcuts") =>
      ipcRenderer.invoke("win:ensureShown", name),
    hide: (name: "listen" | "ask" | "settings" | "shortcuts") =>
      ipcRenderer.invoke("win:hide", name),
    toggleAll: () => ipcRenderer.invoke("win:toggleAll"),
    getHeaderPosition: () => ipcRenderer.invoke("win:getHeaderPosition"),
    moveHeaderTo: (x: number, y: number) =>
      ipcRenderer.invoke("win:moveHeaderTo", x, y),
    resizeHeader: (w: number, h: number) =>
      ipcRenderer.invoke("win:resizeHeader", w, h),
    adjustWindowHeight: (
      winName: "listen" | "ask" | "settings" | "shortcuts",
      height: number
    ) => ipcRenderer.invoke("adjust-window-height", { winName, height }),
    showSettingsWindow: () => ipcRenderer.send("show-settings-window"),
    hideSettingsWindow: () => ipcRenderer.send("hide-settings-window"),
    cancelHideSettingsWindow: () =>
      ipcRenderer.send("cancel-hide-settings-window"),
  },
  prefs: {
    get: () => ipcRenderer.invoke("prefs:get"),
    set: (prefs: Record<string, any>) => ipcRenderer.invoke("prefs:set", prefs),
  },
  closeWindow: (name: string) => ipcRenderer.send("close-window", name),
  app: {
    quit: () => {
      console.log("Preload: quit() called - invoking app:quit IPC");
      return ipcRenderer.invoke("app:quit");
    },
  },
  // Allow the web frontend to inform the Electron renderer of auth tokens so
  // the overlay and other renderer windows can access the same localStorage
  // auth state. These functions are no-ops in a normal browser because
  // `window.evia` won't exist there; the frontend should call them guarded.
  setAuthToken: (token: string, tokenType?: string) => {
    try {
      // Mask the token for logging (don't print full token)
      const masked = token
        ? `${token.slice(0, 6)}...${token.slice(Math.max(0, token.length - 4))}`
        : "";
      console.log(
        `Preload: setAuthToken called (masked=${masked}) tokenType=${tokenType} origin=${
          typeof location !== "undefined" ? location.href : "unknown"
        }`
      );
      localStorage.setItem("auth_token", token);
      if (tokenType) localStorage.setItem("token_type", tokenType);
    } catch (e) {
      console.error("Preload: setAuthToken error", e);
    }
  },
  clearAuthToken: () => {
    try {
      console.log(
        "Preload: clearAuthToken called - removing auth_token and token_type from localStorage"
      );
      localStorage.removeItem("auth_token");
      localStorage.removeItem("token_type");
    } catch (e) {
      console.error("Preload: clearAuthToken error", e);
    }
  },
});

// Export/WAV helpers
contextBridge.exposeInMainWorld("eviaExport", {
  saveSystemWav: () => ipcRenderer.send("export:save-system-wav"),
  onSaveSystemWav: (cb: () => void) =>
    ipcRenderer.on("export:save-system-wav", cb),
});

export {};
