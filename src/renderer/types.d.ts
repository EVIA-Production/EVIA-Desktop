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
  // Add windows
  windows: {
    show: (name: string) => Promise<{ ok: boolean, toggled?: string }>;
    hide: (name: string) => Promise<{ ok: boolean }>;
    cancelHideSettings: () => void;
  };
}

declare global {
  interface Window {
    evia: EviaBridge;
    EVIA_BACKEND_WS?: string;
    audioTest?: {
      init: () => Promise<boolean>;
      play: (seconds?: number) => void;
      toggleRecording: () => void;
      export: (type: string) => void;
    };
  }
}

export {};
