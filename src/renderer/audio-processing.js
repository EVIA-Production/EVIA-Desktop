// Audio processing utilities for EVIA Desktop
// Improved from Glass patterns for stable audio processing

// Import buffer manager
import { AudioBufferManager, SAMPLE_RATE, AUDIO_CHUNK_DURATION, SAMPLES_PER_CHUNK } from './audio-buffer-manager.js';

// Audio context and processor references
let audioContext = null;
let filterNode = null;
let processorNode = null;

// Audio buffers
const pcmBuffers = {
  system: [],
  mic: []
};

// Create buffer managers
const systemBufferManager = new AudioBufferManager(SAMPLE_RATE, AUDIO_CHUNK_DURATION);
const micBufferManager = new AudioBufferManager(SAMPLE_RATE, AUDIO_CHUNK_DURATION);

// Expose buffer managers for diagnostics/export helpers
try {
  if (typeof window !== 'undefined') {
    (window).systemBufferManager = systemBufferManager;
    (window).micBufferManager = micBufferManager;
  }
} catch {}

console.log('[Audio] SAMPLES_PER_CHUNK value:', SAMPLES_PER_CHUNK);

/**
 * Initialize the audio processing context and worklet
 */
async function initAudioProcessing() {
  try {
    // Create audio context with the highest sample rate available
    audioContext = new AudioContext();
    console.log('[Audio] Context created with sample rate:', audioContext.sampleRate);
    
    let workletUrl;
    try {
      workletUrl = new URL('./audio-processor.js', import.meta.url).href;
      console.log('[Audio] Attempting to load worklet from import.meta URL:', workletUrl);
      await audioContext.audioWorklet.addModule(workletUrl);
      console.log('[Audio] AudioWorklet loaded from import.meta URL');
    } catch (err) {
      console.error('[Audio] import.meta URL failed:', err);
      try {
        workletUrl = '/audio-processor.js'; // Vite dev server path
        console.log('[Audio] Attempting Vite dev server path:', workletUrl);
        await audioContext.audioWorklet.addModule(workletUrl);
        console.log('[Audio] AudioWorklet loaded from Vite path');
      } catch (viteErr) {
        console.error('[Audio] Vite path failed:', viteErr);
        try {
          workletUrl = window.location.origin + '/audio-processor.js';
          console.log('[Audio] Attempting origin-relative path:', workletUrl);
          await audioContext.audioWorklet.addModule(workletUrl);
          console.log('[Audio] AudioWorklet loaded from origin path');
        } catch (originErr) {
          console.error('[Audio] All paths failed:', originErr);
          throw originErr;
        }
      }
    }
    
    console.log('[Audio] Processing initialized successfully');
    return true;
  } catch (err) {
    console.error('[Audio] Failed to initialize processing:', err);
    // Try to create a fallback audio context
    try {
      if (!audioContext) {
        audioContext = new AudioContext();
        console.log('[Audio] Created fallback context');
      }
    } catch (e) {
      console.error('[Audio] Failed to create fallback context:', e);
    }
    return false;
  }
}

/**
 * Process system audio (float32 from native helper)
 * @param {Float32Array} float32Data - Raw float32 audio data
 * @param {number} inputSampleRate - Source sample rate
 * @param {number} channels - Number of channels (1 or 2)
 * @returns {Promise<Int16Array>} - Processed PCM16 data at 16kHz
 */
async function processSystemAudio(float32Data, inputSampleRate, channels) {
  try {
    // Mix to mono if stereo
    let monoData = float32Data;
    if (channels === 2) {
      monoData = new Float32Array(float32Data.length / 2);
      for (let i = 0; i < monoData.length; i++) {
        monoData[i] = (float32Data[i * 2] + float32Data[i * 2 + 1]) / 2;
      }
    }

    // Add samples to the buffer manager
    systemBufferManager.addSamples(monoData, inputSampleRate);

    // Extract a complete chunk at input rate
    const chunk = systemBufferManager.extractChunk(inputSampleRate);

    // If not enough samples, return empty
    if (!chunk) {
      return new Int16Array(0);
    }

    // Create OfflineAudioContext at target rate
    const offlineCtx = new OfflineAudioContext({
      numberOfChannels: 1,
      length: SAMPLES_PER_CHUNK,
      sampleRate: SAMPLE_RATE
    });

    // Create buffer source with input data
    const sourceBuffer = offlineCtx.createBuffer(1, chunk.length, inputSampleRate);
    sourceBuffer.copyToChannel(chunk, 0);

    const source = offlineCtx.createBufferSource();
    source.buffer = sourceBuffer;

    // Create low-pass filter for anti-aliasing
    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = SAMPLE_RATE / 2; // Nyquist frequency
    filter.Q.value = 0.7071; // Butterworth response

    // Connect nodes
    source.connect(filter);
    filter.connect(offlineCtx.destination);

    // Start source and render
    source.start();
    const renderedBuffer = await offlineCtx.startRendering();

    // Get processed float32 data
    const processedFloat32 = renderedBuffer.getChannelData(0);

    // Add soft limiting to prevent clipping
    const limited = new Float32Array(processedFloat32.length);
    for (let i = 0; i < processedFloat32.length; i++) {
      limited[i] = Math.tanh(processedFloat32[i] * 0.8) * 0.95;
    }

    // Convert to PCM16
    const pcm16 = convertFloat32ToInt16(limited);

    // Log for diagnostics
    const rms = calculateRMS(pcm16);
    console.log(`[system] Processed chunk RMS=${rms.toFixed(4)} sampleCount=${pcm16.length}`);

    return pcm16;
  } catch (err) {
    console.error('[Audio] Processing error:', err);
    return fallbackProcessAudio(float32Data, inputSampleRate, channels);
  }
}

/**
 * Fallback audio processing when AudioContext/AudioWorklet fails
 * @param {Float32Array} float32Data - Raw float32 audio data
 * @param {number} inputSampleRate - Source sample rate
 * @param {number} channels - Number of channels (1 or 2)
 * @returns {Int16Array} - Processed PCM16 data
 */
function fallbackProcessAudio(float32Data, inputSampleRate, channels) {
  console.log('[Audio] Using fallback processing');
  console.log('[Fallback] Target chunk size:', SAMPLES_PER_CHUNK);
  
  // If empty data, return empty buffer
  if (!float32Data || float32Data.length === 0) {
    return new Int16Array(0);
  }
  
  // Mix to mono if stereo
  let monoData = float32Data;
  if (channels === 2) {
    monoData = new Float32Array(float32Data.length / 2);
    for (let i = 0; i < monoData.length; i++) {
      monoData[i] = (float32Data[i * 2] + float32Data[i * 2 + 1]) / 2;
    }
  }
  
  // Ensure consistent chunk sizes even in fallback mode
  const chunkSize = SAMPLES_PER_CHUNK;
  if (monoData.length < chunkSize) {
    // Pad with zeros if needed
    const paddedData = new Float32Array(chunkSize);
    paddedData.set(monoData);
    monoData = paddedData;
    console.log(`[Audio] Fallback: Padded data to ${chunkSize} samples`);
  } else if (monoData.length > chunkSize) {
    // Truncate to exact chunk size
    monoData = monoData.slice(0, chunkSize);
    console.log(`[Audio] Fallback: Truncated data to ${chunkSize} samples`);
  }
  
  // Apply better low-pass filter
  const nyquist = SAMPLE_RATE / 2;
  const filtered = applyLowPassFilter(monoData, inputSampleRate, nyquist);
  
  // Downsample
  const downsampled = downsampleLinear(filtered, inputSampleRate, SAMPLE_RATE);
  
  // Apply soft limiting to prevent clipping
  const limited = new Float32Array(downsampled.length);
  for (let i = 0; i < downsampled.length; i++) {
    // Soft limiting using tanh
    limited[i] = Math.tanh(downsampled[i] * 0.8) * 0.95;
  }
  
  // Log the RMS value for diagnostics
  const rms = calculateRMS(limited);
  console.log(`[Audio] Fallback: Processed chunk RMS=${rms.toFixed(4)} sampleCount=${limited.length}`);
  
  // Convert to PCM16
  return convertFloat32ToInt16(limited);
}

/**
 * Simple low-pass filter implementation
 * @param {Float32Array} input - Input audio buffer
 * @param {number} sampleRate - Sample rate of input
 * @param {number} cutoffFreq - Cutoff frequency
 * @returns {Float32Array} - Filtered audio buffer
 */
function applyLowPassFilter(input, sampleRate, cutoffFreq) {
  // Simple first-order low-pass filter
  const dt = 1 / sampleRate;
  const RC = 1 / (2 * Math.PI * cutoffFreq);
  const alpha = dt / (RC + dt);
  
  const output = new Float32Array(input.length);
  output[0] = input[0];
  
  for (let i = 1; i < input.length; i++) {
    output[i] = output[i-1] + alpha * (input[i] - output[i-1]);
  }
  
  return output;
}

/**
 * Convert Float32Array to Int16Array (PCM16)
 * @param {Float32Array} float32Array - Float32Array with values between -1 and 1
 * @returns {Int16Array} - Int16Array with values between -32768 and 32767
 */
function convertFloat32ToInt16(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    // Clamp to range [-1, 1] and convert to int16
    int16Array[i] = Math.min(1, Math.max(-1, float32Array[i])) * 0x7FFF;
  }
  return int16Array;
}

/**
 * Improved downsampling with anti-aliasing filter
 * @param {Float32Array} input - Input audio buffer
 * @param {number} inputRate - Input sample rate
 * @param {number} outputRate - Output sample rate
 * @returns {Float32Array} - Downsampled audio buffer
 */
function downsampleLinear(input, inputRate, outputRate) {
  if (outputRate === inputRate) return input;
  
  // Apply a simple low-pass filter first to prevent aliasing
  // Cut-off at Nyquist frequency of target rate
  const cutoff = outputRate / 2;
  const filtered = applyLowPassFilter(input, inputRate, cutoff);
  
  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  
  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const srcIndex = Math.floor(srcPos);
    const fraction = srcPos - srcIndex;
    
    // Linear interpolation with bounds checking
    if (srcIndex + 1 < filtered.length) {
      output[i] = filtered[srcIndex] * (1 - fraction) + filtered[srcIndex + 1] * fraction;
    } else {
      output[i] = filtered[srcIndex];
    }
  }
  
  return output;
}

/**
 * Calculate RMS value of an audio buffer
 * @param {Int16Array|Float32Array} buffer - Audio buffer
 * @returns {number} - RMS value
 */
function calculateRMS(buffer) {
  let sum = 0;
  let divisor = 0x8000;
  
  // Adjust divisor based on buffer type
  if (buffer instanceof Float32Array) {
    divisor = 1;
  }
  
  for (let i = 0; i < buffer.length; i++) {
    const normalized = buffer[i] / divisor;
    sum += normalized * normalized;
  }
  
  return Math.sqrt(sum / buffer.length);
}

/**
 * Convert Base64 string to Float32Array
 * @param {string} base64 - Base64 encoded audio data
 * @returns {Float32Array} - Float32Array with audio data
 */
function base64ToFloat32Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return new Float32Array(bytes.buffer);
}

/**
 * Convert ArrayBuffer to Base64 string
 * @param {ArrayBufferLike} buffer - Audio buffer
 * @returns {string} - Base64 encoded string
 */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  
  return btoa(binary);
}

/**
 * Saves current audio buffer to WAV file for diagnostics
 * @param {string} type - 'system' or 'mic'
 * @param {number} sampleRate - Sample rate of the audio
 * @returns {string} - Data URL for WAV file
 */
function exportBufferToWav(type, sampleRate = SAMPLE_RATE) {
  const buffers = pcmBuffers[type] || [];
  if (buffers.length === 0) return null;
  
  // Concatenate buffers
  const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
  const concatenated = new Int16Array(totalLength / 2);
  
  let offset = 0;
  for (const buffer of buffers) {
    concatenated.set(new Int16Array(buffer), offset);
    offset += buffer.byteLength / 2;
  }
  
  return makeWav(concatenated.buffer, sampleRate);
}

/**
 * Create WAV file from PCM data
 * @param {ArrayBuffer} pcmBuffer - PCM audio buffer
 * @param {number} sampleRate - Sample rate of audio
 * @returns {string} - Data URL for WAV file
 */
function makeWav(pcmBuffer, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBuffer.byteLength;
  const totalSize = 44 + dataSize;
  
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  
  // Write WAV header
  // "RIFF" chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  
  // "fmt " sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  
  // "data" sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Copy PCM data
  const pcmData = new Uint8Array(pcmBuffer);
  const outputData = new Uint8Array(buffer, 44);
  outputData.set(pcmData);
  
  // Create data URL
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Helper function to write string to DataView
 */
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Export the functions and constants
export {
  SAMPLE_RATE,
  AUDIO_CHUNK_DURATION,
  SAMPLES_PER_CHUNK,
  initAudioProcessing,
  processSystemAudio,
  convertFloat32ToInt16,
  downsampleLinear,
  calculateRMS,
  base64ToFloat32Array,
  arrayBufferToBase64,
  exportBufferToWav,
  pcmBuffers,
  systemBufferManager,
  micBufferManager
};
