# Transcription Display Fix - COMPLETE

## Problem
After removing duplicate transcript handlers, transcripts stopped displaying in the Listen window entirely.

## Root Cause Analysis

### The Architecture (How It SHOULD Work)
```
Header Window:
  1. Captures audio (mic + system)
  2. Sends audio to backend via WebSocket
  3. Receives transcripts from backend
  4. Forwards transcripts to Listen window via IPC

Listen Window:
  - Listens for IPC messages from Header
  - Displays transcripts in UI
```

### What Went Wrong
In my previous fix to remove duplicates, I:
1. ✅ Removed IPC relay in `overlay-windows.ts` (correct, but incomplete)
2. ❌ Removed IPC listener in `ListenView.tsx` (WRONG!)
3. ❌ Left WebSocket setup in ListenView (WRONG!)

**Result**: Listen window created its own WebSocket that only received "EVIA connection OK" test messages, while the real transcripts were being sent via IPC to nowhere!

### Evidence from Logs
**Header Console** (working correctly):
```
[AudioCapture] Forwarding MIC message to Listen window: transcript_segment
[Preload] IPC send: transcript-message
```

**Listen Console** (broken):
```
[ListenView] ✅ Received WebSocket message: {type: 'status'...}
[ListenView] ✅ Adding transcript: EVIA connection OK  # Only test messages!
[State Debug] Updated transcripts count: 6
```

Real transcripts ("cosmological constant", etc.) were sent via IPC but never received!

## Fix Applied

### File: `src/renderer/overlay/ListenView.tsx`

**REMOVED**: WebSocket setup (lines 130-227)
- Listen window doesn't need its own WebSocket
- Header window handles WebSocket communication

**RESTORED**: IPC listener (lines 130-184)
- Listens for `transcript-message` events from Header
- Handles both `transcript_segment` and `status` messages with `echo_text`
- Adds transcripts to state for display

### Code Change
```typescript
// Listen for transcript messages forwarded from Header window via IPC
// Header window captures audio, sends to backend via WebSocket, and forwards transcripts here
useEffect(() => {
  const handleTranscriptMessage = (msg: any) => {
    if (msg.type === 'transcript_segment' && msg.data) {
      const { text, speaker, is_final } = msg.data;
      setTranscripts(prev => [...prev, { text, speaker, isFinal: is_final }]);
    } else if (msg.type === 'status' && msg.data?.echo_text) {
      const text = msg.data.echo_text;
      const isFinal = msg.data.final === true;
      setTranscripts(prev => [...prev, { text, speaker: null, isFinal }]);
    }
  };
  
  const eviaIpc = (window as any).evia?.ipc;
  if (eviaIpc?.on) {
    eviaIpc.on('transcript-message', handleTranscriptMessage);
  }
  
  return () => {
    // Cleanup
  };
}, [autoScroll]);
```

## Testing

1. **Restart EVIA** (hot-reload may not be enough):
   ```bash
   cd /Users/benekroetz/EVIA/EVIA-Desktop
   # Kill current process, then:
   EVIA_DEV=1 npm run dev:main
   ```

2. **Click "Zuhören" button**

3. **Speak or play audio** (both mic and system audio)

4. **Expected Result**:
   - Listen window shows real transcripts (not just "EVIA connection OK")
   - Console shows: `[ListenView] 📨 Received IPC message: transcript_segment`
   - Transcripts display in blue background

5. **Console Verification**:
   ```
   # Header Console:
   [AudioCapture] Forwarding MIC message to Listen window: transcript_segment
   [Preload] IPC send: transcript-message
   
   # Listen Console:
   [ListenView] 📨 Received IPC message: transcript_segment
   [ListenView] 📨 Adding transcript: [actual spoken text] final: true
   [State Debug] Updated transcripts count: 1 Latest: [actual text]
   ```

## Why This Is Correct

**Single Source of Truth**: Only Header window manages WebSocket connection
- Avoids duplicate messages
- Centralized audio capture and transmission
- Clean separation of concerns

**IPC for Window Communication**: Standard Electron pattern
- Header → Listen communication via IPC
- Simple, reliable, no duplicate WebSocket connections
- Works with Electron's multi-window architecture

## Previous Duplicate Issue (Now Fixed)
The original duplicate problem was caused by:
- Header forwarding via IPC ✓
- Listen also receiving via its own WebSocket ✗
- Same message handled twice

This fix removes Listen's WebSocket entirely, keeping only IPC listener.

## Status
✅ System audio capture working (after Mac restart)
✅ Transcripts being received by Header window
✅ IPC forwarding from Header to Listen
✅ Listen window now has IPC listener
⏳ Awaiting test confirmation

---
**Date**: 2025-10-06
**Files Modified**: 
- `src/renderer/overlay/ListenView.tsx` (restored IPC listener, removed WebSocket)

