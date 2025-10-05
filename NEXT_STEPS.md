# 🚀 EVIA-Desktop - Next Steps

## ✅ CURRENT STATUS
**Microphone Transcription**: FULLY WORKING ✅  
**Timer**: Fixed (runs continuously) ✅  
**Date**: 2025-10-05

---

## 🎯 IMMEDIATE TESTING

### Test Transcription:
```bash
# 1. Ensure Vite is running:
npm run dev:renderer

# 2. In another terminal, start Electron:
EVIA_DEV=1 npm run dev:main

# 3. Click "Zuhören" and speak!
```

### Verify Timer Fix:
- Timer should start when Listen window opens
- Timer should NOT reset when you see "Deepgram connection OPEN"
- Timer should only stop when you press "Stopp"

---

## 🔥 HIGH PRIORITY FEATURES (In Order)

### 1. System Audio Capture (CRITICAL - 4-6 hours)
**Why Critical**: Required for meeting transcription (capture other person's voice)

**Implementation Plan**:

**A. Main Process** (`src/main/preload.ts`):
```typescript
// Add system audio bridge
systemAudio: {
  start: () => ipcRenderer.invoke('system-audio:start'),
  stop: () => ipcRenderer.invoke('system-audio:stop'),
  onData: (callback) => ipcRenderer.on('system-audio:data', callback),
}
```

**B. Audio Processor** (`src/renderer/audio-processor-glass-parity.ts`):
```typescript
// Create separate WebSocket for system audio
const systemWs = getWebSocketInstance(chatId, 'system'); // source=system
systemWs.connect();

// Forward system audio chunks
window.evia.systemAudio.onData((audioData) => {
  systemWs.sendBinary(audioData);
});
```

**C. Display** (`src/renderer/overlay/ListenView.tsx`):
```typescript
// Conditional styling based on speaker
const transcriptClass = speaker === 1 
  ? 'text-blue-500 text-right' // Mic (me)
  : 'text-gray-400 text-left'; // System (them)
```

**Permissions Required**:
- macOS: Screen Recording permission (allows system audio capture)
- Add to Info.plist: `NSScreenCaptureUsageDescription`

---

### 2. Speaker Diarization UI (EASY - 2-3 hours)
**Why Easy**: Backend already provides speaker IDs, just need CSS

**Implementation** (`src/renderer/overlay/ListenView.tsx`):
```tsx
// Around line 550, modify transcript rendering:
{transcripts.map((t, i) => (
  <div 
    key={i}
    className={`
      ${t.speaker === 1 ? 'ml-auto bg-blue-500/10 text-blue-300' : 'mr-auto bg-gray-500/10 text-gray-300'}
      ${t.speaker === 1 ? 'text-right' : 'text-left'}
      px-3 py-2 rounded-lg max-w-[80%] mb-2
    `}
  >
    <div className="text-xs opacity-50 mb-1">
      {t.speaker === 1 ? 'Me' : 'Them'}
    </div>
    {t.text}
  </div>
))}
```

---

### 3. Clickable Insights (MEDIUM - 2-3 hours)
**Why Medium**: WebSocket handler exists, needs UI + click logic

**Implementation** (`src/renderer/overlay/ListenView.tsx`):
```tsx
// Around line 600, add insight rendering:
{viewMode === 'insights' && (
  <div className="space-y-2 p-4">
    {insights.map((insight, i) => (
      <button
        key={i}
        onClick={() => handleInsightClick(insight)}
        className="w-full text-left p-3 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg transition"
      >
        <div className="text-xs text-purple-400 mb-1">{insight.type}</div>
        <div className="text-white">{insight.title}</div>
        <div className="text-sm text-gray-400 mt-1">{insight.text}</div>
      </button>
    ))}
  </div>
)}

const handleInsightClick = (insight: Insight) => {
  // Open Ask window with pre-filled prompt
  window.evia.windows.show('ask');
  // Send prompt to Ask window via IPC
  window.evia.ipc.send('ask:set-prompt', insight.prompt);
};
```

---

### 4. Ask Functionality Testing (EASY - 1 hour)
**Status**: Already fixed (keytar auth), just needs testing

**Test Commands**:
```javascript
// In Ask window console:
// 1. Check auth
await window.evia.auth.getToken() // Should return token

// 2. Test streaming
// Type a question and press Enter
// Should stream response from backend
```

---

### 5. Settings Window (MEDIUM - 3-4 hours)
**Components Needed**:
- Login/logout UI
- Meeting notes toggle
- Keyboard shortcuts config
- Quit button

**File**: Create `src/renderer/overlay/SettingsView.tsx`

---

### 6. UI Polish (LOW PRIORITY - 2-3 hours)
**Areas**:
- Transcript bubble animations (fade in)
- Timer styling (larger, more visible)
- Insight card hover effects
- Loading states
- Error states

---

## 📋 DETAILED SYSTEM AUDIO GUIDE

### Step 1: macOS Permissions
```typescript
// Add to Info.plist:
<key>NSScreenCaptureUsageDescription</key>
<string>EVIA needs screen recording permission to capture system audio during meetings</string>
```

### Step 2: Desktop Capturer API
```typescript
// In audio-processor-glass-parity.ts:
async function startSystemAudioCapture() {
  // Get system audio source
  const sources = await window.evia.getDesktopCapturerSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  });
  
  const systemAudioSource = sources.find(s => s.id.includes('screen'));
  
  // Capture system audio
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: systemAudioSource.id
      }
    },
    video: false
  });
  
  // Create separate WebSocket for system audio
  const systemWs = getWebSocketInstance(chatId, 'system');
  await systemWs.connect();
  
  // Process audio (same as mic)
  const audioContext = new AudioContext({ sampleRate: 24000 });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(2400, 1, 1);
  
  processor.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    const pcmData = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
    }
    systemWs.sendBinary(pcmData.buffer);
  };
  
  source.connect(processor);
  processor.connect(audioContext.destination);
}
```

### Step 3: Dual WebSocket Management
```typescript
// Both WebSockets run simultaneously:
const micWs = getWebSocketInstance(chatId, 'mic');    // speaker: 1
const systemWs = getWebSocketInstance(chatId, 'system'); // speaker: 0

// Both forward to same Listen window
micWs.onMessage((msg) => window.evia.ipc.send('transcript-message', msg));
systemWs.onMessage((msg) => window.evia.ipc.send('transcript-message', msg));
```

---

## 🎨 UI DESIGN GOALS

### Transcript Bubbles:
```
┌─────────────────────────────────┐
│                                 │
│              ┌──────────────┐   │  ← Me (Blue, Right)
│              │ Hey, what's  │   │
│              │ up?          │   │
│              └──────────────┘   │
│                                 │
│  ┌──────────────┐              │  ← Them (Grey, Left)
│  │ Not much,    │              │
│  │ how about    │              │
│  │ you?         │              │
│  └──────────────┘              │
│                                 │
└─────────────────────────────────┘
```

### Insight Cards:
```
┌─────────────────────────────────┐
│ 📊 MEETING SUMMARY              │  ← Purple, Clickable
│ "Discussed project timeline..." │
├─────────────────────────────────┤
│ 💡 ACTION ITEM                  │  ← Yellow, Clickable
│ "Follow up with team..."        │
└─────────────────────────────────┘
```

---

## 🐛 KNOWN ISSUES (None blocking!)

1. ✅ Timer resets - FIXED
2. ✅ Authentication - FIXED
3. ✅ IPC relay - FIXED
4. ✅ Vite hot reload - FIXED

**All critical issues resolved!**

---

## 📊 PROGRESS TRACKER

- [x] Microphone transcription
- [x] Authentication (keytar)
- [x] WebSocket connection
- [x] IPC message relay
- [x] Timer functionality
- [ ] System audio capture
- [ ] Speaker diarization UI
- [ ] Clickable insights
- [ ] Ask functionality testing
- [ ] Settings window
- [ ] UI polish

**6/12 Complete = 50% Done**

---

## 🚀 LAUNCH CHECKLIST (Before User Testing)

### Must Have:
- [x] Mic transcription
- [ ] System audio transcription
- [ ] Speaker diarization (me vs them)
- [ ] Basic insights display
- [ ] Ask functionality
- [ ] Login/logout

### Nice to Have:
- [ ] Insight click actions
- [ ] Meeting notes export
- [ ] Keyboard shortcuts
- [ ] UI animations
- [ ] Error handling polish

---

## 📞 SUPPORT COMMANDS

### Reset Everything:
```bash
# Clear all state
localStorage.clear()
await window.evia.auth.logout()
```

### Debug Mode:
```javascript
// Enable verbose logging
localStorage.setItem('debug', 'true')
```

### Check System Health:
```javascript
// Run in any console
console.log('Auth:', await window.evia.auth.getToken() ? 'OK' : 'MISSING')
console.log('IPC:', typeof window.evia.ipc === 'object' ? 'OK' : 'MISSING')
console.log('Chat ID:', localStorage.getItem('current_chat_id'))
```

---

**Ready for next phase! 🚀**  
**Start with system audio capture for complete transcription.**

