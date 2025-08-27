# PROMPT FOR NEXT LLM: Comprehensive EVIA-Glass Merge and Audio Capture Analysis

You are a senior engineer tasked with advancing the EVIA Desktop audio capture system. This prompt provides a full, self-contained summary of the project, merging insights from EVIA and Glass, with detailed analysis of the audio pipeline, problems, solutions, and testing steps. Use this to diagnose, fix, or extend the system without needing additional clarification. Focus on achieving undistorted, real-time German transcription via Deepgram.

## 1. Verbose Project Context: EVIA and Glass Merge

EVIA is a real-time meeting assistant for transcribing mic/system audio and generating AI suggestions (via Groq). It's a monorepo with:
- **EVIA-Desktop**: Electron overlay for capture (mic via WebAudio, system via macOS Swift helper). Streams PCM16 mono 16kHz to backend over two WebSockets (`source=mic`/`system`).
- **EVIA-Backend**: FastAPI + SQLModel/PostgreSQL/Redis. Handles `/ws/transcribe`, Deepgram STT, transcript persistence, metrics. Deployed on Azure.
- **EVIA-Frontend**: React/Vite for post-call dashboards, auth, chats.

We're merging Glass (OSS reference for capture/AEC/overlay) selectively: Adopt patterns for macOS system capture (ScreenCaptureKit, raw float32 emission) and JS processing (filtering/downsampling/chunking), but keep EVIA backend for centralized STT/AI. Merge extent: Concepts from Glass's `listenCapture.js` (e.g., stereo-to-mono, low-pass anti-aliasing) ported to EVIA's `main.ts`. Decisions: Prioritize macOS, defer AEC, reuse backend (see `desktop-migration/DECISIONS.md`).

## 2. Audio Capture Mini-Project Details

Goal: Capture macOS system audio (48kHz stereo float32), process to 16kHz mono PCM16 in 100ms chunks (1600 samples), stream to Deepgram without distortion.

**Pipeline**:
1. Swift (`main.swift`): Captures raw float32, interleaves, base64-encodes as JSON.
2. Electron main (`main.ts`): Spawns helper, IPC to renderer.
3. Renderer (`main.ts`): Decodes, mixes mono, low-pass filters (`OfflineAudioContext`), downsamples to 16kHz, chunks, converts to PCM16, sends via WS.
4. Backend (`websocket.py`): Buffers, forwards at 16kHz to Deepgram.

## 3. Problems Faced

- Distorted audio: Aliasing/stretching from downsampling without filters; old binary persistence (logs show 16kHz/1600-sample chunks).
- Binary issues: Updated Swift not loading (cached processes).
- Renderer errors: Unstable `BiquadFilterNode`; param mismatches.
- Chunking: Inconsistent sizes cause timing errors.
- Edges: Stereo handling, AirPods profiles, variable rates.

## 4. Plausible Solutions

- Reload binaries: Kill processes, rebuild, restart.
- Stabilize: Use `AudioWorklet` for filtering.
- Validate: Add stage-wise dumps/logs.
- Adopt more Glass: Full AEC if needed.

## 5. Codebase Scan

Key files: `main.swift`, `main.ts`, `websocket.py`. Issues: Rate/chunking pitfalls.

## 6. Testing Plan

1. Kill: `pkill -f Electron; pkill -f SystemAudioCapture`.
2. Rebuild: `cd .../SystemAudioCapture && swift build -c debug`.
3. Restart: `cd .../EVIA-Desktop && npm run dev:renderer | cat` (background), `EVIA_DEV=1 npm run dev:main`.
4. Analyze: Play tone, export WAV, `ffprobe`; check logs/transcripts.

Use this to propose fixes, focusing on pipeline stability.
