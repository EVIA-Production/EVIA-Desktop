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

// Seed auth token from main prefs into this renderer's localStorage on startup
try {
  ipcRenderer.invoke("prefs:get").then((res: any) => {
    const p = res?.prefs || {};
    const token = p.auth_token;
    const tokenType = p.token_type || "Bearer";
    try {
      const masked = token
        ? `${String(token).slice(0, 6)}...${String(token).slice(
            Math.max(0, String(token).length - 4)
          )}`
        : null;
      console.log("[preload] prefs:get", {
        hasPrefs: !!res,
        masked,
        tokenType,
      });
    } catch {}
    if (token) {
      try {
        localStorage.setItem("auth_token", token);
        if (tokenType) localStorage.setItem("token_type", tokenType);
        console.log("[preload] Seeded auth token from prefs into localStorage");
      } catch {}
    }
  });
} catch {}

// Listen for global auth updates from main and apply to localStorage
ipcRenderer.on(
  "auth:apply",
  (_e, payload: { token?: string | null; tokenType?: string | null }) => {
    try {
      const masked = payload?.token
        ? `${String(payload.token).slice(0, 6)}...${String(payload.token).slice(
            Math.max(0, String(payload.token).length - 4)
          )}`
        : null;
      console.log("[preload] auth:apply received", {
        masked,
        tokenType: payload?.tokenType || null,
      });
      try {
        const v = (process.env.EVIA_DEBUG_FULL_TOKEN || "").toLowerCase();
        const fullLog = v === "1" || v === "true" || v === "yes";
        if (fullLog) {
          console.log(
            "[preload][FULL] auth:apply raw token:",
            payload?.token || null
          );
        }
      } catch {}
      if (payload?.token) {
        localStorage.setItem("auth_token", payload.token);
        if (payload.tokenType)
          localStorage.setItem("token_type", payload.tokenType);
        console.log("[preload] Applied auth token from broadcast");
      } else {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("token_type");
        console.log("[preload] Cleared auth token from broadcast");
      }
    } catch (e) {
      console.error("[preload] Failed to apply auth token", e);
    }
  }
);

contextBridge.exposeInMainWorld("evia", {
  createWs,
  getDesktopCapturerSources: (options: Electron.SourcesOptions) =>
    desktopCapturer.getSources(options),
  auth: {
    startPkce: () => {
      try {
        console.log("[preload] invoking auth:pkce:start");
      } catch {}
      return ipcRenderer.invoke("auth:pkce:start");
    },
    getAccessToken: () => {
      try {
        console.log("[preload] invoking auth:pkce:get-access-token");
      } catch {}
      return ipcRenderer.invoke("auth:pkce:get-access-token");
    },
    logout: () => {
      try {
        console.log("[preload] invoking auth:pkce:logout");
      } catch {}
      return ipcRenderer.invoke("auth:pkce:logout");
    },
    backendLogin: (
      baseUrl: string | undefined,
      username: string,
      password: string,
      loginPath?: string
    ) => {
      try {
        console.log("[preload] invoking auth:backend:login", {
          hasBaseUrl: !!baseUrl,
          hasUsername: !!username,
          hasPassword: !!password,
          hasLoginPath: !!loginPath,
        });
      } catch {}
      return ipcRenderer.invoke("auth:backend:login", {
        baseUrl,
        username,
        password,
        loginPath,
      });
    },
  },
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
      try {
        const v = (process.env.EVIA_DEBUG_FULL_TOKEN || "").toLowerCase();
        const fullLog = v === "1" || v === "true" || v === "yes";
        if (fullLog) {
          console.log("[preload][FULL] setAuthToken raw token:", token);
        }
      } catch {}
      // Update local storage immediately in this renderer for responsiveness
      localStorage.setItem("auth_token", token);
      if (tokenType) localStorage.setItem("token_type", tokenType);
      // Persist centrally and broadcast to other windows via main
      ipcRenderer.invoke("auth:set-token", { token, tokenType });
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
      ipcRenderer.invoke("auth:clear-token");
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
