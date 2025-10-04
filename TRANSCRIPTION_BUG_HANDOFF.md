# 🚨 TRANSCRIPTION BUG - HANDOFF TO SPECIALIST AGENT

**Date**: 2025-10-04  
**Priority**: CRITICAL  
**Branch**: `mup-integration`  
**Estimated Fix Time**: 15-30 minutes  

---

## 🎯 **PROBLEM STATEMENT**

**Symptom**: Transcription works end-to-end (mic → backend → Deepgram → backend sends to Desktop) BUT **Desktop Listen window shows NO transcripts**.

**Evidence**:
1. ✅ Backend receives audio (logs show `< BINARY ... [4800 bytes]`)
2. ✅ Deepgram transcribes (backend logs show `Extracted transcript text`, `Final segment`)
3. ✅ Backend sends to Desktop (logs show `> TEXT '{"type": "transcript_segment", "data": {"text":"Hey. How are you?", "speaker": 1, "is_final": true}}'`)
4. ❌ **Desktop Listen window shows NOTHING** (no console logs for WebSocket messages)

**Timer Issue**: Timer stays at `00:00` (related to same root cause)

---

## 🔍 **ROOT CAUSE ANALYSIS**

### **Hypothesis: Subscription Timing Issue**

The `ListenView.tsx` component subscribes to WebSocket messages **AFTER** the audio processor has already:
1. Connected the WebSocket
2. Started sending audio
3. Received transcription messages from backend

**Evidence**:
- **Header console** (where audio processor runs): Shows `[Audio Logger] Audio data sent - Size: 4800 bytes`
- **Listen window console**: Shows `ChatWebSocket initialized with chatId: 76` but **NO** `[ListenView] Received WebSocket message:` logs
- Backend logs confirm messages ARE being sent (see lines 28, 87, 150, 254 in attached backend logs)

**Code Flow**:
```
1. User clicks "Zuhören" button (EviaBar.tsx)
2. handleToggleListening() calls startCapture() (overlay-entry.tsx)
3. startCapture() connects WebSocket (audio-processor-glass-parity.ts:99)
4. MEANWHILE: ListenView mounts and tries to subscribe (ListenView.tsx:110-162)
5. BUT: WebSocket is already connected and messages are flowing!
6. ListenView subscription misses all messages because they arrived before subscription
```

---

## 📂 **KEY FILES TO INVESTIGATE**

### **1. ListenView.tsx** (`src/renderer/overlay/ListenView.tsx`)
**Lines 110-162**: WebSocket subscription logic
```typescript
useEffect(() => {
  const cid = localStorage.getItem('current_chat_id');
  if (!cid || cid === 'undefined') {
    console.error('[ListenView] No valid chat_id; create one first');
    return () => {};
  }
  console.log('[ListenView] Setting up WebSocket for chat_id:', cid);
  const ws = getWebSocketInstance(cid, 'mic');
  
  // CRITICAL: Subscribe to messages BEFORE connecting
  const unsub = ws.onMessage((msg: any) => {
    console.log('[ListenView] Received WebSocket message:', msg); // <-- THIS NEVER LOGS
    if (msg.type === 'transcript_segment' && msg.data) {
      const { text = '', speaker = null, is_final = false } = msg.data;
      console.log('[ListenView] Adding transcript:', text, 'final:', is_final);
      setTranscripts(prev => [...prev, { text, speaker, isFinal: is_final }]);
      // ...
    }
  });
  
  // This connect() might be redundant if audio processor already connected
  ws.connect();
  
  return () => {
    console.log('[ListenView] Cleaning up WebSocket for chat_id:', cid);
    unsub();
    ws.disconnect(); // <-- This might close the connection audio processor needs!
    stopTimer();
    setIsSessionActive(false);
  };
}, []); // Empty deps = only runs once on mount
```

**Problem**: 
- If audio processor already connected WebSocket, `ws.connect()` does nothing (already connected)
- But `ws.onMessage()` might be subscribing to a handler list that was already processed
- Cleanup `ws.disconnect()` might close the connection while audio is still streaming

### **2. audio-processor-glass-parity.ts** (`src/renderer/audio-processor-glass-parity.ts`)
**Lines 89-119**: Audio capture starts and connects WebSocket
```typescript
export async function startCapture(includeSystemAudio = false) {
  console.log('[AudioCapture] Starting capture (Glass parity: ScriptProcessorNode)...');
  
  // Step 1: Ensure WebSocket is ready
  const ws = ensureWs(); // Gets singleton instance
  if (!ws) {
    throw new Error('[AudioCapture] No valid chat_id - cannot start capture');
  }
  
  // Step 2: Connect WebSocket first <-- THIS HAPPENS BEFORE ListenView subscribes
  await ws.connect();
  console.log('[AudioCapture] WebSocket connected');
  
  // Step 3: Start audio capture
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: SAMPLE_RATE,
      channelCount: 1,
      // ...
    },
  });
  // ... rest of audio processing
}
```

**Problem**: Audio processor connects WebSocket BEFORE ListenView subscribes to messages

### **3. websocketService.ts** (`src/renderer/services/websocketService.ts`)
**Lines 1-322**: WebSocket service manages connections and message handlers

**Key Methods**:
- `getWebSocketInstance(chatId, source)` (line ~290): Returns singleton instance
- `onMessage(handler)` (line ~180): Registers message handler
- `connect()` (line ~90): Connects WebSocket
- `disconnect()` (line ~150): Closes WebSocket

**Potential Issues**:
1. **Singleton Mismatch**: Audio processor and ListenView might get different instances
2. **Handler Registration**: Handlers might not fire if registered after messages arrive
3. **Connection Race**: Multiple connect() calls might cause issues

---

## 🛠️ **SUGGESTED FIX STRATEGIES**

### **Option 1: Don't Manage WS Lifecycle in ListenView (RECOMMENDED)**
**Rationale**: Audio processor should own the WebSocket connection lifecycle. ListenView should only SUBSCRIBE to messages.

**Changes**:
```typescript
// ListenView.tsx (lines 110-162)
useEffect(() => {
  const cid = localStorage.getItem('current_chat_id');
  if (!cid || cid === 'undefined') {
    console.error('[ListenView] No valid chat_id');
    return () => {};
  }
  
  const ws = getWebSocketInstance(cid, 'mic');
  
  // ONLY SUBSCRIBE - don't connect or disconnect!
  const unsub = ws.onMessage((msg: any) => {
    console.log('[Listen View] Received WebSocket message:', msg);
    if (msg.type === 'transcript_segment' && msg.data) {
      const { text = '', speaker = null, is_final = false } = msg.data;
      setTranscripts(prev => [...prev, { text, speaker, isFinal: is_final }]);
      if (autoScroll && viewportRef.current) {
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      }
    } else if (msg.type === 'status' && msg.data?.dg_open === true) {
      console.log('[ListenView] WebSocket status: Deepgram connection OPEN. Starting timer.');
      setIsSessionActive(true);
      startTimer();
    }
  });
  
  // DON'T call ws.connect() - audio processor already did
  // DON'T call ws.disconnect() - audio processor will do it on stopCapture()
  
  return () => {
    console.log('[ListenView] Unsubscribing from WebSocket');
    unsub(); // Only unsubscribe, don't disconnect
  };
}, []); // Empty deps
```

### **Option 2: Ensure Subscription Before Connection**
**Rationale**: Make sure handlers are registered BEFORE any connect() call.

**Changes**:
```typescript
// Modify getWebSocketInstance() to ensure handlers can be registered before connect
// Or add a "preConnect" phase where all handlers register first
```

### **Option 3: Replay Missed Messages**
**Rationale**: If subscription happens after messages arrived, replay them from a buffer.

**Changes**:
- Add message buffer to `ChatWebSocket` class
- When `onMessage()` is called, replay any buffered messages

---

## 🧪 **TESTING CHECKLIST**

After implementing fix:

1. **Start Backend**: `cd EVIA-Backend && docker compose up`
2. **Start Desktop**: `cd EVIA-Desktop && EVIA_DEV=1 npm run dev:main`
3. **Test Transcription**:
   - Click "Zuhören" button
   - Speak into microphone: "Hello, this is a test"
   - **Expected**: Transcript appears in Listen window within 2-3 seconds
   - **Expected**: Timer starts incrementing (00:01, 00:02, ...)
   - **Expected**: Console logs show `[ListenView] Received WebSocket message:` and `[ListenView] Adding transcript:`
4. **Test Stop/Resume**:
   - Click "Stopp" → Timer stops
   - Click "Fertig" → Window hides
   - Click "Zuhören" again → Should work without reconnect issues

---

## 📊 **SUCCESS CRITERIA**

✅ Listen window console logs show: `[ListenView] Received WebSocket message:`  
✅ Transcripts appear in Listen window within 2-3 seconds of speech  
✅ Timer increments every second (00:01, 00:02, ...)  
✅ No WebSocket reconnect loops (check for `code=1001` or `code=1012` in logs)  
✅ Backend logs show: `> TEXT '{"type": "transcript_segment"` (already working)  

---

## 📝 **ADDITIONAL CONTEXT**

### **Backend Logs (Working Correctly)**
```
2025-10-04 16:29:26.736 | INFO | Forwarding transcript_segment to client (len=%d, final=%s)
DEBUG:    > TEXT '{"type": "transcript_segment", "data": {"text":"Hey. How are you?", "speaker": 1, "is_final": true}}' [119 bytes]
2025-10-04 16:29:26.736 | INFO | Sent transcript_segment to client (len=%d, final=%s)
```

### **Desktop Listen Console (NOT Receiving)**
```
websocketService-BT7Iw5p4.js:1 ChatWebSocket initialized with chatId: 76
websocketService-BT7Iw5p4.js:1 [Chat] Reusing existing chat id 76
overlay-iMdX1Fyp.js:195 [Insights] Fetching insights for chat 76
overlay-iMdX1Fyp.js:195 [Insights] Received 3 insights
// <-- NO '[ListenView] Received WebSocket message:' logs!
```

### **Desktop Header Console (Audio Processor Working)**
```
websocketService-BT7Iw5p4.js:1 [Audio Logger] Audio data sent - Size: 4800 bytes, Level: 0.0098
overlay-iMdX1Fyp.js:493 [AudioCapture] Sent chunk: 4800 bytes
// Audio is being sent successfully
```

---

## 🚀 **NEXT STEPS FOR SPECIALIST AGENT**

1. Read this document fully
2. Examine `ListenView.tsx` lines 110-162 (WebSocket subscription)
3. Examine `audio-processor-glass-parity.ts` lines 89-119 (WebSocket connection)
4. Examine `websocketService.ts` (handler registration logic)
5. Implement **Option 1** (recommended) or **Option 2**
6. Test using checklist above
7. Report back with:
   - What was changed
   - Console log evidence showing transcripts appearing
   - Any remaining issues

---

**Good luck! 🍀 This is the last blocker for full E2E transcription.**

