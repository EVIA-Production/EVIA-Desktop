// Glass parity: Audio capture using ScriptProcessorNode (reliable, no CSP issues)
import { getWebSocketInstance, getOrCreateChatId, closeWebSocketInstance } from './services/websocketService';

const SAMPLE_RATE = 24000; // Glass parity
const BUFFER_SIZE = 2048;
const AUDIO_CHUNK_DURATION = 0.1; // 100ms chunks

// Mic audio state
let micWsInstance: any = null;
let micAudioContext: AudioContext | null = null;
let micAudioProcessor: ScriptProcessorNode | null = null;
let micStream: MediaStream | null = null;
let micWsDisconnectedLogged: boolean = false; // 🔧 FIX: Prevent spam logging

// System audio state  
let systemWsInstance: any = null;
let systemAudioContext: AudioContext | null = null;
let systemAudioProcessor: ScriptProcessorNode | null = null;
let systemStream: MediaStream | null = null;

// ──────────────────────────────────────────────────────────────────────────────
// 🎯 AEC (Acoustic Echo Cancellation) - Glass Parity with Speex WASM
// ──────────────────────────────────────────────────────────────────────────────
let aecModPromise: Promise<any> | null = null;
let aecMod: any = null;
let aecPtr: number = 0;

// System audio buffer for AEC reference (stores recent system audio chunks)
let systemAudioBuffer: Array<{ data: string; timestamp: number }> = [];
const MAX_SYSTEM_BUFFER_SIZE = 10;

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
      
      // 🔧 STEP 2: Verify heap buffers exist (critical for AEC to work)
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
  // 🔧 STEP 2: Enhanced AEC verification - check module, instance, AND heap
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
      
      // 🔧 FIX: Forward all transcript messages to Listen window via IPC
      // 🏷️ TAG with source so ListenView can infer speaker for status messages
      micWsInstance.onMessage((msg: any) => {
        if (msg.type === 'transcript_segment' || msg.type === 'status') {
          console.log('[AudioCapture] Forwarding MIC message to Listen window:', msg.type);
          // Forward to Listen window via IPC with source tag
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            // Tag message with _source: 'mic' (speaker 1)
            eviaIpc.send('transcript-message', { ...msg, _source: 'mic' });
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
    // 🔧 FIX: Use provided chatId or fall back to localStorage
    const cid = chatId || (localStorage.getItem('current_chat_id') || '0').toString();
    if (!cid || cid === '0') {
      console.error('[AudioCapture] ❌ No chat_id available for system audio WebSocket');
      console.error('[AudioCapture] Ensure getOrCreateChatId() is called before startCapture()');
      return null;
    }
    if (!systemWsInstance) {
      console.log('[AudioCapture] Creating system WebSocket (source=system, speaker=0) with chat_id:', cid);
      systemWsInstance = getWebSocketInstance(cid, 'system');
      
      // 🔧 FIX: Forward all transcript messages to Listen window via IPC
      // 🏷️ TAG with source so ListenView can infer speaker for status messages
      systemWsInstance.onMessage((msg: any) => {
        if (msg.type === 'transcript_segment' || msg.type === 'status') {
          console.log('[AudioCapture] Forwarding SYSTEM message to Listen window:', msg.type);
          // Forward to Listen window via IPC with source tag
          const eviaIpc = (window as any).evia?.ipc;
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
  // 🎯 STEP 2: Load AEC WASM module first (Glass parity) - with enhanced verification
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const mod = await getAec();
    if (mod && !aecPtr) {
      // Create AEC instance with verified parameters
      aecPtr = mod.newPtr(160, 1600, 24000, 1);
      
      // 🔧 STEP 2: Verify instance was actually created
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
  
  // 🔧 Silence gate - RMS threshold to prevent sending ambient noise
  const SILENCE_RMS_THRESHOLD = 0.01; // Adjust this value based on testing
  let silenceFrameCount = 0;

  micProcessor.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    
    // TypeScript compat: use Array.from instead of spread
    for (let i = 0; i < inputData.length; i++) {
      audioBuffer.push(inputData[i]);
    }

    // Send when we have enough samples
    while (audioBuffer.length >= samplesPerChunk) {
      const chunk = audioBuffer.splice(0, samplesPerChunk);
      let float32Chunk = new Float32Array(chunk); // Initial value (may be replaced by AEC)
      
      // ──────────────────────────────────────────────────────────────────────
      // 🎯 STEP 2: Apply AEC if system audio is available (Glass parity)
      // ──────────────────────────────────────────────────────────────────────
      if (systemAudioBuffer.length > 0) {
        try {
          // Get latest system audio chunk as AEC reference
          const latest = systemAudioBuffer[systemAudioBuffer.length - 1];
          const sysF32 = base64ToFloat32Array(latest.data);
          
          // 🔧 STEP 2: Run AEC and verify it actually processed
          const originalChunk = new Float32Array(chunk);
          float32Chunk = runAecSync(originalChunk, sysF32);
          
          // Only log success if AEC actually ran (check if output differs from input)
          if (float32Chunk !== originalChunk && aecMod && aecPtr) {
            console.log('[AEC] ✅ Applied WASM-AEC (Speex) - echo removed');
          }
        } catch (error) {
          console.error('[AEC] ❌ AEC processing failed, using unprocessed audio:', error);
          // Fall back to unprocessed audio on AEC error
        }
      }
      
      // ──────────────────────────────────────────────────────────────────────
      // 🎯 STEP 3: Silence gate - Skip if below threshold
      // ──────────────────────────────────────────────────────────────────────
      let sumSquares = 0;
      for (let i = 0; i < float32Chunk.length; i++) {
        sumSquares += float32Chunk[i] * float32Chunk[i];
      }
      const rms = Math.sqrt(sumSquares / float32Chunk.length);
      
      if (rms < SILENCE_RMS_THRESHOLD) {
        silenceFrameCount++;
        if (silenceFrameCount % 50 === 1) { // Log every 5 seconds (50 * 100ms)
          console.log(`[AudioCapture] 🔇 MIC SILENCE GATE: Suppressing silent audio (RMS: ${rms.toFixed(6)} < ${SILENCE_RMS_THRESHOLD})`);
        }
        continue; // Skip this chunk entirely
      }
      
      // Reset silence counter when audio detected
      if (silenceFrameCount > 0) {
        console.log(`[AudioCapture] 🎤 MIC AUDIO DETECTED after ${silenceFrameCount} silent frames (RMS: ${rms.toFixed(4)})`);
        silenceFrameCount = 0;
      }
      
      // ──────────────────────────────────────────────────────────────────────
      // 🎯 STEP 4: Convert to PCM16 and send to backend
      // ──────────────────────────────────────────────────────────────────────
      const pcm16 = convertFloat32ToInt16(float32Chunk);
      
      const ws = ensureMicWs();
      // 🔧 CRITICAL FIX: Verify WebSocket is actually connected before sending
      if (ws && ws.isConnected() && ws.sendBinaryData) {
        try {
          ws.sendBinaryData(pcm16.buffer);
          console.log(`[AudioCapture] Sent MIC chunk: ${pcm16.byteLength} bytes (RMS: ${rms.toFixed(4)}, AEC: ${systemAudioBuffer.length > 0 ? 'YES' : 'NO'})`);
        } catch (error) {
          console.error('[AudioCapture] ❌ Failed to send MIC chunk:', error);
        }
      } else if (ws && !ws.isConnected()) {
        // WebSocket exists but disconnected - log warning (avoid spam)
        if (!micWsDisconnectedLogged) {
          console.error('[AudioCapture] ❌ Mic WebSocket disconnected - cannot send audio data');
          micWsDisconnectedLogged = true;
        }
      } else {
        console.error('[AudioCapture] ❌ Mic WebSocket not ready');
      }
    }
  };

  micSource.connect(micProcessor);
  micProcessor.connect(micAudioContext.destination); // Required for processing to work!

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
      // 🎯 AEC INTEGRATION: Store system audio in buffer for AEC reference
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
      const chatId = localStorage.getItem('current_chat_id') || undefined;
      const ws = ensureSystemWs(chatId);
      if (ws && ws.sendBinaryData) {
        try {
          ws.sendBinaryData(pcm16.buffer);
          console.log(`[AudioCapture] Sent SYSTEM chunk: ${pcm16.byteLength} bytes`);
        } catch (error) {
          console.error('[AudioCapture] Failed to send SYSTEM chunk:', error);
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

// Glass parity: Start capture with explicit permission checks
export async function startCapture(includeSystemAudio = false) {
  console.log(`[AudioCapture] Starting capture (Glass parity: ScriptProcessorNode)... includeSystemAudio=${includeSystemAudio}`);
  
  // 🔧 FIX: Reset disconnection flag when starting new capture
  micWsDisconnectedLogged = false;
  
  // Step 1: Ensure mic WebSocket is ready
  let micWs = ensureMicWs();
  if (!micWs) {
    throw new Error('[AudioCapture] No valid chat_id - cannot start capture');
  }
  
  // Step 2: Connect mic WebSocket first (with auto-recreate on 403)
  try {
    await micWs.connect();
    console.log('[AudioCapture] Mic WebSocket connected');
  } catch (error) {
    console.error('[AudioCapture] Mic WebSocket connect failed:', error);
    
    // 🔧 FIX: Check if chat_id was cleared (signal for 403/404)
    const currentChatId = localStorage.getItem('current_chat_id');
    if (!currentChatId) {
      console.log('[AudioCapture] Chat ID was cleared - auto-creating new chat...');
      
      // Get backend URL and token
      const backendUrl = (window as any).EVIA_BACKEND_URL || 'http://localhost:8000';
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
  
  // Step 3: Request microphone permission explicitly
  try {
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
    
    console.log('[AudioCapture] Microphone permission granted');
    
    // Verify we got audio tracks
    const audioTracks = micStream.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error('[AudioCapture] No audio track in microphone stream');
    }
    
    console.log('[AudioCapture] Audio tracks:', audioTracks.map(t => ({
      label: t.label,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState,
    })));
    
  } catch (error: any) {
    console.error('[AudioCapture] Microphone access denied:', error);
    throw new Error(`Microphone permission denied: ${error.message}`);
  }
  
  // Step 4: Setup mic audio processing (with AEC)
  const micSetup = await setupMicProcessing(micStream);
  micAudioContext = micSetup.context;
  micAudioProcessor = micSetup.processor;
  
  // Step 5: Resume mic AudioContext (required by browsers)
  if (micAudioContext.state === 'suspended') {
    await micAudioContext.resume();
    console.log('[AudioCapture] Mic AudioContext resumed');
  }
  
  // Step 6: Setup system audio if requested (Glass binary approach)
  if (includeSystemAudio) {
    console.log('[AudioCapture] 🔊 Starting system audio capture via SystemAudioDump binary (Glass approach)...');
    
    try {
      // Glass parity: Use SystemAudioDump binary for macOS system audio
      // This bypasses the Electron permission issues in dev mode
      const eviaApi = (window as any).evia;
      
      if (!eviaApi?.systemAudio) {
        console.error('[AudioCapture] window.evia.systemAudio API not available');
        console.warn('[AudioCapture] Continuing with mic-only capture');
      } else {
        // Ensure system WebSocket is ready
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
          
          // 🔧 FIX: Check if chat_id was cleared (signal for 403/404)
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
        
        // Start SystemAudioDump binary
        const result = await eviaApi.systemAudio.start();
        if (!result.success) {
          console.error('[AudioCapture] Failed to start SystemAudioDump:', result.error);
          
          // Retry if already running
          if (result.error === 'already_running') {
            console.log('[AudioCapture] SystemAudioDump already running, stopping and retrying...');
            await eviaApi.systemAudio.stop();
            await new Promise(resolve => setTimeout(resolve, 500));
            const retryResult = await eviaApi.systemAudio.start();
            if (!retryResult.success) {
              throw new Error(`Retry failed: ${retryResult.error}`);
            }
          } else {
            throw new Error(result.error || 'Unknown error');
          }
        }
        
        console.log('[AudioCapture] ✅ SystemAudioDump binary started successfully');
        
        // Listen for system audio data from binary (via IPC)
        // Glass parity: Binary outputs stereo PCM, main process converts to mono base64
        const systemAudioHandler = eviaApi.systemAudio.onData((audioData: { data: string }) => {
          try {
            // Convert base64 to binary
            const binaryString = atob(audioData.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            
            // ──────────────────────────────────────────────────────────────────────
            // 🎯 AEC INTEGRATION: Store system audio in buffer for AEC reference
            // ──────────────────────────────────────────────────────────────────────
            // Data is already base64, so just store it directly
            systemAudioBuffer.push({
              data: audioData.data,
              timestamp: Date.now(),
            });
            
            // Limit buffer size to prevent memory bloat
            if (systemAudioBuffer.length > MAX_SYSTEM_BUFFER_SIZE) {
              systemAudioBuffer.shift(); // Remove oldest chunk
            }
            
            console.log(`[AudioCapture] 🔊 System audio buffer: ${systemAudioBuffer.length}/${MAX_SYSTEM_BUFFER_SIZE} chunks (from binary)`);
            
            // Send directly to WebSocket (already in PCM int16 format from binary)
            const chatId = localStorage.getItem('current_chat_id') || undefined;
            const ws = ensureSystemWs(chatId);
            if (ws && ws.sendBinaryData) {
              ws.sendBinaryData(bytes.buffer);
              console.log(`[AudioCapture] Sent SYSTEM chunk: ${bytes.byteLength} bytes (from binary)`);
            } else {
              console.warn('[AudioCapture] System WebSocket not ready');
            }
          } catch (error) {
            console.error('[AudioCapture] Error processing system audio data:', error);
          }
        });
        
        // Store handler for cleanup
        (window as any)._systemAudioHandler = systemAudioHandler;
        
        console.log('[AudioCapture] ✅ System audio capture started successfully (Glass binary)');
      }
    } catch (error: any) {
      console.error('[AudioCapture] System audio capture failed:', error);
      console.error('[AudioCapture] Error details:', {
        name: error.name,
        message: error.message,
      });
      
      console.warn('[AudioCapture] ⚠️  Continuing with mic-only capture');
      console.warn('[AudioCapture] Please ensure Screen Recording permission is granted in System Settings');
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
  
  try {
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
    
    // 🔧 FIX: Properly close mic WebSocket (disconnect AND remove from map to prevent double handlers)
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
    
    // 🔧 FIX: Properly close system WebSocket (disconnect AND remove from map to prevent double handlers)
    if (systemWsInstance) {
      const chatId = localStorage.getItem('current_chat_id') || '';
      closeWebSocketInstance(chatId, 'system');
      systemWsInstance = null;
    }
    
    // ──────────────────────────────────────────────────────────────────────
    // 🎯 AEC CLEANUP: Dispose AEC instance and clear system audio buffer
    // ──────────────────────────────────────────────────────────────────────
    disposeAec();
    systemAudioBuffer = [];
    console.log('[AudioCapture] ✅ AEC disposed and system audio buffer cleared');
    
    // Stop SystemAudioDump binary (Glass approach)
    const eviaApi = (window as any).evia;
    if (eviaApi?.systemAudio) {
      try {
        const result = await eviaApi.systemAudio.stop();
        if (result.success) {
          console.log('[AudioCapture] SystemAudioDump binary stopped');
        } else {
          console.warn('[AudioCapture] Failed to stop SystemAudioDump:', result.error);
        }
        
        // Remove system audio data handler
        const handler = (window as any)._systemAudioHandler;
        if (handler) {
          eviaApi.systemAudio.removeOnData(handler);
          (window as any)._systemAudioHandler = null;
          console.log('[AudioCapture] System audio handler removed');
        }
      } catch (error) {
        console.warn('[AudioCapture] Error stopping SystemAudioDump:', error);
      }
    }
    
    console.log('[AudioCapture] Capture stopped successfully (mic + system)');
  } catch (error) {
    console.error('[AudioCapture] Error stopping capture:', error);
  }
}

