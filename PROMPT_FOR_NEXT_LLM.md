# PROMPT FOR NEXT LLM: Fast‑Track EVIA Desktop System Audio via Glass Capture (Keep EVIA Backend)

You are a senior engineer helping fix EVIA Desktop's system audio capture and transcription issues. I need your help to diagnose and solve a critical problem: **system audio is captured but sounds "alien-like" or "stretched" and cannot be transcribed by Deepgram**.

## Project Context

EVIA Desktop is an Electron overlay app that captures both microphone and system audio for real-time transcription. We're merging functionality from two codebases:

1. **EVIA**: A web app with FastAPI backend that uses Deepgram for STT and Groq for suggestions
2. **Glass**: A reference implementation that successfully captures system audio

Our approach uses:
- Electron main process spawns a native Swift helper using ScreenCaptureKit
- Helper captures system audio and sends it as PCM16 mono 16kHz frames
- Renderer process forwards audio to backend via WebSockets
- Backend uses Deepgram for transcription

## Current Status

- ✅ Mic/system WS connect; `dg_open=true`. Synthetic “EVIA connection OK” appears for both.
- ❌ System audio frames do not reach renderer/backend under Electron (no `[system] Chunk RMS=…`; backend `frames_enqueued=0`).
- ❌ Deepgram has nothing real to transcribe for system beyond synthetic OK.

## Detailed Problem Description

1. The SystemAudioCapture helper successfully captures system audio
2. The helper sends data to the Electron main process
3. The main process forwards data to the renderer
4. The renderer sends data to the backend via WebSocket
5. When exported to WAV, the system audio sounds completely distorted ("alien-like" or "stretched")
6. Deepgram receives the audio but cannot transcribe it

## Key Files

1. **Swift Helper**: `EVIA-Desktop/native/mac/SystemAudioCapture/Sources/SystemAudioCapture/main.swift`
   - Uses ScreenCaptureKit to capture system audio
   - Converts audio format and sends as base64-encoded PCM16

2. **Electron Main**: `EVIA-Desktop/src/main/main.ts`
   - Spawns the helper process
   - Forwards stdout data to renderer via IPC

3. **Electron Renderer**: `EVIA-Desktop/src/renderer/main.ts`
   - Processes audio data
   - Sends to backend via WebSocket

4. **Backend WebSocket**: `EVIA-Backend/backend/api/routes/websocket.py`
   - Receives audio data
   - Forwards to Deepgram for transcription

## Suspected Issues

1. **Sample rate mismatch**: The helper might be capturing at a different rate (e.g., 48kHz) but not properly converting to 16kHz
2. **Format conversion issues**: The conversion from native format to PCM16 might be incorrect
3. **Buffer size problems**: Incorrect buffer sizes might cause audio stretching
4. **Byte order issues**: Incorrect endianness handling could cause distortion
5. **Channel conversion**: Improper stereo to mono conversion might affect quality

## Fast‑Track Plan (Adopt Glass Capture; Keep EVIA Backend)

Goal: Restore reliable system audio quickly by reusing Glass’s proven macOS capture core and IPC framing while preserving EVIA’s backend WS protocol and data model.

Do this:
1. Vendor/port Glass macOS capture core (ScreenCaptureKit + robust resampling) to emit PCM16 mono 16 kHz ~100 ms frames.
2. Keep IPC minimal (stdout or domain socket). Subscribe once in Electron main; forward to renderer unchanged.
3. Renderer continues sending frames to `/ws/transcribe?source=system`. Retain Test Tone, counters, sys WAV export.
4. Add helper-side per‑second stats and a short `/tmp/sysaudio.wav` dump for diagnosis (remove later).
5. Validate A/B (tone/speech): helper→renderer→WS→Deepgram; expect non‑zero frames_enqueued and real transcripts.
6. Defer AEC to a later flag. After stability, plan Windows loopback and macOS codesign/notarization.

## Specific Requests

1. Implement the source swap to Glass mac capture (minimal changes around helper/IPC), preserving EVIA’s two‑WS protocol.
2. Ensure helper emits frames immediately under Electron (diagnostic logs: `first-chunk`, `converted`, `stats`).
3. Confirm renderer sees `[system] Chunk RMS=…` and backend shows `frames_enqueued>0` and live transcripts.
4. Keep security best practices (preload isolation, minimal IPC surface, CSP for packaged app).

## Task for You

Drive the fast‑track implementation above and verify end‑to‑end. Keep EVIA backend and WS protocol intact.

## Key Code Snippet (Swift Helper Audio Conversion)

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

Thank you for your help in solving this critical issue!
