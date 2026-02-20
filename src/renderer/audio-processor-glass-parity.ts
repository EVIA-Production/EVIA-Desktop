// Glass parity: Audio capture using ScriptProcessorNode (reliable, no CSP issues)
import { getWebSocketInstance, getOrCreateChatId, closeWebSocketInstance } from './services/websocketService';
import { BACKEND_URL } from './config/config';

const SAMPLE_RATE = 24000; // Glass parity
const BUFFER_SIZE = 2048;
const AUDIO_CHUNK_DURATION = 0.1; // 100ms chunks

// ──────────────────────────────────────────────────────────────────────────────
// AEC LATENCY COMPENSATION
// The mic hears system audio from 50-150ms ago (acoustic delay)
// We need to use a time-delayed reference signal for AEC to work properly
// ──────────────────────────────────────────────────────────────────────────────
const AEC_LATENCY_MS = 100; // Acoustic delay (mic hears speaker output from this long ago)
const AEC_RING_BUFFER_SIZE = Math.ceil(AEC_LATENCY_MS / (AUDIO_CHUNK_DURATION * 1000)) + 3; // +3 for safety

// ──────────────────────────────────────────────────────────────────────────────
// AUDIO DEBUG RECORDING (Development Only)
// Saves raw PCM16 audio sent to Deepgram for manual verification
// 
// To enable in production:
//   touch ~/Desktop/Taylos_DEBUG_AUDIO
// To disable:
//   rm ~/Desktop/Taylos_DEBUG_AUDIO
// ──────────────────────────────────────────────────────────────────────────────
let DEBUG_SAVE_AUDIO = false;
let debugAudioBuffers: { mic: Int16Array[], system: Int16Array[] } = { mic: [], system: [] };
let debugSessionId: string = '';
let debugFlagChecked = false;

// Check debug flag (called from startCapture)
async function checkDebugFlag() {
  if (debugFlagChecked) return; // Only check once
  debugFlagChecked = true;
  
  console.log('[AudioDebug] Checking for debug flag file...');
  
  try {
    const evia = (window as any).evia;
    if (!evia || !evia.checkDebugFlag) {
      console.log('[AudioDebug] ❌ window.evia.checkDebugFlag not available');
      return;
    }
    
    const enabled = await evia.checkDebugFlag();
    DEBUG_SAVE_AUDIO = enabled === true;
    
    if (DEBUG_SAVE_AUDIO) {
      console.log('[AudioDebug] ✅ 🎙️ Audio debug recording ENABLED');
      console.log('[AudioDebug] 💾 Files will be saved to: ~/Desktop/taylos-audio-debug/');
      console.log('[AudioDebug] 🛑 To disable: rm ~/Desktop/Taylos_DEBUG_AUDIO');
    } else {
      console.log('[AudioDebug] ℹ️  Debug recording DISABLED (no flag file found)');
      console.log('[AudioDebug] ⚡ To enable: touch ~/Desktop/Taylos_DEBUG_AUDIO');
    }
  } catch (error) {
    console.error('[AudioDebug] ⚠️  Error checking debug flag:', error);
  }
}

/**
 * Save debug audio as WAV file
 * Converts accumulated PCM16 chunks to standard WAV format
 */
async function saveDebugAudio(source: 'mic' | 'system', chunks: Int16Array[], sessionId: string): Promise<void> {
  try {
    // Concatenate all chunks into single buffer
    const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const audioData = new Int16Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      audioData.set(chunk, offset);
      offset += chunk.length;
    }
    
    // Create WAV file buffer
    const wavBuffer = createWavBuffer(audioData, SAMPLE_RATE, 1);
    
    // Save via IPC to main process (has file system access)
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc?.send) {
      const filename = `${sessionId}_${source}.wav`;
      eviaIpc.send('audio-debug:save', {
        filename,
        buffer: Array.from(new Uint8Array(wavBuffer))  // Convert to array for IPC
      });
      console.log(`[AudioDebug] 💾 Saved ${source} audio: ${filename} (${(wavBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      console.error('[AudioDebug] ❌ IPC not available for saving audio');
    }
  } catch (error) {
    console.error(`[AudioDebug] ❌ Failed to save ${source} audio:`, error);
  }
}

/**
 * Create WAV file buffer from PCM16 audio data
 * Standard WAV format with RIFF header
 */
function createWavBuffer(audioData: Int16Array, sampleRate: number, numChannels: number): ArrayBuffer {
  const bytesPerSample = 2; // 16-bit = 2 bytes
  const dataSize = audioData.length * bytesPerSample;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  
  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);  // File size - 8
  writeString(view, 8, 'WAVE');
  
  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);  // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);   // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);  // ByteRate
  view.setUint16(32, numChannels * bytesPerSample, true);  // BlockAlign
  view.setUint16(34, 16, true);  // BitsPerSample
  
  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write PCM data
  const dataView = new Int16Array(buffer, headerSize);
  dataView.set(audioData);
  
  return buffer;
}

/**
 * Helper: Write string to DataView
 */
function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// WINDOWS FIX (2025-12-05): Pipeline Metrics for diagnostics
// Exposed to DevTools via window.eviaPipelineMetrics and window.eviaHealthCheck()
// ──────────────────────────────────────────────────────────────────────────────
interface PipelineMetrics {
  sessionStart: number;
  micChunksSent: number;
  systemChunksSent: number;
  transcriptsReceived: number;
  errorsEncountered: number;
  lastMicChunkTime: number;
  lastSystemChunkTime: number;
  reconnectAttempts: number;
  platform: string;
}

const pipelineMetrics: PipelineMetrics = {
  sessionStart: 0,
  micChunksSent: 0,
  systemChunksSent: 0,
  transcriptsReceived: 0,
  errorsEncountered: 0,
  lastMicChunkTime: 0,
  lastSystemChunkTime: 0,
  reconnectAttempts: 0,
  platform: (typeof window !== 'undefined' && (window as any).platformInfo?.platform) || 'unknown'
};

// Expose for DevTools debugging
if (typeof window !== 'undefined') {
  (window as any).eviaPipelineMetrics = pipelineMetrics;
  
  // Also expose a health check function
  (window as any).eviaHealthCheck = () => {
    const now = Date.now();
    const sessionDuration = pipelineMetrics.sessionStart ? (now - pipelineMetrics.sessionStart) / 1000 : 0;
    const timeSinceMic = pipelineMetrics.lastMicChunkTime ? now - pipelineMetrics.lastMicChunkTime : null;
    const timeSinceSystem = pipelineMetrics.lastSystemChunkTime ? now - pipelineMetrics.lastSystemChunkTime : null;
    
    return {
      platform: pipelineMetrics.platform,
      sessionDuration: `${sessionDuration.toFixed(0)}s`,
      micChunks: pipelineMetrics.micChunksSent,
      systemChunks: pipelineMetrics.systemChunksSent,
      transcripts: pipelineMetrics.transcriptsReceived,
      errors: pipelineMetrics.errorsEncountered,
      reconnects: pipelineMetrics.reconnectAttempts,
      timeSinceMicChunk: timeSinceMic ? `${(timeSinceMic/1000).toFixed(1)}s` : 'never',
      timeSinceSystemChunk: timeSinceSystem ? `${(timeSinceSystem/1000).toFixed(1)}s` : 'never',
      healthy: timeSinceMic !== null && timeSinceMic < 2000
    };
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// WINDOWS FIX (2025-12-05): Enhanced WebSocket Health Check with AUTO-RECOVERY
// Detects stale connections and automatically attempts reconnection on Windows
// ──────────────────────────────────────────────────────────────────────────────
const WINDOWS_HEALTH_CHECK_INTERVAL = 5000; // Check every 5 seconds
const STALE_THRESHOLD_MS = 15000; // Consider stale after 15 seconds
const RECONNECT_COOLDOWN_MS = 10000; // Don't reconnect more than once per 10 seconds
// WINDOWS FIX (2025-12-09): Also track TRANSCRIPT reception, not just audio sending
// CRITICAL: Reduced from 30s to 15s for faster detection
const TRANSCRIPT_STALE_THRESHOLD_MS = 15000; // 15 seconds without transcripts = stale

let micHealthCheckTimer: ReturnType<typeof setInterval> | null = null;
let systemHealthCheckTimer: ReturnType<typeof setInterval> | null = null;
let lastMicWsActivity = Date.now();
let lastSystemWsActivity = Date.now();
let lastMicReconnectAttempt = 0;
let lastSystemReconnectAttempt = 0;
// WINDOWS FIX (2025-12-09): Track transcript reception separately
let lastTranscriptReceivedTime = Date.now();
let isActivelyCapturing = false; // Track if we're in an active capture session

// WINDOWS FIX: Function to update transcript activity (called when transcript received)
export function updateTranscriptActivity() {
  lastTranscriptReceivedTime = Date.now();
  console.log('[AudioCapture] 📨 Transcript activity updated');
}

/**
 * WINDOWS FIX: Enhanced WebSocket Health Check with AUTO-RECOVERY
 * Monitors connection liveness and triggers automatic reconnect if stale
 * 
 * 2025-12-09: CRITICAL FIX - Also monitors TRANSCRIPT reception!
 * Previous bug: Only checked if audio was being SENT, not if transcripts were being RECEIVED
 * This caused stalls to go undetected when backend stopped responding
 */
function startWindowsHealthCheck(wsInstance: any, source: 'mic' | 'system') {
  const isWindows = Boolean((window as any)?.platformInfo?.isWindows);
  if (!isWindows) return; // Only run on Windows
  
  console.log(`[AudioCapture] 🪟 Starting Windows health check for ${source} (enhanced auto-recovery + transcript monitoring)`);
  
  const timer = setInterval(async () => {
    try {
      const lastActivity = source === 'mic' ? lastMicWsActivity : lastSystemWsActivity;
      const lastReconnect = source === 'mic' ? lastMicReconnectAttempt : lastSystemReconnectAttempt;
      const timeSinceActivity = Date.now() - lastActivity;
      const timeSinceReconnect = Date.now() - lastReconnect;
      
      // WINDOWS FIX (2025-12-09): Also check transcript reception
      const timeSinceTranscript = Date.now() - lastTranscriptReceivedTime;
      
      // Log health status periodically
      if (timeSinceActivity > 5000 || (isActivelyCapturing && timeSinceTranscript > 10000)) {
        console.log(`[AudioCapture] 🪟 ${source.toUpperCase()} health: ${Math.round(timeSinceActivity/1000)}s since send, ${Math.round(timeSinceTranscript/1000)}s since transcript`);
      }
      
      // WINDOWS FIX (2025-12-09): Detect transcript stall
      // If we're actively capturing and audio is being sent but NO transcripts received for 30s
      const transcriptStall = isActivelyCapturing && 
                              timeSinceActivity < 5000 && // Audio IS being sent
                              timeSinceTranscript > TRANSCRIPT_STALE_THRESHOLD_MS; // But no transcripts
      
      // CRITICAL FIX: When transcript stalls, ALSO trigger reconnect!
      if (transcriptStall && timeSinceReconnect > RECONNECT_COOLDOWN_MS) {
        console.warn(`[AudioCapture] 🪟 🚨 TRANSCRIPT STALL DETECTED! Audio sending OK (${Math.round(timeSinceActivity/1000)}s) but NO transcripts for ${Math.round(timeSinceTranscript/1000)}s - RECONNECTING`);
        
        // Update reconnect timestamp BEFORE attempting
        if (source === 'mic') {
          lastMicReconnectAttempt = Date.now();
        } else {
          lastSystemReconnectAttempt = Date.now();
      }
      
        // Notify UI of transcript stall
        const eviaIpc = (window as any).evia?.ipc;
        if (eviaIpc?.send) {
          eviaIpc.send('debug-log', `[Recovery] 🚨 TRANSCRIPT STALL: ${Math.round(timeSinceTranscript/1000)}s - Reconnecting ${source} WebSocket`);
        }
        
        // Attempt reconnection for transcript stall
        if (wsInstance) {
          try {
            // Disconnect existing
            console.log(`[AudioCapture] 🪟 Disconnecting ${source} WebSocket due to TRANSCRIPT STALL...`);
            wsInstance.disconnect();
            
            // Wait a moment
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Reconnect
            console.log(`[AudioCapture] 🪟 Reconnecting ${source} WebSocket...`);
            await wsInstance.connect();
            
            // Reset BOTH activity timestamps on successful reconnect
            if (source === 'mic') {
              lastMicWsActivity = Date.now();
            } else {
              lastSystemWsActivity = Date.now();
            }
            lastTranscriptReceivedTime = Date.now(); // Reset transcript timer too
            
            console.log(`[AudioCapture] 🪟 ✅ ${source.toUpperCase()} WebSocket reconnected after transcript stall`);
            
            // Notify UI
            if (eviaIpc?.send) {
              eviaIpc.send('debug-log', `[Recovery] ✅ ${source} WebSocket reconnected after transcript stall`);
            }
          } catch (reconnectErr) {
            console.error(`[AudioCapture] 🪟 ❌ ${source} reconnect failed after transcript stall:`, reconnectErr);
            
            // Notify UI of failure
            if (eviaIpc?.send) {
              eviaIpc.send('debug-log', `[Recovery] ❌ ${source} WebSocket reconnect FAILED: ${reconnectErr}`);
            }
          }
        }
        
        // Skip the regular stale check since we just handled it
        return;
      }
      
      // If stale (audio not being sent) and not in cooldown, attempt reconnect
      if (timeSinceActivity > STALE_THRESHOLD_MS && timeSinceReconnect > RECONNECT_COOLDOWN_MS) {
        console.warn(`[AudioCapture] 🪟 ${source.toUpperCase()} WebSocket STALE (${Math.round(timeSinceActivity/1000)}s) - INITIATING AUTO-RECOVERY`);
        
        // Update reconnect timestamp
        if (source === 'mic') {
          lastMicReconnectAttempt = Date.now();
        } else {
          lastSystemReconnectAttempt = Date.now();
        }
        
        // Attempt reconnection
        if (wsInstance) {
          try {
            // Disconnect existing
            console.log(`[AudioCapture] 🪟 Disconnecting stale ${source} WebSocket...`);
            wsInstance.disconnect();
            
            // Wait a moment
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Reconnect
            console.log(`[AudioCapture] 🪟 Reconnecting ${source} WebSocket...`);
            await wsInstance.connect();
            
            // Reset activity timestamp on successful reconnect
            if (source === 'mic') {
              lastMicWsActivity = Date.now();
            } else {
              lastSystemWsActivity = Date.now();
            }
            
            console.log(`[AudioCapture] 🪟 ✅ ${source.toUpperCase()} WebSocket reconnected successfully`);
            
            // Notify UI
            const eviaIpc = (window as any).evia?.ipc;
            if (eviaIpc?.send) {
              eviaIpc.send('debug-log', `[Recovery] ${source} WebSocket reconnected after stall`);
            }
          } catch (reconnectErr) {
            console.error(`[AudioCapture] 🪟 ❌ ${source} reconnect failed:`, reconnectErr);
            
            // Notify UI of failure
            const eviaIpc = (window as any).evia?.ipc;
            if (eviaIpc?.send) {
              eviaIpc.send('debug-log', `[Recovery] ${source} WebSocket reconnect FAILED: ${reconnectErr}`);
            }
          }
        }
      }
      // Send keepalive ping even when healthy
      else if (wsInstance?.sendMessage && wsInstance?.isConnected?.()) {
        try {
          wsInstance.sendMessage({ command: 'ping' });
        } catch (pingErr) {
          // Ignore ping errors silently
        }
      }
    } catch (err) {
      console.error(`[AudioCapture] 🪟 Health check error for ${source}:`, err);
    }
  }, WINDOWS_HEALTH_CHECK_INTERVAL);
  
  if (source === 'mic') {
    micHealthCheckTimer = timer;
  } else {
    systemHealthCheckTimer = timer;
  }
}

function stopWindowsHealthCheck(source: 'mic' | 'system') {
  if (source === 'mic' && micHealthCheckTimer) {
    clearInterval(micHealthCheckTimer);
    micHealthCheckTimer = null;
    console.log('[AudioCapture] 🪟 Stopped mic health check');
  } else if (source === 'system' && systemHealthCheckTimer) {
    clearInterval(systemHealthCheckTimer);
    systemHealthCheckTimer = null;
    console.log('[AudioCapture] 🪟 Stopped system health check');
  }
}

function updateWsActivity(source: 'mic' | 'system') {
  const now = Date.now();
  if (source === 'mic') {
    lastMicWsActivity = now;
  } else {
    lastSystemWsActivity = now;
  }
}

// Mic audio state
let micWsInstance: any = null;
let micAudioContext: AudioContext | null = null;
let micAudioProcessor: ScriptProcessorNode | null = null;
let micStream: MediaStream | null = null;
let micWsDisconnectedLogged: boolean = false; // FIX: Prevent spam logging

// System audio state  
let systemWsInstance: any = null;
let systemAudioContext: AudioContext | null = null;
let systemAudioProcessor: ScriptProcessorNode | null = null;
let systemStream: MediaStream | null = null;

// ──────────────────────────────────────────────────────────────────────────────
// AEC (Acoustic Echo Cancellation) - Glass Parity with Speex WASM
// ──────────────────────────────────────────────────────────────────────────────
let aecModPromise: Promise<any> | null = null;
let aecMod: any = null;
let aecPtr: number = 0;

// System audio buffer for AEC reference (Ring buffer with time-delayed chunks)
// Size: Limited to AEC_RING_BUFFER_SIZE for proper acoustic delay compensation
let systemAudioBuffer: Array<{ data: string; timestamp: number }> = [];
const MAX_SYSTEM_BUFFER_SIZE = AEC_RING_BUFFER_SIZE;

// ──────────────────────────────────────────────────────────────────────────────
// WINDOWS FIX (2025-12-05): Buffer Maintenance to prevent memory pressure
// On Windows, long sessions can accumulate buffer memory causing stalls
// ──────────────────────────────────────────────────────────────────────────────
let lastBufferClearTime = Date.now();
const BUFFER_CLEAR_INTERVAL_MS = 45000; // 45 seconds for Windows (more aggressive than 60s)
const isWindowsPlatformGlobal = typeof window !== 'undefined' && Boolean((window as any)?.platformInfo?.isWindows);

/**
 * WINDOWS FIX: Perform periodic buffer maintenance
 * Maintains ring buffer size for time-aligned AEC reference
 */
function performBufferMaintenance() {
  const now = Date.now();
  if (now - lastBufferClearTime > BUFFER_CLEAR_INTERVAL_MS) {
    // Keep ring buffer size for time-aligned AEC
    if (systemAudioBuffer.length > AEC_RING_BUFFER_SIZE) {
      const oldLength = systemAudioBuffer.length;
      systemAudioBuffer = systemAudioBuffer.slice(-AEC_RING_BUFFER_SIZE);
      console.log(`[AudioCapture] 🧹 Buffer maintenance: cleared ${oldLength - AEC_RING_BUFFER_SIZE} old chunks, kept ${systemAudioBuffer.length}`);
    }
    lastBufferClearTime = now;
    
    // Log memory health check
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      const mem = (performance as any).memory;
      const usedMB = Math.round(mem.usedJSHeapSize / 1024 / 1024);
      const totalMB = Math.round(mem.totalJSHeapSize / 1024 / 1024);
      console.log(`[AudioCapture] 🧹 Memory: ${usedMB}MB / ${totalMB}MB`);
    }
  }
}

/**
 * 🎯 AEC WASM Module Loader - Glass Parity
 * Loads Speex AEC WASM module once and caches it
 */
async function getAec(): Promise<any> {
  if (aecModPromise) return aecModPromise; // Cache hit

  aecModPromise = (async () => {
    try {
      // Dynamic import of AEC WASM module (ES6 import for browser compatibility)
      const aecModule = await import('./aec/aec.js');
      const createAecModule = aecModule.default || aecModule;
      const M: any = await createAecModule();
      
      // STEP 2: Verify heap buffers exist (critical for AEC to work)
      if (!M.HEAPU8) {
        console.error('[AEC] ❌ WASM loaded but HEAPU8 buffer missing!');
        return null;
      }
      if (!M.HEAP16) {
        console.error('[AEC] ❌ WASM loaded but HEAP16 buffer missing!');
        return null;
      }
      
      aecMod = M;
      console.log('[AEC] ✅ WASM Module Loaded (with heap buffers verified)');
      
      // Bind C symbols to JS wrappers (once)
      M.newPtr = M.cwrap('AecNew', 'number', ['number', 'number', 'number', 'number']);
      M.cancel = M.cwrap('AecCancelEcho', null, ['number', 'number', 'number', 'number', 'number']);
      M.destroy = M.cwrap('AecDestroy', null, ['number']);
      
      return M;
    } catch (error) {
      console.error('[AEC] ❌ Failed to load WASM module:', error);
      console.error('[AEC] ❌ Error details:', error);
      // Don't throw - allow audio capture to continue without AEC
      return null;
    }
  })();

  return aecModPromise;
}

/**
 * 🎯 AEC Disposal - Glass Parity
 * Destroys the AEC instance when done
 */
function disposeAec() {
  if (aecPtr && aecMod && aecMod.destroy) {
    aecMod.destroy(aecPtr);
    aecPtr = 0;
    console.log('[AEC] ✅ AEC instance destroyed');
  }
}

/**
 * 🎯 JS ↔︎ WASM Helper - Convert Float32 to Int16 pointer
 */
function int16PtrFromFloat32(mod: any, f32: Float32Array): { ptr: number; view: Int16Array } {
  const len = f32.length;
  const bytes = len * 2;
  const ptr = mod._malloc(bytes);
  
  // HEAP16 wrapper (fallback to HEAPU8.buffer if not available)
  const heapBuf = mod.HEAP16 ? mod.HEAP16.buffer : mod.HEAPU8.buffer;
  const i16 = new Int16Array(heapBuf, ptr, len);
  
  for (let i = 0; i < len; ++i) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  return { ptr, view: i16 };
}

/**
 * 🎯 JS ↔︎ WASM Helper - Convert Int16 view to Float32
 */
function float32FromInt16View(i16: Int16Array): Float32Array {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; ++i) {
    out[i] = i16[i] / 32768;
  }
  return out;
}

/**
 * 🎯 Convert base64 PCM to Float32Array - Glass Parity
 */
function base64ToFloat32Array(base64: string): Float32Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const int16Array = new Int16Array(bytes.buffer);
  const float32Array = new Float32Array(int16Array.length);
  
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }
  
  return float32Array;
}

/**
 * 🎯 Run AEC Synchronously - Glass Parity
 * Applies Speex AEC to remove system audio echo from mic input
 * 
 * @param micF32 - Microphone audio (Float32Array, 2400 samples)
 * @param sysF32 - System audio reference (Float32Array, 2400 samples)
 * @returns Processed audio with echo removed (Float32Array, 2400 samples)
 */
function runAecSync(micF32: Float32Array, sysF32: Float32Array): Float32Array {
  // STEP 2: Enhanced AEC verification - check module, instance, AND heap
  if (!aecMod || !aecPtr || !aecMod.HEAPU8 || !aecMod.HEAP16) {
    // Only warn once to avoid log spam (use window instead of global for browser/renderer)
    const globalAny = (typeof window !== 'undefined' ? window : global) as any;
    if (!globalAny.aecWarnedOnce) {
      console.warn('[AEC] ⚠️  AEC not initialized - missing:', {
        hasModule: !!aecMod,
        hasInstance: !!aecPtr,
        hasHEAPU8: !!(aecMod && aecMod.HEAPU8),
        hasHEAP16: !!(aecMod && aecMod.HEAP16)
      });
      globalAny.aecWarnedOnce = true;
    }
    return micF32;
  }

  const frameSize = 160; // AEC frame size (matches initialization: 160 samples @ 24kHz)
  const numFrames = Math.floor(micF32.length / frameSize);

  // Final processed audio buffer
  const processedF32 = new Float32Array(micF32.length);

  // Align system audio with mic audio length (for stability)
  const alignedSysF32 = new Float32Array(micF32.length);
  if (sysF32.length > 0) {
    const lengthToCopy = Math.min(micF32.length, sysF32.length);
    alignedSysF32.set(sysF32.slice(0, lengthToCopy));
  }

  // Process 2400 samples in 160-sample frames
  for (let i = 0; i < numFrames; i++) {
    const offset = i * frameSize;

    // Extract 160-sample frames
    const micFrame = micF32.subarray(offset, offset + frameSize);
    const echoFrame = alignedSysF32.subarray(offset, offset + frameSize);

    // Write frames to WASM memory
    const micPtr = int16PtrFromFloat32(aecMod, micFrame);
    const echoPtr = int16PtrFromFloat32(aecMod, echoFrame);
    const outPtr = aecMod._malloc(frameSize * 2); // 160 * 2 bytes

    // Run AEC (160 samples at a time)
    aecMod.cancel(aecPtr, micPtr.ptr, echoPtr.ptr, outPtr, frameSize);

    // Read processed frame from WASM memory
    const heapBuf = aecMod.HEAP16 ? aecMod.HEAP16.buffer : aecMod.HEAPU8.buffer;
    const outFrameI16 = new Int16Array(heapBuf, outPtr, frameSize);
    const outFrameF32 = float32FromInt16View(outFrameI16);

    // Copy processed frame to final buffer at correct position
    processedF32.set(outFrameF32, offset);

    // Free allocated memory
    aecMod._free(micPtr.ptr);
    aecMod._free(echoPtr.ptr);
    aecMod._free(outPtr);
  }

  return processedF32;
}

// Ensure WebSocket for microphone (source=mic, speaker=1)
function ensureMicWs() {
  try {
    const cid = (localStorage.getItem('current_chat_id') || '0').toString();
    if (!cid || cid === '0') {
      console.error('[AudioCapture] No chat_id available');
      return null;
    }
    if (!micWsInstance) {
      console.log('[AudioCapture] Creating mic WebSocket (source=mic, speaker=1)');
      micWsInstance = getWebSocketInstance(cid, 'mic');
      
      // WINDOWS FIX: Start health check for Windows
      startWindowsHealthCheck(micWsInstance, 'mic');
      
      // FIX: Forward all transcript messages to Listen window via IPC
      // TAG with source so ListenView can infer speaker for status messages
      console.log('[AudioCapture] REGISTERING MIC MESSAGE HANDLER');
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) {
        eviaIpc.send('debug-log', '[AudioCapture] 🔥 MIC HANDLER REGISTERED');
      }
      
      micWsInstance.onMessage((msg: any) => {
        // WINDOWS FIX: Update activity timestamp on any message
        updateWsActivity('mic');
        
        console.log('[AudioCapture] 🔥 MIC MESSAGE RECEIVED:', msg.type, msg);
        if (eviaIpc?.send) {
          eviaIpc.send('debug-log', `[AudioCapture] 🔥 MIC MSG: ${msg.type}`);
          // Log full error content for debugging
          if (msg.type === 'error') {
            eviaIpc.send('debug-log', `[AudioCapture] ❌ MIC ERROR DATA: ${JSON.stringify(msg.data || msg)}`);
          }
        }
        
        if (msg.type === 'transcript_segment' || msg.type === 'status') {
          // WINDOWS FIX (2025-12-09): Track transcript reception for stall detection
          if (msg.type === 'transcript_segment') {
            updateTranscriptActivity();
          }
          
          console.log('[AudioCapture] Forwarding MIC message to Listen window:', msg.type);
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', `[AudioCapture] 🔥 FORWARDING MIC ${msg.type} via IPC`);
            // Tag message with _source: 'mic' (speaker 1)
            eviaIpc.send('transcript-message', { ...msg, _source: 'mic' });
            console.log('[AudioCapture] ✅ MIC transcript forwarded via IPC');
            eviaIpc.send('debug-log', `[AudioCapture] ✅ MIC ${msg.type} FORWARDED to Listen window`);
          } else {
            console.error('[AudioCapture] ❌ IPC not available for forwarding');
            eviaIpc.send('debug-log', '[AudioCapture] ❌ IPC NOT AVAILABLE!');
          }
        } else {
          console.log('[AudioCapture] ⚠️ MIC message type not transcript/status, skipping:', msg.type);
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', `[AudioCapture] ⚠️ MIC MSG TYPE: ${msg.type} (not transcript/status)`);
          }
        }
      });
    }
    return micWsInstance;
  } catch (error) {
    console.error('[AudioCapture] Failed to get mic WS instance:', error);
    return null;
  }
}

// Ensure WebSocket for system audio (source=system, speaker=0)
function ensureSystemWs(chatId?: string) {
  try {
    // FIX: Use provided chatId or fall back to localStorage
    const cid = chatId || (localStorage.getItem('current_chat_id') || '0').toString();
    if (!cid || cid === '0') {
      console.error('[AudioCapture] ❌ No chat_id available for system audio WebSocket');
      console.error('[AudioCapture] Ensure getOrCreateChatId() is called before startCapture()');
      return null;
    }
    if (!systemWsInstance) {
      console.log('[AudioCapture] Creating system WebSocket (source=system, speaker=0) with chat_id:', cid);
      systemWsInstance = getWebSocketInstance(cid, 'system');
      
      // WINDOWS FIX: Start health check for Windows
      startWindowsHealthCheck(systemWsInstance, 'system');

      // FIX: Forward all transcript messages to Listen window via IPC
      // TAG with source so ListenView can infer speaker for status messages
      console.log('[AudioCapture] 🟢 REGISTERING SYSTEM MESSAGE HANDLER');
      const eviaIpc = (window as any).evia?.ipc;
      
      systemWsInstance.onMessage((msg: any) => {
        // WINDOWS FIX: Update activity timestamp on any message
        updateWsActivity('system');
        
        console.log('[AudioCapture] 🟢 SYSTEM MESSAGE RECEIVED:', msg.type);
        
        // Log full error content for debugging
        if (msg.type === 'error' && eviaIpc?.send) {
          eviaIpc.send('debug-log', `[AudioCapture] ❌ SYSTEM ERROR DATA: ${JSON.stringify(msg.data || msg)}`);
        }
        
        if (msg.type === 'transcript_segment' || msg.type === 'status') {
          // WINDOWS FIX (2025-12-09): Track transcript reception for stall detection
          if (msg.type === 'transcript_segment') {
            updateTranscriptActivity();
          }
          
          console.log('[AudioCapture] Forwarding SYSTEM message to Listen window:', msg.type);
          // Forward to Listen window via IPC with source tag
          if (eviaIpc?.send) {
            // Tag message with _source: 'system' (speaker 0)
            eviaIpc.send('transcript-message', { ...msg, _source: 'system' });
            console.log('[AudioCapture] ✅ SYSTEM transcript forwarded via IPC');
          }
        }
      });
    }
    return systemWsInstance;
  } catch (error) {
    console.error('[AudioCapture] Failed to get system WS instance:', error);
    return null;
  }
}

// Glass parity: Convert Float32 to Int16 PCM
function convertFloat32ToInt16(float32Array: Float32Array): Int16Array {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}

// Glass parity: Setup microphone processing with ScriptProcessorNode + AEC
async function setupMicProcessing(stream: MediaStream) {
  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2: Load AEC WASM module first (Glass parity) - with enhanced verification
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const mod = await getAec();
    if (mod && !aecPtr) {
      // Create AEC instance with verified parameters
      aecPtr = mod.newPtr(160, 1600, 24000, 1);
      
      // STEP 2: Verify instance was actually created
      if (aecPtr && aecPtr > 0) {
        console.log('[AEC] ✅ AEC instance created (ptr=' + aecPtr + ', frameSize=160, filterLength=1600, sampleRate=24000)');
        console.log('[AEC] ✅ Heap buffers verified: HEAPU8=' + !!mod.HEAPU8 + ', HEAP16=' + !!mod.HEAP16);
      } else {
        console.error('[AEC] ❌ AEC instance creation failed - newPtr returned invalid pointer');
        aecPtr = 0;
      }
    } else if (!mod) {
      console.warn('[AEC] ⚠️  AEC module failed to load - continuing without echo cancellation');
    }
  } catch (error) {
    console.error('[AEC] ❌ AEC initialization exception - continuing without echo cancellation:', error);
    aecPtr = 0;
  }
  
  const micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  const micSource = micAudioContext.createMediaStreamSource(stream);
  const micProcessor = micAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

  let audioBuffer: number[] = [];
  const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION; // 2400 samples
  
  // Silence gate - RMS threshold to prevent sending ambient noise
  // WINDOWS FIX: Lowered Windows threshold from 0.013 to 0.010
  // Higher threshold was too aggressive and blocked legitimate quiet audio
  let SILENCE_RMS_THRESHOLD = 0.01; // default for Mac
  try {
    const isWindows = Boolean((window as any)?.platformInfo?.isWindows);
    if (isWindows) {
      SILENCE_RMS_THRESHOLD = 0.010; // FIXED: Was 0.013, now matches Mac threshold
      console.log('[AudioCapture] 🪟 Windows detected - using silence threshold:', SILENCE_RMS_THRESHOLD);
    }
  } catch {}
    let silenceFrameCount = 0;

  let frameCounter = 0;
  let totalAudioLevel = 0;
  let silentFrames = 0;
  let chunkCount = 0; // Track chunks sent for logging
  
  micProcessor.onaudioprocess = (e) => {
    // CRITICAL FIX: NO ALERTS IN AUDIO CALLBACK! (blocks audio thread)
    // Log diagnostic info instead
    if (frameCounter === 0) {
      console.log('[MIC-DIAGNOSTIC] 🎤 onaudioprocess FIRING! First frame received!');
      try {
        const eviaIpc = (window as any).evia?.ipc;
        if (eviaIpc?.send) {
          eviaIpc.send('debug-log', '[MIC-DIAGNOSTIC] 🎤 onaudioprocess FIRING! First frame received!');
        }
      } catch (e) {
        // Ignore
      }
    }
    
    const inputData = e.inputBuffer.getChannelData(0);
    
    // 🎤 DIAGNOSTIC: Check audio level every 50 frames
    frameCounter++;
    let sum = 0;
    for (let i = 0; i < inputData.length; i++) {
      sum += Math.abs(inputData[i]);
    }
    const avgLevel = sum / inputData.length;
    totalAudioLevel += avgLevel;
    
    if (avgLevel < 0.001) {
      silentFrames++;
    }
    
    if (frameCounter % 50 === 0) {
      const avgAudioLevel = totalAudioLevel / frameCounter;
      const silencePercent = (silentFrames / frameCounter * 100).toFixed(1);
      console.log(`[MIC-DIAGNOSTIC] Frame ${frameCounter}: avg level=${avgAudioLevel.toFixed(5)}, silent=${silencePercent}%, current=${avgLevel.toFixed(5)}`);
      
      if (avgAudioLevel < 0.0001) {
        console.warn(`[MIC-DIAGNOSTIC] ⚠️  Mic audio is very quiet or silent! Check permissions and mic settings.`);
      }
    }
    
    // TypeScript compat: use Array.from instead of spread
    for (let i = 0; i < inputData.length; i++) {
      audioBuffer.push(inputData[i]);
    }

    // Send when we have enough samples
    while (audioBuffer.length >= samplesPerChunk) {
      // WINDOWS FIX: Perform periodic buffer maintenance to prevent memory pressure
      if (isWindowsPlatformGlobal) {
        performBufferMaintenance();
      }
      
      const chunk = audioBuffer.splice(0, samplesPerChunk);
      let float32Chunk = new Float32Array(chunk); // Initial value (may be replaced by AEC)
      
      // ──────────────────────────────────────────────────────────────────────
      // STEP 2: Apply TIME-ALIGNED AEC (Acoustic Delay Compensation)
      // ──────────────────────────────────────────────────────────────────────
      if (systemAudioBuffer.length > 0) {
        try {
          // FIX: Use time-delayed reference for AEC
          // The mic hears system audio from AEC_LATENCY_MS ago (acoustic delay)
          // We must use the corresponding historical system audio chunk
          const delayedIndex = Math.max(0, systemAudioBuffer.length - Math.ceil(AEC_LATENCY_MS / 100));
          const referenceChunk = systemAudioBuffer[delayedIndex];
          const sysF32 = base64ToFloat32Array(referenceChunk.data);
          
          const now = Date.now();
          const referenceAge = now - referenceChunk.timestamp;
          
          // Run AEC with time-aligned reference
          const originalChunk = new Float32Array(chunk);
          const aecResult = runAecSync(originalChunk, sysF32);
          float32Chunk = new Float32Array(aecResult);
          
          // Verify AEC actually processed
          if (float32Chunk !== originalChunk && aecMod && aecPtr) {
            console.log(`[AEC] ✅ Time-aligned AEC applied (reference age: ${referenceAge}ms, target: ${AEC_LATENCY_MS}ms)`);
          }
        } catch (error) {
          console.error('[AEC] ❌ AEC processing failed, using unprocessed audio:', error);
          // Fall back to unprocessed audio on AEC error
        }
      }
      
      // ──────────────────────────────────────────────────────────────────────
      // STEP 3: Convert to PCM16 first (needed for both debug recorder AND backend)
      // ──────────────────────────────────────────────────────────────────────
      const pcm16 = convertFloat32ToInt16(float32Chunk);
      
      // ──────────────────────────────────────────────────────────────────────
      // STEP 4: Calculate RMS for logging (SILENCE GATE DISABLED)
      // ──────────────────────────────────────────────────────────────────────
      let sumSquares = 0;
      for (let i = 0; i < float32Chunk.length; i++) {
        sumSquares += float32Chunk[i] * float32Chunk[i];
      }
      const rms = Math.sqrt(sumSquares / float32Chunk.length);
      
      // SILENCE GATE DISABLED - Causes audio cuts and maltranscription
      // Previously: if (rms < 0.01) continue; was dropping quiet speech chunks
      // Result: Gaps in audio → missing words in transcription
      // Solution: Send ALL audio to Deepgram, let their VAD handle silence detection
      
      // ──────────────────────────────────────────────────────────────────────
      // STEP 5: Send to backend (pcm16 already converted above)
      // ──────────────────────────────────────────────────────────────────────
      
      // 🎙️ AUDIO DEBUG: Save chunk for later WAV export
      if (DEBUG_SAVE_AUDIO) {
        debugAudioBuffers.mic.push(new Int16Array(pcm16));
      }
      
      // v1.0.0 FIX: Direct WebSocket send (no IPC routing!)
      // Taylos uses renderer-based WebSockets (unlike Glass which uses main process)
      const ws = ensureMicWs();
      // CRITICAL FIX: Verify WebSocket is actually connected before sending
      if (ws && ws.isConnected() && ws.sendBinaryData) {
        try {
          ws.sendBinaryData(pcm16.buffer);
          // WINDOWS FIX: Update activity on successful send
          updateWsActivity('mic');
          chunkCount++;
          
          // WINDOWS FIX: Track pipeline metrics
          pipelineMetrics.micChunksSent++;
          pipelineMetrics.lastMicChunkTime = Date.now();
          
          // Log status every 100 chunks for monitoring
          if (pipelineMetrics.micChunksSent % 100 === 0) {
            const elapsed = (Date.now() - pipelineMetrics.sessionStart) / 1000;
            console.log(`[Pipeline] Status: ${pipelineMetrics.micChunksSent} mic chunks, ${pipelineMetrics.systemChunksSent} system chunks, ${elapsed.toFixed(0)}s elapsed, platform=${pipelineMetrics.platform}`);
          }
          
          // ULTRA-CRITICAL: Log EVERY chunk send for diagnosis
          console.log(`[AudioCapture] Sent MIC chunk #${chunkCount}: ${pcm16.byteLength} bytes (RMS: ${rms.toFixed(4)}, AEC: ${systemAudioBuffer.length > 0 ? 'YES' : 'NO'})`);
          // Forward to Ask console
          try {
            const eviaIpc = (window as any).evia?.ipc;
            if (eviaIpc?.send) {
              eviaIpc.send('debug-log', `[AudioCapture] 📤 SENT MIC CHUNK #${chunkCount}: ${pcm16.byteLength} bytes, RMS: ${rms.toFixed(4)}`);
            }
          } catch {}
        } catch (error) {
          console.error('[AudioCapture] ❌ Failed to send MIC chunk:', error);
          try {
            const eviaIpc = (window as any).evia?.ipc;
            if (eviaIpc?.send) {
              eviaIpc.send('debug-log', `[AudioCapture] ❌ SEND FAILED: ${error}`);
            }
          } catch {}
        }
      } else if (ws && !ws.isConnected()) {
        // WebSocket exists but disconnected - log warning (avoid spam)
        if (!micWsDisconnectedLogged) {
          console.error('[AudioCapture] ❌ Mic WebSocket disconnected - cannot send audio data');
          try {
            const eviaIpc = (window as any).evia?.ipc;
            if (eviaIpc?.send) {
              eviaIpc.send('debug-log', '[AudioCapture] ❌ MIC WS DISCONNECTED!');
            }
          } catch {}
          micWsDisconnectedLogged = true;
        }
      } else {
        console.error('[AudioCapture] ❌ Mic WebSocket not ready');
        try {
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', '[AudioCapture] ❌ MIC WS NOT READY!');
          }
        } catch {}
      }
    }
  };

  micSource.connect(micProcessor);
  micProcessor.connect(micAudioContext.destination); // Required for processing to work!

  console.log('[AudioCapture] 🔊 Mic audio processing setup complete');
  console.log('[AudioCapture] 🔊 AudioContext state:', micAudioContext.state);
  console.log('[AudioCapture] 🔊 Sample rate:', micAudioContext.sampleRate);
  console.log('[AudioCapture] 🔊 Processor connected:', !!micProcessor);
  
  // CRITICAL: Forward diagnostics to Ask console
  try {
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc?.send) {
      eviaIpc.send('debug-log', `[AudioCapture] 🔊 Mic setup complete - context state: ${micAudioContext.state}`);
      eviaIpc.send('debug-log', `[AudioCapture] 🔊 Waiting for onaudioprocess to fire...`);
    }
  } catch (e) {
    // Ignore
  }

  return { context: micAudioContext, processor: micProcessor };
}

// Glass parity: Setup system audio processing with ScriptProcessorNode
function setupSystemAudioProcessing(stream: MediaStream) {
  const sysAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  const sysSource = sysAudioContext.createMediaStreamSource(stream);
  const sysProcessor = sysAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

  let audioBuffer: number[] = [];
  const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION; // 2400 samples

  sysProcessor.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    
    // Check if actually receiving audio
    const hasSound = inputData.some(sample => Math.abs(sample) > 0.01);
    if (!hasSound) {
      console.warn('[AudioCapture] System audio data is silent!');
    }
    
    // TypeScript compat: use Array.from instead of spread
    for (let i = 0; i < inputData.length; i++) {
      audioBuffer.push(inputData[i]);
    }

    // Send when we have enough samples
    while (audioBuffer.length >= samplesPerChunk) {
      const chunk = audioBuffer.splice(0, samplesPerChunk);
      const float32Chunk = new Float32Array(chunk);
      const pcm16 = convertFloat32ToInt16(float32Chunk);
      
      // ──────────────────────────────────────────────────────────────────────
      // AEC INTEGRATION: Store system audio in buffer for AEC reference
      // ──────────────────────────────────────────────────────────────────────
      // Convert PCM16 to base64 for storage (Glass parity)
      const arrayBuffer = pcm16.buffer;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = btoa(binary);
      
      // Add to system audio buffer (for AEC reference)
      systemAudioBuffer.push({
        data: base64Data,
        timestamp: Date.now(),
      });
      
      // Limit buffer size to prevent memory bloat
      if (systemAudioBuffer.length > MAX_SYSTEM_BUFFER_SIZE) {
        systemAudioBuffer.shift(); // Remove oldest chunk
      }
      
      console.log(`[AudioCapture] 🔊 System audio buffer: ${systemAudioBuffer.length}/${MAX_SYSTEM_BUFFER_SIZE} chunks`);
      
      // ──────────────────────────────────────────────────────────────────────
      // Send system audio to backend
      // ──────────────────────────────────────────────────────────────────────
      
      // 🎙️ AUDIO DEBUG: Save chunk for later WAV export
      if (DEBUG_SAVE_AUDIO) {
        debugAudioBuffers.system.push(new Int16Array(pcm16));
      }
      
      const chatId = localStorage.getItem('current_chat_id') || undefined;
      const ws = ensureSystemWs(chatId);
      if (ws && ws.sendBinaryData) {
        try {
          ws.sendBinaryData(pcm16.buffer);
          // WINDOWS FIX: Update activity on successful send
          updateWsActivity('system');
          
          // WINDOWS FIX: Track pipeline metrics
          pipelineMetrics.systemChunksSent++;
          pipelineMetrics.lastSystemChunkTime = Date.now();
          
          console.log(`[AudioCapture] Sent SYSTEM chunk: ${pcm16.byteLength} bytes`);
        } catch (error) {
          console.error('[AudioCapture] Failed to send SYSTEM chunk:', error);
          pipelineMetrics.errorsEncountered++;
        }
      } else {
        console.error('[AudioCapture] System WebSocket not ready');
      }
    }
  };

  sysSource.connect(sysProcessor);
  sysProcessor.connect(sysAudioContext.destination); // Required for processing to work!

  return { context: sysAudioContext, processor: sysProcessor };
}

// v1.0.0 FIX: No IPC routing needed for mic audio
// Taylos uses renderer-based WebSockets (direct send from onaudioprocess)

// Glass parity: Start capture with explicit permission checks
export async function startCapture(includeSystemAudio = false) {
  console.log(`[AudioCapture] Starting capture (Glass parity: ScriptProcessorNode)... includeSystemAudio=${includeSystemAudio}`);
  
  // AUDIO DEBUG: Check IMMEDIATELY at function start
  console.log('[AudioDebug] ═══════════════════════════════════════');
  console.log('[AudioDebug] 🔍 CHECKING DEBUG FLAG NOW...');
  console.log('[AudioDebug] ═══════════════════════════════════════');
  
  try {
    const evia = (window as any).evia;
    console.log('[AudioDebug] window.evia exists?', !!evia);
    console.log('[AudioDebug] window.evia.checkDebugFlag exists?', !!evia?.checkDebugFlag);
    
    if (evia && evia.checkDebugFlag) {
      const enabled = await evia.checkDebugFlag();
      DEBUG_SAVE_AUDIO = enabled === true;
      debugFlagChecked = true;
      
      console.log('[AudioDebug] Flag check result:', enabled);
      console.log('[AudioDebug] DEBUG_SAVE_AUDIO set to:', DEBUG_SAVE_AUDIO);
      
      if (DEBUG_SAVE_AUDIO) {
        debugSessionId = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        debugAudioBuffers = { mic: [], system: [] };
        
        console.log('[AudioDebug] ✅ ✅ ✅ AUDIO DEBUG RECORDING ENABLED ✅ ✅ ✅');
        console.log('[AudioDebug] 💾 Files will save to: ~/Desktop/taylos-audio-debug/');
        console.log('[AudioDebug] 🎙️ Session ID:', debugSessionId);
        console.log('[AudioDebug] ═══════════════════════════════════════');
      } else {
        console.log('[AudioDebug] ❌ Debug flag file NOT FOUND');
        console.log('[AudioDebug] To enable: touch ~/Desktop/Taylos_DEBUG_AUDIO');
        console.log('[AudioDebug] ═══════════════════════════════════════');
      }
    } else {
      console.log('[AudioDebug] ❌ window.evia.checkDebugFlag NOT AVAILABLE');
      console.log('[AudioDebug] ═══════════════════════════════════════');
    }
  } catch (error) {
    console.error('[AudioDebug] ❌ ERROR checking flag:', error);
    console.log('[AudioDebug] ═══════════════════════════════════════');
  }
  
  // WINDOWS FIX (2025-12-09): Mark capture as active for transcript stall detection
  isActivelyCapturing = true;
  lastTranscriptReceivedTime = Date.now(); // Reset transcript timer
  
  // WINDOWS FIX: Reset pipeline metrics for new session
  pipelineMetrics.sessionStart = Date.now();
  pipelineMetrics.micChunksSent = 0;
  pipelineMetrics.systemChunksSent = 0;
  pipelineMetrics.errorsEncountered = 0;
  pipelineMetrics.lastMicChunkTime = 0;
  pipelineMetrics.lastSystemChunkTime = 0;
  pipelineMetrics.platform = (window as any).platformInfo?.platform || 'unknown';
  console.log(`[Pipeline] Session started - platform=${pipelineMetrics.platform}`);
  
  // CRITICAL: Also log to Ask window for debugging (since F12 doesn't work in Listen window)
  try {
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc?.send) {
      eviaIpc.send('debug-log', `[AudioCapture] ✅ startCapture CALLED! includeSystemAudio=${includeSystemAudio}`);
    }
  } catch (e) {
    // Ignore if Ask window not available
  }
  
  // FIX: Reset disconnection flag when starting new capture
  micWsDisconnectedLogged = false;
  
  // GLASS PARITY FIX: Call getUserMedia FIRST (like Glass does at line 453)
  // This prevents the hang that was occurring when we tried to connect WebSocket before getUserMedia
  // Step 1: Request microphone permission (MOVED TO TOP!)
  try {
    console.log('[AudioCapture] 🎤 Requesting microphone access with constraints:', {
      sampleRate: SAMPLE_RATE,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    });
    
    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) eviaIpc.send('debug-log', '[AudioCapture] 🎤 Requesting microphone access...');
    } catch {}
    
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    
    console.log('[AudioCapture] ✅ Microphone permission granted');
    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) eviaIpc.send('debug-log', '[AudioCapture] ✅ MIC STREAM ACQUIRED!');
    } catch {}
    
    // Verify we got audio tracks
    const audioTracks = micStream.getAudioTracks();
    console.log(`[AudioCapture] 🎤 Got ${audioTracks.length} audio track(s):`, audioTracks.map(t => ({
      label: t.label,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState,
      settings: t.getSettings()
    })));
    
    // CRITICAL DIAGNOSTIC: Log device info to Ask console
    if (audioTracks.length > 0) {
      const track = audioTracks[0];
      const settings = track.getSettings();
      try {
        const eviaIpc = (window as any).evia?.ipc;
        if (eviaIpc?.send) {
          eviaIpc.send('debug-log', `[AudioCapture] 🎤 Got ${audioTracks.length} audio track(s)`);
          eviaIpc.send('debug-log', `[AudioCapture] 🎤 DEVICE: "${track.label}"`);
          eviaIpc.send('debug-log', `[AudioCapture] 🎤 Sample Rate: ${settings.sampleRate}Hz, Channels: ${settings.channelCount}`);
          eviaIpc.send('debug-log', `[AudioCapture] 🎤 Enabled: ${track.enabled}, Muted: ${track.muted}, State: ${track.readyState}`);
        }
      } catch (e) {
        console.error('[AudioCapture] Failed to forward device info:', e);
      }
    } else {
      console.error('[AudioCapture] ❌ NO AUDIO TRACKS IN MIC STREAM!');
      try {
        const eviaIpc = (window as any).evia?.ipc;
        if (eviaIpc?.send) {
          eviaIpc.send('debug-log', '[AudioCapture] ❌ NO AUDIO TRACKS IN MIC STREAM!');
        }
      } catch (e) {}
    }
    
    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) eviaIpc.send('debug-log', `[AudioCapture] 🎤 Got ${audioTracks.length} audio track(s)`);
    } catch {}
    
    if (audioTracks.length === 0) {
      throw new Error('[AudioCapture] No audio track in microphone stream');
    }
    
  } catch (error: any) {
    const errorMsg = `[AudioCapture] ❌ Microphone access denied: ${error.message}`;
    console.error(errorMsg);
    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) eviaIpc.send('debug-log', `❌ MIC FAILED: ${error.message}`);
    } catch {}
    throw new Error(`Microphone permission denied: ${error.message}`);
  }
  
  // Step 2: Setup mic audio processing (with AEC) - GLASS PARITY (line 465)
  console.log('[AudioCapture] Setting up mic audio processing...');
  const micSetup = await setupMicProcessing(micStream);
  micAudioContext = micSetup.context;
  micAudioProcessor = micSetup.processor;
  
  // Step 3: Resume mic AudioContext (required by browsers)
  if (micAudioContext.state === 'suspended') {
    await micAudioContext.resume();
    console.log('[AudioCapture] Mic AudioContext resumed');
  }
  
  // Step 4: NOW create and connect mic WebSocket (AFTER getUserMedia succeeds)
  // This prevents the hang that was occurring when we tried to connect before getUserMedia
  let micWs = ensureMicWs();
  if (!micWs) {
    const errorMsg = '[AudioCapture] ❌ No valid chat_id - cannot start capture';
    console.error(errorMsg);
    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) eviaIpc.send('debug-log', errorMsg);
    } catch {}
    throw new Error(errorMsg);
  }
  
  // Connect mic WebSocket (with auto-recreate on 403)
  try {
    await micWs.connect();
    console.log('[AudioCapture] Mic WebSocket connected');
    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) eviaIpc.send('debug-log', '[AudioCapture] ✅ Mic WebSocket connected');
    } catch {}
  } catch (error) {
    const errorMsg = `[AudioCapture] ❌ Mic WebSocket connect failed: ${error}`;
    console.error(errorMsg);
    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) eviaIpc.send('debug-log', errorMsg);
    } catch {}
    
    // FIX: Check if chat_id was cleared (signal for 403/404)
    const currentChatId = localStorage.getItem('current_chat_id');
    if (!currentChatId) {
      console.log('[AudioCapture] Chat ID was cleared - auto-creating new chat...');
      
      // Get backend URL and token
      const backendUrl = BACKEND_URL;
      const token = localStorage.getItem('auth_token') || '';
      
      // Force create new chat
      const newChatId = await getOrCreateChatId(backendUrl, token, true);
      console.log('[AudioCapture] Created new chat:', newChatId);
      
      // Close old WebSocket instance and recreate
      closeWebSocketInstance(micWsInstance?.chatId || '', 'mic');
      micWsInstance = null;
      
      // Recreate WebSocket with new chat_id
      micWs = ensureMicWs();
      if (!micWs) {
        throw new Error('[AudioCapture] Failed to recreate mic WebSocket after chat creation');
      }
      
      // Retry connection
      await micWs.connect();
      console.log('[AudioCapture] Mic WebSocket reconnected with new chat');
    } else {
      // Re-throw if not a chat_id issue
      throw error;
    }
  }
  
  // Step 5: Setup system audio if requested (platform-specific approach)
  if (includeSystemAudio) {
    console.log('[AudioCapture] 🔊 Starting system audio capture...');
    
    try {
      const eviaApi = (window as any).evia;
      const isWindows = Boolean((window as any)?.platformInfo?.isWindows);
      const isMac = Boolean((window as any)?.platformInfo?.isMac);
      
      // Ensure system WebSocket is ready first (needed for all platforms)
        const chatId = localStorage.getItem('current_chat_id') || undefined;
        let sysWs = ensureSystemWs(chatId);
        if (!sysWs) {
          throw new Error('[AudioCapture] Failed to create system audio WebSocket - chat_id may be missing');
        }
        
        // Connect system WebSocket (with auto-recreate on 403)
        try {
          await sysWs.connect();
          console.log('[AudioCapture] System WebSocket connected');
        } catch (error) {
          console.error('[AudioCapture] System WebSocket connect failed:', error);
          
          // FIX: Check if chat_id was cleared (signal for 403/404)
          const currentChatId = localStorage.getItem('current_chat_id');
          if (!currentChatId) {
            console.log('[AudioCapture] Chat ID was cleared - using newly created chat...');
            
            // Close old WebSocket instance and recreate
            closeWebSocketInstance(systemWsInstance?.chatId || '', 'system');
            systemWsInstance = null;
            
            // Recreate WebSocket with new chat_id (freshly stored in localStorage)
            const newChatId = localStorage.getItem('current_chat_id') || undefined;
            sysWs = ensureSystemWs(newChatId);
            if (!sysWs) {
              throw new Error('[AudioCapture] Failed to recreate system WebSocket after chat creation');
            }
            
            // Retry connection
            await sysWs.connect();
            console.log('[AudioCapture] System WebSocket reconnected with new chat');
          } else {
            // Re-throw if not a chat_id issue
            throw error;
          }
        }
        
      // ════════════════════════════════════════════════════════════════════════
      // WINDOWS: Use Electron's native loopback via getDisplayMedia (GLASS PARITY!)
      // Glass uses this approach: getDisplayMedia({ video: true, audio: true })
      // which triggers Electron's setDisplayMediaRequestHandler with audio: 'loopback'
      // ════════════════════════════════════════════════════════════════════════
        if (isWindows) {
        console.log('[AudioCapture] 🪟 Windows: Using native Electron loopback (Glass approach)');
        try {
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', '[AudioCapture] 🪟 Starting Windows native loopback audio...');
          }
          
          // Get system audio using native Electron loopback (same as Glass!)
          // This triggers the setDisplayMediaRequestHandler in main.ts
          systemStream = await navigator.mediaDevices.getDisplayMedia({
            video: true, // Required for getDisplayMedia
            audio: true  // This triggers Electron's native loopback
          });
          
          // Verify we got audio tracks
          const audioTracks = systemStream.getAudioTracks();
          if (audioTracks.length === 0) {
            throw new Error('No audio track in native loopback stream');
          }
          
          console.log(`[AudioCapture] 🪟 Got ${audioTracks.length} system audio track(s):`, audioTracks.map(t => ({
            label: t.label,
            enabled: t.enabled,
            readyState: t.readyState
          })));
          
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', `[AudioCapture] 🪟 Got ${audioTracks.length} system audio tracks via native loopback`);
          }
          
          // Setup WebAudio processing (same as Mac uses via setupSystemAudioProcessing)
          const sysSetup = setupSystemAudioProcessing(systemStream);
          systemAudioContext = sysSetup.context;
          systemAudioProcessor = sysSetup.processor;
          
          // Resume AudioContext if suspended
          if (systemAudioContext.state === 'suspended') {
            await systemAudioContext.resume();
          }
          
          console.log('[AudioCapture] 🪟 ✅ Windows native loopback audio capture started successfully');
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', '[AudioCapture] 🪟 ✅ Windows system audio started via native loopback');
          }
          
          // Store flag for cleanup
          (window as any)._systemAudioIsWindows = true;
          (window as any)._systemAudioUsingLoopback = true;
          
        } catch (loopbackErr: any) {
          console.error('[AudioCapture] 🪟 Native loopback failed:', loopbackErr);
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', `[AudioCapture] 🪟 ❌ Native loopback failed: ${loopbackErr.message}`);
          }
          // Continue without system audio on Windows if loopback fails
          console.warn('[AudioCapture] 🪟 Continuing with mic-only capture on Windows');
        }
      }
      // ════════════════════════════════════════════════════════════════════════
      // macOS: Use SystemAudioDump binary (unchanged)
      // ════════════════════════════════════════════════════════════════════════
      else if (isMac) {
        if (!eviaApi?.systemAudio) {
          console.error('[AudioCapture] window.evia.systemAudio API not available');
          console.warn('[AudioCapture] Continuing with mic-only capture');
        } else {
          console.log('[AudioCapture] 🍎 macOS: Using SystemAudioDump binary');
          let result = await eviaApi.systemAudio.start();
          
        if (!result.success) {
          console.error('[AudioCapture] Failed to start system audio helper:', result.error);
          
          // Retry if already running
          if (result.error === 'already_running') {
            console.log('[AudioCapture] System audio helper already running, stopping and retrying...');
              await eviaApi.systemAudio.stop();
            await new Promise(resolve => setTimeout(resolve, 500));
              result = await eviaApi.systemAudio.start();
              if (!result.success) {
                throw new Error(`Retry failed: ${result.error}`);
            }
          } else {
            throw new Error(result.error || 'Unknown error');
          }
        }
        
        console.log('[AudioCapture] ✅ System audio helper started successfully');
        
        // Listen for system audio data from binary (via IPC)
          const systemAudioHandler = eviaApi.systemAudio.onData((audioData: { data: string }) => {
          try {
            // Convert base64 to binary
            const binaryString = atob(audioData.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            
              // Store in AEC buffer
            systemAudioBuffer.push({
              data: audioData.data,
              timestamp: Date.now(),
            });
            if (systemAudioBuffer.length > MAX_SYSTEM_BUFFER_SIZE) {
                systemAudioBuffer.shift();
            }
            
              // Send to WebSocket
            const chatId = localStorage.getItem('current_chat_id') || undefined;
            const ws = ensureSystemWs(chatId);
            if (ws && ws.sendBinaryData) {
              ws.sendBinaryData(bytes.buffer);
              updateWsActivity('system');
              pipelineMetrics.systemChunksSent++;
              pipelineMetrics.lastSystemChunkTime = Date.now();
            }
          } catch (error) {
            console.error('[AudioCapture] Error processing system audio data:', error);
            pipelineMetrics.errorsEncountered++;
          }
        });
        
        // Store handler for cleanup
  (window as any)._systemAudioHandler = systemAudioHandler;
          (window as any)._systemAudioIsWindows = false;
        
          console.log('[AudioCapture] ✅ System audio capture started successfully (macOS binary)');
        }
      } else {
        console.warn('[AudioCapture] System audio not supported on this platform');
      }
    } catch (error: any) {
      console.error('[AudioCapture] System audio capture failed:', error);
      console.error('[AudioCapture] Error details:', {
        name: error.name,
        message: error.message,
      });
      
      console.warn('[AudioCapture] ⚠️  Continuing with mic-only capture');
      if ((window as any)?.platformInfo?.isMac) {
        console.warn('[AudioCapture] Please ensure Screen Recording permission is granted in System Settings');
      }
    }
  }
  
  console.log('[AudioCapture] Capture started successfully');
  console.log(`[AudioCapture] Mic: ${SAMPLE_RATE} Hz, Chunk size: ${SAMPLE_RATE * AUDIO_CHUNK_DURATION} samples`);
  if (systemAudioContext) {
    console.log(`[AudioCapture] System: ${SAMPLE_RATE} Hz, Chunk size: ${SAMPLE_RATE * AUDIO_CHUNK_DURATION} samples`);
  }
  
  return { 
    micAudioContext, 
    micAudioProcessor, 
    micStream,
    systemAudioContext,
    systemAudioProcessor,
    systemStream,
  };
}

// Stop capture and cleanup
export async function stopCapture(captureHandle?: any) {
  console.log('[AudioCapture] Stopping capture...');
  
  // WINDOWS FIX (2025-12-09): Mark capture as inactive
  isActivelyCapturing = false;
  
  // 🎙️ AUDIO DEBUG: Save accumulated audio to WAV files
  if (DEBUG_SAVE_AUDIO) {
    try {
      console.log('[AudioDebug] 🎙️ Saving debug audio files...');
      console.log('[AudioDebug]   - Mic chunks:', debugAudioBuffers.mic.length);
      console.log('[AudioDebug]   - System chunks:', debugAudioBuffers.system.length);
      
      // Save mic audio if any chunks captured
      if (debugAudioBuffers.mic.length > 0) {
        await saveDebugAudio('mic', debugAudioBuffers.mic, debugSessionId);
      }
      
      // Save system audio if any chunks captured
      if (debugAudioBuffers.system.length > 0) {
        await saveDebugAudio('system', debugAudioBuffers.system, debugSessionId);
      }
      
      // Clear buffers
      debugAudioBuffers = { mic: [], system: [] };
      console.log('[AudioDebug] ✅ Debug audio files saved successfully');
    } catch (error) {
      console.error('[AudioDebug] ❌ Failed to save debug audio:', error);
    }
  }
  
  try {
    // WINDOWS FIX: Stop health check timers
    stopWindowsHealthCheck('mic');
    stopWindowsHealthCheck('system');

    // Stop mic processor
    if (micAudioProcessor) {
      micAudioProcessor.disconnect();
      micAudioProcessor = null;
    }
    
    // Close mic audio context
    if (micAudioContext) {
      await micAudioContext.close();
      micAudioContext = null;
    }
    
    // Stop all mic tracks
    if (micStream) {
      micStream.getTracks().forEach((track: MediaStreamTrack) => {
        track.stop();
        console.log(`[AudioCapture] Stopped MIC track: ${track.label}`);
      });
      micStream = null;
    }
    
    // FIX: Properly close mic WebSocket (disconnect AND remove from map to prevent double handlers)
    if (micWsInstance) {
      const chatId = localStorage.getItem('current_chat_id') || '';
      closeWebSocketInstance(chatId, 'mic');
      micWsInstance = null;
    }
    
    // Stop system audio processor
    if (systemAudioProcessor) {
      systemAudioProcessor.disconnect();
      systemAudioProcessor = null;
    }
    
    // Close system audio context
    if (systemAudioContext) {
      await systemAudioContext.close();
      systemAudioContext = null;
    }
    
    // Stop all system tracks
    if (systemStream) {
      systemStream.getTracks().forEach((track: MediaStreamTrack) => {
        track.stop();
        console.log(`[AudioCapture] Stopped SYSTEM track: ${track.label}`);
      });
      systemStream = null;
    }
    
    // FIX: Properly close system WebSocket (disconnect AND remove from map to prevent double handlers)
    if (systemWsInstance) {
      const chatId = localStorage.getItem('current_chat_id') || '';
      closeWebSocketInstance(chatId, 'system');
      systemWsInstance = null;
    }
    
    // ──────────────────────────────────────────────────────────────────────
    // AEC CLEANUP: Dispose AEC instance and clear system audio buffer
    // ──────────────────────────────────────────────────────────────────────
    disposeAec();
    systemAudioBuffer = [];
    console.log('[AudioCapture] ✅ AEC disposed and system audio buffer cleared');
    
    // Stop system audio helper (mac uses binary, Windows may use native loopback or helper)
    const eviaApi = (window as any).evia;
        const isWindows = Boolean((window as any)?.platformInfo?.isWindows);
    const usingNativeLoopback = (window as any)._systemAudioUsingLoopback;
    
    // On Windows with native loopback, the stream tracks are already stopped above
    // Only need to stop the binary helper on macOS or if Windows is using the old WASAPI helper
    if (!usingNativeLoopback && (eviaApi?.systemAudio || eviaApi?.systemAudioWindows)) {
      try {
        const result = isWindows ? await eviaApi.systemAudioWindows?.stop() : await eviaApi.systemAudio?.stop();
        if (result?.success) {
          console.log('[AudioCapture] System audio helper stopped');
        } else if (result) {
          console.warn('[AudioCapture] Failed to stop system audio helper:', result.error);
        }
        
        // Remove system audio data handler (only for binary helper approach)
        const handler = (window as any)._systemAudioHandler;
        if (handler) {
          if (isWindows && eviaApi.systemAudioWindows) {
            eviaApi.systemAudioWindows.removeOnData(handler);
          } else if (eviaApi.systemAudio) {
            eviaApi.systemAudio.removeOnData(handler);
          }
          (window as any)._systemAudioHandler = null;
          console.log('[AudioCapture] System audio handler removed');
        }
      } catch (error) {
        console.warn('[AudioCapture] Error stopping system audio helper:', error);
      }
    } else if (isWindows && usingNativeLoopback) {
      console.log('[AudioCapture] 🪟 Windows native loopback: Stream tracks already stopped');
    }
    
    // Clean up window flags
    (window as any)._systemAudioIsWindows = undefined;
    (window as any)._systemAudioUsingLoopback = undefined;
    
    console.log('[AudioCapture] Capture stopped successfully (mic + system)');
  } catch (error) {
    console.error('[AudioCapture] Error stopping capture:', error);
  }
}

// Start capture from provided MediaStreams (Windows/Chromium flow via ScreenPicker)
// This avoids any native/binary system audio path and keeps mic/system fully separate.
export async function startCaptureWithStreams(
  providedSystemStream?: MediaStream,
  providedMicStream?: MediaStream
) {
  console.log('[AudioCapture] startCaptureWithStreams called', {
    hasSystem: !!providedSystemStream,
    hasMic: !!providedMicStream,
  });

  // AUDIO DEBUG: Check flag and initialize session
  console.log('[AudioDebug] ═══════════════════════════════════════');
  console.log('[AudioDebug] 🔍 CHECKING DEBUG FLAG NOW...');
  console.log('[AudioDebug] ═══════════════════════════════════════');
  
  try {
    const evia = (window as any).evia;
    console.log('[AudioDebug] window.evia exists?', !!evia);
    console.log('[AudioDebug] window.evia.checkDebugFlag exists?', !!evia?.checkDebugFlag);
    
    if (evia && evia.checkDebugFlag) {
      const enabled = await evia.checkDebugFlag();
      DEBUG_SAVE_AUDIO = enabled === true;
      debugFlagChecked = true;
      
      console.log('[AudioDebug] Flag check result:', enabled);
      console.log('[AudioDebug] DEBUG_SAVE_AUDIO set to:', DEBUG_SAVE_AUDIO);
      
      if (DEBUG_SAVE_AUDIO) {
        debugSessionId = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        debugAudioBuffers = { mic: [], system: [] };
        
        console.log('[AudioDebug] ✅ ✅ ✅ AUDIO DEBUG RECORDING ENABLED ✅ ✅ ✅');
        console.log('[AudioDebug] 💾 Files will save to: ~/Desktop/taylos-audio-debug/');
        console.log('[AudioDebug] 🎙️ Session ID:', debugSessionId);
        console.log('[AudioDebug] ═══════════════════════════════════════');
      } else {
        console.log('[AudioDebug] ❌ Debug flag file NOT FOUND');
        console.log('[AudioDebug] To enable: touch ~/Desktop/Taylos_DEBUG_AUDIO');
        console.log('[AudioDebug] ═══════════════════════════════════════');
      }
    } else {
      console.log('[AudioDebug] ❌ window.evia.checkDebugFlag NOT AVAILABLE');
      console.log('[AudioDebug] ═══════════════════════════════════════');
    }
  } catch (error) {
    console.error('[AudioDebug] ⚠️  Error during flag check:', error);
    DEBUG_SAVE_AUDIO = false;
  }
  // ═══════════════════════════════════════════════════════════════════════════════

  // Reset state flags
  micWsDisconnectedLogged = false;

  // Validate mic stream
  if (!providedMicStream || providedMicStream.getAudioTracks().length === 0) {
    throw new Error('[AudioCapture] No microphone stream provided');
  }

  // Bind globals so cleanup works
  micStream = providedMicStream;
  systemStream = providedSystemStream || null;

  // Setup mic processing first
  const micSetup = await setupMicProcessing(micStream);
  micAudioContext = micSetup.context;
  micAudioProcessor = micSetup.processor;
  if (micAudioContext.state === 'suspended') {
    await micAudioContext.resume();
  }

  // Ensure Mic WS and connect (with chat auto-create fallback similar to startCapture)
  let micWs = ensureMicWs();
  if (!micWs) {
    throw new Error('[AudioCapture] No valid chat_id - cannot start mic capture');
  }
  try {
    await micWs.connect();
  } catch (error) {
    const currentChatId = localStorage.getItem('current_chat_id');
    if (!currentChatId) {
      // chat cleared due to 403/404 -> create a new one and reconnect
      const backendUrl = BACKEND_URL;
      const token = localStorage.getItem('auth_token') || '';
      const newChatId = await getOrCreateChatId(backendUrl, token, true);
      console.log('[AudioCapture] Recreated chat for mic:', newChatId);
      closeWebSocketInstance(micWsInstance?.chatId || '', 'mic');
      micWsInstance = null;
      micWs = ensureMicWs();
      if (!micWs) throw error;
      await micWs.connect();
    } else {
      throw error;
    }
  }

  const isWindows = Boolean((window as any)?.platformInfo?.isWindows);

  // ════════════════════════════════════════════════════════════════════════
  // WINDOWS: Use native loopback via getDisplayMedia (GLASS PARITY!)
  // ════════════════════════════════════════════════════════════════════════
  if (isWindows) {
    try {
      console.log('[AudioCapture] 🪟 Windows: Using native Electron loopback (Glass approach)');
      
      // Ensure system websocket
      let sysWs = ensureSystemWs(localStorage.getItem('current_chat_id') || undefined);
      if (!sysWs) {
        const backendUrl = BACKEND_URL;
        const token = localStorage.getItem('auth_token') || '';
        const newChatId = await getOrCreateChatId(backendUrl, token, true);
        closeWebSocketInstance(systemWsInstance?.chatId || '', 'system');
        systemWsInstance = null;
        sysWs = ensureSystemWs(newChatId?.toString());
      }
      if (sysWs) {
        try { await sysWs.connect(); } catch (err) { console.warn('[AudioCapture] System WS connect failed:', err); }
      }

      // Get system audio using native Electron loopback (same as Glass!)
      systemStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true  // Triggers Electron's native loopback
      });
      
      const audioTracks = systemStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track in native loopback stream');
      }
      
      console.log(`[AudioCapture] 🪟 Got ${audioTracks.length} system audio track(s)`);
      
      // Setup WebAudio processing
      const sysSetup = setupSystemAudioProcessing(systemStream);
      systemAudioContext = sysSetup.context;
      systemAudioProcessor = sysSetup.processor;
      
      if (systemAudioContext.state === 'suspended') {
        await systemAudioContext.resume();
        }
      
      (window as any)._systemAudioIsWindows = true;
      (window as any)._systemAudioUsingLoopback = true;
      
      console.log('[AudioCapture] 🪟 ✅ Windows native loopback audio started');
    } catch (e) {
      console.warn('[AudioCapture] 🪟 Failed to start Windows native loopback:', e);
    }
  } else if (systemStream && systemStream.getAudioTracks().length > 0) {
    // Non-Windows: If system stream was provided, setup its processing and WS too
    const sysSetup = setupSystemAudioProcessing(systemStream);
    systemAudioContext = sysSetup.context;
    systemAudioProcessor = sysSetup.processor;

    let sysWs = ensureSystemWs(localStorage.getItem('current_chat_id') || undefined);
    if (!sysWs) {
      console.warn('[AudioCapture] No valid chat_id for system audio; attempting reconnect after chat create');
      const backendUrl = BACKEND_URL;
      const token = localStorage.getItem('auth_token') || '';
      const newChatId = await getOrCreateChatId(backendUrl, token, true);
      closeWebSocketInstance(systemWsInstance?.chatId || '', 'system');
      systemWsInstance = null;
      sysWs = ensureSystemWs(newChatId?.toString());
    }
    if (sysWs) {
      try {
        await sysWs.connect();
      } catch (err) {
        console.warn('[AudioCapture] System WS connect failed:', err);
      }
    }
  } else {
    console.log('[AudioCapture] No system stream provided; starting mic-only');
  }

  console.log('[AudioCapture] startCaptureWithStreams initialized');
  return {
    micAudioContext,
    micAudioProcessor,
    micStream,
    systemAudioContext,
    systemAudioProcessor,
    systemStream,
  };
}
