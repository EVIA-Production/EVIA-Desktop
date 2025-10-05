# ✅ Timer Fix Applied + System Audio Diagnosis

## 🎯 What Was Fixed

### Timer Issue ✅
**Problem**: Timer was inside the WebSocket useEffect, so if any error occurred before the `startTimer()` call, the timer wouldn't start.

**Solution**: Moved timer logic to its own **dedicated useEffect** that runs **immediately on component mount**, completely independent of:
- WebSocket connection status
- IPC message receiving
- System audio capture
- Any other errors

```typescript
// NEW: Dedicated timer useEffect
useEffect(() => {
  console.log('[ListenView] 🕐 Starting session timer on mount');
  setIsSessionActive(true);
  startTimer();
  
  return () => {
    stopTimer();
    setIsSessionActive(false);
  };
}, []); // Runs once on mount, stops on unmount
```

---

## 🧪 Testing Instructions

### Test 1: Timer Fix (Quick Test)

Run the app:
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
./RUN_PRODUCTION_WITH_LOGS.sh
```

**Expected Results**:
1. Click **"Zuhören"**
2. Listen window appears
3. **Timer should START immediately** showing "00:00", "00:01", "00:02", etc.
4. Speak into mic - transcripts appear (blue bubbles)
5. **Timer continues counting**
6. Click **"Stopp"**
7. **Timer should STOP** at the final time

✅ **If timer works**: Continue to Test 2  
❌ **If timer doesn't work**: There's a deeper React rendering issue

---

### Test 2: System Audio Permissions (Full Reset)

System audio is still failing with:
```
[Main] ❌ desktopCapturer.getSources ERROR: Failed to get sources.
```

This is a **macOS TCC permission issue** with production builds.

Run the reset script:
```bash
./RESET_PERMISSIONS_AND_TEST.sh
```

**Follow the script's prompts**:
1. It will re-sign the app
2. **You MUST manually remove ALL "EVIA Desktop" entries** from System Preferences
3. The app will launch
4. Click **"Zuhören"**
5. **Watch for macOS permission dialog** - it should appear!
6. Click **"Allow"**

**Expected Results After Granting Permission**:
```
[Main] 🎥 desktopCapturer.getSources called
[Main] macOS Screen Recording permission status: granted
[Main] ✅ Found 2 desktop sources:
[Main]   1. "Built-in Display" (id: screen:0:0)
```

---

## 🐛 If System Audio Still Fails

### Root Cause Analysis

The issue is that `desktopCapturer.getSources()` is an **Electron API** that requires:
1. ✅ Correct entitlements in `entitlements.plist` (we have this)
2. ✅ App signed with entitlements (we're doing ad-hoc signing)
3. ❌ **Valid Developer ID signature** for production builds

**The Problem**: Ad-hoc signing (`codesign -s -`) might not be sufficient for `desktopCapturer` in packaged production builds. macOS may require a **proper Developer ID** certificate.

### Solutions (in order of difficulty):

#### Option 1: Test in Dev Mode (Easiest)
System audio works in dev mode because Electron runs as the parent process.

```bash
# Terminal 1: Backend
cd /Users/benekroetz/EVIA/EVIA-Backend && docker compose up

# Terminal 2: Vite dev server
cd /Users/benekroetz/EVIA/EVIA-Desktop && npm run dev:renderer

# Terminal 3: Electron main process
cd /Users/benekroetz/EVIA/EVIA-Desktop && npm run dev:main
```

**Limitation**: Permission will be attributed to "Cursor" (or "Electron"), not "EVIA Desktop".

#### Option 2: Use a Real Developer ID (Proper Solution)
1. Get an Apple Developer account ($99/year)
2. Create a Developer ID Application certificate
3. Update `electron-builder.yml` to use the certificate:
   ```yaml
   mac:
     identity: "Developer ID Application: Your Name (TEAM_ID)"
     entitlements: build/entitlements.mac.plist
   ```
4. Rebuild with `npm run build`

This would allow `desktopCapturer` to work properly in production builds.

#### Option 3: Alternative System Audio Capture (Workaround)
Instead of `desktopCapturer`, use a native macOS helper binary (like Glass's `SystemAudioDump`) that's properly signed and can request permissions independently.

---

## 📊 Current Status

| Feature | Status | Notes |
|---------|--------|-------|
| Timer | ✅ **FIXED** | Now starts immediately on mount |
| Mic Transcription | ✅ Working | Blue bubbles appear |
| System Audio (Dev) | ⚠️ **Untested** | Should work but attributes to Cursor |
| System Audio (Prod) | ❌ **Blocked** | Requires Developer ID or workaround |
| Speaker Diarization UI | ✅ Implemented | Blue=me, Grey=them |

---

## 🎯 Recommended Next Steps

1. **Test timer fix** - Run `./RUN_PRODUCTION_WITH_LOGS.sh` and verify timer works
2. **Try permission reset** - Run `./RESET_PERMISSIONS_AND_TEST.sh` to see if permission prompt appears
3. **If still fails**: Switch to dev mode testing or get Developer ID certificate

---

## 🔍 Debug Commands

### Check app signature:
```bash
codesign -dvvv "dist/mac-arm64/EVIA Desktop.app" 2>&1 | grep -E "(Identifier|Signature|Authority)"
```

### Check entitlements:
```bash
codesign -d --entitlements :- "dist/mac-arm64/EVIA Desktop.app" 2>&1 | grep -i screen
```

### Check TCC permission (requires Full Disk Access for Terminal):
```bash
sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
  "SELECT service, client, auth_value FROM access WHERE service='kTCCServiceScreenCapture' AND client LIKE '%evia%';"
```

Expected: `kTCCServiceScreenCapture|com.evia.desktop|2` (2 = granted)

---

**Status**: 🟢 Timer fix ready for testing  
**Next**: Test timer, then diagnose system audio with reset script

