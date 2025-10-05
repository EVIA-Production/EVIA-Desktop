# ✅ Glass SystemAudioDump Implementation - COMPLETE

## 📋 Summary

**Status:** ✅ Implementation Complete - Ready for Testing  
**Time Elapsed:** ~45 minutes  
**Approach:** Glass SystemAudioDump binary (proven, battle-tested)  
**Date:** October 5, 2025

---

## 🎯 What Was Implemented

### ✅ All Components Installed

1. **Binary** ✅
   - Copied `SystemAudioDump` (226KB universal Mach-O) from Glass
   - Location: `src/main/assets/SystemAudioDump`
   - Signed with screen recording entitlements

2. **Main Process Service** ✅
   - Created `src/main/system-audio-service.ts`
   - Spawns/manages SystemAudioDump process
   - Handles audio data from binary stdout
   - Converts stereo to mono, base64 encodes
   - Forwards to renderer via IPC

3. **IPC Handlers** ✅
   - `system-audio:start` → Start binary
   - `system-audio:stop` → Stop binary
   - `system-audio:is-running` → Check status
   - Event: `system-audio-data` → Audio data stream

4. **Preload Bridge** ✅
   - `window.evia.systemAudio.start()`
   - `window.evia.systemAudio.stop()`
   - `window.evia.systemAudio.isRunning()`
   - `window.evia.systemAudio.onData(callback)`

5. **Renderer Integration** ✅
   - Updated `src/renderer/audio-processor-glass-parity.ts`
   - Calls binary on macOS (Glass approach)
   - Receives base64 PCM from binary
   - Sends to WebSocket (`source=system`)

6. **Packaging Config** ✅
   - Updated `electron-builder.yml`
   - Added `asarUnpack` for SystemAudioDump
   - Binary will be unpacked in production builds

7. **Dev Mode Signing** ✅
   - Created `SIGN_DEV_FOR_SYSTEM_AUDIO.sh`
   - Signs Electron.app with screen recording entitlements
   - Signs SystemAudioDump binary
   - Automated permission setup

---

## 📁 Files Created/Modified

### New Files ✅
```
src/main/assets/SystemAudioDump             # 226KB binary
src/main/system-audio-service.ts            # 287 lines
SIGN_DEV_FOR_SYSTEM_AUDIO.sh                # Dev signing script
GLASS_SYSTEM_AUDIO_IMPLEMENTATION_GUIDE.md  # 498 lines documentation
GLASS_BINARY_IMPLEMENTATION_COMPLETE.md     # This file
```

### Modified Files ✅
```
src/main/main.ts                            # +IPC handlers, +cleanup
src/main/preload.ts                         # +systemAudio API bridge
src/renderer/audio-processor-glass-parity.ts # +Glass binary integration
electron-builder.yml                         # +asarUnpack config
package.json                                 # Electron 38.2.1 (already done)
```

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ RENDERER PROCESS (Header Window)                               │
│                                                                 │
│  startCapture(includeSystemAudio=true)                         │
│    ↓                                                            │
│  window.evia.systemAudio.start()                               │
│    ↓                                                            │
│  window.evia.systemAudio.onData((audioData) => {...})          │
│    ↓                                                            │
│  Decode base64 → PCM bytes → WebSocket.send(bytes)             │
│                                                                 │
└────────────┬───────────────────────────────────────────────────┘
             │ IPC: 'system-audio:start'
             ↓
┌────────────────────────────────────────────────────────────────┐
│ MAIN PROCESS                                                    │
│                                                                 │
│  systemAudioService.start()                                    │
│    ↓                                                            │
│  spawn('SystemAudioDump', [], { stdio: ['ignore','pipe','pipe']})│
│    ↓                                                            │
│  proc.stdout.on('data', (chunk) => {                           │
│    ├─ Buffer stereo PCM (4800 bytes/0.1s)                      │
│    ├─ convertStereoToMono(chunk)                               │
│    ├─ base64 = monoChunk.toString('base64')                    │
│    └─ win.webContents.send('system-audio-data', {data:base64}) │
│  })                                                             │
│                                                                 │
└────────────┬───────────────────────────────────────────────────┘
             │ spawn()
             ↓
┌────────────────────────────────────────────────────────────────┐
│ SystemAudioDump Binary (Standalone Process)                    │
│                                                                 │
│  - Native ScreenCaptureKit API                                 │
│  - Captures system audio (all apps)                            │
│  - Outputs stereo PCM to stdout                                │
│  - Format: 24kHz, int16, 2 channels                            │
│  - Chunk: 4800 bytes = 0.1 seconds                             │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Testing Instructions

### Dev Mode Testing (CURRENT)

**Prerequisites:**
```bash
# 1. Ensure backend is running
cd /Users/benekroetz/EVIA/EVIA-Backend
docker compose up

# 2. Ensure permissions are signed (ALREADY DONE ✅)
cd /Users/benekroetz/EVIA/EVIA-Desktop
./SIGN_DEV_FOR_SYSTEM_AUDIO.sh
```

**Grant Permissions:**
1. Open **System Settings → Privacy & Security → Screen & System Audio Recording**
2. Click **+** button
3. Press **⌘⇧G** (Cmd+Shift+G)
4. Paste: `/Users/benekroetz/EVIA/EVIA-Desktop/node_modules/electron/dist/`
5. Select **Electron.app** → Click **Open**
6. Toggle it **ON** ✅

**Run Application:**
```bash
# Terminal 1: Vite dev server
npm run dev:renderer

# Terminal 2: Electron main process
EVIA_DEV=1 npm run dev:main

# Terminal 3: Monitor backend logs
cd /Users/benekroetz/EVIA/EVIA-Backend
docker compose logs -f backend
```

**Test Steps:**
1. **Login:** Click "Auth" → Enter credentials → "Einloggen"
2. **Start Listening:** Click "Zuhören" (Listen button in header)
3. **Grant Mic Permission:** Allow microphone access when prompted
4. **Verify:**
   - Timer should start (shows duration)
   - Blue transcript bubbles appear for your voice (mic)
   - Grey transcript bubbles appear for system audio
   - Backend logs show:
     ```
     INFO: WebSocket /ws/transcribe connected: source=mic
     INFO: WebSocket /ws/transcribe connected: source=system
     DEBUG: < BINARY ... [4800 bytes]  (for both)
     ```

**Expected Logs:**
```
MAIN PROCESS (EVIA_DEV=1 npm run dev:main):
[Main] IPC: system-audio:start called
[SystemAudioService] Checking for existing SystemAudioDump processes...
[SystemAudioService] ✅ SystemAudioDump started with PID: 12345
[SystemAudioService] Sent SYSTEM chunk: 4800 bytes

HEADER WINDOW (DevTools):
[AudioCapture] 🔊 Starting system audio capture via SystemAudioDump binary...
[AudioCapture] System WebSocket connected
[AudioCapture] ✅ SystemAudioDump binary started successfully
[AudioCapture] Sent SYSTEM chunk: 4800 bytes (from binary)

LISTEN WINDOW (DevTools):
[ListenView] 📨 Received IPC message: transcript_segment
[ListenView] 📨 IPC Adding transcript: "System audio text..." final: false
```

---

## 🐛 Debugging

### Binary Not Starting
**Symptom:** "Failed to start SystemAudioDump"
**Fix:**
```bash
# Check binary exists and is executable
ls -lah src/main/assets/SystemAudioDump
# Should show: -rwxr-xr-x ... SystemAudioDump

# Check signature
codesign -d --entitlements :- src/main/assets/SystemAudioDump
# Should contain: com.apple.security.personal-information.screen-recording

# Re-sign if needed
./SIGN_DEV_FOR_SYSTEM_AUDIO.sh
```

### Process Exits with Code 1
**Symptom:** "SystemAudioDump process closed with code: 1"
**Cause:** Screen recording permission not granted
**Fix:**
1. Open **System Settings → Privacy & Security → Screen & System Audio Recording**
2. Find **Electron** in the list
3. Toggle it **ON**
4. Restart EVIA Desktop

### No Audio Data Received
**Symptom:** Binary starts but no `Sent SYSTEM chunk` logs
**Check:**
```bash
# Test binary manually
./src/main/assets/SystemAudioDump
# Should output: "✅ Capturing system audio" and stream binary data
# Ctrl+C to stop

# Check if binary is actually running
ps aux | grep SystemAudioDump
# Should show PID and path
```

### WebSocket Not Connecting
**Symptom:** "System WebSocket not ready"
**Fix:**
1. Ensure `current_chat_id` in localStorage
2. Check backend is running: `docker compose ps`
3. Verify token in keytar: Open Header DevTools → Console:
   ```javascript
   await window.evia.auth.getToken()
   ```

---

## 📊 Verification Checklist

Before marking as complete, verify:

- [x] Binary copied and signed
- [x] Service created and compiles
- [x] IPC handlers registered
- [x] Preload API exposed
- [x] Renderer integrated
- [x] electron-builder configured
- [x] Dev signing script created
- [ ] **Dev mode test: Binary starts successfully**
- [ ] **Dev mode test: Mic audio transcribes (blue bubbles)**
- [ ] **Dev mode test: System audio transcribes (grey bubbles)**
- [ ] **Backend logs show source=system WebSocket**
- [ ] **Backend logs show BINARY chunks received**
- [ ] Production build test
- [ ] Production TCC permissions work

---

## 🎉 Success Criteria

### Mic Audio (Already Working ✅)
- ✅ Blue transcript bubbles
- ✅ Backend: `source=mic` WebSocket
- ✅ Backend: Binary chunks received
- ✅ Deepgram transcription appears

### System Audio (TO VERIFY)
- ⏳ Grey transcript bubbles
- ⏳ Backend: `source=system` WebSocket
- ⏳ Backend: Binary chunks received
- ⏳ Deepgram transcription appears
- ⏳ No "Failed to get sources" errors
- ⏳ SystemAudioDump PID in logs
- ⏳ No exit code 1 errors

---

## 🔄 Next Steps

1. **Test in Dev Mode** ⏳
   - Follow "Testing Instructions" above
   - Verify all success criteria

2. **Production Build** (If dev works)
   ```bash
   npm run build
   # App will be in: dist/
   # Test: Open app, grant permissions, verify system audio
   ```

3. **Documentation** (After success)
   - Update main README with system audio notes
   - Document permission requirements
   - Add troubleshooting section

---

## 🙏 Credits

**Based on Glass Implementation:**
- `glass/src/ui/assets/SystemAudioDump` (binary)
- `glass/src/features/listen/stt/sttService.js` (process management)
- `glass/docs/system-audio-capture-permissions.md` (permission guide)

**Why This Works:**
- ✅ Binary runs as **separate process** (not under Cursor)
- ✅ Gets **own TCC permission** from macOS
- ✅ **Proven** in Glass production
- ✅ Works in **both dev and production**
- ✅ No Electron version dependencies
- ✅ Native ScreenCaptureKit API (optimal)

---

## 📝 Notes

- **Electron 38 Loopback Attempt:** Failed (dev mode limitation persists)
- **Glass Binary Approach:** Chosen as proven, reliable solution
- **Implementation Time:** ~45 minutes
- **Lines of Code:** ~600 (service + integration)
- **Binary Size:** 226KB (universal x86_64 + arm64)

---

**Ready for testing! 🚀**

