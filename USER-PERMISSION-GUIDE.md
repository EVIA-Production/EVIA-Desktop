# 🔐 EVIA Permission Guide

## What Permissions Does EVIA Need?

EVIA needs **3 permissions** to work properly:

1. **Screen Recording** (for EVIA app)
2. **Screen Recording** (for SystemAudioDump helper) ← **THIS IS CRITICAL!**
3. **Microphone** (for EVIA app)

---

## ⚠️ IMPORTANT: You'll See 2 Screen Recording Requests!

When you first use EVIA, you'll be asked for Screen Recording permission **TWICE**:

### First Request: EVIA App
- Icon: EVIA logo
- Name: "EVIA"
- Why: To access desktop sources

### Second Request: SystemAudioDump Helper
- Icon: May look like Terminal or generic app icon
- Name: "SystemAudioDump" (or shows as "EVIA" in some macOS versions)
- Why: To capture system audio from meetings

**YOU MUST GRANT BOTH! 🚨**

---

## 🎯 Step-by-Step: First Time Setup

### 1. Open EVIA
Right-click EVIA.app → Open

### 2. Log In
Enter your credentials

### 3. Press "Listen" / "Zuhören"
This starts the permission flow

### 4. Grant Screen Recording (Request #1)
```
A dialog appears:
"EVIA would like to record your screen"

✅ Click "Open System Settings"
✅ Toggle EVIA ON
✅ Click "Quit & Reopen" in EVIA
```

### 5. Press "Listen" Again
After reopening, press Listen again

### 6. Grant Screen Recording (Request #2)  ← **DON'T SKIP THIS!**
```
Another dialog appears:
"SystemAudioDump would like to record your screen"
(or might show as "EVIA")

✅ Click "Open System Settings"
✅ Toggle SystemAudioDump/EVIA ON (you may see 2 entries for EVIA)
✅ Return to EVIA (no restart needed)
```

### 7. Grant Microphone
```
A dialog appears:
"EVIA would like to access your microphone"

✅ Click "OK"
```

### 8. Done!
✅ EVIA is now fully set up and ready to use!

---

## 🐛 Troubleshooting: System Audio Not Captured

### Symptom:
- Your microphone works
- But meeting audio (Zoom, Teams, etc.) is NOT transcribed
- Console shows "SystemAudioDump error" or "permission denied"

### Solution:
**You didn't grant the second Screen Recording permission!**

**How to fix:**

1. **Open System Settings**
2. **Privacy & Security** → **Screen Recording**
3. **Look for TWO EVIA-related entries:**
   - ✅ EVIA (should be ON)
   - ❌ SystemAudioDump or EVIA (might be OFF) ← **TURN THIS ON!**
4. **Toggle both ON**
5. **Return to EVIA and press Listen**
6. **System audio should now work!** ✅

---

## 📋 Checking Your Permissions

### macOS 13+ (Ventura and later)

**System Settings → Privacy & Security**

#### Screen Recording Section:
You should see:
- ✅ EVIA (ON)
- ✅ SystemAudioDump or second EVIA entry (ON)  ← **CRITICAL!**

#### Microphone Section:
- ✅ EVIA (ON)

---

## 🔍 Why Does EVIA Need 2 Screen Recording Permissions?

**Technical explanation:**

- **EVIA app** needs Screen Recording to:
  - List available windows/screens
  - Access desktop sources via Electron's desktopCapturer

- **SystemAudioDump helper** needs Screen Recording to:
  - Actually capture system audio using macOS ScreenCaptureKit
  - This is a separate process, so it needs its own permission

**This is by design and normal!**

Apps like:
- OBS Studio
- Loopback
- Rogue Amoeba's apps

...all use similar architecture with helper processes that need separate permissions.

---

## 🛠️ Reset Permissions (For Testing)

If you want to reset EVIA and see the permission prompts again:

```bash
# Reset Screen Recording permission for EVIA
tccutil reset ScreenCapture com.evia.desktop

# Reset Microphone permission
tccutil reset Microphone com.evia.desktop

# Kill EVIA
pkill -f "EVIA.app"

# Clear app data
rm -rf ~/Library/Application\ Support/evia

# Reopen EVIA
open /Applications/EVIA.app
```

---

## 📧 User Email Template

**Subject:** Important: Grant Both Screen Recording Permissions

```
Hi [Name],

Quick heads up about EVIA permissions!

When you first use EVIA, you'll be asked for Screen Recording 
permission TWICE. This is normal and both are needed:

1️⃣ First request: For "EVIA" app
2️⃣ Second request: For "SystemAudioDump" helper

❗ YOU MUST GRANT BOTH for system audio capture to work!

If you only grant the first one, your microphone will work but 
meeting audio (Zoom/Teams) won't be captured.

---

To check if both are granted:
System Settings → Privacy & Security → Screen Recording

You should see TWO EVIA-related entries, both ON.

---

Need help? Email me: bene.kroetz@gmail.com

Best,
Bene
```

---

## 🎬 For Demo Videos

When recording demo videos showing first-time setup:

1. **Reset permissions** using the script above
2. **Open EVIA** (show right-click → Open for unsigned app)
3. **Log in**
4. **Press Listen**
5. **Show Screen Recording request #1** - grant it
6. **Quit & Reopen**
7. **Press Listen again**
8. **Show Screen Recording request #2** - grant it ← **EMPHASIZE THIS!**
9. **Show Microphone request** - grant it
10. **Start a test recording** to show it works

**Narration tip:** 
"Notice EVIA asks for Screen Recording permission twice. This is normal - 
one for the app, one for the audio capture helper. Make sure to grant both!"

---

## 🔐 Technical Details

### SystemAudioDump Binary

**Location in app bundle:**
```
EVIA.app/Contents/Resources/app.asar.unpacked/src/main/assets/SystemAudioDump
```

**What it is:**
- Native Swift binary using macOS ScreenCaptureKit
- Captures system audio (24kHz, stereo, int16)
- Runs as separate process from main Electron app
- Has its own bundle identifier: `com.evia.system-audio-dump`

**Why it needs Screen Recording:**
- ScreenCaptureKit API requires Screen Recording permission
- Even though we're only capturing audio, it's part of screen capture

**Signing:**
- Signed with same entitlements as main app during build
- Ad-hoc signature (`codesign -s -`)
- Includes `com.apple.security.personal-information.screen-recording` entitlement

---

## 🆘 Common Issues

### Issue 1: "Only my voice is captured, not meeting audio"
**Cause:** SystemAudioDump permission not granted  
**Fix:** Check System Settings → Screen Recording for second EVIA entry

### Issue 2: "I don't see a second permission request"
**Cause:** macOS cached the denial or something went wrong  
**Fix:** Reset permissions and try again

### Issue 3: "Permission window doesn't open"
**Cause:** You're on an older macOS version  
**Fix:** EVIA requires macOS 13+ (Ventura) for system audio capture

### Issue 4: "SystemAudioDump keeps asking for permission"
**Cause:** Binary not properly signed or permission was revoked  
**Fix:** Check System Settings and ensure toggle is ON

---

**Questions? Contact: bene.kroetz@gmail.com**

