// Type definitions for EVIA Desktop

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
  };
  // Desktop capturer for screen/audio capture
  getDesktopCapturerSources: (opts: any) => Promise<any[]>;
  // 🔐 Authentication via secure keytar storage
  auth: {
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => Promise<void>;
    getToken: () => Promise<string | null>;
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
  }
}

export {};
