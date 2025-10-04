// Glass parity: Audio capture using ScriptProcessorNode (reliable, no CSP issues)
import { getWebSocketInstance } from './services/websocketService';

const SAMPLE_RATE = 24000; // Glass parity
const BUFFER_SIZE = 2048;
const AUDIO_CHUNK_DURATION = 0.1; // 100ms chunks

let wsInstance = null;
let audioContext = null;
let audioProcessor = null;
let micStream = null;

function ensureWs() {
  try {
    const cid = (localStorage.getItem('current_chat_id') || '0').toString();
    if (!cid || cid === '0') {
      console.error('[AudioCapture] No chat_id available');
      return null;
    }
    if (!wsInstance) {
      wsInstance = getWebSocketInstance(cid, 'mic');
    }
    return wsInstance;
  } catch (error) {
    console.error('[AudioCapture] Failed to get WS instance:', error);
    return null;
  }
}

// Glass parity: Convert Float32 to Int16 PCM
function convertFloat32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}

// Glass parity: Setup microphone processing with ScriptProcessorNode
function setupMicProcessing(stream) {
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
      
      const ws = ensureWs();
      if (ws && ws.sendBinaryData) {
        try {
          ws.sendBinaryData(pcm16.buffer);
          console.log(`[AudioCapture] Sent chunk: ${pcm16.byteLength} bytes`);
        } catch (error) {
          console.error('[AudioCapture] Failed to send chunk:', error);
        }
      } else {
        console.error('[AudioCapture] WebSocket not ready');
      }
    }
  };

  micSource.connect(micProcessor);
  micProcessor.connect(micAudioContext.destination); // Required for processing to work!

  return { context: micAudioContext, processor: micProcessor };
}

// Glass parity: Start capture with explicit permission checks
export async function startCapture(includeSystemAudio = false) {
  console.log('[AudioCapture] Starting capture (Glass parity: ScriptProcessorNode)...');
  
  // Step 1: Ensure WebSocket is ready
  const ws = ensureWs();
  if (!ws) {
    throw new Error('[AudioCapture] No valid chat_id - cannot start capture');
  }
  
  // Step 2: Connect WebSocket first
  await ws.connect();
  console.log('[AudioCapture] WebSocket connected');
  
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
    
  } catch (error) {
    console.error('[AudioCapture] Microphone access denied:', error);
    throw new Error(`Microphone permission denied: ${error.message}`);
  }
  
  // Step 4: Setup audio processing
  const { context, processor } = setupMicProcessing(micStream);
  audioContext = context;
  audioProcessor = processor;
  
  // Step 5: Resume AudioContext (required by browsers)
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
    console.log('[AudioCapture] AudioContext resumed');
  }
  
  console.log('[AudioCapture] Capture started successfully');
  console.log(`[AudioCapture] Sample rate: ${SAMPLE_RATE} Hz, Chunk size: ${SAMPLE_RATE * AUDIO_CHUNK_DURATION} samples`);
  
  return { audioContext, audioProcessor, micStream };
}

// Stop capture and cleanup
export async function stopCapture(captureHandle) {
  console.log('[AudioCapture] Stopping capture...');
  
  try {
    // Stop processor
    if (audioProcessor) {
      audioProcessor.disconnect();
      audioProcessor = null;
    }
    
    // Close audio context
    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }
    
    // Stop all mic tracks
    if (micStream) {
      micStream.getTracks().forEach(track => {
        track.stop();
        console.log(`[AudioCapture] Stopped track: ${track.label}`);
      });
      micStream = null;
    }
    
    // Disconnect WebSocket
    if (wsInstance) {
      wsInstance.disconnect();
      wsInstance = null;
    }
    
    console.log('[AudioCapture] Capture stopped successfully');
  } catch (error) {
    console.error('[AudioCapture] Error stopping capture:', error);
  }
}

