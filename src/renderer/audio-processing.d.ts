declare module './audio-processing.js' {
  export const SAMPLE_RATE: number;
  export const AUDIO_CHUNK_DURATION: number;
  export const SAMPLES_PER_CHUNK: number;
  export const pcmBuffers: { system: ArrayBuffer[], mic: ArrayBuffer[] };
  export function initAudioProcessing(): Promise<boolean>;
  export function processSystemAudio(float32Data: Float32Array, inputSampleRate: number, channels: number): Promise<Int16Array>;
  export function convertFloat32ToInt16(float32Array: Float32Array): Int16Array;
  export function downsampleLinear(input: Float32Array, inputRate: number, outputRate: number): Float32Array;
  export function calculateRMS(buffer: Int16Array | Float32Array): number;
  export function base64ToFloat32Array(base64: string): Float32Array;
  export function arrayBufferToBase64(buffer: ArrayBufferLike): string;
  export function exportBufferToWav(type: string, sampleRate?: number): string | null;
}