# Audio Capture Analysis: EVIA vs Glass

## System Audio Capture Comparison

This document provides a detailed analysis of the audio capture approaches in EVIA Desktop versus Glass, focusing on the system audio capture issues we're experiencing.

## Current Issues in EVIA Desktop

1. **System Audio Distortion**: System audio is captured but sounds "alien-like" or "stretched" when exported to WAV
2. **No Transcription**: Deepgram cannot transcribe the distorted system audio
3. **Microphone Interruptions**: Microphone audio has gaps and interruptions

## Glass Implementation Overview

Glass uses a more comprehensive approach to system audio capture:

1. **Native Helper**: Similar to our approach, but with more robust error handling and format conversion
2. **Audio Processing**: Extensive processing pipeline with proper resampling, filtering, and AEC
3. **Format Handling**: Explicit handling of audio format conversion and sample rate matching
4. **AEC Integration**: Uses Rust/WASM for Acoustic Echo Cancellation to improve audio quality

## Key Differences in Implementation

### 1. Audio Format Handling

**Glass**:
- Explicitly handles audio format conversion
- Ensures proper sample rate conversion
- Validates audio format parameters before processing

**EVIA**:
- Relies on ScreenCaptureKit's default format
- Uses simple conversion without validation
- May have incorrect sample rate assumptions

### 2. Audio Processing Pipeline

**Glass**:
- Multi-stage processing pipeline
- Proper resampling with anti-aliasing
- Sophisticated gain control
- Noise reduction and echo cancellation

**EVIA**:
- Basic processing with simple filters
- Limited gain control
- No echo cancellation
- Potentially incorrect resampling

### 3. Error Handling and Diagnostics

**Glass**:
- Comprehensive error handling
- Detailed diagnostics for audio format issues
- Fallback mechanisms for audio capture

**EVIA**:
- Basic error reporting
- Limited diagnostics for audio format
- No fallback mechanisms

## Suspected Root Causes

1. **Sample Rate Mismatch**: The Swift helper might be capturing at a different rate than expected (e.g., 48kHz) but not properly converting to 16kHz
   
2. **Format Conversion Issues**: The conversion from native audio format to PCM16 might be incorrect, leading to distorted audio

3. **Buffer Size Problems**: Incorrect buffer sizes might cause audio stretching or compression

4. **Byte Order Issues**: Incorrect byte order handling (endianness) could cause audio distortion

5. **Channel Conversion**: Improper stereo to mono conversion might affect audio quality

## Code Analysis

### Swift Helper Audio Conversion

The key issue likely lies in how we convert the audio in our Swift helper:

```swift
// In SystemAudioCapture/main.swift
func convert(_ sampleBuffer: CMSampleBuffer) -> Data? {
    guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return nil }
    
    var length: Int = 0
    var dataPointer: UnsafeMutablePointer<Int8>?
    CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer)
    
    guard let data = dataPointer else { return nil }
    
    let pcmBuffer = UnsafeBufferPointer<Int8>(start: data, count: length)
    let srcData = Data(buffer: pcmBuffer)
    
    // Create AVAudioPCMBuffer with the source format
    let srcFrameCapacity = AVAudioFrameCount(length) / srcFormat.streamDescription.pointee.mBytesPerFrame
    guard let srcPCMBuffer = AVAudioPCMBuffer(pcmFormat: srcFormat, frameCapacity: srcFrameCapacity) else { return nil }
    
    // Copy the data to the buffer
    srcPCMBuffer.frameLength = srcFrameCapacity
    let srcChannelData = srcPCMBuffer.int16ChannelData
    srcData.withUnsafeBytes { rawBufferPtr in
        let int16BufferPtr = rawBufferPtr.bindMemory(to: Int16.self)
        for i in 0..<Int(srcFrameCapacity) {
            for channel in 0..<Int(srcFormat.channelCount) {
                srcChannelData?[channel][i] = int16BufferPtr[i * Int(srcFormat.channelCount) + channel]
            }
        }
    }
    
    // Create a destination buffer
    guard let dstPCMBuffer = AVAudioPCMBuffer(pcmFormat: dstFormat, frameCapacity: dstFrameCapacity) else { return nil }
    
    // Convert the audio
    var error: NSError?
    converter?.convert(to: dstPCMBuffer, error: &error, withInputFrom: { _, _ in .haveData })
    
    if let error = error {
        print("Conversion error: \(error)")
        return nil
    }
    
    // Get the converted data
    guard let dstChannelData = dstPCMBuffer.int16ChannelData else { return nil }
    let dstData = Data(bytes: dstChannelData[0], count: Int(dstPCMBuffer.frameLength * dstFormat.streamDescription.pointee.mBytesPerFrame))
    
    return dstData
}
```

Potential issues in this code:
1. The sample rate conversion might not be properly configured
2. The channel data copying logic might be incorrect
3. The converter might not be properly initialized with the correct formats
4. The byte order (endianness) might not be handled correctly

## Recommendations for Next Steps

1. **Verify Audio Format Parameters**:
   - Log the actual format parameters from ScreenCaptureKit
   - Ensure source format matches what's being captured
   - Verify destination format is correctly set to 16kHz mono PCM16

2. **Improve Format Conversion**:
   - Use explicit format conversion with proper resampling
   - Ensure correct channel mapping (stereo to mono)
   - Handle byte order correctly

3. **Add Diagnostic Logging**:
   - Log audio format details at each stage
   - Add buffer size and sample count checks
   - Verify conversion ratios

4. **Consider Glass's Approach**:
   - Study Glass's audio processing pipeline more closely
   - Consider adopting parts of their code for format handling
   - Implement proper resampling with anti-aliasing

5. **Test Direct Audio Output**:
   - Modify the helper to output raw audio files directly
   - Compare with the audio received in the renderer
   - Isolate where the distortion is occurring

## Glass vs EVIA: Why Not Just Use Glass's Code?

While Glass successfully captures and processes system audio, we're not directly adopting their code for several reasons:

1. **Backend Integration**: EVIA has an existing backend with Deepgram integration that we want to reuse
2. **Architecture Differences**: Glass uses a different architecture for audio processing and transcription
3. **Complexity**: Glass's implementation is more complex and would require significant adaptation
4. **Incremental Approach**: We're trying to incrementally improve EVIA rather than replace it entirely

However, we should consider adopting more of Glass's audio processing code, particularly for format conversion and resampling, as our current approach is not working correctly.
