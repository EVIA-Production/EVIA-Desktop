# EVIA Desktop Audio: Next Steps Implementation

Based on our analysis of the audio issues and the latest test results, here are the specific implementation steps needed to fix the audio capture and processing pipeline:

## 1. Fix AudioWorklet Registration

The error `Failed to construct 'AudioWorkletNode': The node name 'audio-processor' is not defined in AudioWorkletGlobalScope` indicates the processor isn't being properly registered.

### Implementation:

1. **Check AudioWorklet Loading Path**:
   ```javascript
   // In audio-processing.js
   const workletUrl = new URL('./audio-processor.js', import.meta.url).href;
   console.log('[Audio] Loading worklet from:', workletUrl);
   ```

2. **Verify Processor Registration**:
   ```javascript
   // In audio-processor.js
   // Make sure this is at the bottom of the file
   registerProcessor('audio-processor', AudioProcessor);
   ```

3. **Add Error Handling for Module Loading**:
   ```javascript
   try {
     await audioContext.audioWorklet.addModule(workletUrl);
     console.log('[Audio] AudioWorklet module loaded successfully');
   } catch (err) {
     console.error('[Audio] Failed to load AudioWorklet module:', err);
     // Try with absolute path as fallback
     try {
       const absolutePath = window.location.origin + '/audio-processor.js';
       console.log('[Audio] Trying absolute path:', absolutePath);
       await audioContext.audioWorklet.addModule(absolutePath);
     } catch (e) {
       console.error('[Audio] All attempts to load AudioWorklet failed');
       throw e;
     }
   }
   ```

## 2. Implement Consistent Buffer Management

The logs show inconsistent chunk sizes - sometimes `sampleCount=64`, sometimes `sampleCount=2400`, sometimes `sampleCount=480`. This inconsistency causes stuttering audio.

### Implementation:

1. **Enforce Consistent Chunk Sizes**:
   ```javascript
   // In audio-processing.js
   function processSystemAudio(float32Data, inputSampleRate, channels) {
     // Add samples to the buffer manager
     systemBufferManager.addSamples(float32Data, inputSampleRate);
     
     // Only extract and process complete chunks
     const chunk = systemBufferManager.extractChunk(inputSampleRate);
     if (!chunk) {
       return new Int16Array(0); // Return empty buffer if not enough samples
     }
     
     // Process the complete chunk...
   }
   ```

2. **Debug Buffer Manager**:
   ```javascript
   // In audio-buffer-manager.js
   systemBufferManager.setDebugMode(true);
   ```

3. **Fix Chunk Size in Fallback Processing**:
   ```javascript
   // In audio-processing.js - fallbackProcessAudio function
   // Ensure consistent chunk sizes even in fallback mode
   const chunkSize = SAMPLES_PER_CHUNK;
   if (monoData.length < chunkSize) {
     // Pad with zeros if needed
     const paddedData = new Float32Array(chunkSize);
     paddedData.set(monoData);
     monoData = paddedData;
   } else if (monoData.length > chunkSize) {
     // Truncate to exact chunk size
     monoData = monoData.slice(0, chunkSize);
   }
   ```

## 3. Prevent Audio Feedback

The system is capturing its own output, creating a feedback loop.

### Implementation:

1. **Separate Audio Contexts**:
   ```javascript
   // In audio-processing.js
   let captureContext = null;  // For capturing audio
   let playbackContext = null; // For playing audio (optional)
   
   async function initAudioProcessing() {
     captureContext = new AudioContext();
     
     // Only create playback context if needed
     if (needsPlayback) {
       playbackContext = new AudioContext();
     }
     
     // Rest of initialization...
   }
   ```

2. **Mute Output During Capture**:
   ```javascript
   // In audio-processing.js
   function processSystemAudio(float32Data, inputSampleRate, channels) {
     // Process without connecting to audio output
     const offlineContext = new OfflineAudioContext(1, float32Data.length, inputSampleRate);
     
     // Create buffer source
     const source = offlineContext.createBufferSource();
     const buffer = offlineContext.createBuffer(1, float32Data.length, inputSampleRate);
     buffer.getChannelData(0).set(float32Data);
     source.buffer = buffer;
     
     // Connect to processor but not to destination
     source.connect(processorNode);
     // Do NOT connect processorNode to destination
     
     // Start processing...
   }
   ```

## 4. Test Without Deepgram

Validate the audio capture and processing pipeline independently before reintegrating with Deepgram.

### Implementation:

1. **Create Local Loopback Test**:
   ```javascript
   // In audio-test.js
   function testLocalAudio() {
     const testContext = new AudioContext();
     const source = testContext.createBufferSource();
     const buffer = testContext.createBuffer(1, SAMPLE_RATE * 5, SAMPLE_RATE);
     
     // Fill buffer with captured audio
     const channelData = buffer.getChannelData(0);
     // Get the last 5 seconds of audio
     const lastSamples = systemBufferManager.getLastNSeconds(5);
     channelData.set(lastSamples);
     
     // Play it back
     source.buffer = buffer;
     source.connect(testContext.destination);
     source.start();
   }
   ```

2. **Implement WAV Export for Analysis**:
   ```javascript
   // In audio-test.js
   function exportToWav() {
     const samples = systemBufferManager.getAllSamples();
     const wav = makeWav(convertFloat32ToInt16(samples).buffer, SAMPLE_RATE);
     
     // Create download link
     const link = document.createElement('a');
     link.href = wav;
     link.download = `system-audio-${Date.now()}.wav`;
     link.click();
   }
   ```

## 5. Fix Microphone Input

Investigate why microphone input consistently shows RMS=0.0000, indicating no audio is being captured.

### Implementation:

1. **Check Microphone Permissions**:
   ```javascript
   // In audio-processing.js
   async function checkMicrophonePermissions() {
     try {
       const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
       console.log('[Audio] Microphone permissions granted');
       return stream;
     } catch (err) {
       console.error('[Audio] Microphone permissions denied:', err);
       return null;
     }
   }
   ```

2. **Test Microphone Input Directly**:
   ```javascript
   // In audio-test.js
   async function testMicrophoneInput() {
     const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
     const micContext = new AudioContext();
     const micSource = micContext.createMediaStreamSource(micStream);
     
     // Create analyzer to visualize mic input
     const analyzer = micContext.createAnalyser();
     analyzer.fftSize = 2048;
     micSource.connect(analyzer);
     
     // Draw waveform
     const bufferLength = analyzer.frequencyBinCount;
     const dataArray = new Uint8Array(bufferLength);
     
     function draw() {
       requestAnimationFrame(draw);
       analyzer.getByteTimeDomainData(dataArray);
       
       // Calculate RMS
       let sum = 0;
       for (let i = 0; i < bufferLength; i++) {
         const normalized = (dataArray[i] - 128) / 128;
         sum += normalized * normalized;
       }
       const rms = Math.sqrt(sum / bufferLength);
       
       console.log('[Mic Test] RMS:', rms.toFixed(4));
       
       // Draw waveform...
     }
     
     draw();
   }
   ```

## Implementation Timeline

1. **Day 1**: Fix AudioWorklet registration and implement consistent buffer management
2. **Day 2**: Implement audio feedback prevention and create local loopback test
3. **Day 3**: Fix microphone input and integrate all components
4. **Day 4**: Test and debug with real-world scenarios
5. **Day 5**: Reintegrate with Deepgram and validate end-to-end functionality

## Testing Strategy

1. **Unit Testing**: Test each component individually
   - AudioWorklet registration
   - Buffer management
   - Audio processing pipeline
   - Microphone input

2. **Integration Testing**: Test components working together
   - System audio capture → processing → output
   - Microphone capture → processing → output

3. **End-to-End Testing**: Test complete flow
   - System audio capture → processing → Deepgram → transcription
   - Microphone capture → processing → Deepgram → transcription

## Conclusion

By implementing these specific fixes, we can address the core issues in the audio capture and processing pipeline. The most critical issues are the AudioWorklet registration, consistent buffer management, and preventing audio feedback. Once these are resolved, we can focus on reintegrating with Deepgram for transcription.

## System Audio Priority
- Stabilize system audio capture and transcription before mic.
- Verify non-zero RMS and clean WAV exports.

## WAV Export for Listening
- Implement button-triggered export of last 10s system audio to WAV.
- Avoid in-app playback to prevent feedback.

## Audio Test Button Fix
- Check IPC handler for 'launch-audio-test'.
- Ensure new window creation in main process.
- Test in dev mode.