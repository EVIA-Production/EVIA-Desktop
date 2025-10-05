# Production System Audio Fix - EVIA Desktop

## 🎯 Issue Confirmed

Your production app has **the exact same permission issue as Glass**, but now it's the production app that needs permission instead of Terminal.app.

## ✅ What's Working

- ✅ EVIA Desktop.app is properly signed with screen-recording entitlement
- ✅ SystemAudioDump binary is properly signed with entitlements
- ✅ Binary is executable and in the correct location
- ✅ Backend connection is working ("EVIA connection OK")

## ❌ What's Missing

- ❌ **macOS hasn't granted "Screen Recording" permission to EVIA Desktop**

This is why system audio isn't being transcribed - macOS is silently blocking the `SystemAudioDump` binary from capturing audio, just like it did in Glass before we fixed it.

## 🔧 The Fix (3 minutes)

### ⚠️ IMPORTANT: Toggle Doesn't Always Work!

If you've **already toggled** the permission ON in System Settings but it's **still not working**, macOS has a sync bug where the visual toggle doesn't commit to the TCC database. You need to **REMOVE and RE-ADD** the permission.

### Option 1: Force Refresh (If Toggle Appears On But Doesn't Work)

```bash
./FORCE_PERMISSION_REFRESH.sh
```

This script:
1. Kills System Settings to force TCC reload
2. Re-signs the app to clear cached permission state
3. Guides you through REMOVING and RE-ADDING the permission
4. Tests that the binary can actually run

**Why this is needed**: macOS sometimes shows the toggle as ON but hasn't actually committed the permission to its database. The ONLY fix is to remove and re-add.

### Option 2: Guided First-Time Grant

Run the helper script that will walk you through granting permission:

```bash
./GRANT_PRODUCTION_PERMISSION.sh
```

This will:
1. Open System Settings to the right place
2. Guide you through adding EVIA Desktop
3. Verify the permission was granted

### Option 3: Manual Steps

1. **Open System Settings**
   - Go to: Privacy & Security > Screen Recording

2. **Add EVIA Desktop**
   - Click the `+` button
   - Press `Cmd + Shift + G`
   - Paste: `/Users/benekroetz/EVIA/EVIA-Desktop/dist/mac-arm64/EVIA Desktop.app`
   - Click "Open"

3. **Enable it**
   - Toggle the switch next to "EVIA Desktop" to **ON**

4. **Restart the app**
   - Quit EVIA Desktop if it's running
   - Launch it again

## 🧪 Testing & Monitoring

### Quick verification (doesn't need TCC access):

```bash
./VERIFY_PERMISSION_WORKING.sh
```

This tests if the helper binary can actually run. If permission is granted, you'll see:
```
✅ SUCCESS: Binary is running (permission granted!)
```

If it fails, you'll see:
```
❌ FAILED: Binary exited immediately (permission denied)
```

### Full diagnostic (if above passes):

```bash
./TEST_PRODUCTION_SYSTEM_AUDIO.sh
```

Look for: `✅ EVIA Desktop has Screen Recording permission`

### Monitor system audio in real-time:

```bash
./MONITOR_PRODUCTION_AUDIO.sh
```

Then start system audio capture in the app - you should see logs about audio capture starting.

## 🎓 Why This Happens (Glass Parallel)

This is **identical** to the Glass issue documented in `glass/docs/system-audio-capture-permissions.md`:

| Glass (Dev Mode) | EVIA Desktop (Production) |
|------------------|---------------------------|
| Terminal.app needed permission | EVIA Desktop.app needs permission |
| Helper was properly signed ✅ | Helper is properly signed ✅ |
| Parent process lacked TCC grant ❌ | Parent process lacks TCC grant ❌ |
| Binary exit code 1 (permission denied) | Binary exit code 1 (permission denied) |

**Root cause**: macOS checks the **parent process** that spawns `SystemAudioDump`. If that parent (Terminal in dev, EVIA Desktop in prod) doesn't have Screen Recording permission, macOS silently blocks the capture.

## 📊 Expected Results After Fix

Once permission is granted:

1. **In the Listen window**: You should see transcriptions appear for system audio
2. **In logs**: `SystemAudioDump started with PID: ...` (no exit code 1)
3. **No more**: Silent failures or "EVIA connection OK" loops
4. **TCC database**: Entry for `com.evia.desktop` with `auth_value=2`

## 🚀 Next Steps

1. **Grant the permission** using the script above
2. **Test** by playing audio and checking transcriptions
3. **Monitor** using the monitoring script if needed
4. **Document** this in your deployment checklist for future builds

## 📝 Production Deployment Checklist

For future production builds, remember:

- [ ] Build the app: `npm run build`
- [ ] Sign the app: `codesign -s - --deep --force --entitlements build/entitlements.mac.plist "dist/mac-arm64/EVIA Desktop.app"`
- [ ] Sign the binary: `codesign -s - --force --entitlements build/entitlements.mac.plist "dist/.../SystemAudioDump"`
- [ ] **Grant Screen Recording permission** (this step!)
- [ ] Test system audio capture

## 🔗 Related Documentation

- Glass permission fix: `glass/docs/system-audio-capture-permissions.md`
- Dev mode permission fix: `GRANT_TERMINAL_PERMISSION.sh`
- Production diagnostic: `TEST_PRODUCTION_SYSTEM_AUDIO.sh`

