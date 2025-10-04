// Type declarations for audio-processor.js

export interface CaptureHandle {
  micAudioContext: AudioContext;
  node: AudioWorkletNode;
  micStream: MediaStream;
}

export function startCapture(includeSystemAudio?: boolean): Promise<CaptureHandle>;
export function stopCapture(captureHandle: CaptureHandle | null): Promise<void>;
export function startAudioCapture(onChunk: (buffer: ArrayBuffer) => void): void;
export function dumpWav(chunks: any): void;
