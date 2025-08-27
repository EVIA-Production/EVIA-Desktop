/**
 * EVIA Desktop - Audio Test Utility
 * Tests system audio capture without Deepgram dependency
 */

// Constants
const SAMPLE_RATE = 24000;
const AUDIO_CHUNK_DURATION = 0.1; // 100ms
const SAMPLES_PER_CHUNK = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

// Audio buffers
const audioBuffers = {
  system: [],
  mic: []
};

// Audio contexts
let captureContext = null;
let playbackContext = null;
let analyzerNode = null;
let visualizer = null;

/**
 * Initialize the audio test environment
 */
async function initAudioTest() {
  try {
    // Create separate contexts for capture and playback to avoid feedback
    captureContext = new AudioContext();
    playbackContext = new AudioContext();
    
    console.log('[AudioTest] Contexts created with sample rates:', 
      captureContext.sampleRate, playbackContext.sampleRate);
    
    // Create analyzer for visualization
    analyzerNode = playbackContext.createAnalyser();
    analyzerNode.fftSize = 2048;
    analyzerNode.connect(playbackContext.destination);
    
    // Initialize visualizer if canvas exists
    const canvas = document.getElementById('waveform');
    if (canvas) {
      visualizer = new WaveformVisualizer(canvas, analyzerNode);
      visualizer.start();
    }
    
    // Setup UI
    setupUI();
    
    return true;
  } catch (err) {
    console.error('[AudioTest] Failed to initialize audio test:', err);
    document.getElementById('status').textContent = 
      `Error: ${err.message}. Check console for details.`;
    return false;
  }
}

/**
 * Setup UI elements and event handlers
 */
function setupUI() {
  const playButton = document.getElementById('play-system-audio');
  if (playButton) {
    playButton.addEventListener('click', () => playSystemAudio(5)); // 5 second playback
  }
  
  const recordButton = document.getElementById('record-system-audio');
  if (recordButton) {
    recordButton.addEventListener('click', toggleSystemRecording);
  }
  
  const exportButton = document.getElementById('export-system-audio');
  if (exportButton) {
    exportButton.addEventListener('click', () => exportAudioToWav('system'));
  }
  
  const statusElement = document.getElementById('status');
  if (statusElement) {
    statusElement.textContent = 'Audio test initialized. Ready to capture.';
  }
}

// Recording state
let isRecording = false;
let systemAudioInterval = null;

/**
 * Toggle system audio recording
 */
function toggleSystemRecording() {
  const button = document.getElementById('record-system-audio');
  const statusElement = document.getElementById('status');
  
  if (!isRecording) {
    // Start recording
    isRecording = true;
    button.textContent = 'Stop Recording';
    statusElement.textContent = 'Recording system audio...';
    
    // Clear previous buffers
    audioBuffers.system = [];
    
    // Start system audio capture via IPC
    window.evia.systemAudio.start();
    
    // Setup data handler if not already
    window.evia.systemAudio.onData((data) => {
      try {
        const json = JSON.parse(data);
        const [_, rateStr, chStr] = json.mimeType.match(/rate=(\\d+);channels=(\\d+)/) || [];
        const inputRate = parseInt(rateStr) || 48000;
        const channels = parseInt(chStr) || 1;
        const float32 = base64ToFloat32Array(json.data);
        
        // Log source format info
        console.log(`[AudioTest] Received float32 audio: rate=${inputRate}Hz, channels=${channels}, samples=${float32.length}`);
        
        // Process system audio (convert to mono if needed)
        let monoData = float32;
        if (channels === 2) {
          monoData = new Float32Array(float32.length / 2);
          for (let i = 0; i < monoData.length; i++) {
            monoData[i] = (float32[i * 2] + float32[i * 2 + 1]) / 2;
          }
        }
        
        // Resample if needed
        const resampled = inputRate !== SAMPLE_RATE ? 
          downsampleLinear(monoData, inputRate, SAMPLE_RATE) : monoData;
        
        // Convert to Int16 for storage
        const pcm16 = convertFloat32ToInt16(resampled);
        
        // Store buffer
        audioBuffers.system.push(pcm16.buffer);
        
        // Update status with buffer count and duration
        const totalSamples = audioBuffers.system.reduce(
          (acc, buf) => acc + (new Int16Array(buf)).length, 0);
        const durationSec = totalSamples / SAMPLE_RATE;
        statusElement.textContent = 
          `Recording system audio... (${audioBuffers.system.length} buffers, ${durationSec.toFixed(1)}s)`;
          
        // Calculate RMS for level indication
        const rms = calculateRMS(pcm16);
        updateLevelMeter(rms);
        
      } catch (e) {
        console.error('[AudioTest] Error processing system audio:', e);
      }
    });
  } else {
    // Stop recording
    isRecording = false;
    button.textContent = 'Start Recording';
    
    // Stop system audio capture
    window.evia.systemAudio.stop();
    
    // Calculate final stats
    const totalSamples = audioBuffers.system.reduce(
      (acc, buf) => acc + (new Int16Array(buf)).length, 0);
    const durationSec = totalSamples / SAMPLE_RATE;
    
    statusElement.textContent = 
      `Recording stopped. Captured ${audioBuffers.system.length} buffers (${durationSec.toFixed(1)}s).`;
  }
}

/**
 * Play back the recorded system audio
 * @param {number} seconds - Number of seconds to play (from the end of recording)
 */
function playSystemAudio(seconds = 5) {
  if (!playbackContext) {
    console.error('[AudioTest] Playback context not initialized');
    return;
  }
  
  if (audioBuffers.system.length === 0) {
    document.getElementById('status').textContent = 'No audio recorded yet!';
    return;
  }
  
  try {
    // Combine all buffers
    const combinedBuffer = combineBuffers(audioBuffers.system);
    const int16Data = new Int16Array(combinedBuffer);
    
    // Convert to Float32 for playback
    const float32Data = convertInt16ToFloat32(int16Data);
    
    // Take the last N seconds
    const samplesToPlay = Math.min(float32Data.length, SAMPLE_RATE * seconds);
    const audioToPlay = float32Data.slice(-samplesToPlay);
    
    // Create audio buffer
    const audioBuffer = playbackContext.createBuffer(1, audioToPlay.length, SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(audioToPlay);
    
    // Create source and play
    const source = playbackContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyzerNode);
    source.start();
    
    document.getElementById('status').textContent = 
      `Playing ${seconds}s of recorded audio...`;
      
    // Update status when playback ends
    source.onended = () => {
      document.getElementById('status').textContent = 
        'Playback complete. Ready to record or play again.';
    };
  } catch (e) {
    console.error('[AudioTest] Error playing back system audio:', e);
    document.getElementById('status').textContent = 
      `Playback error: ${e.message}`;
  }
}

/**
 * Export recorded audio to WAV file
 * @param {string} type - 'system' or 'mic'
 */
function exportAudioToWav(type) {
  if (audioBuffers[type].length === 0) {
    document.getElementById('status').textContent = 'No audio to export!';
    return;
  }
  
  try {
    // Combine all buffers
    const combinedBuffer = combineBuffers(audioBuffers[type]);
    const int16Data = new Int16Array(combinedBuffer);
    
    // Create WAV file
    const wavBlob = createWavBlob(int16Data, SAMPLE_RATE);
    
    // Create download link
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}-audio-${new Date().toISOString()}.wav`;
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    
    document.getElementById('status').textContent = 
      `Exported ${type} audio to WAV file.`;
  } catch (e) {
    console.error(`[AudioTest] Error exporting ${type} audio:`, e);
    document.getElementById('status').textContent = 
      `Export error: ${e.message}`;
  }
}

/**
 * Create a WAV blob from PCM16 data
 * @param {Int16Array} pcmData - PCM audio data
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {Blob} - WAV file as blob
 */
function createWavBlob(pcmData, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  
  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write PCM data
  const pcmOffset = 44;
  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(pcmOffset + i * bytesPerSample, pcmData[i], true);
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Helper to write a string to a DataView
 */
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Combine multiple ArrayBuffers into one
 * @param {ArrayBuffer[]} buffers - Array of buffers to combine
 * @returns {ArrayBuffer} - Combined buffer
 */
function combineBuffers(buffers) {
  const totalLength = buffers.reduce((acc, buf) => acc + buf.byteLength, 0);
  const result = new ArrayBuffer(totalLength);
  const view = new Uint8Array(result);
  let offset = 0;
  
  for (const buffer of buffers) {
    view.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  
  return result;
}

/**
 * Convert Float32Array to Int16Array
 * @param {Float32Array} float32Array - Input audio data
 * @returns {Int16Array} - Converted audio data
 */
function convertFloat32ToInt16(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    // Convert -1.0...1.0 to -32768...32767
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return int16Array;
}

/**
 * Convert Int16Array to Float32Array
 * @param {Int16Array} int16Array - Input audio data
 * @returns {Float32Array} - Converted audio data
 */
function convertInt16ToFloat32(int16Array) {
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    // Convert -32768...32767 to -1.0...1.0
    float32Array[i] = int16Array[i] < 0 ? int16Array[i] / 32768 : int16Array[i] / 32767;
  }
  return float32Array;
}

/**
 * Downsample audio using linear interpolation
 * @param {Float32Array} input - Input audio data
 * @param {number} inputRate - Input sample rate
 * @param {number} outputRate - Output sample rate
 * @returns {Float32Array} - Downsampled audio data
 */
function downsampleLinear(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input;
  
  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  
  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const srcIndex = Math.floor(srcPos);
    const fraction = srcPos - srcIndex;
    
    if (srcIndex + 1 < input.length) {
      output[i] = input[srcIndex] * (1 - fraction) + input[srcIndex + 1] * fraction;
    } else {
      output[i] = input[srcIndex];
    }
  }
  
  return output;
}

/**
 * Calculate RMS (Root Mean Square) of audio buffer
 * @param {Int16Array|Float32Array} buffer - Audio buffer
 * @returns {number} - RMS value (0.0 to 1.0 for Float32, 0 to 32768 for Int16)
 */
function calculateRMS(buffer) {
  let sum = 0;
  const len = buffer.length;
  
  for (let i = 0; i < len; i++) {
    sum += buffer[i] * buffer[i];
  }
  
  return Math.sqrt(sum / len);
}

/**
 * Update level meter in UI
 * @param {number} rms - RMS value
 */
function updateLevelMeter(rms) {
  const meter = document.getElementById('level-meter');
  if (!meter) return;
  
  // Normalize RMS to 0-100 range with some headroom
  const normalized = Math.min(100, Math.max(0, rms / 327.68)); // 1% of max Int16
  meter.style.width = `${normalized}%`;
  
  // Color coding
  if (normalized > 80) {
    meter.style.backgroundColor = '#ff4d4d'; // Red for high levels
  } else if (normalized > 50) {
    meter.style.backgroundColor = '#ffcc00'; // Yellow for medium levels
  } else {
    meter.style.backgroundColor = '#4CAF50'; // Green for low levels
  }
}

/**
 * Convert base64 string to Float32Array
 * @param {string} base64 - Base64 encoded string
 * @returns {Float32Array} - Float32 audio data
 */
function base64ToFloat32Array(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return new Float32Array(bytes.buffer);
}

/**
 * Waveform visualizer class
 */
class WaveformVisualizer {
  constructor(canvas, analyzerNode) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.analyzer = analyzerNode;
    this.dataArray = new Uint8Array(this.analyzer.frequencyBinCount);
    this.running = false;
  }
  
  start() {
    this.running = true;
    this.draw();
  }
  
  stop() {
    this.running = false;
  }
  
  draw() {
    if (!this.running) return;
    
    requestAnimationFrame(() => this.draw());
    
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    this.analyzer.getByteTimeDomainData(this.dataArray);
    
    this.ctx.fillStyle = 'rgb(20, 20, 30)';
    this.ctx.fillRect(0, 0, width, height);
    
    this.ctx.lineWidth = 2;
    this.ctx.strokeStyle = 'rgb(0, 200, 0)';
    this.ctx.beginPath();
    
    const sliceWidth = width / this.dataArray.length;
    let x = 0;
    
    for (let i = 0; i < this.dataArray.length; i++) {
      const v = this.dataArray[i] / 128.0;
      const y = v * height / 2;
      
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
      
      x += sliceWidth;
    }
    
    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();
  }
}

// Export functions
window.audioTest = {
  init: initAudioTest,
  play: playSystemAudio,
  toggleRecording: toggleSystemRecording,
  export: exportAudioToWav
};
