# 🎤 System Audio in Dev Mode - Permission Guide

## 📋 The Issue

The `SystemAudioDump` binary works perfectly in **production**, but in **dev mode** it fails with:
```
❌ Screen recording permission required!
Permission denied. Exiting.
```

## 🔬 Why This Happens

**Dev Mode Chain:**
```
Cursor → Electron → SystemAudioDump binary
```

When you run `npm run dev` from Cursor:
1. Cursor spawns Electron
2. Electron spawns SystemAudioDump binary
3. macOS checks if SystemAudioDump has Screen Recording permission
4. **BUT** macOS doesn't let it inherit permission from Cursor

**Production Mode (Works):**
```
EVIA Desktop.app → SystemAudioDump binary
```
The packaged app is properly signed and the binary inherits permissions.

## ✅ Solution: Launch from Terminal

**Terminal can grant permissions to child processes!**

### Step 1: Grant Permission to Terminal

1. Open **System Settings → Privacy & Security → Screen Recording**
2. Click the **+** button
3. Navigate to **Applications → Utilities → Terminal.app**
4. Select it and click **Open**
5. Toggle Terminal **ON**
6. **Quit Terminal completely** (Cmd+Q)

### Step 2: Launch EVIA from Terminal

Open **Terminal.app** (freshly, to get new permissions) and run:

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
./RUN_DEV_WITH_SYSTEM_AUDIO.sh
```

**OR manually:**

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run build:main
npm run dev
```

### Step 3: Test

1. Click "Zuhören"
2. Check main process terminal for:
   ```
   [SystemAudioService] ✅ SystemAudioDump started with PID: 12345
   ```
3. **Verify binary is running:**
   ```bash
   ps aux | grep SystemAudioDump
   # Should show a process, not just grep
   ```

4. **Check Header DevTools console** for:
   ```
   [AudioCapture] Sent SYSTEM chunk: 4800 bytes (from binary)
   ```

## 🐛 Troubleshooting

### Binary Still Fails

**Check Terminal has permission:**
```bash
# This should show the permission prompt or succeed silently
./src/main/assets/SystemAudioDump | head -1
# If you see "Screen recording permission required!", Terminal doesn't have permission
```

**Check binary signature:**
```bash
codesign -d --entitlements :- ./src/main/assets/SystemAudioDump | grep screen-recording
# Should show: <key>com.apple.security.personal-information.screen-recording</key>
```

### Binary Runs But No Audio

**Check if binary produces output:**
```bash
# Play some system audio, then run:
./src/main/assets/SystemAudioDump | xxd | head -20
# Should show binary audio data (hex dump of PCM)
# Ctrl+C to stop
```

### Still Not Working?

**Check which Terminal you're using:**
```bash
echo $TERM_PROGRAM
# iTerm.app? Grant permission to iTerm instead of Terminal
# vscode? Grant permission to Visual Studio Code
```

## 📊 Success Indicators

When working correctly, you'll see:

**Main Process Terminal:**
```
[SystemAudioService] ✅ SystemAudioDump started with PID: 45678
```

**`ps aux | grep SystemAudioDump`:**
```
you  45678  0.1  0.0  ... ./SystemAudioDump  (NOT just grep)
```

**Header DevTools Console:**
```
[AudioCapture] ✅ SystemAudioDump binary started successfully
[AudioCapture] Sent SYSTEM chunk: 4800 bytes (from binary)  ← KEY LOG
[AudioCapture] Sent SYSTEM chunk: 4800 bytes (from binary)
[AudioCapture] Sent SYSTEM chunk: 4800 bytes (from binary)
```

**Listen Window:**
- Grey bubbles for system audio (speaker:0)
- Blue bubbles for mic audio (speaker:1)

## 🎯 Production Mode

In production builds, this "just works" because:
1. The app is properly signed
2. macOS grants permission to "EVIA Desktop"
3. Binary inherits permission from parent app
4. No Terminal needed

## 🤔 Why Not Just Grant Permission to Cursor?

We could, but:
1. Cursor updates frequently (permission resets)
2. Cursor is your code editor, not your app
3. It's cleaner to separate dev environment from app permissions
4. Terminal is designed for this use case

## 📝 Glass Comparison

**Glass handles this the same way:**
- Dev mode: Requires Terminal to have Screen Recording permission
- Production: Works automatically with signed app

We copied their binary and approach **exactly** - this is expected behavior in development.
