# 🔧 Dev Mode System Audio Fix: Terminal Permission

## Problem
System audio capture fails in development mode with the message:
```
❌ Screen recording permission required! Permission denied. Exiting.
```

## Root Cause
In dev mode, the permission chain is:
```
Terminal.app → npm → Electron → SystemAudioDump binary
```

macOS requires **Terminal.app** (the parent process) to have Screen Recording permission, even though the binary itself has the correct entitlements.

## Solution: Grant Terminal.app Screen Recording Permission

### Step 1: Open System Settings
```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
```

Or manually:
1. Open **System Settings**
2. Go to **Privacy & Security**
3. Scroll down and click **Screen & System Audio Recording**

### Step 2: Add Terminal.app

1. Click the **"+"** button (or **"Edit"** on macOS Ventura+)
2. Press **⌘⇧G** (Cmd+Shift+G) to open "Go to folder"
3. Type: `/Applications/Utilities/`
4. Select **Terminal.app** (or **iTerm2.app** if you use that)
5. Click **"Open"**
6. **Toggle it ON** (make sure the checkbox is checked)

### Step 3: Verify Permission

Run the diagnostic script:
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
./TEST_SYSTEM_AUDIO_DEBUG.sh
```

Step 6 should now show:
```
✅ Terminal/iTerm has Screen Recording permission
```

### Step 4: Restart EVIA

**IMPORTANT**: You must completely quit and restart:

```bash
# Kill any existing processes
pkill -f "EVIA"
pkill -f "Electron"

# Restart from Terminal
npm run dev
```

### Step 5: Test System Audio

1. Click **"Zuhören"** in the EVIA header
2. Grant **Microphone** permission when prompted (one-time)
3. Check the **Terminal output** for `[SystemAudioService]` logs
4. You should see:
   ```
   [SystemAudioService] ✅ SystemAudioDump started with PID: xxxxx
   ```

## Verification Checklist

- [ ] Terminal.app has Screen Recording permission in System Settings
- [ ] Ran `./TEST_SYSTEM_AUDIO_DEBUG.sh` and Step 6 passed
- [ ] Completely quit EVIA (no processes running)
- [ ] Restarted EVIA from Terminal (`npm run dev`)
- [ ] Backend is running (`docker compose up`)
- [ ] Clicked "Zuhören" and granted microphone permission
- [ ] See `[SystemAudioService] ✅ SystemAudioDump started` in terminal
- [ ] Both MIC and SYSTEM audio WebSockets show "connection OK" in Listen window

## Troubleshooting

### "Binary exited with code 1"
- Terminal.app still doesn't have permission
- Try removing and re-adding Terminal.app in System Settings
- Restart your Mac if the TCC database is corrupted

### "Binary NOT found"
- Run `npm run build:main` to rebuild
- Check `/Users/benekroetz/EVIA/EVIA-Desktop/src/main/assets/SystemAudioDump` exists

### No audio data after binary starts
- Check backend logs: `docker compose logs backend`
- Verify WebSocket connections in Listen window dev tools
- Check for firewall/network issues

## Why This Only Affects Dev Mode

| Mode | Permission Required For | Why |
|------|------------------------|-----|
| **Dev** | Terminal.app | Electron runs inside npm/node, which is spawned by Terminal |
| **Production** | EVIA Desktop.app | Packaged app runs independently, has its own code signature |

In production, users will grant permission to "EVIA Desktop" directly, not Terminal.

## Related Files
- Binary: `src/main/assets/SystemAudioDump`
- Service: `src/main/system-audio-service.ts`
- Renderer: `src/renderer/audio-processor-glass-parity.ts`
- IPC Bridge: `src/main/preload.ts`

