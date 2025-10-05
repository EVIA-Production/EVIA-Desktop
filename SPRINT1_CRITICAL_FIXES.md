# 🚨 Sprint 1: Critical Fixes Applied

**Date**: 2025-10-05  
**Issues Fixed**: Timer not stopping + System audio dev mode limitation

---

## ❌ Issues Identified from Testing

### 1. **Timer Kept Running After "Stopp"** 🕐
**Problem**: Clicking "Stopp" button didn't stop the timer. It kept counting even though recording stopped.

**Root Cause**: The timer was only stopped on component unmount, but the Listen window stays visible after "Stopp" (it shows the "Done" state for insights). The component never unmounted until you clicked the button a third time to hide the window.

**Fix Applied**: 
- Modified `overlay-entry.tsx` to send a `recording_stopped` IPC message when capture stops
- Modified `ListenView.tsx` to listen for this message and stop the timer immediately
- Timer now stops **exactly when "Stopp" is pressed**, regardless of window visibility

---

### 2. **System Audio Capture Failed** 📢
**Problem**: 
```
[Main] desktopCapturer.getSources error: Failed to get sources.
```
No system audio was captured. Backend only showed `source=mic` connections.

**Root Cause**: **Development mode limitation**

In dev mode (`npm run dev:main`), Electron runs inside Cursor's process. macOS treats permission requests as coming from "Cursor.app", not your EVIA app.

**Why the Permission Prompt Showed Cursor**:
- ✅ **This is correct behavior** for development mode
- The app is literally running inside Cursor's Electron instance
- macOS correctly identifies the requesting process as "Cursor"

**Fix Required**: One of three options:

#### Option A: Build & Run Production App (RECOMMENDED) ✅
```bash
cd EVIA-Desktop

# 1. Build the app
npm run build

# 2. Find the built app
ls -la dist/mac/

# 3. Run it (or drag to /Applications first)
open dist/mac/EVIA\ Desktop.app
```

This creates a standalone `.app` that macOS recognizes separately.

#### Option B: Restart Cursor Completely 🔄
```bash
# 1. Grant Screen Recording permission to Cursor
#    System Preferences > Security & Privacy > Screen Recording > ✓ Cursor

# 2. QUIT CURSOR ENTIRELY (Cmd+Q or Cursor > Quit)
#    ⚠️ Just closing the window won't work!

# 3. Restart Cursor from Finder/Dock

# 4. Test again
cd EVIA-Desktop
npm run dev:main
```

**⚠️ Critical**: macOS caches permissions. You MUST quit and restart Cursor for it to take effect.

#### Option C: Reset macOS Permissions (Last Resort) ☢️
```bash
# Reset all Screen Recording permissions
tccutil reset ScreenCapture

# Then grant to Cursor and restart
```

---

## ✅ What Was Fixed in Code

### `/src/renderer/overlay/overlay-entry.tsx`
```typescript
// When stopping capture, notify Listen window
eviaIpc.send('transcript-message', { type: 'recording_stopped' });
```

### `/src/renderer/overlay/ListenView.tsx`
```typescript
// Handle recording_stopped message
if (msg.type === 'recording_stopped') {
  console.log('[ListenView] 🛑 Recording stopped - stopping timer');
  stopTimer();
  setIsSessionActive(false);
}
```

### Added Documentation
- `DEV_MODE_SYSTEM_AUDIO_WORKAROUND.md` - Full guide for system audio in dev mode
- This file - Summary of critical fixes

---

## 🧪 How to Test Fixes

### Test 1: Timer Now Stops Correctly ✅
```bash
# 1. Start dev mode
npm run dev:vite  # Terminal 1
npm run dev:main  # Terminal 2

# 2. Click "Zuhören" (timer starts)
# 3. Speak into mic (should see transcripts)
# 4. Click "Stopp" (timer should IMMEDIATELY stop)
# 5. Verify in console: "[ListenView] 🛑 Recording stopped - stopping timer"
```

**Expected Console Output (Listen Window)**:
```
[ListenView] 📨 Received IPC message: recording_stopped
[ListenView] 🛑 Recording stopped - stopping timer
```

---

### Test 2: System Audio (Production Mode) ✅

**Step 1: Build the app**
```bash
npm run build
```

**Step 2: Grant Permission**
1. Open `dist/mac/EVIA Desktop.app`
2. macOS will prompt: "EVIA Desktop would like to record your screen"
3. Click "Allow"

**Step 3: Test System Audio**
1. Play YouTube video or Spotify
2. In EVIA, click "Zuhören"
3. Speak into mic AND let system audio play

**Expected Console Output (Header Window)**:
```
[AudioCapture] Starting dual capture (mic + system audio)...
[AudioCapture] Found 2 desktop sources
[AudioCapture] System audio tracks: [{label: "Built-in Display", enabled: true}]
[AudioCapture] System audio capture started successfully
[AudioCapture] Sent MIC chunk: 4800 bytes
[AudioCapture] Sent SYSTEM chunk: 4800 bytes  ← Should see this!
```

**Expected Backend Output**:
```
[WebSocket] New connection: source=mic, speaker=1
[WebSocket] New connection: source=system, speaker=0  ← Should see this!
```

**Expected UI**:
- **Blue bubbles on right** = Your mic speech
- **Grey bubbles on left** = YouTube/Spotify audio

---

## 📊 System Audio: Dev vs Production

| Aspect | Dev Mode (`npm run dev:main`) | Production (`open EVIA Desktop.app`) |
|--------|-------------------------------|--------------------------------------|
| **Permission Prompt** | Shows "Cursor" | Shows "EVIA Desktop" |
| **System Audio** | ⚠️ May fail | ✅ Works reliably |
| **macOS Behavior** | Grants permission to Cursor's Electron | Grants permission to your app |
| **Hot Reload** | ✅ Yes | ❌ No (must rebuild) |
| **Recommended For** | Quick UI changes | Testing system audio |

---

## 🎯 Recommendation for Sprint 1 Testing

### For System Audio + Speaker Diarization Testing:
**Use Production Build** (`npm run build` → `open dist/mac/EVIA Desktop.app`)

### For Quick Mic Transcription Testing:
**Use Dev Mode** (`npm run dev:main`) - mic-only works fine

---

## 🐛 Troubleshooting

### "Timer still doesn't stop"
**Check Console for**:
```
[OverlayEntry] Sent recording_stopped message to Listen window
[ListenView] 🛑 Recording stopped - stopping timer
```

If you don't see these logs, the IPC bridge may not be working. Restart Electron.

### "System audio tracks: []" (empty)
**Causes**:
1. Permission not granted
2. No audio playing when you clicked "Zuhören"
3. Some apps (Spotify DRM) block audio capture
4. Running in dev mode without Cursor restart

**Fix**: Build production app OR fully restart Cursor after granting permission.

### "desktopCapturer.getSources error: Failed to get sources"
**Fix**: This is a dev mode issue. Either:
1. Build production app (recommended)
2. Quit Cursor (Cmd+Q) and restart
3. Run `tccutil reset ScreenCapture` and regrant permission

---

## ✅ Success Criteria

### Timer Fix Verification:
- [ ] Timer starts when "Zuhören" is clicked
- [ ] Timer stops **immediately** when "Stopp" is clicked
- [ ] Console shows `[ListenView] 🛑 Recording stopped - stopping timer`
- [ ] Timer stays stopped (doesn't keep counting)

### System Audio Verification (Production):
- [ ] macOS shows permission prompt for "EVIA Desktop" (not Cursor)
- [ ] Console shows "Found X desktop sources"
- [ ] Console shows "System audio tracks: [...]" with non-empty array
- [ ] Backend shows two WebSocket connections (mic + system)
- [ ] UI shows blue bubbles (mic) and grey bubbles (system audio)

---

## 📁 Files Modified

1. `/src/renderer/overlay/overlay-entry.tsx`
   - Added `recording_stopped` IPC message when stopping capture

2. `/src/renderer/overlay/ListenView.tsx`
   - Added handler for `recording_stopped` message to stop timer

3. `/DEV_MODE_SYSTEM_AUDIO_WORKAROUND.md` (new)
   - Complete guide for system audio in development mode

4. `/SPRINT1_CRITICAL_FIXES.md` (this file)
   - Summary of issues and fixes

---

## 🚀 Next Steps

1. **Test Timer Fix** (can test in dev mode):
   ```bash
   npm run dev:vite
   npm run dev:main
   # Click Zuhören → Stopp → verify timer stops
   ```

2. **Test System Audio** (requires production build):
   ```bash
   npm run build
   open dist/mac/EVIA\ Desktop.app
   # Grant permission → Test with YouTube audio
   ```

3. **If system audio works**: Take screenshots for evidence
4. **If system audio fails**: Share full console output from Header window

---

**Status**: ✅ Timer fix complete | ⏳ System audio awaiting production build test  
**Last Updated**: 2025-10-05

