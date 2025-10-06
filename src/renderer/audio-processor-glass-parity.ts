// Glass parity: Audio capture using ScriptProcessorNode (reliable, no CSP issues)
import { getWebSocketInstance } from './services/websocketService';

const SAMPLE_RATE = 24000; // Glass parity
const BUFFER_SIZE = 2048;
const AUDIO_CHUNK_DURATION = 0.1; // 100ms chunks

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
function ensureSystemWs() {
  try {
    const cid = (localStorage.getItem('current_chat_id') || '0').toString();
    if (!cid || cid === '0') {
      console.error('[AudioCapture] No chat_id available');
      return null;
    }
    if (!systemWsInstance) {
      console.log('[AudioCapture] Creating system WebSocket (source=system, speaker=0)');
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

// Glass parity: Setup microphone processing with ScriptProcessorNode
function setupMicProcessing(stream: MediaStream) {
  const micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  const micSource = micAudioContext.createMediaStreamSource(stream);
  const micProcessor = micAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

  let audioBuffer = [];
  const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION; // 2400 samples

  micProcessor.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    
    // Check if actually receiving audio
    const hasSound = inputData.some(sample => Math.abs(sample) > 0.01);
    if (!hasSound) {
      console.warn('[AudioCapture] Microphone data is silent!');
    }
    
    // TypeScript compat: use Array.from instead of spread
    for (let i = 0; i < inputData.length; i++) {
      audioBuffer.push(inputData[i]);
    }

    // Send when we have enough samples
    while (audioBuffer.length >= samplesPerChunk) {
      const chunk = audioBuffer.splice(0, samplesPerChunk);
      const pcm16 = convertFloat32ToInt16(new Float32Array(chunk));
      
      const ws = ensureMicWs();
      if (ws && ws.sendBinaryData) {
        try {
          ws.sendBinaryData(pcm16.buffer);
          console.log(`[AudioCapture] Sent MIC chunk: ${pcm16.byteLength} bytes`);
        } catch (error) {
          console.error('[AudioCapture] Failed to send MIC chunk:', error);
        }
      } else {
        console.error('[AudioCapture] Mic WebSocket not ready');
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

  let audioBuffer = [];
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
      const pcm16 = convertFloat32ToInt16(new Float32Array(chunk));
      
      const ws = ensureSystemWs();
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
  
  // Step 1: Ensure mic WebSocket is ready
  const micWs = ensureMicWs();
  if (!micWs) {
    throw new Error('[AudioCapture] No valid chat_id - cannot start capture');
  }
  
  // Step 2: Connect mic WebSocket first
  await micWs.connect();
  console.log('[AudioCapture] Mic WebSocket connected');
  
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
  
  // Step 4: Setup mic audio processing
  const micSetup = setupMicProcessing(micStream);
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
        const sysWs = ensureSystemWs();
        if (!sysWs) {
          throw new Error('[AudioCapture] Failed to create system audio WebSocket');
        }
        await sysWs.connect();
        console.log('[AudioCapture] System WebSocket connected');
        
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
            
            // Send directly to WebSocket (already in PCM int16 format from binary)
            const ws = ensureSystemWs();
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
    
    // Disconnect mic WebSocket
    if (micWsInstance) {
      micWsInstance.disconnect();
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
    
    // Disconnect system WebSocket
    if (systemWsInstance) {
      systemWsInstance.disconnect();
      systemWsInstance = null;
    }
    
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

