// Glass parity: Audio capture using ScriptProcessorNode (reliable, no CSP issues)
import {
  getWebSocketInstance,
  getOrCreateChatId,
  recreateChatId,
  closeWebSocketInstance,
} from './services/websocketService';
import { BACKEND_URL } from './config/config';

const SAMPLE_RATE = 24000; // Glass parity
import { ReferenceRing, SYSTEM_CAPTURE_ASSUMED_LATENCY_MS } from '../main/aec-reference';
import { AecTelemetry, describeReport } from '../main/aec-telemetry';
import { Aec3Canceller, AEC3_MAX_TRACKABLE_DELAY_MS } from '../main/aec3-canceller';
import {
  type AudioChunkMetadata,
  type CaptureSource,
  CaptureSessionTimeline,
} from '../main/capture-timeline';
import { aec3WasmBinary } from './aec3/wasm-binary';

const BUFFER_SIZE = 2048;
const AUDIO_CHUNK_DURATION = 0.1; // 100ms chunks

// ──────────────────────────────────────────────────────────────────────────────
// AEC LATENCY COMPENSATION
// The mic hears system audio from 50-150ms ago (acoustic delay)
// We need to use a time-delayed reference signal for AEC to work properly
// ──────────────────────────────────────────────────────────────────────────────
const AEC_LATENCY_MS = 100; // Acoustic delay (mic hears speaker output from this long ago)
const AEC_RING_BUFFER_SIZE = Math.ceil(AEC_LATENCY_MS / (AUDIO_CHUNK_DURATION * 1000)) + 3; // +3 for safety
/**
 * Mic chunks held back so their far-end reference has arrived.
 *
 * A mic chunk is cut the instant its last sample is captured, but the far-end
 * audio covering that same instant is still in flight. Measured against the
 * real timeline before any reserve existed, 2184 of a window's 2400 samples
 * were unwritten, so the canceller was skipped for 91% of chunks - silently.
 *
 * The reserve is not a round number, it is a budget, and the constraint is
 * exact. Reading a window that assumes the reference is
 * SYSTEM_CAPTURE_ASSUMED_LATENCY_MS stale means reading that much further
 * ahead, on top of the chunk's own duration:
 *
 *     reserve >= chunk duration + SYSTEM_CAPTURE_ASSUMED_LATENCY_MS
 *     400ms   >= 100ms          + 240ms                              (+60ms spare)
 *
 * Three chunks is not enough for the latency measured in the 2026-08-10
 * production capture. Four costs 400ms on the microphone path and makes every
 * 100ms window available after the 240ms helper correction instead of feeding
 * AEC3 a non-causal reference that cannot remove the far end.
 */
const AEC_MIC_RESERVE_CHUNKS = 4;

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
/**
 * The canceller is ON, on measurement, not preference.
 *
 * It was off because the Speex build did net harm. WebRTC AEC3 replaced it and
 * passes every gate in `tools/aec-bench.cjs`, measured through this same
 * wrapper at this same rate, on real speech through a hardware-shaped room:
 *
 *     silent reference        -0.4dB   (Speex: -5.7dB speech, -16.1dB tone)
 *     echo removed at 60ms   +42.7dB   (Speex: +14.1dB)
 *     rep kept in double talk -3.0dB   (Speex: -8.8dB)
 *     survives +200ppm drift +46.9dB   (Speex: +6.4dB at +50ppm)
 *
 * And the test that actually decides it - the same nova-3 model production
 * uses, over the bench's own audio - transcribes the cancelled microphone
 * identically to the rep recorded alone, with the prospect's longest leaked
 * word run down from 20 to 2.
 *
 * This remains a kill switch. Set `disableCustomAec: true` in the audio
 * diagnostic config to capture raw.
 */
let DEBUG_DISABLE_CUSTOM_AEC = false;
let DEBUG_DISABLE_BROWSER_PROCESSING = false;
let debugAudioBuffers: { mic: Int16Array[], system: Int16Array[] } = { mic: [], system: [] };
/**
 * The reference window as the canceller actually received it, one entry per mic
 * chunk including skipped ones.
 *
 * The `system` track above is what was SENT to the recogniser; this is what was
 * READ back out of the ring at the mic's own timeline, and the difference
 * between the two is the whole alignment question. Live logs have shown
 * ref=-120dBFS with refGap=0% - digital silence from inside the written range -
 * and no offline model reproduces it, so the only way to settle whether the
 * helper delivered silence or the indexing returned silence is to keep both and
 * compare them. Padded on skipped chunks so it stays sample-aligned with
 * `mic-raw`; that alignment is what makes the offline analysis possible.
 */
let referenceDebugBuffer: Float32Array[] = [];
let micRawDebugBuffer: Float32Array[] = [];
let debugSessionId: string = '';
let debugFlagChecked = false;

type AudioDiagnosticConfig = {
  saveAudio: boolean;
  disableCustomAec: boolean;
  disableBrowserProcessing: boolean;
};

async function loadAudioDiagnosticConfig(): Promise<AudioDiagnosticConfig> {
  const evia = (window as any).evia;
  const config = evia?.getAudioDiagnosticConfig
    ? await evia.getAudioDiagnosticConfig()
    : {
        saveAudio: Boolean(await evia?.checkDebugFlag?.()),
        disableCustomAec: false,
        disableBrowserProcessing: false,
      };

  DEBUG_SAVE_AUDIO = config?.saveAudio === true;
  // Only an EXPLICIT false re-enables the canceller. `config?.x === true`
  // silently reset this to false whenever the caller omitted the field, which
  // is every call - so the disable above never took effect and the broken
  // canceller kept running, still attenuating the rep by 9-24dB.
  if (config?.disableCustomAec === false) DEBUG_DISABLE_CUSTOM_AEC = false;
  else if (config?.disableCustomAec === true) DEBUG_DISABLE_CUSTOM_AEC = true;
  DEBUG_DISABLE_BROWSER_PROCESSING = config?.disableBrowserProcessing === true;
  debugFlagChecked = true;

  console.log('[AudioDiagnostic] Capture mode:', {
    saveAudio: DEBUG_SAVE_AUDIO,
    customAec: DEBUG_DISABLE_CUSTOM_AEC ? 'bypassed' : 'enabled',
    browserProcessing: DEBUG_DISABLE_BROWSER_PROCESSING ? 'bypassed' : 'enabled',
  });

  return {
    saveAudio: DEBUG_SAVE_AUDIO,
    disableCustomAec: DEBUG_DISABLE_CUSTOM_AEC,
    disableBrowserProcessing: DEBUG_DISABLE_BROWSER_PROCESSING,
  };
}

async function getActiveAuthToken(): Promise<string> {
  try {
    const token = await (window as any).evia?.auth?.getToken?.();
    if (token) return token;
  } catch (error) {
    console.warn('[AudioCapture] Failed to read auth token from secure storage, falling back to localStorage:', error);
  }

  return localStorage.getItem('auth_token') || '';
}

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

    const config = await loadAudioDiagnosticConfig();
    const enabled = config.saveAudio;

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
async function saveDebugAudio(source: 'mic' | 'system' | 'mic-raw' | 'reference', chunks: Int16Array[], sessionId: string): Promise<void> {
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
      timeSinceMicChunk: timeSinceMic ? `${(timeSinceMic / 1000).toFixed(1)}s` : 'never',
      timeSinceSystemChunk: timeSinceSystem ? `${(timeSinceSystem / 1000).toFixed(1)}s` : 'never',
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
const MAC_SYSTEM_HEALTH_CHECK_INTERVAL = 4000;
const MAC_SYSTEM_CHUNK_STALE_MS = 7000;
const MAC_SYSTEM_RESTART_COOLDOWN_MS = 12000;

let micHealthCheckTimer: ReturnType<typeof setInterval> | null = null;
let systemHealthCheckTimer: ReturnType<typeof setInterval> | null = null;
let macSystemHealthCheckTimer: ReturnType<typeof setInterval> | null = null;
let lastMicWsActivity = Date.now();
let lastSystemWsActivity = Date.now();
let lastMicReconnectAttempt = 0;
let lastSystemReconnectAttempt = 0;
let isActivelyCapturing = false;
let macSystemCaptureStartedAt = 0;

async function restartMacSystemAudioPipeline(reason: string) {
  const eviaApi = (window as any).evia;
  if (!eviaApi?.systemAudio) {
    console.warn('[AudioCapture] 🍎 Cannot restart system audio helper - API unavailable');
    return;
  }

  const now = Date.now();
  if (now - lastSystemReconnectAttempt < MAC_SYSTEM_RESTART_COOLDOWN_MS) {
    return;
  }
  lastSystemReconnectAttempt = now;
  pipelineMetrics.reconnectAttempts += 1;

  const eviaIpc = eviaApi?.ipc;
  try {
    console.warn(`[AudioCapture] 🍎 Restarting macOS system audio pipeline: ${reason}`);
    if (eviaIpc?.send) {
      eviaIpc.send('debug-log', `[Recovery] 🍎 Restarting system audio: ${reason}`);
    }

    if (systemWsInstance) {
      try {
        systemWsInstance.disconnect();
      } catch (disconnectErr) {
        console.warn('[AudioCapture] 🍎 Failed to disconnect system WS before restart:', disconnectErr);
      }
    }

    const restartResult = await eviaApi.systemAudio.restart();
    if (!restartResult?.success) {
      throw new Error(restartResult?.error || 'system audio restart failed');
    }

    if (systemWsInstance) {
      await new Promise(resolve => setTimeout(resolve, 600));
      await systemWsInstance.connect();
    }

    lastSystemWsActivity = Date.now();
    macSystemCaptureStartedAt = Date.now();
    pipelineMetrics.lastSystemChunkTime = 0;

    if (eviaIpc?.send) {
      eviaIpc.send('debug-log', `[Recovery] ✅ macOS system audio restarted: ${reason}`);
    }
  } catch (error) {
    console.error('[AudioCapture] 🍎 macOS system audio restart failed:', error);
    pipelineMetrics.errorsEncountered += 1;
    if (eviaIpc?.send) {
      eviaIpc.send('debug-log', `[Recovery] ❌ macOS system audio restart failed: ${error}`);
    }
  }
}

function startMacSystemHealthCheck() {
  const isMac = Boolean((window as any)?.platformInfo?.isMac);
  if (!isMac) return;

  if (macSystemHealthCheckTimer) {
    clearInterval(macSystemHealthCheckTimer);
  }

  console.log('[AudioCapture] 🍎 Starting macOS system-audio watchdog');
  macSystemHealthCheckTimer = setInterval(async () => {
    try {
      if (!isActivelyCapturing) return;
      const eviaApi = (window as any).evia;
      if (!eviaApi?.systemAudio) return;

      const now = Date.now();
      const hasReceivedChunk = pipelineMetrics.lastSystemChunkTime > 0;
      const timeSinceChunk = hasReceivedChunk
        ? now - pipelineMetrics.lastSystemChunkTime
        : now - macSystemCaptureStartedAt;
      const helperRunning = await eviaApi.systemAudio.isRunning();

      if (timeSinceChunk > 5000) {
        console.log(
          `[AudioCapture] 🍎 System watchdog: helper=${helperRunning} chunk=${Math.round(timeSinceChunk / 1000)}s`
        );
      }

      if (!helperRunning) {
        await restartMacSystemAudioPipeline('helper-not-running');
        return;
      }

      if (macSystemCaptureStartedAt > 0 && timeSinceChunk > MAC_SYSTEM_CHUNK_STALE_MS) {
        const reason = hasReceivedChunk
          ? `stale-audio-chunks-${Math.round(timeSinceChunk / 1000)}s`
          : `no-first-audio-chunk-${Math.round(timeSinceChunk / 1000)}s`;
        await restartMacSystemAudioPipeline(reason);
      }
    } catch (error) {
      console.error('[AudioCapture] 🍎 macOS watchdog error:', error);
    }
  }, MAC_SYSTEM_HEALTH_CHECK_INTERVAL);
}

function stopMacSystemHealthCheck() {
  if (macSystemHealthCheckTimer) {
    clearInterval(macSystemHealthCheckTimer);
    macSystemHealthCheckTimer = null;
    console.log('[AudioCapture] 🍎 Stopped macOS system-audio watchdog');
  }
}

/**
 * WINDOWS FIX: Enhanced WebSocket Health Check with AUTO-RECOVERY
 * Monitors connection liveness and triggers automatic reconnect if stale
 * 
 * Silence is valid call state. Recovery is based on raw capture activity and
 * actual WebSocket connectivity, never on the absence of transcript text.
 */
function startWindowsHealthCheck(wsInstance: any, source: 'mic' | 'system') {
  const isWindows = Boolean((window as any)?.platformInfo?.isWindows);
  if (!isWindows) return; // Only run on Windows

  console.log(`[AudioCapture] 🪟 Starting Windows health check for ${source}`);

  const timer = setInterval(async () => {
    try {
      if (!isActivelyCapturing) return;

      const lastActivity = source === 'mic' ? lastMicWsActivity : lastSystemWsActivity;
      const lastReconnect = source === 'mic' ? lastMicReconnectAttempt : lastSystemReconnectAttempt;
      const timeSinceActivity = Date.now() - lastActivity;
      const timeSinceReconnect = Date.now() - lastReconnect;
      const wsConnected = Boolean(wsInstance?.isConnected?.());

      if (timeSinceActivity > 5000 || !wsConnected) {
        console.log(`[AudioCapture] 🪟 ${source.toUpperCase()} health: connected=${wsConnected}, ${Math.round(timeSinceActivity / 1000)}s since audio activity`);
      }

      // Reconnect a disconnected socket immediately, or a socket whose raw
      // capture pipeline has genuinely stopped producing chunks.
      if ((!wsConnected || timeSinceActivity > STALE_THRESHOLD_MS) && timeSinceReconnect > RECONNECT_COOLDOWN_MS) {
        console.warn(`[AudioCapture] 🪟 ${source.toUpperCase()} pipeline unhealthy (connected=${wsConnected}, audio=${Math.round(timeSinceActivity / 1000)}s) - initiating recovery`);

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

// System audio state  
let systemWsInstance: any = null;
let systemAudioContext: AudioContext | null = null;
let systemAudioProcessor: ScriptProcessorNode | null = null;
let systemStream: MediaStream | null = null;

// One identity and one monotonic clock for both physical capture paths.
let captureTimeline: CaptureSessionTimeline | null = null;
let nextCaptureGeneration = 0;
let captureTransportReady = false;
let captureStartupError: Error | null = null;
type BufferedCaptureChunk = {
  source: CaptureSource;
  data: ArrayBuffer;
  metadata: AudioChunkMetadata;
};
let preReadyCaptureChunks: BufferedCaptureChunk[] = [];
const MAX_PRE_READY_CAPTURE_MS = 3000;
const MAX_PRE_READY_CAPTURE_BYTES =
  SAMPLE_RATE * 2 * 2 * (MAX_PRE_READY_CAPTURE_MS / 1000);
const FIRST_CAPTURE_CHUNK_TIMEOUT_MS = 5000;

function isCurrentCaptureTimeline(timeline: CaptureSessionTimeline): boolean {
  return captureTimeline === timeline && isActivelyCapturing;
}

function beginCaptureSession(): CaptureSessionTimeline {
  if (isActivelyCapturing || captureTimeline) {
    throw new Error('[AudioCapture] Cannot start a new capture over an active session');
  }

  captureTransportReady = false;
  captureStartupError = null;
  preReadyCaptureChunks = [];
  referenceRing.reset();
  micOriginMs = null;
  micSamplesConsumed = 0;
  aecTelemetry = null;
  aecSkippedChunks = 0;
  lastSkipWarningAtMs = 0;
  aec3LoadFailed = false;

  const timeline = new CaptureSessionTimeline({
    generation: nextCaptureGeneration++,
    epochUnixMs: Date.now(),
    originPerformanceMs: performance.now(),
  });
  captureTimeline = timeline;
  isActivelyCapturing = true;
  console.log(`[AudioCapture] Capture identity ${timeline.id}/${timeline.generation}`);
  return timeline;
}

function resetCaptureSessionState(expectedTimeline?: CaptureSessionTimeline): void {
  if (expectedTimeline && captureTimeline && captureTimeline !== expectedTimeline) {
    return;
  }
  isActivelyCapturing = false;
  captureTransportReady = false;
  captureStartupError = null;
  preReadyCaptureChunks = [];
  captureTimeline = null;
  referenceRing.reset();
  micOriginMs = null;
  micSamplesConsumed = 0;
  aecTelemetry = null;
  aecSkippedChunks = 0;
  lastSkipWarningAtMs = 0;
  aec3LoadFailed = false;
}

function requireCaptureTimeline(): CaptureSessionTimeline {
  if (!captureTimeline) {
    throw new Error('[AudioCapture] Capture timeline is not initialized');
  }
  return captureTimeline;
}

function sendCaptureChunk(
  source: CaptureSource,
  data: ArrayBuffer,
  metadata: AudioChunkMetadata,
): ReturnType<ReturnType<typeof getWebSocketInstance>['sendAudioChunk']> | 'buffered' {
  const timeline = requireCaptureTimeline();
  if (
    metadata.capture_session_id !== timeline.id ||
    metadata.capture_generation !== timeline.generation ||
    metadata.source !== source ||
    metadata.byte_length !== data.byteLength
  ) {
    throw new Error('[AudioCapture] Refusing chunk with stale or inconsistent metadata');
  }
  if (captureStartupError) throw captureStartupError;

  if (!captureTransportReady) {
    preReadyCaptureChunks.push({ source, data, metadata });
    const earliestStartMs = Math.min(
      ...preReadyCaptureChunks.map(item => item.metadata.capture_start_ms),
    );
    const latestEndMs = Math.max(
      ...preReadyCaptureChunks.map(item => item.metadata.capture_end_ms),
    );
    const bufferedBytes = preReadyCaptureChunks.reduce(
      (total, item) => total + item.data.byteLength,
      0,
    );
    if (
      latestEndMs - earliestStartMs > MAX_PRE_READY_CAPTURE_MS ||
      bufferedBytes > MAX_PRE_READY_CAPTURE_BYTES
    ) {
      captureStartupError = new Error(
        `[AudioCapture] Startup exceeded its bounded audio buffer; opening was not released`
      );
      throw captureStartupError;
    }
    return 'buffered';
  }

  const ws = source === 'mic'
    ? ensureMicWs()
    : ensureSystemWs(localStorage.getItem('current_chat_id') || undefined);
  if (!ws) throw new Error(`[AudioCapture] ${source} WebSocket unavailable`);
  return ws.sendAudioChunk(data, metadata);
}

function releaseCaptureTransport(): void {
  if (captureStartupError) throw captureStartupError;
  const buffered = [...preReadyCaptureChunks];
  buffered
    .sort((a, b) => {
      const timeDelta = a.metadata.capture_start_ms - b.metadata.capture_start_ms;
      if (timeDelta !== 0) return timeDelta;
      if (a.source !== b.source) return a.source === 'system' ? -1 : 1;
      return a.metadata.chunk_seq - b.metadata.chunk_seq;
    })
    .forEach((chunk) => {
      const ws = chunk.source === 'mic'
        ? ensureMicWs()
        : ensureSystemWs(localStorage.getItem('current_chat_id') || undefined);
      if (!ws) throw new Error(`[AudioCapture] ${chunk.source} WebSocket unavailable at release`);
      ws.sendAudioChunk(chunk.data, chunk.metadata);
    });
  preReadyCaptureChunks = [];
  captureTransportReady = true;
}

async function waitForFirstCaptureChunk(
  firstChunk: Promise<void>,
  source: CaptureSource,
): Promise<void> {
  let timeoutId: number | undefined;
  try {
    await Promise.race([
      firstChunk,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(
            `[AudioCapture] Timed out waiting for first ${source} PCM chunk`,
          ));
        }, FIRST_CAPTURE_CHUNK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// AEC (Acoustic Echo Cancellation) - WebRTC AEC3
//
// Replaced the Speex WASM canceller, which was measured doing net harm: on a
// silent reference, where a correct canceller returns the microphone untouched,
// it attenuated speech by 5.7dB and a tone by 16.1dB, and during double talk it
// took 8.8dB off the rep's voice. AEC3 on the same bench costs 0.4dB and 3.0dB
// respectively while removing 42dB of echo. `tools/aec-bench.cjs` is the gate.
// ──────────────────────────────────────────────────────────────────────────────
let aec3Canceller: Aec3Canceller | null = null;
/** Reported once per session; a canceller that failed to load must not be silent. */
let aec3LoadFailed = false;

// System audio buffer for AEC reference (Ring buffer with time-delayed chunks)
// Size: Limited to AEC_RING_BUFFER_SIZE for proper acoustic delay compensation
let systemAudioBuffer: Array<{ data: string; timestamp: number }> = [];
const MAX_SYSTEM_BUFFER_SIZE = AEC_RING_BUFFER_SIZE;

/** Continuous, wall-clock-addressable far-end reference for the canceller. */
const referenceRing = new ReferenceRing();
/** Origin for counting mic capture time; set on the first chunk of a session. */
let micOriginMs: number | null = null;
/** Mic samples already emitted, so a chunk's start time is counted, not sampled. */
let micSamplesConsumed = 0;
/** Measures what the canceller actually does. Set up per session. */
let aecTelemetry: AecTelemetry | null = null;
/** Chunks the canceller was skipped for, so a skip can never be invisible. */
let aecSkippedChunks = 0;
let lastSkipWarningAtMs = 0;

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
 * Bring up the echo canceller for a session.
 *
 * Never throws: a microphone with echo in it is bad, and a microphone that
 * stopped working because the canceller failed to load is worse. On failure the
 * pipeline runs uncancelled and says so, once, where the log is actually read.
 */
async function initAec3(): Promise<void> {
  if (aec3Canceller || aec3LoadFailed) return;
  try {
    aec3Canceller = await Aec3Canceller.create({
      streamRate: SAMPLE_RATE,
      // Embedded rather than fetched: a packaged renderer runs from file://,
      // where emscripten's fetch of a sibling .wasm fails - in production only.
      wasmBinary: aec3WasmBinary(),
    });
    const line = `[AEC] ✅ WebRTC AEC3 ready (${aec3Canceller.internalRate}Hz internal, ` +
      `${aec3Canceller.frameSamples}-sample frames at ${SAMPLE_RATE}Hz)`;
    console.log(line);
    sendDebugLog(line);
  } catch (error) {
    aec3LoadFailed = true;
    const line = `[AEC] ❌ AEC3 failed to load - capturing WITHOUT echo cancellation: ${error}`;
    console.error(line);
    sendDebugLog(line);
  }
}

function disposeAec() {
  if (!aec3Canceller) return;
  aec3Canceller.dispose();
  aec3Canceller = null;
  console.log('[AEC] ✅ AEC3 instance destroyed');
}

/** Diagnostics to the terminal, where they are read. Must never break capture. */
function sendDebugLog(line: string): void {
  try {
    (window as any).evia?.ipc?.send?.('debug-log', `[AudioCapture] ${line}`);
  } catch {
    /* diagnostics must never break capture */
  }
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
 * Cancel the far end out of one microphone chunk.
 *
 * Returns the microphone unchanged if the canceller is not up. Never throws:
 * losing the rep's words is the single worst outcome in this product, so a
 * canceller in trouble degrades to a duplicate, never to silence.
 */
function runAecSync(micF32: Float32Array, sysF32: Float32Array): Float32Array {
  if (!aec3Canceller) return micF32;

  // AEC3 needs matched windows. The ring always returns exactly the length
  // asked for, so this is belt and braces against a future caller.
  const reference = sysF32.length === micF32.length
    ? sysF32
    : (() => {
        const padded = new Float32Array(micF32.length);
        padded.set(sysF32.subarray(0, Math.min(sysF32.length, micF32.length)));
        return padded;
      })();

  try {
    return aec3Canceller.process(micF32, reference);
  } catch (error) {
    console.error('[AEC] ❌ AEC3 process failed, passing the microphone through:', error);
    return micF32;
  }
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

        if (eviaIpc?.send) {
          // Log full error content for debugging
          if (msg.type === 'error') {
            eviaIpc.send('debug-log', `[AudioCapture] ❌ MIC ERROR DATA: ${JSON.stringify(msg.data || msg)}`);
          }
        }

        if (msg.type === 'transcript_segment' || msg.type === 'status' || msg.type === 'context_status') {
          if (eviaIpc?.send) {
            // Tag message with _source: 'mic' (speaker 1)
            eviaIpc.send('transcript-message', { ...msg, _source: 'mic' });
          } else {
            console.error('[AudioCapture] ❌ IPC not available for forwarding');
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

        // Log full error content for debugging
        if (msg.type === 'error' && eviaIpc?.send) {
          eviaIpc.send('debug-log', `[AudioCapture] ❌ SYSTEM ERROR DATA: ${JSON.stringify(msg.data || msg)}`);
        }

        if (msg.type === 'transcript_segment' || msg.type === 'status' || msg.type === 'context_status') {
          // Forward to Listen window via IPC with source tag
          if (eviaIpc?.send) {
            // Tag message with _source: 'system' (speaker 0)
            eviaIpc.send('transcript-message', { ...msg, _source: 'system' });
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

function closeCaptureWebSocket(source: 'mic' | 'system') {
  const instance = source === 'mic' ? micWsInstance : systemWsInstance;
  if (!instance) return;

  closeWebSocketInstance(instance.chatId || localStorage.getItem('current_chat_id') || '', source);
  if (source === 'mic') {
    micWsInstance = null;
  } else {
    systemWsInstance = null;
  }
}

type SystemAudioStartupStatus =
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

type CaptureSocketConnectionStatus = {
  systemAudioSocketAvailable: boolean;
  systemAudioStatus: SystemAudioStartupStatus;
};

async function connectCaptureWebSockets(
  includeSystemAudio: boolean
): Promise<CaptureSocketConnectionStatus> {
  const createPair = () => {
    const mic = ensureMicWs();
    const system = includeSystemAudio
      ? ensureSystemWs(localStorage.getItem('current_chat_id') || undefined)
      : null;

    if (!mic) {
      throw new Error('[AudioCapture] No valid chat_id - cannot create microphone WebSocket');
    }
    return { mic, system };
  };

  const connectPair = async (
    pair: ReturnType<typeof createPair>
  ): Promise<CaptureSocketConnectionStatus> => {
    if (!includeSystemAudio) {
      await pair.mic.connect();
      return {
        systemAudioSocketAvailable: false,
        systemAudioStatus: 'not_requested',
      };
    }

    if (!pair.system) {
      const error = new Error('[AudioCapture] Required system-audio WebSocket unavailable') as Error & {
        systemAudioStatus?: SystemAudioStartupStatus;
      };
      error.systemAudioStatus = 'socket_unavailable';
      throw error;
    }

    // A two-sided call is not ready until both transports are open. Silently
    // degrading to mic-only fabricates a complete-looking session while the
    // prospect is absent, which is worse than a visible startup failure.
    try {
      await Promise.all([pair.mic.connect(), pair.system.connect()]);
    } catch (cause) {
      const error = new Error('[AudioCapture] Required dual-source WebSocket startup failed', {
        cause,
      }) as Error & { systemAudioStatus?: SystemAudioStartupStatus };
      error.systemAudioStatus = 'socket_connection_failed';
      throw error;
    }
    return {
      systemAudioSocketAvailable: true,
      systemAudioStatus: 'ready',
    };
  };

  let pair = createPair();
  let connectionStatus: CaptureSocketConnectionStatus;
  try {
    connectionStatus = await connectPair(pair);
  } catch (error) {
    console.error('[AudioCapture] Required microphone WebSocket connection failed:', error);
    console.log('[AudioCapture] Replacing the stale capture chat and retrying once...');
    closeCaptureWebSocket('mic');
    if (includeSystemAudio) closeCaptureWebSocket('system');

    const token = await getActiveAuthToken();
    const newChatId = await recreateChatId(BACKEND_URL, token);
    console.log('[AudioCapture] Recreated capture chat:', newChatId);

    pair = createPair();
    connectionStatus = await connectPair(pair);
  }

  console.log(
    `[AudioCapture] Microphone WebSocket connected; system=${connectionStatus.systemAudioStatus}`
  );
  return connectionStatus;
}

async function startMacSystemAudioCapture(
  eviaApi: any,
  timeline: CaptureSessionTimeline,
): Promise<void> {
  if (!eviaApi?.systemAudio) {
    const error = new Error('macOS system audio API is unavailable') as Error & {
      systemAudioStatus?: SystemAudioStartupStatus;
    };
    error.systemAudioStatus = 'unsupported';
    throw error;
  }

  console.log('[AudioCapture] macOS: starting SystemAudioDump concurrently with WebSocket handshakes');
  const previousHandler = (window as any)._systemAudioHandler;
  if (previousHandler && eviaApi.systemAudio.removeOnData) {
    eviaApi.systemAudio.removeOnData(previousHandler);
  }

  macSystemCaptureStartedAt = Date.now();
  let settleFirstChunk: (() => void) | null = null;
  let rejectFirstChunk: ((error: Error) => void) | null = null;
  let firstChunkSettled = false;
  const firstValidChunk = new Promise<void>((resolve, reject) => {
    settleFirstChunk = resolve;
    rejectFirstChunk = reject;
  });
  const systemAudioHandler = eviaApi.systemAudio.onData((audioData: {
    data: string;
    capturedAtUnixMs?: number;
  }) => {
    if (!isCurrentCaptureTimeline(timeline)) return;

    try {
      updateWsActivity('system');
      const isFirstSystemChunk = pipelineMetrics.lastSystemChunkTime === 0;
      pipelineMetrics.lastSystemChunkTime = Date.now();
      const binaryString = atob(audioData.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      if (typeof audioData.capturedAtUnixMs !== 'number' || !Number.isFinite(audioData.capturedAtUnixMs)) {
        throw new Error('[AudioCapture] System audio chunk is missing its capture PTS');
      }

      const metadata = timeline.createSystemFromEpochPts({
        capturedAtUnixMs: audioData.capturedAtUnixMs,
        observedAtUnixMs: Date.now(),
        observedAtPerformanceMs: performance.now(),
        sampleRate: SAMPLE_RATE,
        byteLength: bytes.byteLength,
      });

      if (DEBUG_SAVE_AUDIO) {
        debugAudioBuffers.system.push(new Int16Array(bytes.buffer.slice(0)));
      }

      // macOS delivers system audio from the helper binary over IPC - NOT
      // through sysProcessor.onaudioprocess, which only runs on the Windows
      // loopback path. The reference ring has to be fed here too, or the
      // canceller has no far-end signal on the platform we ship first.
      // Stamp when this chunk's FIRST sample was CAPTURED, not when it arrived.
      // ScreenCaptureKit's presentation timestamp crosses the helper and IPC as
      // Unix time, so the timeline has already validated and mapped the PTS to
      // the same session scale used by the microphone. There is deliberately no
      // receipt-time fallback: a foreign/implausible clock must fail startup.
      const referenceChunk = base64ToFloat32Array(audioData.data);
      const capturedAtPerformanceMs =
        timeline.originPerformanceMs + metadata.capture_start_ms;
      if (isFirstSystemChunk) {
        console.log(
          `[AudioCapture] First macOS system-audio chunk after ` +
          `${pipelineMetrics.lastSystemChunkTime - macSystemCaptureStartedAt}ms; ` +
          `timestamp=ScreenCaptureKit (${(Date.now() - audioData.capturedAtUnixMs).toFixed(1)}ms old)`
        );
      }
      referenceRing.write(
        referenceChunk,
        capturedAtPerformanceMs,
      );

      systemAudioBuffer.push({ data: audioData.data, timestamp: Date.now() });
      if (systemAudioBuffer.length > MAX_SYSTEM_BUFFER_SIZE) {
        systemAudioBuffer.shift();
      }

      const pcm = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const sendResult = sendCaptureChunk('system', pcm, metadata);
      if (sendResult === 'sent') {
        pipelineMetrics.systemChunksSent++;
      }
      if (!firstChunkSettled) {
        firstChunkSettled = true;
        settleFirstChunk?.();
      }
    } catch (error) {
      console.error('[AudioCapture] Error processing system audio data:', error);
      pipelineMetrics.errorsEncountered++;
      if (!firstChunkSettled) {
        firstChunkSettled = true;
        rejectFirstChunk?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });

  (window as any)._systemAudioHandler = systemAudioHandler;
  (window as any)._systemAudioIsWindows = false;

  let result = await eviaApi.systemAudio.start();
  if (!result.success && (result.code === 'already_running' || result.error === 'already_running')) {
    console.log('[AudioCapture] System audio helper already running, stopping and retrying...');
    await eviaApi.systemAudio.stop();
    await new Promise(resolve => setTimeout(resolve, 500));
    result = await eviaApi.systemAudio.start();
  }
  if (!result.success) {
    const error = new Error(result.error || 'System audio helper failed to start') as Error & {
      systemAudioStatus?: SystemAudioStartupStatus;
      minimumMacOS?: string;
      currentMacOS?: string;
    };
    const supportedStatus: SystemAudioStartupStatus[] = [
      'capture_failed',
      'capture_timeout',
      'permission_denied',
      'missing_binary',
      'spawn_failed',
      'invalid_audio_protocol',
      'unsupported_os',
      'unsupported',
    ];
    error.systemAudioStatus = supportedStatus.includes(result.code)
      ? result.code
      : 'capture_failed';
    error.minimumMacOS = result.minimumMacOS;
    error.currentMacOS = result.currentMacOS;
    throw error;
  }

  console.log(
    `[AudioCapture] System audio helper capture-ready${
      typeof result.readyInMs === 'number' ? ` after ${result.readyInMs}ms` : ''
    }`
  );
  await waitForFirstCaptureChunk(firstValidChunk, 'system');
  console.log('[AudioCapture] First timestamped system-audio chunk is ready');
  startMacSystemHealthCheck();
}

async function stopMacSystemAudioCaptureOnly(eviaApi: any): Promise<void> {
  stopMacSystemHealthCheck();
  macSystemCaptureStartedAt = 0;

  try {
    await eviaApi?.systemAudio?.stop?.();
  } catch (error) {
    console.warn('[AudioCapture] Failed to stop degraded macOS system-audio helper:', error);
  }

  const handler = (window as any)._systemAudioHandler;
  if (handler) {
    try {
      eviaApi?.systemAudio?.removeOnData?.(handler);
    } catch (error) {
      console.warn('[AudioCapture] Failed to remove macOS system-audio handler:', error);
    }
    (window as any)._systemAudioHandler = null;
  }

  closeCaptureWebSocket('system');
  systemAudioBuffer = [];
  pipelineMetrics.lastSystemChunkTime = 0;
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
async function setupMicProcessing(
  stream: MediaStream,
  timeline: CaptureSessionTimeline,
) {
  // ──────────────────────────────────────────────────────────────────────────
  // Bring up the echo canceller before the first microphone frame arrives.
  // ──────────────────────────────────────────────────────────────────────────
  if (DEBUG_DISABLE_CUSTOM_AEC) {
    const line = '[AEC] bypass enabled - capturing WITHOUT echo cancellation';
    console.log(line);
    sendDebugLog(line);
    disposeAec();
  } else {
    await initAec3();
  }

  const micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  const micSource = micAudioContext.createMediaStreamSource(stream);
  const micProcessor = micAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

  let audioBuffer: number[] = [];
  const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION; // 2400 samples

  let frameCounter = 0;
  let totalAudioLevel = 0;
  let silentFrames = 0;
  let settleFirstChunk: (() => void) | null = null;
  let rejectFirstChunk: ((error: Error) => void) | null = null;
  let firstChunkSettled = false;
  const firstChunk = new Promise<void>((resolve, reject) => {
    settleFirstChunk = resolve;
    rejectFirstChunk = reject;
  });

  micProcessor.onaudioprocess = (e) => {
    if (!isCurrentCaptureTimeline(timeline)) return;

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

    // Send when we have enough samples, holding AEC_MIC_RESERVE_CHUNKS behind.
    //
    // A mic chunk is cut the instant its last sample is captured, but the far
    // end audio covering that same instant is still in flight. Measured offline
    // against this pipeline's real timeline: 2184 of a reference window's 2400
    // samples were still unwritten, so the canceller was skipped for 91% of
    // chunks - silently, because a skipped chunk records no telemetry, which is
    // why the logs read refGap=0% while cancelling nothing at all.
    //
    // Keeping chunks in reserve makes the chunk being processed old enough that
    // its reference exists. It costs that much latency on the microphone path,
    // which is the price of the canceller working at all.
    while (audioBuffer.length >= samplesPerChunk * (1 + AEC_MIC_RESERVE_CHUNKS)) {
      // WINDOWS FIX: Perform periodic buffer maintenance to prevent memory pressure
      if (isWindowsPlatformGlobal) {
        performBufferMaintenance();
      }

      const chunk = audioBuffer.splice(0, samplesPerChunk);
      // Annotated: the canceller returns a Float32Array over ArrayBufferLike,
      // which does not assign to the inferred Float32Array<ArrayBuffer>.
      let float32Chunk: Float32Array = new Float32Array(chunk); // may be replaced by AEC

      if (DEBUG_SAVE_AUDIO) {
        micRawDebugBuffer.push(new Float32Array(float32Chunk));
      }

      // ──────────────────────────────────────────────────────────────────────
      // STEP 2: Apply TIME-ALIGNED AEC (Acoustic Delay Compensation)
      // ──────────────────────────────────────────────────────────────────────
      // The capture time of this chunk's FIRST sample, counted rather than
      // sampled: deriving it from the callback's own clock each time would put
      // scheduler jitter straight into the alignment. One origin, then count.
      if (micOriginMs === null) {
        const micPendingMs = (audioBuffer.length / SAMPLE_RATE) * 1000;
        const micChunkMs = (samplesPerChunk / SAMPLE_RATE) * 1000;
        micOriginMs = performance.now() - micPendingMs - micChunkMs;
      }
      const micChunkStartedAtMs = micOriginMs + (micSamplesConsumed / SAMPLE_RATE) * 1000;
      micSamplesConsumed += samplesPerChunk;

      // The reference debug track has to gain exactly one window per mic chunk,
      // including the chunks where the canceller does not run. mic-raw and mic
      // are both pushed unconditionally, so pushing the reference only from
      // inside the guard below shifts the tracks apart by however many chunks
      // were cut before the far end arrived - and on macOS that is guaranteed to
      // be some, because setupMicProcessing is awaited before the system helper
      // is even spawned, and the helper still has to clear a permission check
      // and start ScreenCaptureKit. aec-analyse-session.cjs cross-correlates
      // these two tracks over a +/-0.5s search to recover the real acoustic
      // delay, so a startup shift past that makes the one remaining
      // verification step report a delay that is not there - and its advice on
      // a pinned-at-zero delay is to RAISE the assumed latency, which would be
      // exactly the wrong move.
      let referenceForDebug: Float32Array | null = null;

      if (!DEBUG_DISABLE_CUSTOM_AEC && referenceRing.hasData) {
        try {
          // Sample-accurate reference for exactly this mic chunk. The window
          // deliberately starts before the expected echo: a reference that
          // leads is something a causal filter absorbs as leading zero taps,
          // whereas a reference that lags makes the echo non-causal and no
          // amount of adaptation can recover it. The previous code delayed the
          // reference 100ms against a 60.3ms measured path, i.e. exactly that
          // unrecoverable case.
          const { samples: sysF32, missingSamples } = referenceRing.referenceFor(
            micChunkStartedAtMs,
            samplesPerChunk,
          );

          // A window we could not fill is not a reference. AEC3 adapts to what
          // it is given, so a half-written window teaches it a path that does
          // not exist and it then has to un-learn. Skip the canceller rather
          // than feed it holes - and skip the reference too, so the two streams
          // stay aligned with each other across the gap. Never skip SENDING the
          // audio: losing the rep's words is the one outcome worse than bleed.
          referenceForDebug = sysF32;

          if (missingSamples === 0) {
            const originalChunk = new Float32Array(chunk);
            float32Chunk = runAecSync(originalChunk, sysF32);

            // Measure it. Four different things have been wrong here at various
            // points - alignment, filter length, whether the reference was fed
            // at all, whether the WASM module initialised - and a transcript
            // cannot tell them apart. These numbers can.
            if (!aecTelemetry) aecTelemetry = new AecTelemetry(SAMPLE_RATE);
            aecTelemetry.record(originalChunk, float32Chunk, sysF32, missingSamples);
            const maxLagSamples = Math.round((AEC3_MAX_TRACKABLE_DELAY_MS / 1000) * SAMPLE_RATE);
            const report = aecTelemetry.report(performance.now(), maxLagSamples);
            if (report) {
              const skipNote = aecSkippedChunks > 0 ? ` skipped=${aecSkippedChunks}` : '';
              aecSkippedChunks = 0;
              const line = `${describeReport(report)}${skipNote}`;
              console.log(line);
              // Also to the main process, which prints to the terminal. The
              // audio pipeline runs in the main window's renderer while the
              // console people actually read is the overlay's, so a log that
              // only goes to console.log here is invisible in practice - which
              // is exactly how the first two rounds of this were flown blind.
              sendDebugLog(line);
            }
          } else {
            // A skipped chunk records no telemetry, so without this the logs
            // read "refGap=0%" while the canceller runs on nothing - which is
            // exactly how 91% of chunks were silently skipped for a whole
            // release. Count every skip and surface it on the next report, and
            // if reports have stopped entirely, say so on a timer of its own.
            aecSkippedChunks += 1;
            const now = performance.now();
            if (now - lastSkipWarningAtMs >= 5000) {
              lastSkipWarningAtMs = now;
              const gapLine = `[AEC] reference window ${missingSamples}/${samplesPerChunk} samples ` +
                `short - canceller skipped (${aecSkippedChunks} chunks)`;
              console.warn(gapLine);
              sendDebugLog(gapLine);
            }
          }

          // Do not log from the 100 ms audio callback; console capture adds
          // jitter to the very timing this alignment depends on.
        } catch (error) {
          console.error('[AEC] ❌ AEC processing failed, using unprocessed audio:', error);
          // Fall back to unprocessed audio on AEC error
        }
      }

      // One window per mic chunk, always - digital silence when there was no
      // reference to read. This is what actually makes the four debug tracks
      // "sample-aligned by construction". aec-analyse-session.cjs rejects the
      // session if this alignment is broken.
      if (DEBUG_SAVE_AUDIO) {
        referenceDebugBuffer.push(
          referenceForDebug
            ? new Float32Array(referenceForDebug)
            : new Float32Array(samplesPerChunk),
        );
      }

      // ──────────────────────────────────────────────────────────────────────
      // STEP 3: Convert to PCM16 first (needed for both debug recorder AND backend)
      // ──────────────────────────────────────────────────────────────────────
      const pcm16 = convertFloat32ToInt16(float32Chunk);

      // We no longer hard-drop quiet chunks here in the audio callback.
      // Shared websocket sending now suppresses only sustained silence with a
      // short hangover, which reduces billed silence without clipping speech.

      // ──────────────────────────────────────────────────────────────────────
      // STEP 4: Send to backend (pcm16 already converted above)
      // ──────────────────────────────────────────────────────────────────────

      // 🎙️ AUDIO DEBUG: Save chunk for later WAV export
      if (DEBUG_SAVE_AUDIO) {
        debugAudioBuffers.mic.push(new Int16Array(pcm16));
      }

      // v1.0.0 FIX: Direct WebSocket send (no IPC routing!)
      // Taylos uses renderer-based WebSockets (unlike Glass which uses main process)
      updateWsActivity('mic');
      // sendAudioChunk owns connection-aware metadata+binary buffering. Always
      // create metadata first; a missing socket is a visible transport failure,
      // never permission to emit an unpaired binary frame or drop silently.
      try {
        const captureEndPerformanceMs = micChunkStartedAtMs + (samplesPerChunk / SAMPLE_RATE) * 1000;
        const metadata = timeline.createFromMonotonicInterval({
          source: 'mic',
          startPerformanceMs: micChunkStartedAtMs,
          endPerformanceMs: captureEndPerformanceMs,
          sampleRate: SAMPLE_RATE,
          byteLength: pcm16.byteLength,
        });
        const sendResult = sendCaptureChunk('mic', pcm16.buffer, metadata);
        if (!firstChunkSettled) {
          firstChunkSettled = true;
          settleFirstChunk?.();
        }
        if (sendResult === 'sent') {
          // WINDOWS FIX: Track pipeline metrics
          pipelineMetrics.micChunksSent++;
          pipelineMetrics.lastMicChunkTime = Date.now();

          // Log status every 100 chunks for monitoring
          if (pipelineMetrics.micChunksSent % 100 === 0) {
            const elapsed = (Date.now() - pipelineMetrics.sessionStart) / 1000;
            console.log(`[Pipeline] Status: ${pipelineMetrics.micChunksSent} mic chunks, ${pipelineMetrics.systemChunksSent} system chunks, ${elapsed.toFixed(0)}s elapsed, platform=${pipelineMetrics.platform}`);
          }
        }
      } catch (error) {
        console.error('[AudioCapture] ❌ Failed to send MIC chunk:', error);
        if (!firstChunkSettled) {
          firstChunkSettled = true;
          rejectFirstChunk?.(error instanceof Error ? error : new Error(String(error)));
        }
        try {
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', `[AudioCapture] ❌ SEND FAILED: ${error}`);
          }
        } catch { }
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

  return { context: micAudioContext, processor: micProcessor, firstChunk };
}

// Glass parity: Setup system audio processing with ScriptProcessorNode
function setupSystemAudioProcessing(
  stream: MediaStream,
  timeline: CaptureSessionTimeline,
) {
  const sysAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  const sysSource = sysAudioContext.createMediaStreamSource(stream);
  const sysProcessor = sysAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

  let audioBuffer: number[] = [];
  const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION; // 2400 samples
  let lastSilenceWarningAt = 0;
  let settleFirstChunk: (() => void) | null = null;
  let rejectFirstChunk: ((error: Error) => void) | null = null;
  let firstChunkSettled = false;
  const firstChunk = new Promise<void>((resolve, reject) => {
    settleFirstChunk = resolve;
    rejectFirstChunk = reject;
  });

  sysProcessor.onaudioprocess = (e) => {
    if (!isCurrentCaptureTimeline(timeline)) return;

    const inputData = e.inputBuffer.getChannelData(0);

    // Check if actually receiving audio
    const hasSound = inputData.some(sample => Math.abs(sample) > 0.01);
    const now = Date.now();
    if (!hasSound && DEBUG_SAVE_AUDIO && now - lastSilenceWarningAt >= 10_000) {
      console.warn('[AudioCapture] System audio data is silent!');
      lastSilenceWarningAt = now;
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

      // Continuous, sample-addressable reference for AEC. The chunk list below
      // is kept for the existing debug paths, but alignment no longer comes
      // from indexing it: 100ms chunks cannot express the 60.3ms measured
      // acoustic delay, and the two AudioContexts start at an arbitrary phase
      // from each other, so a chunk index was a per-session random offset.
      // Stamp the chunk's FIRST sample, not the callback. A chunk is cut at
      // 2400 samples while the processor delivers 2048, so the samples still
      // pending after the cut are more recent than this chunk - ignoring them
      // puts up to 85ms of constant error into the alignment.
      // The same capture-latency correction the macOS path needs: the loopback
      // audio in this buffer was rendered by the system before Chromium handed
      // it over, and a reference older than the mic window by more than the
      // acoustic delay cannot be cancelled at all.
      const sysPendingMs = (audioBuffer.length / SAMPLE_RATE) * 1000;
      const sysChunkMs = (samplesPerChunk / SAMPLE_RATE) * 1000;
      const sysChunkStartedAtPerformanceMs = performance.now() - sysPendingMs - sysChunkMs;
      referenceRing.write(
        float32Chunk,
        sysChunkStartedAtPerformanceMs - SYSTEM_CAPTURE_ASSUMED_LATENCY_MS,
      );

      // Add to system audio buffer (for AEC reference)
      systemAudioBuffer.push({
        data: base64Data,
        timestamp: Date.now(),
      });

      // Limit buffer size to prevent memory bloat
      if (systemAudioBuffer.length > MAX_SYSTEM_BUFFER_SIZE) {
        systemAudioBuffer.shift(); // Remove oldest chunk
      }

      // ──────────────────────────────────────────────────────────────────────
      // Send system audio to backend
      // ──────────────────────────────────────────────────────────────────────

      // 🎙️ AUDIO DEBUG: Save chunk for later WAV export
      if (DEBUG_SAVE_AUDIO) {
        debugAudioBuffers.system.push(new Int16Array(pcm16));
      }

      updateWsActivity('system');
      pipelineMetrics.lastSystemChunkTime = Date.now();
      try {
        const metadata = timeline.createFromMonotonicInterval({
          source: 'system',
          startPerformanceMs: sysChunkStartedAtPerformanceMs,
          endPerformanceMs: sysChunkStartedAtPerformanceMs + sysChunkMs,
          sampleRate: SAMPLE_RATE,
          byteLength: pcm16.byteLength,
        });
        const sendResult = sendCaptureChunk('system', pcm16.buffer, metadata);
        if (!firstChunkSettled) {
          firstChunkSettled = true;
          settleFirstChunk?.();
        }
        if (sendResult === 'sent') {
          // WINDOWS FIX: Track pipeline metrics
          pipelineMetrics.systemChunksSent++;
        }
      } catch (error) {
        console.error('[AudioCapture] Failed to send SYSTEM chunk:', error);
        pipelineMetrics.errorsEncountered++;
        if (!firstChunkSettled) {
          firstChunkSettled = true;
          rejectFirstChunk?.(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  };

  sysSource.connect(sysProcessor);
  sysProcessor.connect(sysAudioContext.destination); // Required for processing to work!

  return { context: sysAudioContext, processor: sysProcessor, firstChunk };
}

// v1.0.0 FIX: No IPC routing needed for mic audio
// Taylos uses renderer-based WebSockets (direct send from onaudioprocess)

// Glass parity: Start capture with explicit permission checks
async function startCaptureInternal(includeSystemAudio = false) {
  const captureStartupStartedAt = performance.now();
  console.log(`[AudioCapture] Starting capture (Glass parity: ScriptProcessorNode)... includeSystemAudio=${includeSystemAudio}`);

  // AUDIO DEBUG: Check IMMEDIATELY at function start
  console.log('[AudioDebug] ═══════════════════════════════════════');
  console.log('[AudioDebug] 🔍 CHECKING DEBUG FLAG NOW...');
  console.log('[AudioDebug] ═══════════════════════════════════════');

  try {
    const evia = (window as any).evia;
    console.log('[AudioDebug] window.evia exists?', !!evia);
    console.log('[AudioDebug] window.evia.checkDebugFlag exists?', !!evia?.checkDebugFlag);

    if (evia && (evia.getAudioDiagnosticConfig || evia.checkDebugFlag)) {
      const config = await loadAudioDiagnosticConfig();
      const enabled = config.saveAudio;

      console.log('[AudioDebug] Flag check result:', enabled);
      console.log('[AudioDebug] DEBUG_SAVE_AUDIO set to:', DEBUG_SAVE_AUDIO);

      if (DEBUG_SAVE_AUDIO) {
        debugSessionId = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        debugAudioBuffers = { mic: [], system: [] };
        micRawDebugBuffer = [];
        referenceDebugBuffer = [];

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

  const timeline = beginCaptureSession();
  macSystemCaptureStartedAt = 0;

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

  // GLASS PARITY FIX: Call getUserMedia FIRST (like Glass does at line 453)
  // This prevents the hang that was occurring when we tried to connect WebSocket before getUserMedia
  // Step 1: Request microphone permission (MOVED TO TOP!)
  try {
    console.log('[AudioCapture] 🎤 Requesting microphone access with constraints:', {
      sampleRate: SAMPLE_RATE,
      channelCount: 1,
      echoCancellation: !DEBUG_DISABLE_BROWSER_PROCESSING,
      noiseSuppression: !DEBUG_DISABLE_BROWSER_PROCESSING,
      autoGainControl: !DEBUG_DISABLE_BROWSER_PROCESSING
    });

    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) eviaIpc.send('debug-log', '[AudioCapture] 🎤 Requesting microphone access...');
    } catch { }

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: !DEBUG_DISABLE_BROWSER_PROCESSING,
        noiseSuppression: !DEBUG_DISABLE_BROWSER_PROCESSING,
        autoGainControl: !DEBUG_DISABLE_BROWSER_PROCESSING,
        // FIX ISSUE 2: Chrome-specific AEC and VAD constraints to aggressively filter system echo
        googEchoCancellation: !DEBUG_DISABLE_BROWSER_PROCESSING,
        googExperimentalEchoCancellation: !DEBUG_DISABLE_BROWSER_PROCESSING,
        googAutoGainControl: !DEBUG_DISABLE_BROWSER_PROCESSING,
        googNoiseSuppression: !DEBUG_DISABLE_BROWSER_PROCESSING,
        googHighpassFilter: !DEBUG_DISABLE_BROWSER_PROCESSING,
        googTypingNoiseDetection: !DEBUG_DISABLE_BROWSER_PROCESSING,
      } as any,
      video: false,
    });

    console.log('[AudioCapture] ✅ Microphone permission granted');
    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) eviaIpc.send('debug-log', '[AudioCapture] ✅ MIC STREAM ACQUIRED!');
    } catch { }

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
      } catch (e) { }
    }

    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) eviaIpc.send('debug-log', `[AudioCapture] 🎤 Got ${audioTracks.length} audio track(s)`);
    } catch { }

    if (audioTracks.length === 0) {
      throw new Error('[AudioCapture] No audio track in microphone stream');
    }

  } catch (error: any) {
    const errorMsg = `[AudioCapture] ❌ Microphone access denied: ${error.message}`;
    console.error(errorMsg);
    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) eviaIpc.send('debug-log', `❌ MIC FAILED: ${error.message}`);
    } catch { }
    throw new Error(`Microphone permission denied: ${error.message}`);
  }

  // getUserMedia remains first. Network and native system capture can then
  // start concurrently, but the microphone processing graph is intentionally
  // held until the required far-end path has produced timestamped audio.
  const eviaApi = (window as any).evia;
  const isMac = Boolean((window as any)?.platformInfo?.isMac);
  const socketConnectionsPromise = connectCaptureWebSockets(includeSystemAudio);
  const macSystemCapturePromise = includeSystemAudio && isMac
    ? startMacSystemAudioCapture(eviaApi, timeline)
        .then(() => ({ available: true, status: 'ready' as SystemAudioStartupStatus }))
    : Promise.resolve({
        available: false,
        status: includeSystemAudio
          ? ('unsupported' as SystemAudioStartupStatus)
          : ('not_requested' as SystemAudioStartupStatus),
      });

  const [socketStatus, macSystemStatus] = await Promise.all([
    socketConnectionsPromise,
    macSystemCapturePromise,
  ]);
  let systemAudioAvailable = false;
  let systemAudioStatus: SystemAudioStartupStatus = includeSystemAudio
    ? socketStatus.systemAudioStatus
    : 'not_requested';

  if (includeSystemAudio && isMac) {
    systemAudioAvailable =
      socketStatus.systemAudioSocketAvailable && macSystemStatus.available;
    systemAudioStatus = !socketStatus.systemAudioSocketAvailable
      ? socketStatus.systemAudioStatus
      : macSystemStatus.status;

    if (!systemAudioAvailable) throw new Error(`[AudioCapture] Required system audio failed: ${systemAudioStatus}`);
  }

  // Step 5: Setup system audio if requested (platform-specific approach)
  if (includeSystemAudio) {
    console.log('[AudioCapture] 🔊 Starting system audio capture...');

    try {
      const eviaApi = (window as any).evia;
      const isWindows = Boolean((window as any)?.platformInfo?.isWindows);
      const isMac = Boolean((window as any)?.platformInfo?.isMac);

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
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            } as MediaTrackConstraints,
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
          const sysSetup = setupSystemAudioProcessing(systemStream, timeline);
          systemAudioContext = sysSetup.context;
          systemAudioProcessor = sysSetup.processor;

          // Resume AudioContext if suspended
          if (systemAudioContext.state === 'suspended') {
            await systemAudioContext.resume();
          }
          await waitForFirstCaptureChunk(sysSetup.firstChunk, 'system');

          console.log('[AudioCapture] 🪟 ✅ Windows native loopback audio capture started successfully');
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', '[AudioCapture] 🪟 ✅ Windows system audio started via native loopback');
          }

          // Store flag for cleanup
          (window as any)._systemAudioIsWindows = true;
          (window as any)._systemAudioUsingLoopback = true;
          systemAudioAvailable = socketStatus.systemAudioSocketAvailable;
          systemAudioStatus = systemAudioAvailable
            ? 'ready'
            : socketStatus.systemAudioStatus;

        } catch (loopbackErr: any) {
          console.error('[AudioCapture] 🪟 Native loopback failed:', loopbackErr);
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            eviaIpc.send('debug-log', `[AudioCapture] 🪟 ❌ Native loopback failed: ${loopbackErr.message}`);
          }
          throw loopbackErr;
        }
      }
      // ════════════════════════════════════════════════════════════════════════
      // macOS: Use SystemAudioDump binary
      // ════════════════════════════════════════════════════════════════════════
      else if (isMac) {
        console.log(
          `[AudioCapture] macOS system audio status: ${systemAudioStatus}`
        );
      } else {
        console.error('[AudioCapture] System audio not supported on this platform');
        systemAudioAvailable = false;
        systemAudioStatus = 'unsupported';
        closeCaptureWebSocket('system');
        throw new Error('[AudioCapture] Required system audio is unsupported on this platform');
      }
    } catch (error: any) {
      console.error('[AudioCapture] System audio capture failed:', error);
      console.error('[AudioCapture] Error details:', {
        name: error.name,
        message: error.message,
      });

      systemAudioAvailable = false;
      systemAudioStatus = 'capture_failed';
      closeCaptureWebSocket('system');
      if ((window as any)?.platformInfo?.isMac) {
        console.warn('[AudioCapture] Please ensure Screen Recording permission is granted in System Settings');
      }
      throw error;
    }
  }

  console.log('[AudioCapture] Setting up mic audio processing after required transports are ready...');
  const micSetup = await setupMicProcessing(micStream, timeline);
  micAudioContext = micSetup.context;
  micAudioProcessor = micSetup.processor;
  if (micAudioContext.state === 'suspended') {
    await micAudioContext.resume();
    console.log('[AudioCapture] Mic AudioContext resumed');
  }
  await waitForFirstCaptureChunk(micSetup.firstChunk, 'mic');

  releaseCaptureTransport();

  const startupReadyInMs = Math.round(performance.now() - captureStartupStartedAt);
  console.log(`[AudioCapture] Capture started successfully after ${startupReadyInMs}ms`);
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
    startupReadyInMs,
    systemAudioAvailable,
    systemAudioStatus,
  };
}

export async function startCapture(includeSystemAudio = false) {
  try {
    return await startCaptureInternal(includeSystemAudio);
  } catch (error) {
    console.error('[AudioCapture] Startup failed; rolling back the capture session:', error);
    await stopCapture();
    throw error;
  }
}

// Stop capture and cleanup
export async function stopCapture(captureHandle?: any) {
  console.log('[AudioCapture] Stopping capture...');

  // WINDOWS FIX (2025-12-09): Mark capture as inactive
  isActivelyCapturing = false;
  captureTransportReady = false;
  captureStartupError = null;
  preReadyCaptureChunks = [];
  macSystemCaptureStartedAt = 0;
  lastMicReconnectAttempt = 0;
  lastSystemReconnectAttempt = 0;

  const debugAudioToSave = DEBUG_SAVE_AUDIO
    ? {
        sessionId: debugSessionId,
        mic: debugAudioBuffers.mic,
        micRaw: micRawDebugBuffer,
        system: debugAudioBuffers.system,
        reference: referenceDebugBuffer,
      }
    : null;
  debugAudioBuffers = { mic: [], system: [] };
  micRawDebugBuffer = [];
  referenceDebugBuffer = [];

  const cleanupErrors: unknown[] = [];
  const cleanup = async (label: string, action: () => void | Promise<void>) => {
    try {
      await action();
    } catch (error) {
      cleanupErrors.push(error);
      console.warn(`[AudioCapture] Cleanup failed (${label}):`, error);
    }
  };

  try {
    // WINDOWS FIX: Stop health check timers
    stopWindowsHealthCheck('mic');
    stopWindowsHealthCheck('system');
    stopMacSystemHealthCheck();

    // Stop mic processor
    if (micAudioProcessor) {
      await cleanup('mic processor', () => micAudioProcessor?.disconnect());
      micAudioProcessor = null;
    }

    // Close mic audio context
    if (micAudioContext) {
      await cleanup('mic context', () => micAudioContext?.close());
      micAudioContext = null;
    }

    // Stop all mic tracks
    if (micStream) {
      micStream.getTracks().forEach((track: MediaStreamTrack) => {
        try {
          track.stop();
        } catch (error) {
          cleanupErrors.push(error);
        }
        console.log(`[AudioCapture] Stopped MIC track: ${track.label}`);
      });
      micStream = null;
    }

    // FIX: Properly close mic WebSocket (disconnect AND remove from map to prevent double handlers)
    if (micWsInstance) {
      const chatId = localStorage.getItem('current_chat_id') || '';
      await cleanup('mic WebSocket', () => closeWebSocketInstance(chatId, 'mic'));
      micWsInstance = null;
    }

    // Stop system audio processor
    if (systemAudioProcessor) {
      await cleanup('system processor', () => systemAudioProcessor?.disconnect());
      systemAudioProcessor = null;
    }

    // Close system audio context
    if (systemAudioContext) {
      await cleanup('system context', () => systemAudioContext?.close());
      systemAudioContext = null;
    }

    // Stop all system tracks
    if (systemStream) {
      systemStream.getTracks().forEach((track: MediaStreamTrack) => {
        try {
          track.stop();
        } catch (error) {
          cleanupErrors.push(error);
        }
        console.log(`[AudioCapture] Stopped SYSTEM track: ${track.label}`);
      });
      systemStream = null;
    }

    // FIX: Properly close system WebSocket (disconnect AND remove from map to prevent double handlers)
    if (systemWsInstance) {
      const chatId = localStorage.getItem('current_chat_id') || '';
      await cleanup('system WebSocket', () => closeWebSocketInstance(chatId, 'system'));
      systemWsInstance = null;
    }

    // ──────────────────────────────────────────────────────────────────────
    // AEC CLEANUP: Dispose AEC instance and clear system audio buffer
    // ──────────────────────────────────────────────────────────────────────
    disposeAec();
    systemAudioBuffer = [];
    // The reference clock is per session. Carrying an origin across sessions
    // would align the next call's mic against the previous call's timeline,
    // which is precisely the misalignment this rewrite exists to remove.
    referenceRing.reset();
    captureTimeline = null;
    micOriginMs = null;
    micSamplesConsumed = 0;
    aecTelemetry = null;
    aecSkippedChunks = 0;
    lastSkipWarningAtMs = 0;
    // A failed load is per session too: a helper that was not running last time
    // must not condemn the next call to capturing raw for the rest of the app's
    // lifetime.
    aec3LoadFailed = false;
    console.log('[AudioCapture] ✅ AEC disposed and reference clock reset');

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
    if (cleanupErrors.length === 0) {
      console.log('[AudioCapture] Capture stopped successfully (mic + system)');
    } else {
      console.warn(`[AudioCapture] Capture stopped with ${cleanupErrors.length} cleanup error(s)`);
    }

    // Diagnostic disk I/O comes last so it cannot keep capture resources alive.
    if (debugAudioToSave) {
      try {
        console.log('[AudioDebug] Saving debug audio files...', {
          micChunks: debugAudioToSave.mic.length,
          micRawChunks: debugAudioToSave.micRaw.length,
          systemChunks: debugAudioToSave.system.length,
        });
        if (debugAudioToSave.mic.length > 0) {
          await saveDebugAudio('mic', debugAudioToSave.mic, debugAudioToSave.sessionId);
        }
        if (debugAudioToSave.micRaw.length > 0) {
          await saveDebugAudio(
            'mic-raw',
            debugAudioToSave.micRaw.map(chunk => convertFloat32ToInt16(chunk)),
            debugAudioToSave.sessionId
          );
        }
        if (debugAudioToSave.system.length > 0) {
          await saveDebugAudio('system', debugAudioToSave.system, debugAudioToSave.sessionId);
        }
        if (debugAudioToSave.reference.length > 0) {
          // Sample-aligned with mic-raw, which is what lets
          // `tools/aec-analyse-session.cjs` recover the real acoustic delay,
          // the real clock drift and the real coherence from a real call.
          await saveDebugAudio(
            'reference',
            debugAudioToSave.reference.map(chunk => convertFloat32ToInt16(chunk)),
            debugAudioToSave.sessionId
          );
        }
        console.log('[AudioDebug] Debug audio files saved successfully');
      } catch (error) {
        console.error('[AudioDebug] Failed to save debug audio:', error);
      }
    }
  } catch (error) {
    console.error('[AudioCapture] Error stopping capture:', error);
  } finally {
    micAudioProcessor = null;
    micAudioContext = null;
    micStream = null;
    micWsInstance = null;
    systemAudioProcessor = null;
    systemAudioContext = null;
    systemStream = null;
    systemWsInstance = null;
    systemAudioBuffer = [];
    (window as any)._systemAudioHandler = null;
    (window as any)._systemAudioIsWindows = undefined;
    (window as any)._systemAudioUsingLoopback = undefined;
    resetCaptureSessionState();
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

    if (evia && (evia.getAudioDiagnosticConfig || evia.checkDebugFlag)) {
      const config = await loadAudioDiagnosticConfig();
      const enabled = config.saveAudio;

      console.log('[AudioDebug] Flag check result:', enabled);
      console.log('[AudioDebug] DEBUG_SAVE_AUDIO set to:', DEBUG_SAVE_AUDIO);

      if (DEBUG_SAVE_AUDIO) {
        debugSessionId = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        debugAudioBuffers = { mic: [], system: [] };
        micRawDebugBuffer = [];
        referenceDebugBuffer = [];

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

  if (!providedMicStream || providedMicStream.getAudioTracks().length === 0) {
    throw new Error('[AudioCapture] No microphone stream provided');
  }

  const timeline = beginCaptureSession();
  pipelineMetrics.sessionStart = Date.now();
  pipelineMetrics.micChunksSent = 0;
  pipelineMetrics.systemChunksSent = 0;
  pipelineMetrics.errorsEncountered = 0;
  pipelineMetrics.lastMicChunkTime = 0;
  pipelineMetrics.lastSystemChunkTime = 0;
  pipelineMetrics.platform = (window as any).platformInfo?.platform || 'unknown';

  try {
    micStream = providedMicStream;
    systemStream = providedSystemStream || null;
    const isWindows = Boolean((window as any)?.platformInfo?.isWindows);

    // This entry point represents a two-sided call. Absence of the prospect
    // channel must never be reported as a successful mic-only capture.
    if (!systemStream && isWindows) {
      console.log('[AudioCapture] Windows: acquiring required native loopback stream');
      systemStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      (window as any)._systemAudioIsWindows = true;
      (window as any)._systemAudioUsingLoopback = true;
    }
    if (!systemStream || systemStream.getAudioTracks().length === 0) {
      throw new Error('[AudioCapture] Required system-audio stream is absent');
    }

    // Start the far-end graph first. Its opening frames are retained under the
    // bounded startup buffer while both WebSockets establish one chat session.
    const systemSetup = setupSystemAudioProcessing(systemStream, timeline);
    systemAudioContext = systemSetup.context;
    systemAudioProcessor = systemSetup.processor;
    if (systemAudioContext.state === 'suspended') {
      await systemAudioContext.resume();
    }

    const socketBarrier = connectCaptureWebSockets(true);
    await Promise.all([
      socketBarrier,
      waitForFirstCaptureChunk(systemSetup.firstChunk, 'system'),
    ]);

    // Only after the prospect path is physically producing timestamped PCM do
    // we start the microphone graph. Release still waits for its first frame,
    // so neither side can appear to start before the other is transport-ready.
    const micSetup = await setupMicProcessing(micStream, timeline);
    micAudioContext = micSetup.context;
    micAudioProcessor = micSetup.processor;
    if (micAudioContext.state === 'suspended') {
      await micAudioContext.resume();
    }
    await waitForFirstCaptureChunk(micSetup.firstChunk, 'mic');

    releaseCaptureTransport();
    console.log(
      `[AudioCapture] startCaptureWithStreams ready: ${timeline.id}/${timeline.generation}`,
    );
    return {
      micAudioContext,
      micAudioProcessor,
      micStream,
      systemAudioContext,
      systemAudioProcessor,
      systemStream,
      captureSessionId: timeline.id,
      captureGeneration: timeline.generation,
      systemAudioAvailable: true,
      systemAudioStatus: 'ready' as SystemAudioStartupStatus,
    };
  } catch (error) {
    console.error('[AudioCapture] Required dual-source startup failed:', error);
    await stopCapture();
    resetCaptureSessionState(timeline);
    throw error;
  }
}
