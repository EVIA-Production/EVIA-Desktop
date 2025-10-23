# 🚀 EVIA Desktop - First Launch Manual

**Version**: 1.0  
**Date**: October 22, 2025  
**Status**: Ready for First Launch

---

## 📋 WHAT'S NEW IN THIS RELEASE

### ✅ Backend Integration Updates
1. **Seamless Language Switching**: Desktop now sends `change_language` WebSocket command to backend
2. **Toast Notifications**: User-friendly error/success messages for better feedback
3. **Offline Mode Detection**: Automatic detection when backend is unavailable
4. **Cleanup Complete**: All WAV debugging code removed (Desktop + Backend)

### 🎨 User Experience Improvements
- Error toasts show when backend is offline or errors occur
- Offline indicator appears when backend is unreachable  
- Auto-reconnect when backend comes back online
- Smooth language switching with backend synchronization

---

## 🛠️ PREREQUISITES

### Backend Requirements
1. **Backend Running**: 
   ```bash
   cd /Users/benekroetz/EVIA/EVIA-Backend
   docker compose up -d
   ```

2. **Groq API Key Configured**: 
   - Set in `/Users/benekroetz/EVIA/EVIA-Backend/.env`
   - Variable: `GROQ_API_KEY=your-key-here`
   - **Note**: For first launch, using single backend key (not per-user keys)

3. **Backend Health Check**:
   ```bash
   curl http://localhost:8000/health
   # Expected: {"status":"ok","message":"EVIA backend is running"}
   ```

### Desktop Requirements
- macOS 12+ (Apple Silicon or Intel)
- Node.js 20+
- Permissions:
  - Microphone access
  - Screen Recording access (for system audio)
  - Accessibility access (for global shortcuts)

---

## 🚀 BUILD & RUN

### Development Mode
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop

# Start backend first
cd ../EVIA-Backend && docker compose up -d && cd ../EVIA-Desktop

# Run desktop in dev mode
npm run dev
```

### Production Build
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop

# Clean build
npm run clean
npm install
npm run build

# Run the app
open dist/mac-arm64/EVIA.app
```

---

## 🎮 HOW TO USE

### First Time Setup
1. **Launch app**: `open dist/mac-arm64/EVIA.app`
2. **Grant permissions** when prompted:
   - Microphone
   - Screen Recording
   - Accessibility
3. **Login** with your EVIA credentials
4. **Test basic flow**:
   - Press `Cmd+K` or click "Listen/Zuhören"
   - Speak for 5-10 seconds
   - Press "Stop/Stopp"
   - View insights

### Language Switching
1. **Open Settings**: Click ⋯ (three dots) in header
2. **Select Language**: Click "German" or "English"
3. **Wait for animation**: Singularity animation plays
4. **Backend syncs**: Language change sent to backend automatically

**What Happens**:
- ✅ All UI text updates
- ✅ Active recording stops gracefully
- ✅ Session clears (transcripts, insights)
- ✅ Backend receives `change_language` command
- ✅ Deepgram reconnects with new language
- ✅ Windows close (except Settings)

### Offline Mode
**Automatic Detection**:
- Health check every 30 seconds
- After 3 failed checks → "Offline Mode" indicator appears
- Auto-reconnect when backend is back

**What's Disabled**:
- Transcription (requires backend)
- Ask/Insights (requires backend)

**What Still Works**:
- UI navigation
- Settings
- Shortcuts

---

## 🐛 TROUBLESHOOTING

### "Backend offline" toast appears
**Cause**: Backend not running or unreachable

**Fix**:
```bash
# Check if backend is running
docker ps --filter "name=backend"

# Restart backend
cd /Users/benekroetz/EVIA/EVIA-Backend
docker compose restart backend

# Wait 30 seconds for Desktop to reconnect
```

### Transcription is German when English is selected
**Cause**: Backend language not syncing

**Check**:
1. Open DevTools (if in dev mode)
2. Look for log: `[OverlayEntry] ✅ Language change command sent to backend`
3. If missing, WebSocket may be disconnected

**Fix**:
- Toggle language again (reconnects WebSocket)
- Or restart Desktop app

### "Audio capture failed" toast
**Cause**: Microphone permission not granted or mic not available

**Fix**:
```bash
# Reset mic permission
tccutil reset Microphone com.evia.app

# Restart app and grant permission when prompted
```

### Insights not updating
**Cause**: Backend Groq API key issue or rate limit

**Check Backend Logs**:
```bash
docker logs evia-backend-backend-1 --tail 50
```

**Look For**:
- `Loaded GROQ_API_KEY: xxxx...xxxx` (should NOT be [empty])
- Groq API errors (429 = rate limit, 401 = invalid key)

**Fix**:
- Update `GROQ_API_KEY` in `/Users/benekroetz/EVIA/EVIA-Backend/.env`
- Restart backend: `docker compose restart backend`

### Desktop won't start
**Cause**: Build artifacts corrupted or permissions issue

**Fix**:
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop

# Clean rebuild
rm -rf dist node_modules
npm install
npm run build

# Run again
open dist/mac-arm64/EVIA.app
```

---

## 🔐 PERMISSIONS REFERENCE

### Microphone
**Purpose**: Capture your voice for transcription  
**When Requested**: First time you press "Listen"  
**Grant**: System Settings → Privacy & Security → Microphone → EVIA (✓)

### Screen Recording
**Purpose**: Capture system audio (for meeting transcription)  
**When Requested**: First time you press "Listen" with system audio  
**Grant**: System Settings → Privacy & Security → Screen Recording → EVIA (✓)

### Accessibility
**Purpose**: Global keyboard shortcuts (Cmd+K, etc.)  
**When Requested**: First time you use a shortcut  
**Grant**: System Settings → Privacy & Security → Accessibility → EVIA (✓)

**Reset Permissions** (if needed):
```bash
tccutil reset Microphone com.evia.app
tccutil reset ScreenCapture com.evia.app
tccutil reset Accessibility com.evia.app
```

---

## ⌨️ KEYBOARD SHORTCUTS

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Toggle Listen (start/stop recording) |
| `Cmd+Enter` | Toggle Ask window |
| `Cmd+\` | Show/Hide all windows |

---

## 🎯 TESTING CHECKLIST

Before declaring "production ready", test these scenarios:

### Basic Flow
- [ ] Launch app successfully
- [ ] Grant all permissions
- [ ] Login with credentials
- [ ] Start listening (`Cmd+K`)
- [ ] Speak for 10 seconds
- [ ] Stop listening
- [ ] View transcription
- [ ] Click "Insights"
- [ ] View insights (summary, topics, actions)
- [ ] Click an insight → Ask window opens with context
- [ ] Get AI response

### Language Switching
- [ ] Open Settings
- [ ] Click "English"
- [ ] Singularity animation plays
- [ ] All UI text updates to English
- [ ] Backend confirms language change (check logs)
- [ ] Start new recording in English
- [ ] Verify transcription is English

### Offline Mode
- [ ] Stop backend: `docker compose stop backend`
- [ ] Wait 90 seconds
- [ ] "Offline Mode" indicator appears
- [ ] Toast: "Backend offline" appears
- [ ] Start backend: `docker compose start backend`
- [ ] Wait 30 seconds
- [ ] Offline indicator disappears
- [ ] Toast: "Connected to backend" appears

### Error Handling
- [ ] Try to Ask when backend is offline → Error toast
- [ ] Try to Listen when mic is denied → Error toast
- [ ] Toggle language during active recording → Graceful stop

---

## 📊 KNOWN LIMITATIONS (First Launch)

### Not Implemented Yet
1. **Per-User Groq Keys**: Using single backend key for all users
   - Will implement after first launch testing
   - UI for key input will be added later

2. **Vision API**: Disabled in backend (commented out)
   - Ready to enable post-launch
   - Test script available: `test-vision-endpoint.py`

3. **Error Boundaries**: Basic error handling only
   - Will add comprehensive error boundaries post-launch

### Expected Behavior
- **Language switch**: Active recording stops (by design)
- **Offline mode**: 30-90 second delay to detect
- **Deepgram reconnect**: 1-2 second latency on language switch

---

## 🔍 DEBUGGING

### Enable Verbose Logging
```bash
# Set environment variable
export ELECTRON_ENABLE_LOGGING=1

# Run in dev mode
npm run dev

# Logs appear in terminal
```

### Check Backend Logs
```bash
# Real-time logs
docker logs evia-backend-backend-1 -f

# Last 100 lines
docker logs evia-backend-backend-1 --tail 100

# Search for errors
docker logs evia-backend-backend-1 2>&1 | grep ERROR
```

### Check Desktop Logs
**Dev Mode**: Console in terminal

**Production**: 
```bash
# Main process logs
cat ~/Library/Logs/evia/main.log

# Renderer logs (not available in production)
```

---

## 📈 PERFORMANCE EXPECTATIONS

| Metric | Expected | Notes |
|--------|----------|-------|
| App startup | < 3s | Cold start |
| Language switch | < 2s | Includes Deepgram reconnect |
| Offline detection | 30-90s | 3 failed health checks |
| Backend health check | < 50ms | Every 30 seconds |
| Toast duration | 5s | Auto-dismiss |

---

## 🎉 SUCCESS CRITERIA

**First Launch is Successful When**:
1. ✅ App starts without errors
2. ✅ Permissions granted successfully
3. ✅ Login works
4. ✅ Transcription works (both English and German)
5. ✅ Language switching syncs with backend
6. ✅ Insights clickable and functional
7. ✅ Offline mode detects backend downtime
8. ✅ Error toasts provide helpful feedback
9. ✅ No crashes during normal usage
10. ✅ User can complete full workflow

---

## 📞 SUPPORT

### If Issues Occur
1. **Check backend health**: `curl http://localhost:8000/health`
2. **Check backend logs**: `docker logs evia-backend-backend-1 --tail 50`
3. **Restart backend**: `docker compose restart backend`
4. **Restart Desktop**: Close app, `open dist/mac-arm64/EVIA.app`
5. **Clean rebuild**: `npm run clean && npm run build`

### Report Issues
Include:
- macOS version
- Steps to reproduce
- Desktop logs (if in dev mode)
- Backend logs
- Screenshot of error

---

## 🚀 DEPLOYMENT NOTES

### For Production Deployment
1. **Code signing**: Configure Apple Developer certificate
2. **Notarization**: Submit to Apple for notarization
3. **Distribution**: 
   - Option A: Direct download (DMG)
   - Option B: Mac App Store (requires different build config)

### Backend Configuration
- Ensure `GROQ_API_KEY` is set
- Verify `.env` has all required variables
- Check database migrations are applied
- Redis should be running

---

**Manual Complete**  
**Ready for First Launch** 🎉

**Next Steps**: User testing → Gather feedback → Iterate

