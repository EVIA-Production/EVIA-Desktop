# EVIA Desktop: Next Steps for Audio Capture

## Immediate Actions (Fast-Track)

1. Accumulate source audio in helper and emit proper 100ms chunks at 24k (done, with strict 2400-sample enforcement).

2. Wire Electron main to subscribe once and forward frames to renderer; maintain counters, Test Tone, and sys WAV export.

3. **Improve Audio Processing in Renderer**
   - Review the PCM data handling in `main.ts`
   - Ensure correct interpretation of binary data
   - Add format validation before processing

4. **Test with Direct Audio Output**
   - Validate `/tmp/src_sysaudio.wav` (48k float32) and `/tmp/sysaudio.wav` (16k PCM16) for speed/quality
   - Validate renderer sys WAV export without Test Tone
   - Ensure backend frames_enqueued>0 and transcripts present

## Medium-Term Improvements

1. **Adopt Better Audio Processing**
   - Consider implementing parts of Glass's audio processing pipeline
   - Add proper filtering and gain control
   - Implement AEC (Acoustic Echo Cancellation)

2. **Enhance Diagnostics**
   - Expand the audio-debug.html tool
   - Add spectral analysis for audio quality
   - Implement more detailed audio metrics

3. **Improve Robustness**
   - Add more fallback mechanisms
   - Implement adaptive quality based on system capabilities
   - Add automatic recovery from audio device changes

## Long-Term Goals

1. **Cross-Platform Support**
   - Extend to Windows using `desktopCapturer`
   - Add Linux support where possible
   - Ensure consistent audio quality across platforms

2. **Advanced Audio Features**
   - Implement noise suppression
   - Add audio enhancement for speech clarity
   - Consider speaker diarization improvements

3. **Performance Optimization**
   - Profile and optimize audio processing
   - Reduce latency in the capture pipeline
   - Optimize memory usage for long sessions

## Technical Debt to Address

1. **Code Organization**
   - Refactor audio processing into reusable modules
   - Improve separation of concerns in renderer code
   - Create proper abstraction layers for audio capture

2. **Testing Infrastructure**
   - Add automated tests for audio processing
   - Create test fixtures for audio formats
   - Implement CI/CD for audio quality validation

3. **Documentation**
   - Improve code documentation
   - Create architecture diagrams
   - Document audio format requirements and conversions

## Potential Solutions for Current Issues

### System Audio Distortion

1. **Verify Format Parameters**
   ```swift
   // Add to SystemAudioCapture/main.swift
   func logAudioFormatDetails(format: AVAudioFormat) {
       let desc = format.streamDescription.pointee
       print("""
           Audio Format Details:
           - Sample Rate: \(format.sampleRate) Hz
           - Channels: \(format.channelCount)
           - Format ID: \(desc.mFormatID)
           - Format Flags: \(desc.mFormatFlags)
           - Bytes Per Packet: \(desc.mBytesPerPacket)
           - Frames Per Packet: \(desc.mFramesPerPacket)
           - Bytes Per Frame: \(desc.mBytesPerFrame)
           - Bits Per Channel: \(desc.mBitsPerChannel)
           """)
   }
   ```

2. **Improve Resampling**
   ```swift
   // Replace current converter initialization with:
   let converterSettings: [String: Any] = [
       AVAudioConverterSampleRateKey: dstFormat.sampleRate,
       AVAudioConverterChannelLayoutKey: dstFormat.channelLayout as Any,
       AVAudioConverterQualityKey: AVAudioQualityHigh.rawValue
   ]
   converter = AVAudioConverter(from: srcFormat, to: dstFormat, with: converterSettings)
   ```

3. **Fix Byte Order Handling**
   ```swift
   // Ensure correct byte order when creating Int16 data
   srcData.withUnsafeBytes { rawBufferPtr in
       let int16BufferPtr = rawBufferPtr.bindMemory(to: Int16.self)
       for i in 0..<Int(srcFrameCapacity) {
           for channel in 0..<Int(srcFormat.channelCount) {
               // Handle endianness if needed
               let sample = int16BufferPtr[i * Int(srcFormat.channelCount) + channel]
               srcChannelData?[channel][i] = CFSwapInt16BigToHost(sample)
           }
       }
   }
   ```

### Microphone Interruptions

1. **Disable VAD Completely**
   ```typescript
   // In main.ts, remove or comment out all VAD-related code
   // For example, replace:
   if (rms > silenceThreshold) {
     // process audio
   }
   
   // With:
   // Always process audio regardless of RMS
   // process audio
   ```

2. **Improve Buffer Management**
   ```typescript
   // Increase buffer size and add overflow protection
   const buffer = new Float32Array(8192); // Larger buffer
   let bufferIndex = 0;
   
   proc.onaudioprocess = (e) => {
     const input = e.inputBuffer.getChannelData(0);
     
     // Ensure we don't overflow the buffer
     const remainingSpace = buffer.length - bufferIndex;
     const samplesToAdd = Math.min(input.length, remainingSpace);
     
     for (let i = 0; i < samplesToAdd; i++) {
       buffer[bufferIndex++] = input[i];
     }
     
     // Process complete chunks
     while (bufferIndex >= samplesPerChunk) {
       const chunk = buffer.slice(0, samplesPerChunk);
       // Process chunk...
       
       // Shift remaining data to beginning of buffer
       buffer.copyWithin(0, samplesPerChunk, bufferIndex);
       bufferIndex -= samplesPerChunk;
     }
   };
   ```

## Questions to Answer

1. What is the actual format of the audio being captured by ScreenCaptureKit?
2. Is the AVAudioConverter properly configured for our needs?
3. Are we handling the PCM data correctly in the Electron renderer?
4. How does Glass handle the format conversion and resampling?
5. Is there a simpler approach to system audio capture that would be more reliable?

## Resources

- [AVAudioConverter Documentation](https://developer.apple.com/documentation/avfoundation/avaudioconverter)
- [ScreenCaptureKit Documentation](https://developer.apple.com/documentation/screencapturekit)
- [Web Audio API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Glass Repository](https://github.com/pickle-com/glass)
- [Deepgram Documentation](https://developers.deepgram.com/docs/)

## Timeline Estimate

- **Week 1**: Analyze and fix audio format issues in SystemAudioCapture helper
- **Week 2**: Improve audio processing in renderer and test with direct audio output
- **Week 3**: Implement better audio processing pipeline and diagnostics
- **Week 4**: Cross-platform testing and performance optimization
