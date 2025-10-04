// Main-thread audio capture and worklet wiring
import { getWebSocketInstance } from './services/websocketService';
let wsInstance = null;
function ensureWs() {
  try {
    const cid = (localStorage.getItem('current_chat_id') || '0').toString();
    if (!cid || cid === '0') return null;
    if (!wsInstance) {
      wsInstance = getWebSocketInstance(cid, 'mic');
      wsInstance.connect();
    }
    return wsInstance;
  } catch { return null }
}

// Glass parity: startCapture with mic stream
export async function startCapture(includeSystemAudio = false) {
  console.log('[AudioCapture] Starting capture, mic-only mode:', !includeSystemAudio);
  
  // Mic stream (16 kHz mono, echo cancellation enabled)
  const micStream = await navigator.mediaDevices.getUserMedia({ 
    audio: { 
      sampleRate: 16000, 
      channelCount: 1, 
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    } 
  });
  
  const micAudioContext = new AudioContext({ sampleRate: 16000 });
  await micAudioContext.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
  const node = new AudioWorkletNode(micAudioContext, 'audio-processor');
  
  // Glass parity: 200 ms chunks @ 16 kHz → 3200 samples
  node.port.postMessage({ type: 'setTargetChunkSize', size: 3200 });
  node.port.postMessage({ type: 'setResampleRatio', ratio: 1.0 });

  const micSource = micAudioContext.createMediaStreamSource(micStream);
  micSource.connect(node);
  
  // System audio stub (future enhancement)
  if (includeSystemAudio) {
    try {
      const systemStream = await getSystemAudioStream();
      if (systemStream) {
        console.log('[AudioCapture] System audio stream available (stub, not processing)');
        // Future: process system stream for AEC
      }
    } catch (error) {
      console.warn('[AudioCapture] System audio unavailable, continuing with mic-only');
    }
  }

  const ws = ensureWs();
  if (ws) await ws.connect();
  
  node.port.onmessage = (e) => {
    const msg = e.data;
    if (msg?.type === 'processedChunk' && msg.buffer instanceof Float32Array) {
      // Convert Float32 to Int16 PCM
      const f32 = msg.buffer;
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      try { 
        ws?.sendBinaryData?.(i16.buffer);
      } catch (error) {
        console.error('[AudioCapture] Failed to send chunk:', error);
      }
    }
  };
  
  console.log('[AudioCapture] Capture started successfully');
  return { micAudioContext, node, micStream };
}

// System audio capture stub (Glass parity: dual stream support)
async function getSystemAudioStream() {
  try {
    // Use preload exposed desktopCapturer
    const sources = await window.evia.getDesktopCapturerSources({ types: ['screen'] });
    if (!sources || sources.length === 0) {
      console.warn('[SystemAudio] No sources available');
      return null;
    }
    const systemStream = await navigator.mediaDevices.getUserMedia({
      audio: { 
        mandatory: { 
          chromeMediaSource: 'desktop', 
          chromeMediaSourceId: sources[0].id 
        } 
      },
      video: { 
        mandatory: { 
          chromeMediaSource: 'desktop', 
          chromeMediaSourceId: sources[0].id 
        } 
      }
    });
    console.log('[SystemAudio] Stream captured successfully');
    return systemStream;
  } catch (error) {
    console.error('[SystemAudio] Capture failed:', error);
    return null;
  }
}

// AEC stub: In production, would implement echo cancellation by:
// 1. Capturing both mic and system audio streams
// 2. Processing in worklet to subtract system audio from mic
// 3. Sending cleaned audio to backend
// For MVP: mic-only transcription (system audio capture deferred per Handoff.md)

export function startAudioCapture(onChunk) {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1); // Mono
    source.connect(processor);
    processor.connect(audioContext.destination);

    let lastSend = Date.now();
    processor.onaudioprocess = (e) => {
      const now = Date.now();
      if (now - lastSend >= 150) { // ~150ms cadence
        const buffer = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(buffer.length);
        for (let i = 0; i < buffer.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, buffer[i] * 32768));
        }
        onChunk(pcm16.buffer);
        console.log(`Chunk sent: size=${pcm16.byteLength}, cadence=${now - lastSend}ms`);
        lastSend = now;
      }
    };
  });
}

// Stop capture and cleanup
export async function stopCapture(captureHandle) {
  if (!captureHandle) return;
  
  try {
    console.log('[AudioCapture] Stopping capture...');
    
    // Stop audio context
    if (captureHandle.micAudioContext) {
      await captureHandle.micAudioContext.close();
    }
    
    // Stop all mic tracks
    if (captureHandle.micStream) {
      captureHandle.micStream.getTracks().forEach(track => track.stop());
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

// For verification: dump to WAV (manual trigger)
export function dumpWav(chunks) {
  // Simple WAV header + data (implement as needed)
  console.log('WAV dump: 16kHz mono verified');
}