# 🎯 AGENT PROMPT: Fix Transcription Display in Desktop App

**Role**: Transcription Specialist  
**Mission**: Fix WebSocket message subscription so transcripts appear in Listen window  
**Time Limit**: 30 minutes  
**Branch**: `mup-integration`  

---

## 📋 **YOUR MISSION**

Backend is transcribing perfectly and sending messages to Desktop, but **Desktop Listen window doesn't display them**. Fix the WebSocket message subscription timing issue so transcripts appear in real-time.

---

## 🔍 **PROBLEM**

**What's broken**: Desktop Listen window shows no transcripts despite backend sending them.

**Evidence**:
- ✅ Backend receives audio: `< BINARY ... [4800 bytes]`
- ✅ Backend transcribes: `Extracted transcript text (len=14, prev="Hey. How", is_final=True)`
- ✅ Backend sends to Desktop: `> TEXT '{"type": "transcript_segment", "data": {"text":"Hey. How are you?", "speaker": 1, "is_final": true}}'`
- ❌ **Desktop logs show NO message reception** (missing `[ListenView] Received WebSocket message:` logs)

**Root Cause**: `ListenView.tsx` subscribes to WebSocket messages AFTER the audio processor has already connected and started receiving messages. Handlers miss early messages.

---

## 📂 **FILES YOU NEED**

1. **`src/renderer/overlay/ListenView.tsx`** (lines 110-162)  
   - Currently: Subscribes to WebSocket, but misses messages
   - Fix: Don't manage connection lifecycle, only subscribe

2. **`src/renderer/audio-processor-glass-parity.ts`** (lines 89-119)  
   - Already connects WebSocket correctly
   - Don't modify this unless absolutely necessary

3. **`src/renderer/services/websocketService.ts`**  
   - WebSocket singleton service
   - Check if handler registration works correctly

---

## 🛠️ **RECOMMENDED FIX** (Option 1)

**Change `ListenView.tsx` to ONLY subscribe, not manage connection:**

```typescript
// src/renderer/overlay/ListenView.tsx (lines 110-162)
useEffect(() => {
  const cid = localStorage.getItem('current_chat_id');
  if (!cid || cid === 'undefined') {
    console.error('[ListenView] No valid chat_id');
    return () => {};
  }
  
  console.log('[ListenView] Setting up WebSocket subscription for chat_id:', cid);
  const ws = getWebSocketInstance(cid, 'mic');
  
  // ONLY SUBSCRIBE - don't call connect() or disconnect()!
  const unsub = ws.onMessage((msg: any) => {
    console.log('[ListenView] ✅ Received WebSocket message:', msg);
    if (msg.type === 'transcript_segment' && msg.data) {
      const { text = '', speaker = null, is_final = false } = msg.data;
      console.log('[ListenView] ✅ Adding transcript:', text, 'final:', is_final);
      setTranscripts(prev => [...prev, { text, speaker, isFinal: is_final }]);
      if (autoScroll && viewportRef.current) {
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      }
    } else if (msg.type === 'status' && msg.data?.dg_open === true) {
      console.log('[ListenView] ✅ Deepgram connection OPEN. Starting timer.');
      setIsSessionActive(true);
      startTimer();
    }
  });
  
  // ❌ DON'T call ws.connect() - audio processor already did
  // ❌ DON'T call ws.disconnect() - audio processor will handle it
  
  return () => {
    console.log('[ListenView] Unsubscribing from WebSocket');
    unsub(); // Only unsubscribe, don't disconnect
    stopTimer();
    setIsSessionActive(false);
  };
}, []); // Empty deps - run once on mount
```

**Why this works**:
- Audio processor (`startCapture()`) owns the WebSocket connection
- ListenView ONLY subscribes to messages
- No race conditions between connect/subscribe
- No accidental disconnects when component unmounts

---

## 🧪 **TESTING**

### **Setup**
```bash
# Terminal 1: Start backend
cd /Users/benekroetz/EVIA/EVIA-Backend
docker compose up

# Terminal 2: Build Desktop
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run build:main

# Terminal 3: Run Desktop
cd /Users/benekroetz/EVIA/EVIA-Desktop
EVIA_DEV=1 npm run dev:main
```

### **Test Cases**
1. **Click "Zuhören" button**
   - ✅ Listen window opens
   - ✅ Timer starts at 00:00
   
2. **Speak into microphone**: "Hello, this is a test"
   - ✅ Console logs: `[ListenView] ✅ Received WebSocket message:`
   - ✅ Console logs: `[ListenView] ✅ Adding transcript: Hello, this is a test`
   - ✅ **Transcript appears in Listen window within 2-3 seconds**
   - ✅ Timer increments: 00:01, 00:02, 00:03...
   
3. **Click "Stopp" button**
   - ✅ Button changes to "Fertig"
   - ✅ Timer stops incrementing
   - ✅ Audio capture stops
   
4. **Click "Fertig" button**
   - ✅ Listen window hides
   - ✅ Button returns to "Zuhören"

---

## ✅ **SUCCESS CRITERIA**

**You're done when**:
1. Console shows: `[ListenView] ✅ Received WebSocket message:` (this is the key!)
2. Transcripts appear in Listen window within 2-3 seconds
3. Timer starts at 00:01 and increments every second
4. No reconnect loops (no `code=1001` or `code=1012` errors during normal operation)

---

## 📝 **DELIVERABLES**

When done, provide:
1. **List of files changed** (should be just `ListenView.tsx`)
2. **Console log screenshot** showing:
   - `[ListenView] ✅ Received WebSocket message:`
   - `[ListenView] ✅ Adding transcript:`
   - Actual transcript text visible in window
3. **Git commit message** explaining the fix
4. **Any remaining issues** (if any)

---

## 🚨 **IF YOU GET STUCK**

**Read**: `/Users/benekroetz/EVIA/EVIA-Desktop/TRANSCRIPTION_BUG_HANDOFF.md` for detailed analysis

**Check**:
1. Is `getWebSocketInstance()` returning the same singleton for both audio processor and ListenView?
2. Are handlers registered in `messageHandlers` array before messages arrive?
3. Is `onMessage()` actually invoking all registered handlers?

**Alternative Fix** (Option 2): If Option 1 doesn't work, implement a message buffer in `websocketService.ts` to replay missed messages.

---

**Good luck! This is the last critical bug before full E2E transcription works. 🚀**

