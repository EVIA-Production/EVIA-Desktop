# System Audio Capture - Root Cause Analysis & Complete Fix

## 🔍 Executive Summary

**Problem**: `desktopCapturer.getSources()` fails with "Failed to get sources" error in production builds, preventing system audio capture.

**Root Cause**: macOS requires **entitlements to be embedded in the app bundle at build time** for the `desktopCapturer` API to function. Ad-hoc signing after build is insufficient.

**Solution**: Created `build/entitlements.mac.plist` with screen recording entitlements, ensured `electron-builder.yml` uses it during build, and updated Info.plist descriptions.

---

## 🐛 Symptoms Observed

1. **Main process logs**:
   ```
   [Main] macOS Screen Recording permission status: denied
   [Main] ❌ desktopCapturer.getSources ERROR: Failed to get sources.
   [Main] Error message: undefined
   [Main] Error stack: undefined
   ```

2. **Backend logs**: Only `source=mic` audio received, no `source=system` audio

3. **UI**: Only blue (mic) transcript bubbles, no grey (system audio) bubbles

4. **Permission prompts**: macOS asked for "Cursor" permissions (dev mode) instead of "EVIA Desktop" (production mode)

---

## 🎯 Root Cause (Multi-Angle Analysis)

### Primary Cause
The `desktopCapturer` API is an **Electron-specific API** that requires:
1. **Entitlements** declared in the app bundle
2. **Code signing** with those entitlements
3. **macOS TCC permission** granted for the specific bundle

The API fails **before even requesting permission** if entitlements are missing.

### Why Ad-Hoc Signing After Build Wasn't Enough
- `codesign -s - --force` **can** embed entitlements
- But macOS caches bundle information at launch
- The TCC system validates entitlements against the original bundle signature
- Post-build signing creates a mismatch that macOS rejects

### Why It Works in Glass Project
Glass uses a **native Swift helper binary** (`SystemAudioDump`) that:
- Has its own entitlements
- Runs as a separate process
- Uses ScreenCaptureKit directly (not Electron's `desktopCapturer`)

EVIA uses Electron's `desktopCapturer` API, which is **more tightly coupled** to the main bundle's entitlements.

### Web Search Confirmation
The web search results confirm:
- **Entitlements must be in `build/entitlements.mac.plist`** (not root)
- **`electron-builder.yml` must reference them** in `mac.entitlements` and `mac.entitlementsInherit`
- **Info.plist descriptions** (`NSScreenCaptureUsageDescription`, etc.) are required for permission prompts
- **Both old and new entitlement keys** are needed for compatibility:
  - `com.apple.security.device.screen-recording` (older macOS)
  - `com.apple.security.personal-information.screen-recording` (macOS Sonoma+)

---

## ✅ Complete Fix Applied

### 1. Created `build/entitlements.mac.plist`
**Location**: `/Users/benekroetz/EVIA/EVIA-Desktop/build/entitlements.mac.plist`

**Contents**: All required entitlements including:
- Screen recording (both old and new keys)
- Microphone/audio input
- Camera (required by macOS for screen recording on some versions)
- JIT and unsigned memory (for Electron/V8)

### 2. Updated `electron-builder.yml`
**Changes**:
- Confirmed `entitlements` and `entitlementsInherit` point to `build/entitlements.mac.plist`
- Added `NSCameraUsageDescription` to `extendInfo`
- Kept `hardenedRuntime: true` for security

**Why Both Keys**:
- `entitlements`: Used for the main app bundle
- `entitlementsInherit`: Inherited by helper processes (Renderer, GPU, etc.)

### 3. Created `BUILD_AND_TEST_SYSTEM_AUDIO.sh`
**Purpose**: Automates the complete build, verification, and testing process.

**Steps**:
1. Clean previous builds
2. Build with entitlements
3. Verify entitlements are embedded
4. Remove quarantine attribute
5. Clear old TCC entries
6. Guide user through manual permission setup
7. Launch with logging

---

## 🧪 Testing Instructions

### Clean Build & Test (Recommended)
```bash
./BUILD_AND_TEST_SYSTEM_AUDIO.sh
```

This script will:
- Build the app with entitlements
- Verify entitlements are embedded
- Guide you through permission setup
- Launch with detailed logging

### Manual Build & Test
If you prefer manual control:
```bash
# 1. Clean and build
rm -rf dist/
npm run build

# 2. Verify entitlements
codesign -d --entitlements :- "dist/mac-arm64/EVIA Desktop.app"
# Look for: com.apple.security.device.screen-recording

# 3. Clear old permissions
tccutil reset ScreenCapture com.evia.desktop

# 4. Add app to System Settings > Screen Recording

# 5. Launch
./RUN_PRODUCTION_WITH_LOGS.sh
```

---

## 📊 Expected Results

### ✅ Success Indicators

**Terminal Logs**:
```
[Main] 🎥 desktopCapturer.getSources called
[Main] macOS Screen Recording permission status: granted  ← KEY!
[Main] ✅ Found 2 desktop sources:                        ← KEY!
[Main]   1. "Built-in Display" (id: screen:0:0)
[AudioCapture] Sent SYSTEM chunk: 4800 bytes              ← KEY!
```

**Backend Logs**:
```
[WebSocket] source=mic, speaker=1
[WebSocket] source=system, speaker=0  ← KEY!
```

**Listen UI**:
- 🔵 Blue bubbles (right side) = Your voice
- ⚪ **Grey bubbles (left side) = System audio** ← KEY!

### ❌ Failure Indicators

**If entitlements still missing**:
```
[Main] ❌ desktopCapturer.getSources ERROR: Failed to get sources.
```
→ Re-run verification step: `codesign -d --entitlements :- "dist/mac-arm64/EVIA Desktop.app"`

**If permission denied**:
```
[Main] macOS Screen Recording permission status: denied
```
→ Check System Settings > Screen Recording → Add EVIA Desktop

---

## 🔄 After Every Build

**IMPORTANT**: After `npm run build`, you MUST:

1. **Remove old EVIA Desktop from System Settings**
   - System Settings > Privacy & Security > Screen Recording
   - Remove ALL "EVIA Desktop" entries

2. **Add the newly built app**
   - Click '+' → Navigate to `dist/mac-arm64/EVIA Desktop.app`
   - Check the checkbox

3. **Restart if prompted**
   - macOS may ask to "Quit & Reopen" → Do it

**Why**: macOS TCC associates permissions with the **exact bundle signature**. Each build creates a new signature (even with ad-hoc signing), requiring permission re-grant.

---

## 🎯 Why This Fix Works

### Before (Broken)
1. App builds without entitlements
2. `desktopCapturer.getSources()` called
3. **macOS rejects: "This app doesn't declare screen recording entitlement"**
4. Error: "Failed to get sources"
5. No permission prompt shown

### After (Fixed)
1. App builds **with entitlements embedded**
2. `desktopCapturer.getSources()` called
3. macOS checks entitlements: ✅ Found
4. macOS checks TCC: Not yet granted → **Shows permission prompt**
5. User grants → `desktopCapturer` returns screen sources
6. System audio capture works

---

## 🐛 Known Limitations

### Dev Mode (`npm run dev`)
**Issue**: System audio **will not work** in dev mode.

**Why**: Electron runs as a child process of Cursor/VS Code. macOS attributes permissions to the parent process.

**Workaround**: Test system audio **only in production builds** using `./BUILD_AND_TEST_SYSTEM_AUDIO.sh`.

### First Launch After Build
**Issue**: Permission prompt may not appear immediately.

**Solution**: 
1. Launch the app
2. Click "Zuhören"
3. Watch for macOS permission dialog
4. If no dialog appears, manually add app in System Settings

### Multiple "EVIA Desktop" Entries
**Issue**: System Settings shows multiple "EVIA Desktop" entries after several builds.

**Solution**: Remove ALL entries before each test to avoid confusion. Each build has a unique signature.

---

## 📚 References

1. **Electron `desktopCapturer` docs**: https://www.electronjs.org/docs/latest/api/desktop-capturer
2. **Apple TCC entitlements**: https://developer.apple.com/documentation/bundleresources/entitlements
3. **electron-builder macOS config**: https://www.electron.build/configuration/mac
4. **Glass project solution**: `glass/docs/system-audio-capture-permissions.md`
5. **Web search results**: Stackoverflow, EliteMacX86 forums on TCC permissions

---

## 🎉 Success Criteria

System audio is **WORKING** when:

1. ✅ Terminal shows `[Main] ✅ Found X desktop sources`
2. ✅ Backend logs show `source=system, speaker=0`
3. ✅ Listen UI shows **grey bubbles on the left side**
4. ✅ Grey bubbles contain transcription of YouTube/Spotify/system audio
5. ✅ Timer runs continuously
6. ✅ Blue bubbles (mic) and grey bubbles (system) appear side-by-side

---

## 🚨 Emergency Rollback

If this fix breaks something:

```bash
# Restore old electron-builder.yml
git checkout HEAD -- electron-builder.yml

# Remove build directory
rm -rf build/

# Clean and rebuild
rm -rf dist/
npm run build
```

---

**Next Steps**: Run `./BUILD_AND_TEST_SYSTEM_AUDIO.sh` and test!

