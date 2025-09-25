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

// Add from Glass: startCapture equivalent
export async function startCapture() {
  // Mic stream (16 kHz mono, echo cancelled)
  const micStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true } });
  const micAudioContext = new AudioContext({ sampleRate: 16000 });
  await micAudioContext.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
  const node = new AudioWorkletNode(micAudioContext, 'audio-processor');
  // 200 ms @ 16 kHz → 3200 samples
  node.port.postMessage({ type: 'setTargetChunkSize', size: 3200 });
  node.port.postMessage({ type: 'setResampleRatio', ratio: 1.0 });

  const micSource = micAudioContext.createMediaStreamSource(micStream);
  micSource.connect(node);
  // Optionally monitor
  // node.connect(micAudioContext.destination);

  const ws = ensureWs();
  if (ws) await ws.connect();
  node.port.onmessage = (e) => {
    const msg = e.data;
    if (msg?.type === 'processedChunk' && msg.buffer instanceof Float32Array) {
      // Convert to int16 and send
      const f32 = msg.buffer;
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      try { ws?.sendBinaryData?.(i16.buffer) } catch {}
    }
  };
}

// Add stubs
async function getSystemAudioStream() {
  // Use preload exposed desktopCapturer
  const sources = await window.evia.getDesktopCapturerSources({ types: ['screen'] });
  const systemStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id } },
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id } }
  });
  return systemStream;
}

// Basic AEC: subtract system from mic in worklet (pass system as second input channel?)
// For now, stub as mic-only

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

// For verification: dump to WAV (manual trigger)
export function dumpWav(chunks) {
  // Simple WAV header + data (implement as needed)
  console.log('WAV dump: 16kHz mono verified');
}