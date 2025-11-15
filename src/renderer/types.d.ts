// Type definitions for EVIA Desktop
export {};

interface WebSocketWrapper {
  sendBinary: (data: ArrayBufferLike) => void;
  sendCommand: (cmd: any) => void;
  close: () => void;
}

interface SystemAudioBridge {
  start: () => Promise<any>;
  stop: () => Promise<any>;
  onData: (callback: (data: string) => void) => void;
  onStatus: (callback: (data: string) => void) => void;
}

interface PrefsBridge {
  get: () => Promise<any>;
  set: (prefs: any) => Promise<any>;
}

interface EviaBridge {
  createWs: (url: string) => WebSocketWrapper;
  systemAudio: SystemAudioBridge;
  prefs: PrefsBridge;
  openSystemPreferences: (section: 'screen' | 'mic') => void;
  openTerminal: (script: string) => Promise<any>;
  launchMain: () => Promise<any>;
  launchAudioTest: () => Promise<any>;
  eviaExport?: {
    saveLatestSystemWav: () => void;
  };
  // Add windows
  windows: {
    show: (name: string) => Promise<{ ok: boolean, toggled?: string }>;
    ensureShown: (name: string) => Promise<{ ok: boolean, toggled?: string }>;
    hide: (name: string) => Promise<{ ok: boolean }>;
    cancelHideSettingsWindow: () => void;
  };
  closeWindow: (name: string) => void;
  // IPC for cross-window communication (language changes, etc.)
  ipc: {
    send: (channel: string, ...args: any[]) => void;
    on: (channel: string, listener: (...args: any[]) => void) => void;
    removeListener: (channel: string, listener: (...args: any[]) => void) => void;
    removeAllListeners: (channel: string) => void;
    off: (channel: string, listener: (...args: any[]) => void) => void;
  };
  // Desktop capturer for screen/audio capture
  getDesktopCapturerSources: (opts: any) => Promise<any[]>;
  // 🔐 Authentication via secure keytar storage
  auth: {
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => Promise<{ success: boolean; error?: string }>;
    getToken: () => Promise<string | null>;
  };
  // 🌐 Shell API for opening external URLs
  shell: {
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
  };
  // 🚪 App control
  app: {
    quit: () => Promise<void>;
  };
  // 🔐 Permissions API (Phase 3)
  permissions: {
    check: () => Promise<{ microphone: string; screen: string }>;
    requestMicrophone: () => Promise<{ status: string; error?: string }>;
    openSystemPreferences: (pane: string) => Promise<{ success: boolean; error?: string }>;
    markComplete: () => Promise<{ success: boolean }>;
  };
}

declare global {
  interface Window {
    evia: EviaBridge;
    EVIA_BACKEND_WS?: string;
    eviaExport?: {
      saveLatestSystemWav: () => void;
    };
    audioTest?: {
      init: () => Promise<boolean>;
      play: (seconds?: number) => void;
      toggleRecording: () => void;
      export: (type: string) => void;
    };
    electron?: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        send: (channel: string, ...args: any[]) => void;
        on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
      };
    };
    platformInfo?: {
      platform: string;
      isWindows: boolean;
      isMac: boolean;
      isLinux: boolean;
    }
  }
}
