# 🎯 EVIA-Desktop Quick Reference

## ✅ STATUS: TRANSCRIPTION WORKS!

**Date**: 2025-10-05  
**Mic Transcription**: ✅ OPERATIONAL  
**Timer**: ✅ FIXED (runs continuously)

---

## 🚀 QUICK START

```bash
# Terminal 1: Vite dev server
npm run dev:renderer

# Terminal 2: Electron
EVIA_DEV=1 npm run dev:main
```

**First time only** - Login in Header console:
```javascript
await window.evia.auth.login("admin", "Admin123!")
```

Then click **"Zuhören"** and speak!

---

## 🔧 ALL FILES MODIFIED

1. ✅ `src/main/overlay-windows.ts` - Vite dev + IPC relay
2. ✅ `src/main/preload.ts` - IPC bridge
3. ✅ `src/renderer/types.d.ts` - Auth + IPC types
4. ✅ `src/renderer/overlay/overlay-entry.tsx` - Keytar auth
5. ✅ `src/renderer/services/websocketService.ts` - Keytar auth
6. ✅ `src/renderer/audio-processor-glass-parity.ts` - IPC forward
7. ✅ `src/renderer/overlay/ListenView.tsx` - IPC receive + timer
8. ✅ `src/renderer/overlay/AskView.tsx` - Keytar auth

---

## 📋 WHAT WAS FIXED

### 1. Vite Dev Server Loading
**Before**: Loading stale pre-built files  
**After**: Loading from `http://localhost:5174` (hot reload works)

### 2. Authentication
**Before**: Using `localStorage` (401/403 errors)  
**After**: Using `window.evia.auth.getToken()` (keytar - secure!)

### 3. IPC Message Relay
**Before**: Listen window can't receive transcripts (separate JS contexts)  
**After**: Header → Main → Listen relay works perfectly

### 4. Timer
**Before**: Restarting on every Deepgram connection event  
**After**: Runs continuously from component mount to unmount

---

## 🎯 NEXT FEATURES (Priority Order)

1. **System Audio Capture** (4-6 hours) - CRITICAL
2. **Speaker Diarization UI** (2-3 hours) - Easy
3. **Clickable Insights** (2-3 hours) - Medium
4. **Ask Testing** (1 hour) - Ready to test
5. **Settings Window** (3-4 hours) - Medium
6. **UI Polish** (2-3 hours) - Low priority

**Total estimated**: ~15-20 hours to complete

---

## 💾 COMPLETE DOCUMENTATION

- 📘 **COMPLETE_FIX_REPORT.md** - Full technical details (all fixes)
- 📗 **NEXT_STEPS.md** - Implementation guide for remaining features
- 📙 **QUICK_REFERENCE.md** - This file (quick commands)

---

## 🐛 DEBUG COMMANDS

```javascript
// Check auth status
await window.evia.auth.getToken()

// Reset chat
localStorage.removeItem('current_chat_id')

// Check IPC
console.log('IPC available:', !!window.evia.ipc)

// System health
console.log({
  auth: await window.evia.auth.getToken() ? 'OK' : 'MISSING',
  ipc: typeof window.evia.ipc === 'object' ? 'OK' : 'MISSING',
  chatId: localStorage.getItem('current_chat_id')
})
```

---

## 📊 ARCHITECTURE

```
Microphone
    ↓
Header Window (audio-processor-glass-parity.ts)
    ↓ WebSocket (authenticated via keytar)
Backend (FastAPI + Deepgram)
    ↓ Transcription
Header Window (WebSocket handler)
    ↓ window.evia.ipc.send('transcript-message', msg)
Main Process (overlay-windows.ts)
    ↓ ipcMain.on('transcript-message')
    ↓ webContents.send('transcript-message', msg)
Listen Window (ListenView.tsx)
    ↓ window.evia.ipc.on('transcript-message')
    ↓ setTranscripts() + Display

Timer: Starts on mount, stops on unmount (lifecycle-controlled)
```

---

## 🎉 SUCCESS METRICS

- ✅ Audio captured at 24kHz
- ✅ JWT auth from keytar (secure)
- ✅ Backend transcription confirmed
- ✅ IPC relay working
- ✅ Real-time display in Listen window
- ✅ Timer runs continuously
- ✅ No stale build issues

**All core functionality operational!**

---

**Ready for phase 2: System audio + speaker diarization** 🚀

