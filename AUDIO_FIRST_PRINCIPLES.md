# EVIA Desktop Audio Capture: First Principles Analysis

## Core Issues Identified

1. **Audio Worklet Path Issues**: 
   - The AudioWorklet module is being loaded from an incorrect path
   - Processor name mismatch: registered as 'audio-filter-processor' but accessed as 'audio-processor'

2. **Chunk Size Inconsistency**:
   - Log shows `sampleCount=64` instead of expected `sampleCount=2400`
   - Only later in the log do we see `sampleCount=2400` appearing
   - This inconsistency causes stuttering audio (rapid pause/play effect)

3. **Audio Feedback Loop**:
   - System is capturing its own output, creating a feedback loop
   - This explains why "the YouTube video gets overtuned by audio somehow produced by the overlay"

4. **Sample Rate Conversion Issues**:
   - Improper downsampling from 48kHz to 24kHz
   - Lack of proper anti-aliasing filter before downsampling

## First Principles Solution

### 1. Separate Audio Testing from Deepgram

We need to validate the audio capture pipeline independently from Deepgram:

```javascript
// Simple audio test that plays captured system audio locally
function testSystemAudio() {
  const audioContext = new AudioContext();
  const player = audioContext.createBufferSource();
  
  // Create a buffer from the last 5 seconds of captured system audio
  const buffer = audioContext.createBuffer(1, SAMPLE_RATE * 5, SAMPLE_RATE);
  const channelData = buffer.getChannelData(0);
  
  // Fill with our captured system audio data
  const combinedBuffer = combineBuffers(pcmBuffers.system);
  const float32Data = convertInt16ToFloat32(new Int16Array(combinedBuffer));
  channelData.set(float32Data.slice(-SAMPLE_RATE * 5));
  
  // Play it back
  player.buffer = buffer;
  player.connect(audioContext.destination);
  player.start();
}
```

### 2. Fix Buffer Management

The core issue is inconsistent buffer management. We need a proper buffer manager:

```javascript
class AudioBufferManager {
  constructor(targetSampleRate, targetChunkDuration) {
    this.targetSampleRate = targetSampleRate;
    this.targetChunkSize = Math.floor(targetSampleRate * targetChunkDuration);
    this.buffer = new Float32Array(0);
  }
  
  addData(newData, inputSampleRate) {
    // Resample if needed
    const resampled = inputSampleRate !== this.targetSampleRate 
      ? this.resample(newData, inputSampleRate, this.targetSampleRate) 
      : newData;
      
    // Append to buffer
    const newBuffer = new Float32Array(this.buffer.length + resampled.length);
    newBuffer.set(this.buffer);
    newBuffer.set(resampled, this.buffer.length);
    this.buffer = newBuffer;
    
    // Extract complete chunks
    const chunks = [];
    while (this.buffer.length >= this.targetChunkSize) {
      chunks.push(this.buffer.slice(0, this.targetChunkSize));
      this.buffer = this.buffer.slice(this.targetChunkSize);
    }
    
    return chunks;
  }
  
  resample(input, inputRate, outputRate) {
    // Proper resampling with anti-aliasing filter
    // ...implementation...
  }
}
```

### 3. Prevent Audio Feedback

To prevent the system from capturing its own output:

```javascript
// In main.ts
function setupAudioRouting() {
  // Create a separate audio context just for playback
  const playbackContext = new AudioContext();
  
  // Create a gain node to control volume
  const gainNode = playbackContext.createGain();
  gainNode.gain.value = 0.5; // 50% volume
  
  // Route audio to headphones only (if supported)
  if (playbackContext.setSinkId) {
    playbackContext.setSinkId('headphones')
      .catch(e => console.error('Could not route audio to headphones:', e));
  }
  
  // Connect gain to output
  gainNode.connect(playbackContext.destination);
  
  return { playbackContext, gainNode };
}
```

### 4. Proper AudioWorklet Path Resolution

```javascript
// In audio-processing.js
async function initAudioProcessing() {
  try {
    audioContext = new AudioContext();
    console.log('[Audio] Context created with sample rate:', audioContext.sampleRate);
    
    // Use a direct path for development
    const workletUrl = new URL('./audio-processor.js', import.meta.url).href;
    console.log('[Audio] Loading worklet from:', workletUrl);
    
    await audioContext.audioWorklet.addModule(workletUrl);
    audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');
    
    // Rest of initialization...
  } catch (err) {
    console.error('[Audio] Failed to initialize AudioWorklet:', err);
    // Fallback implementation...
  }
}
```

## Electron-Specific Audio Considerations

1. **Electron Audio Isolation**:
   - Electron's renderer process needs to be isolated from system audio output
   - Use `nodeIntegration: false` and proper preload scripts

2. **Permissions Management**:
   - Ensure proper permissions for audio capture
   - Handle permission requests gracefully

3. **Process Communication**:
   - Maintain clear separation between main and renderer processes
   - Use IPC for audio data transfer when necessary

## Testing Strategy

1. **Local Loopback Test**:
   - Capture system audio and immediately play it back locally
   - This validates the capture pipeline without involving Deepgram

2. **Audio File Export**:
   - Export captured audio as WAV files
   - Analyze them with external tools to verify quality

3. **Visual Waveform Analysis**:
   - Add waveform visualization to debug UI
   - Helps identify issues with sample rates, clipping, etc.

## Conclusion

The core issues stem from inconsistent buffer management, incorrect path resolution for AudioWorklet, and a potential audio feedback loop. By addressing these fundamental issues and implementing proper buffer management, we can create a stable system audio capture solution in Electron, independent of Deepgram integration.
