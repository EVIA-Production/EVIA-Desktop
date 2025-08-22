# EVIA Desktop Audio Capture Project Summary

## Overview for Next LLM

You are tasked with fixing the system audio capture in the EVIA Desktop application. This document provides comprehensive context about our project, what we've done so far, and the specific issues we're facing. Our primary problem is that **system audio capture is not working correctly** - while we get permission grants and data flow, the audio is distorted ("alien-like") and not transcribable.

## Project Goal

Implement high-reliability real-time transcription for both microphone and system audio in EVIA Desktop (an Electron overlay application), with German language prioritization. This involves:

1. Capturing microphone audio via WebAudio API
2. Capturing system audio via a native macOS helper using ScreenCaptureKit
3. Streaming both audio sources to the backend via separate WebSocket connections
4. Processing audio with Deepgram for speech-to-text
5. Getting suggestions via Groq

## Initial Architecture

### EVIA Desktop (Electron App)
- **Main Process**: Spawns the native helper, handles IPC
- **Renderer Process**: UI, audio processing, WebSockets
- **Native Helper**: Swift CLI tool using ScreenCaptureKit to capture system audio

### Audio Flow
1. **Microphone**: getUserMedia → process (filter, gain, etc.) → WebSocket (`source=mic`)
2. **System Audio**: Native helper → stdout → IPC → Renderer → WebSocket (`source=system`)

### WebSocket Protocol
- Two separate connections per chat: `ws://backend/ws/transcribe?chat_id=X&token=Y&source=mic` and `ws://backend/ws/transcribe?chat_id=X&token=Y&source=system`
- Binary frames: PCM16 mono 16kHz audio chunks (100-200ms)
- JSON commands: `suggest`, `reset`, `history`
- Server responses: `transcript_segment`, `status`, `error`

## Key Files

### EVIA-Desktop
- `src/main/main.ts`: Electron main process, spawns helper, handles IPC
- `src/main/preload.cjs`: Secure bridge between main and renderer
- `src/renderer/main.ts`: UI, audio processing, WebSockets
- `native/mac/SystemAudioCapture/Sources/SystemAudioCapture/main.swift`: Native helper using ScreenCaptureKit
- `src/renderer/audio-debug.html`: Diagnostic tool for audio testing
- `src/renderer/permissions.html`: Permission workflow UI

### EVIA-Backend
- `backend/api/routes/websocket.py`: WebSocket endpoint, Deepgram integration
- `backend/api/main.py`: FastAPI app, CORS configuration
- `desktop-migration/*.md`: Documentation on desktop integration

## Changes Made So Far

### Permissions & Helper
1. Added proper permission handling in Swift helper with detailed status messages
2. Created a standalone launcher script to run the helper directly
3. Added a permissions reset script to clear and reset permissions
4. Implemented a permissions page with guided workflow
5. Added macOS version compatibility checks (`@available(macOS 13.0, *)`)
6. Added Info.plist for proper app identification

### Audio Processing
1. Applied Butterworth low-pass filter (3600Hz) to microphone audio
2. Adjusted adaptive gain (max 12.0) and soft limiting for mic
3. Temporarily disabled VAD (Voice Activity Detection) to ensure continuous audio flow
4. Added diagnostic tools to visualize and analyze audio

### Robustness
1. Implemented WebSocket reconnection with exponential backoff
2. Added watchdog for Deepgram connection status
3. Added JSON validation to handle non-JSON output from helper
4. Redirected helper debug output to stderr to keep stdout clean for data

### Debugging
1. Added WAV export functionality for both audio sources
2. Enhanced logging with RMS values, sample counts, and status messages
3. Created a diagnostic page to visualize audio waveforms and metrics
4. Added version info and debug output to the helper

## Current Status

### Working
1. Microphone capture is mostly working (with some interruptions)
2. Permission granting for both microphone and screen recording
3. WebSocket connections to backend for both sources
4. Deepgram transcription for microphone audio (partial success)

### Not Working
1. System audio transcription verification after chunk fix (expect success if WAV normal).
3. Mic functional; AEC pending for echo-free capture.

## Logs and Observations

1. The diagnostic tool shows a live diagram for mic input but only "System audio started!" for system audio
2. System audio WAV exports are completely incomprehensible
3. Terminal logs show successful permission grants:
   ```
   [SystemAudioCapture][stderr] {"status":"permission_granted","message":"Screen recording permission granted"}
   [SystemAudioCapture][stderr] {"status":"display_found","display_id":1,"width":1440,"height":900}
   [SystemAudioCapture][stderr] {"status":"starting_capture","message":"Starting audio capture stream"}
   ```
4. The WebSocket for system audio connects and receives `dg_open=true`, but later disconnects with code 1001

## Suspected Issues

1. **Sample rate mismatch**: The helper might be capturing at a different rate than expected (16kHz)
2. **Format issues**: The PCM data might be incorrectly formatted (e.g., wrong byte order, channels)
3. **Resampling problems**: The conversion from native audio format to 16kHz PCM16 might be incorrect
4. **Buffer handling**: Possible buffer overruns or underruns causing audio stretching
5. **Permission issues**: Despite permission grants, the actual audio capture might be restricted

## Comparison with Glass

The `glass/` repository successfully captures system audio using a similar approach:
- It also uses a native helper for macOS system audio capture
- It also processes the audio and sends it to Deepgram
- Key differences:
  1. Glass uses a more complex native helper with direct integration
  2. Glass applies AEC (Acoustic Echo Cancellation) using Rust/WASM
  3. Glass has a more mature audio processing pipeline
  4. We're trying to reuse EVIA's existing backend rather than adopting Glass's full stack

## Next Steps (Recommendations)

Fast-track plan (adopt Glass mac capture; keep EVIA backend):
1. Vendor/port Glass’s macOS system-audio capture module (ScreenCaptureKit + robust resampling) to emit PCM16 mono 16 kHz, ~100 ms frames.
2. Keep Electron IPC minimal (stdout or domain socket); subscribe once in main; forward to renderer unchanged.
3. Renderer continues to send frames to `/ws/transcribe?source=system`; retain Test Tone, WAV exports, counters.
4. Validate end-to-end with tone/speech; enable minimal helper stats and a short `/tmp` WAV dump for diagnosis.
5. Defer AEC to a feature flag post-stability; add Windows loopback plan next.

## Specific Request for Next LLM

Please help us fix the system audio capture in EVIA Desktop. The core issue is that while we're getting data from the SystemAudioCapture helper and successfully sending it to the backend, the audio is distorted ("alien-like") and not transcribable. 

Focus on:
1. Analyzing the Swift helper code to identify potential issues with audio format, sample rate, or resampling
2. Comparing our implementation with Glass's approach to see what we're missing
3. Suggesting specific code changes to fix the audio quality issues

Key questions:
- Is our audio format conversion in the Swift helper correct?
- Are we handling the PCM data properly in the Electron renderer?
- Could there be an issue with the audio buffer size or processing?
- Should we adopt more of Glass's audio processing code instead of our current approach?

All code is available in the repositories, and you can examine any file to understand the implementation details.

## Repository Structure

```
EVIA-Desktop/
├── native/
│   └── mac/
│       ├── launch_helper.sh
│       ├── test_audio.sh
│       └── SystemAudioCapture/
│           ├── Package.swift
│           └── Sources/
│               └── SystemAudioCapture/
│                   ├── main.swift
│                   └── Resources/
│                       └── Info.plist
├── src/
│   ├── main/
│   │   ├── main.ts
│   │   └── preload.cjs
│   └── renderer/
│       ├── main.ts
│       ├── audio-debug.html
│       ├── permissions.html
│       └── audio-utils.js
└── reset_permissions.sh

EVIA-Backend/
├── backend/
│   └── api/
│       ├── main.py
│       └── routes/
│           └── websocket.py
└── desktop-migration/
    ├── SUMMARY.md
    ├── WS_PROTOCOL.md
    ├── PLAN.md
    └── DECISIONS.md
```
