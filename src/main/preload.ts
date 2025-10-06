import { contextBridge, ipcRenderer } from "electron";
import * as keytar from "keytar";

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

contextBridge.exposeInMainWorld("evia", {
  createWs,
  transcripts: {
    init: (chatId: string, token: string) =>
      ipcRenderer.invoke("transcript:init", { chatId, token }),
    onEvent: (cb: (evt: any) => void) => {
      const handler = (_e: any, payload: any) => {
        try {
          if (payload?.type === "transcript_segment") {
            console.log("[preload][transcript:event] segment", {
              source: payload.source,
              text: payload.data?.text,
              is_final: payload.data?.is_final,
              final: payload.data?.final,
            });
          } else if (payload?.type === "status") {
            console.log("[preload][transcript:event] status", payload.data);
          }
        } catch {}
        cb(payload);
      };
      ipcRenderer.on("transcript:event", handler);
      return () => ipcRenderer.removeListener("transcript:event", handler);
    },
  },
  getDesktopCapturerSources: (options: Electron.SourcesOptions) =>
    ipcRenderer.invoke("desktop-capturer:getSources", options),
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
    toggleAllVisibility: () => ipcRenderer.invoke("header:toggle-visibility"),
    nudgeHeader: (dx: number, dy: number) =>
      ipcRenderer.invoke("header:nudge", { dx, dy }),
    openAskWindow: () => ipcRenderer.invoke("header:open-ask"),
  },
  capture: {
    takeScreenshot: () => ipcRenderer.invoke("capture:screenshot"),
  },
  prefs: {
    get: () => ipcRenderer.invoke("prefs:get"),
    set: (prefs: Record<string, any>) => ipcRenderer.invoke("prefs:set", prefs),
  },
  closeWindow: (name: string) => ipcRenderer.invoke("close-window", name),
  auth: {
    login: (username: string, password: string) =>
      ipcRenderer.invoke("auth:login", { username, password }),
    getToken: () => ipcRenderer.invoke("auth:getToken"),
  },
  audio: {
    sendMicFrame: (buf: ArrayBuffer) =>
      ipcRenderer.send("audio:micFrame", Buffer.from(buf)),
    sendSystemFrame: (buf: ArrayBuffer) =>
      ipcRenderer.send("audio:systemFrame", Buffer.from(buf)),
  },
});

// Export/WAV helpers
contextBridge.exposeInMainWorld("eviaExport", {
  saveSystemWav: () => ipcRenderer.send("export:save-system-wav"),
  onSaveSystemWav: (cb: () => void) =>
    ipcRenderer.on("export:save-system-wav", cb),
});

// Electron IPC (for dynamic window sizing, etc.)
contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) =>
      ipcRenderer.invoke(channel, ...args),
    send: (channel: string, ...args: any[]) =>
      ipcRenderer.send(channel, ...args),
    on: (channel: string, listener: (event: any, ...args: any[]) => void) =>
      ipcRenderer.on(channel, listener),
  },
});

export {};
