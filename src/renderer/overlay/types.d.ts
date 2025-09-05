// Global types for EVIA Desktop Overlay

interface Window {
  electronAPI?: {
    onToggleVisibility: (callback: () => void) => void;
    onShowAskView: (callback: () => void) => void;
    onShowListenView: (callback: () => void) => void;
    removeAllListeners: () => void;
  };
}

export interface TranscriptSegment {
  id: string;
  text: string;
  speaker: 'user' | 'assistant';
  timestamp: string;
  confidence: number;
}

export interface AIAnswer {
  answer: string;
  citations: string[];
  latency: number;
}

export interface UserSettings {
  language: 'de' | 'en';
  mic_sensitivity: number;
  aec_enabled: boolean;
  diarization_enabled: boolean;
  system_audio_enabled: boolean;
  consent_training: boolean;
  consent_analytics: boolean;
  consent_storage: boolean;
}

export interface WebSocketStatus {
  connected: boolean;
  latency: number;
  lastSeen: string;
}

export interface InsightClickEvent {
  chat_id: number;
  type: string;
  index: number;
  timestamp: string;
}
