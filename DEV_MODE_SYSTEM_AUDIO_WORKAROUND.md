# 🎯 System Audio in Development Mode - Workaround

## ❌ The Problem

System audio capture **fails in development mode** with:
```
[Main] desktopCapturer.getSources error: Failed to get sources.
```

### Root Cause
In dev mode (`npm run dev:main`), Electron runs inside **Cursor's Electron instance**. macOS sees permission requests as coming from "Cursor.app", not your EVIA app.

---

## ✅ Solutions

### Option 1: Build & Run Production App (RECOMMENDED)
```bash
# 1. Build the app
npm run build

# 2. Run the built app (not via npm)
open -a "EVIA Desktop" 

# OR manually: drag EVIA Desktop.app from dist/ to /Applications
```

This creates a standalone app that macOS recognizes separately and grants permissions correctly.

---

### Option 2: Full Cursor Restart (Dev Mode Workaround)
```bash
# 1. Grant Screen Recording permission to Cursor
#    System Preferences > Security & Privacy > Screen Recording > ✓ Cursor

# 2. **COMPLETELY QUIT CURSOR** (not just close window)
#    Cmd+Q or Cursor > Quit Cursor

# 3. Restart Cursor from scratch

# 4. Test system audio
cd EVIA-Desktop
./TEST_SPRINT1.sh
```

**⚠️ Important**: Just closing the window isn't enough - you must **Quit Cursor entirely** for macOS to reload permissions.

---

### Option 3: Reset macOS Permissions (Nuclear Option)
If permissions are stuck/cached:

```bash
# Reset Screen Recording permission for ALL apps
tccutil reset ScreenCapture

# Then restart Cursor and grant permission again
```

---

## 🧪 How to Verify System Audio Works

### Expected Console Output (Header Window):
```
[AudioCapture] Starting dual capture (mic + system audio)...
[AudioCapture] Step 1: Getting desktop sources from Electron...
[AudioCapture] Step 2: Found 2 desktop sources
[AudioCapture] Using source: Built-in Display
[AudioCapture] System audio permission granted
[AudioCapture] System audio tracks: [{label: "...", enabled: true}]
[AudioCapture] System audio capture started successfully
```

### Backend Should Show:
```
[WebSocket] New connection: chat_id=X, source=mic, speaker=1
[WebSocket] New connection: chat_id=X, source=system, speaker=0
[Deepgram] Created stream for source=mic
[Deepgram] Created stream for source=system
```

### UI Should Show:
- **Blue bubbles on right** = Your mic (speaker=1)
- **Grey bubbles on left** = System audio (speaker=0)

---

## 🐛 Common Issues

### Issue: "No desktop sources available"
**Fix**: Grant Screen Recording permission and restart Cursor completely.

### Issue: "System audio tracks: []" (empty array)
**Fix**: 
1. Make sure audio is playing on your system BEFORE clicking "Zuhören"
2. Check System Preferences > Sound > Output device is working
3. Some apps (Spotify, etc.) may block audio capture

### Issue: Permission prompt keeps appearing
**Fix**: Click "Allow" and then **quit & restart Cursor** immediately.

---

## 📊 Dev vs Production Comparison

| Feature | Dev Mode (`npm run dev:main`) | Production (`open EVIA Desktop.app`) |
|---------|-------------------------------|--------------------------------------|
| **Permissions** | Granted to Cursor | Granted to EVIA Desktop |
| **System Audio** | ⚠️ Unreliable | ✅ Works reliably |
| **Hot Reload** | ✅ Yes | ❌ No |
| **Debugging** | ✅ Easy | ⚠️ Harder |
| **macOS Prompt** | Shows "Cursor" | Shows "EVIA Desktop" |

---

## 🎯 Recommendation

**For Sprint 1 testing**: Use **Option 1 (Production Build)** to properly test system audio capture and speaker diarization.

**For rapid development**: Use **Option 2 (Cursor Restart)** when making quick changes, but be aware of permission issues.

---

**Last Updated**: 2025-10-05  
**Status**: System audio requires production build or full IDE restart

