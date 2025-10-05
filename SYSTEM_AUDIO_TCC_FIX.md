# System Audio TCC Permission Fix (EVIA Desktop)

## 🔍 Root Cause Identified

**Issue**: macOS **denies Screen Recording permission** to unsigned production apps, even after clicking "Allow" in System Preferences.

**Diagnosis Logs**:
```
[Main] macOS Screen Recording permission status: denied
[Main] ❌ Screen Recording permission DENIED
```

**Why This Happens**:
- Production `.app` bundles are **unsigned** (ad-hoc built without a Developer ID)
- macOS TCC (Transparency, Consent, and Control) **rejects permission grants** for unsigned apps
- The permission dialog appears, but macOS **silently denies** the actual access

## ✅ Solution (Glass Parity Fix)

This is the **exact same issue** we fixed in Glass (documented in `glass/docs/system-audio-capture-permissions.md`).

### Quick Fix (Run This Script)

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
./FIX_SYSTEM_AUDIO_PERMISSIONS.sh
```

The script will:
1. ✅ Ad-hoc sign the production app with Screen Recording entitlements
2. ✅ Clear stale TCC database entries  
3. ✅ Guide you through re-granting permission in System Preferences
4. ✅ Verify the TCC entry is correct
5. ✅ Launch the app for testing

### Manual Steps (If Script Fails)

1. **Ad-hoc sign the app** with entitlements:
   ```bash
   codesign -s - --deep --force --entitlements entitlements.plist "dist/mac-arm64/EVIA Desktop.app"
   ```

2. **Clear TCC entries**:
   ```bash
   sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
     "DELETE FROM access WHERE service='kTCCServiceScreenCapture' AND client LIKE '%evia%';"
   ```

3. **Open System Preferences**:
   ```bash
   open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
   ```

4. **Add EVIA Desktop**:
   - Click '+' button
   - Press `Cmd+Shift+G`
   - Paste: `/Users/benekroetz/EVIA/EVIA-Desktop/dist/mac-arm64/EVIA Desktop.app`
   - Select the app, click 'Open'
   - Toggle checkbox **ON**

5. **Verify TCC entry**:
   ```bash
   sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
     "SELECT service, client, auth_value FROM access WHERE service='kTCCServiceScreenCapture' AND client LIKE '%evia%';"
   ```
   
   Expected: `kTCCServiceScreenCapture|com.evia.desktop|2` (auth_value=2 means granted)

6. **Test**:
   ```bash
   open "dist/mac-arm64/EVIA Desktop.app"
   ```

## 🎯 Success Indicators

When system audio permission is **correctly granted**, you'll see:

```
[Main] 🎥 desktopCapturer.getSources called
[Main] macOS Screen Recording permission status: granted  ← KEY!
[Main] ✅ Screen Recording permission already granted
[Main] Calling desktopCapturer.getSources()...
[Main] ✅ Found 2 desktop sources:
[Main]   1. "Built-in Display" (id: screen:0:0)
[Main]   2. "..." 
```

**Backend logs** should show:
```
[WebSocket] source=mic, speaker=1    ← Your microphone
[WebSocket] source=system, speaker=0 ← System audio (KEY!)
```

**Listen UI** should show:
- 🔵 Blue bubbles on RIGHT = Your voice (mic)
- ⚪ Grey bubbles on LEFT = System audio (YouTube/Spotify/etc.)

## ⚠️ Why This Matters

### Dev Mode vs Production Mode

| Mode | Permissions | System Audio | Debugging |
|------|-------------|--------------|-----------|
| **Dev (Cursor)** | Cursor's permissions | ❌ Fails (wrong parent process) | ✅ Full logs |
| **Production** | App's own permissions | ✅ Works (after TCC fix) | ⚠️ Limited logs |

**Development in Cursor**:
- Electron runs **inside Cursor's process**
- macOS asks for permission for "**Cursor**" (not EVIA Desktop)
- `desktopCapturer` calls succeed, but **system audio tracks are empty**
- This is a **dev mode limitation**, not a code bug

**Production Build**:
- App runs as **its own process**  
- macOS asks for permission for "**EVIA Desktop**"
- `desktopCapturer` works correctly **IF app is signed with entitlements**
- Without signing, macOS **silently denies** even after "Allow" is clicked

## 🔄 After Every Rebuild

**Important**: Each time you run `npm run build`, you must **re-sign and re-grant** permission:

```bash
./FIX_SYSTEM_AUDIO_PERMISSIONS.sh
```

This is because `electron-builder` creates a **new unsigned bundle** that macOS treats as a different app.

## 📋 Entitlements Required

The `entitlements.plist` file contains:

```xml
<key>com.apple.security.personal-information.screen-recording</key>
<true/>

<key>com.apple.security.device.microphone</key>
<true/>

<key>com.apple.security.device.audio-input</key>
<true/>

<key>com.apple.security.cs.allow-jit</key>
<true/>

<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
<true/>
```

These are **critical** for:
- Screen Recording permission (for system audio via `desktopCapturer`)
- Microphone permission (for mic audio)
- Electron's V8 JIT compilation

## 🐛 Troubleshooting

### Still seeing "permission denied"?

1. **Check TCC entry**:
   ```bash
   sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
     "SELECT client, auth_value FROM access WHERE service='kTCCServiceScreenCapture';"
   ```
   
   Look for `com.evia.desktop` or similar. If `auth_value` is not `2`, permission is not granted.

2. **Check app signature**:
   ```bash
   codesign -d --entitlements :- "dist/mac-arm64/EVIA Desktop.app" 2>&1 | grep screen-recording
   ```
   
   Should output the entitlement key. If empty, the app is not signed with entitlements.

3. **Remove ALL EVIA Desktop entries** from System Preferences:
   - System Preferences > Privacy & Security > Screen & System Audio Recording
   - Click on each "EVIA Desktop" entry and click '-' to remove
   - Close System Preferences
   - Run `./FIX_SYSTEM_AUDIO_PERMISSIONS.sh` again

4. **Restart required?**:
   Some macOS versions require a **full restart** after granting Screen Recording permission to a new app. Try:
   ```bash
   sudo reboot
   ```

### App crashes or doesn't launch?

The entitlements might be incompatible with your code signing setup. Verify:
```bash
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/EVIA Desktop.app"
```

If this fails, try signing without `--deep`:
```bash
codesign -s - --force --entitlements entitlements.plist "dist/mac-arm64/EVIA Desktop.app"
```

## 📚 References

- **Glass TCC Fix**: `glass/docs/system-audio-capture-permissions.md`
- **Apple TCC Documentation**: [developer.apple.com/documentation/bundleresources/entitlements](https://developer.apple.com/documentation/bundleresources/entitlements)
- **ScreenCaptureKit**: [developer.apple.com/documentation/screencapturekit](https://developer.apple.com/documentation/screencapturekit)

## ✅ Next Steps

After running `./FIX_SYSTEM_AUDIO_PERMISSIONS.sh` successfully:

1. ✅ Mic transcription should continue working
2. ✅ System audio transcription should now work
3. ✅ Speaker diarization should show "Me" (blue) and "Them" (grey)
4. ✅ Timer should work correctly

---

**Status**: 🟡 Requires manual TCC fix after each build  
**Target**: Automate this in `electron-builder` config for release builds

