# 🧪 System Audio Testing Instructions

## ✅ Production App is Now Running!

The app has been launched from: `dist/mac-arm64/EVIA Desktop.app`

---

## 🎯 What to Test

### 1. **Grant macOS Permission** (First Time Only)
You should see a macOS dialog:
> **"EVIA Desktop" would like to record your screen**

**Action**: Click **"Allow"**

⚠️ **Important**: This prompt should say **"EVIA Desktop"** (not "Cursor")

---

### 2. **Login** (If Needed)
1. Open DevTools on the **Header window** (the top bar)
   - Right-click on the header → Inspect
   - Or press `Cmd+Option+I`

2. In the Console, run:
   ```javascript
   await window.evia.auth.login("admin", "Admin123!")
   ```

3. Should return: `{success: true}`

---

### 3. **Test Mic + System Audio Capture**

#### Prepare:
1. **Play audio** (YouTube, Spotify, or any app)
2. **Keep it playing** throughout the test
3. Open DevTools on both **Header** and **Listen** windows

#### Test Flow:
1. Click **"Zuhören"** button (should hear permission prompt if first time)
2. **Speak into microphone**: "Hello, this is my microphone"
3. **Let system audio play** (YouTube video, etc.)
4. Wait 5-10 seconds
5. Click **"Stopp"** button

---

### 4. **Verify Console Logs**

#### Header Window Console (Should Show):
```
[AudioCapture] Starting dual capture (mic + system audio)...
[AudioCapture] Step 1: Getting desktop sources from Electron...
[AudioCapture] Step 2: Found 2 desktop sources
[AudioCapture] Using source: Built-in Display
[AudioCapture] System audio permission granted
[AudioCapture] System audio tracks: [{label: "...", enabled: true}]
[AudioCapture] System audio capture started successfully
[AudioCapture] Sent MIC chunk: 4800 bytes
[AudioCapture] Sent SYSTEM chunk: 4800 bytes  ← KEY: Should see this!
```

**❌ If you see**:
- `[AudioCapture] System audio tracks: []` (empty) → System audio failed
- `desktopCapturer.getSources error` → Permission issue

**✅ Success**: You see both "Sent MIC chunk" and "Sent SYSTEM chunk" messages

---

#### Listen Window Console (Should Show):
```
[ListenView] 📨 Received IPC message: transcript_segment
[ListenView] 📨 IPC Adding transcript: Hello, this is my microphone final: false
[ListenView] 📨 IPC Adding transcript: [YouTube audio text] final: false
```

**Check `speaker` values**:
- `speaker: 1` = Your mic (should be "Me" / blue)
- `speaker: 0` = System audio (should be "Them" / grey)

---

### 5. **Verify UI (Listen Window)**

The transcript view should show:

**Your Speech (Mic)**:
- ✅ **Blue gradient background**
- ✅ **Aligned to RIGHT side**
- ✅ Label: "Me (Mic)"
- ✅ Contains your spoken words

**System Audio (YouTube/Spotify)**:
- ✅ **Grey gradient background**
- ✅ **Aligned to LEFT side**
- ✅ Label: "Them (System)"
- ✅ Contains audio from playing app

---

### 6. **Test Timer**

1. Click **"Zuhören"** → Timer should **START** (00:01, 00:02, etc.)
2. Click **"Stopp"** → Timer should **STOP IMMEDIATELY**
3. Listen window console should show: `[ListenView] 🛑 Recording stopped - stopping timer`
4. Timer should **NOT continue counting**

---

### 7. **Check Backend Logs**

In your backend terminal, you should see:

```
[WebSocket] New connection: chat_id=698, source=mic, speaker=1
[WebSocket] New connection: chat_id=698, source=system, speaker=0  ← KEY!
[Deepgram] Created stream for source=mic
[Deepgram] Created stream for source=system  ← KEY!
[Deepgram] Transcript (source=mic, speaker=1): "Hello, this is my microphone"
[Deepgram] Transcript (source=system, speaker=0): "[YouTube audio]"
```

**✅ Success**: You see **TWO** WebSocket connections (mic + system)

---

## 📸 Evidence to Collect

### If System Audio Works:
1. **Screenshot** of Listen window showing:
   - Blue bubbles on right (your mic)
   - Grey bubbles on left (system audio)
   
2. **Console logs** from Header window showing:
   - "Found X desktop sources"
   - "System audio tracks: [...]"
   - "Sent SYSTEM chunk: 4800 bytes"

3. **Backend logs** showing:
   - Two WebSocket connections
   - Two Deepgram streams

### If System Audio Fails:
1. **Full console log** from Header window
2. **Error messages** (especially `desktopCapturer` errors)
3. **macOS permission screenshot**: System Preferences > Security & Privacy > Screen Recording

---

## 🐛 Troubleshooting

### Problem: "System audio tracks: []" (empty)
**Possible Causes**:
1. No audio playing when you clicked "Zuhören"
2. Permission not granted
3. Some apps (Spotify DRM) block audio capture

**Fix**:
1. Make sure audio is **actively playing BEFORE** clicking "Zuhören"
2. Check System Preferences > Security & Privacy > Screen Recording > EVIA Desktop is checked
3. Try YouTube instead of Spotify

---

### Problem: "desktopCapturer.getSources error: Failed to get sources"
**This means**: Permission issue

**Fix**:
1. Open System Preferences > Security & Privacy > Screen Recording
2. Check the box next to "EVIA Desktop"
3. **Quit the app** (Cmd+Q)
4. Launch again: `open "dist/mac-arm64/EVIA Desktop.app"`

---

### Problem: Only mic bubbles appear (no system audio bubbles)
**Check**:
1. Backend logs - do you see TWO WebSocket connections?
2. Header console - do you see "Sent SYSTEM chunk" messages?
3. Audio was playing when you started capture?

---

### Problem: Timer doesn't stop
**Check**:
1. Listen window console for: `[ListenView] 🛑 Recording stopped`
2. If missing → timer fix didn't work, share full console log

---

## ✅ Success Criteria Checklist

- [ ] macOS permission prompt shows "EVIA Desktop" (not Cursor)
- [ ] Header console shows "Found X desktop sources"
- [ ] Header console shows "System audio tracks: [...]" (non-empty)
- [ ] Header console shows BOTH "Sent MIC chunk" AND "Sent SYSTEM chunk"
- [ ] Backend shows TWO WebSocket connections (mic + system)
- [ ] Listen UI shows blue bubbles on right (mic)
- [ ] Listen UI shows grey bubbles on left (system audio)
- [ ] Timer starts when clicking "Zuhören"
- [ ] Timer stops when clicking "Stopp"
- [ ] Timer does NOT continue after stopping

---

## 🚀 Next Steps

### If Everything Works:
1. Take screenshots
2. Save console logs
3. Share in chat: "✅ System audio works! Both mic and system bubbles appearing."

### If Something Fails:
1. Note which step failed
2. Copy relevant error messages
3. Share console logs from Header and Listen windows
4. Share backend logs if relevant

---

## 📁 Quick Reference

**Launch App**: `open "dist/mac-arm64/EVIA Desktop.app"`  
**Login**: `await window.evia.auth.login("admin", "Admin123!")`  
**Permission**: System Preferences > Security & Privacy > Screen Recording  
**Rebuild**: `npm run build`

---

**Status**: 🟢 Production app is running  
**Next**: Test system audio capture following steps above  
**Report**: Share results (success or errors) in chat

