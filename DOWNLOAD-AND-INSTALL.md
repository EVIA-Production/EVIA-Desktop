# 📥 EVIA Desktop - Download & Installation Guide

**For macOS Users** | Version 0.1.0

---

## 🚀 Quick Install (3 Minutes)

### Step 1: Download

**Apple Silicon Macs (M1/M2/M3)** - Most users:
- [Download EVIA-0.1.0-arm64.dmg](#) (446 MB)

**Intel Macs** - Older models:
- [Download EVIA-0.1.0.dmg](#) (222 MB)

*Not sure which you have? Click  → About This Mac. If you see "Apple M1/M2/M3", use ARM64.*

---

### Step 2: Install

1. **Open the DMG** you downloaded
2. **Drag EVIA.app** to the Applications folder
3. **Open Applications** folder
4. **Right-click EVIA.app** → Select "Open"
   - ⚠️ **Important**: Must use right-click first time (app is unsigned)
5. Click **"Open"** in the security dialog

---

### Step 3: Grant Permissions

EVIA needs 3 permissions to work:

1. **Microphone** - To hear you speak
   - Click "Allow" when prompted
   
2. **Screen Recording** - To capture system audio (meetings, calls)
   - Click "Open System Settings"
   - Check the box next to EVIA
   - Return to EVIA

3. **Accessibility** - For keyboard shortcuts (Cmd+K, etc.)
   - Click "Open System Settings"
   - Check the box next to EVIA
   - Return to EVIA

---

### Step 4: Login

Enter your EVIA credentials:
- **Email**: your.email@company.com
- **Password**: your password

Click **"Login"** → You're ready! 🎉

---

## 🎮 How to Use

### Start Listening

**Press `Cmd+K`** or click "Zuhören/Listen" in the menu bar

- Speak normally (mic + system audio captured)
- Watch real-time transcription appear
- Press "Stopp" when done

### View Insights

After stopping, click **"Erkenntnisse"** (Insights) to see:
- ✅ **Summary** of the conversation
- ✅ **Topics** discussed
- ✅ **Actions** to take

### Ask Questions

**Press `Cmd+Shift+Return`** or click "Fragen" (Ask)

- Type your question
- Get AI-powered answers
- Click any insight to auto-fill a related question

### Change Language

Click **⋯ (Settings)** → Select **German** or **English**

- UI updates immediately
- New recordings use selected language

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Start/Stop listening |
| `Cmd+Shift+Return` | Open Ask window |
| `Cmd+\` | Show/Hide all windows |

---

## ❓ Troubleshooting

### "EVIA cannot be opened because it is from an unidentified developer"

**Solution**: Use **right-click → Open** (not double-click)

1. Right-click EVIA.app
2. Select "Open"
3. Click "Open" in dialog

This only needs to be done once.

---

### Permissions not working

**Solution**: Manually grant in System Settings

```
System Settings → Privacy & Security → 
  - Microphone → ✓ EVIA
  - Screen Recording → ✓ EVIA
  - Accessibility → ✓ EVIA
```

---

### No transcripts appearing

**Check**:
1. Microphone permission granted? (see above)
2. Speaking loud enough?
3. Internet connection active?

If still not working, try:
- Restart EVIA
- Check you're logged in
- Verify backend is online (see Advanced Troubleshooting)

---

### Backend offline message

This means EVIA's cloud service is temporarily unavailable.

**Wait 1-2 minutes** and try again. If persists:
- Check your internet connection
- Contact support

---

## 🔧 Advanced Troubleshooting

### Reset EVIA Completely

If experiencing issues:

```bash
# 1. Quit EVIA
# 2. Delete app data
rm -rf ~/Library/Application\ Support/evia/

# 3. Reset permissions
tccutil reset Microphone com.evia.app
tccutil reset ScreenCapture com.evia.app
tccutil reset Accessibility com.evia.app

# 4. Restart EVIA
```

---

### Check Backend Connection

```bash
# Run in Terminal:
curl https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io/health

# Expected: {"status":"ok","message":"EVIA backend is running"}
```

If you see an error, the backend is down. Contact support.

---

## 📊 System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **macOS** | 12 (Monterey) | 14 (Sonoma) |
| **RAM** | 4 GB | 8 GB+ |
| **Storage** | 1 GB free | 2 GB+ free |
| **Internet** | Required | Broadband |
| **Processor** | Apple Silicon or Intel | Apple Silicon (M-series) |

---

## 🆘 Get Help

**Issues?** Report at:
- GitHub: [github.com/YOUR_ORG/EVIA-Desktop/issues](#)
- Email: support@evia.com

**Include**:
- macOS version ( → About This Mac)
- EVIA version (Settings → About)
- Screenshot of error

---

## 📱 What's Next?

After installing, try:
1. Record a 1-minute test conversation
2. View insights generated
3. Ask EVIA a question about the recording
4. Explore Settings (⋯) to customize

**Tip**: Use `Cmd+K` shortcut to quickly start/stop - no need to click!

---

**Ready to use EVIA!** 🚀

*Version 0.1.0 | Last updated: October 27, 2025*

