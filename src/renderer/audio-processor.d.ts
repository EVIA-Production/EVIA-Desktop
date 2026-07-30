// Type declarations for audio-processor.js

export interface CaptureHandle {
  micAudioContext: AudioContext;
  micAudioProcessor: ScriptProcessorNode;
  micStream: MediaStream;
  systemAudioContext: AudioContext | null;
  systemAudioProcessor: ScriptProcessorNode | null;
  systemStream: MediaStream | null;
  startupReadyInMs: number;
  systemAudioAvailable: boolean;
  systemAudioStatus:
      | 'ready'
      | 'not_requested'
      | 'socket_unavailable'
      | 'socket_timeout'
      | 'socket_connection_failed'
      | 'capture_failed'
      | 'capture_timeout'
      | 'permission_denied'
      | 'missing_binary'
      | 'spawn_failed'
      | 'invalid_audio_protocol'
      | 'unsupported_os'
      | 'unsupported';
}

export function startCapture(includeSystemAudio?: boolean): Promise<CaptureHandle>;
export function stopCapture(captureHandle: CaptureHandle | null): Promise<void>;
export function startAudioCapture(onChunk: (buffer: ArrayBuffer) => void): void;
export function dumpWav(chunks: any): void;
