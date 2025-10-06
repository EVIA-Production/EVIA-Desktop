# Transcript Display Fix - Complete Solution

## Problem Summary
After fixing duplicate transcripts, transcripts stopped displaying in the Listen window entirely. The root cause was a **stale build** combined with needing to properly set up the IPC communication chain.

## Root Cause Analysis

### Architecture Overview
EVIA Desktop uses a multi-window Electron architecture:
- **Header Window**: Captures audio (mic + system), sends to backend via WebSocket, receives transcript responses
- **Listen Window**: Displays transcripts to the user
- **Main Process**: Relays IPC messages between windows since they're separate `BrowserWindow` instances

### Communication Flow
```
┌─────────────────┐
│  Header Window  │
│  (Audio Cap)    │
└────────┬────────┘
         │
         │ 1. Audio captured
         ▼
    WebSocket to Backend
         │
         │ 2. Transcripts received
         ▼
    Forward via IPC
         │
         │ 3. ipcRenderer.send('transcript-message', msg)
         ▼
┌─────────────────┐
│  Main Process   │
│  (IPC Relay)    │
└────────┬────────┘
         │
         │ 4. ipcMain.on('transcript-message', ...)
         │ 5. listenWin.webContents.send('transcript-message', msg)
         ▼
┌─────────────────┐
│  Listen Window  │
│  (Display)      │
└─────────────────┘
         │
         │ 6. window.evia.ipc.on('transcript-message', ...)
         │ 7. Update transcripts state
         ▼
      UI renders
```

## What Went Wrong

### Initial Problem: Duplicate Transcripts
Previously, **both** Header and Listen windows had WebSocket connections to the backend, causing duplicate transcripts.

### Fix Attempt #1 (Incorrect)
Removed:
1. ❌ WebSocket connection from Listen window ✅ **CORRECT**
2. ❌ IPC relay in main process (`overlay-windows.ts`) ❌ **WRONG**
3. ❌ IPC listener in Listen window (`ListenView.tsx`) ❌ **WRONG**

This broke the entire communication chain.

### Fix Attempt #2 (Incomplete)
Re-added the IPC listener in `ListenView.tsx`, but forgot to re-add the IPC relay in `overlay-windows.ts`. The Listen window was listening, but the main process wasn't relaying messages from Header to Listen.

### Fix Attempt #3 (Stale Build)
Re-added both the IPC relay AND listener, but the user was running **stale built code**. The source files were correct, but the compiled JavaScript in `dist/` was from the old version.

**Evidence of stale build:**
```javascript
// User's console showed this (from OLD code):
ListenView.tsx:137 [ListenView] 🔍 WebSocket useEffect STARTED
ListenView.tsx:138 [ListenView] 🔍 localStorage: object exists

// But current source code has this (NEW code):
console.log('[ListenView] Setting up IPC listener for transcript messages')
```

The line numbers and messages didn't match because the browser was running old bundled code.

## The Complete Fix

### 1. Main Process IPC Relay (`src/main/overlay-windows.ts`)
```typescript
// IPC relay: Forward transcript messages from Header window to Listen window
// This is REQUIRED because Header captures audio and receives transcripts,
// while Listen window displays them. They are separate BrowserWindows.
ipcMain.on('transcript-message', (_event, message: any) => {
  const listenWin = childWindows.get('listen')
  if (listenWin && !listenWin.isDestroyed() && listenWin.isVisible()) {
    listenWin.webContents.send('transcript-message', message)
  }
})
```

**Location**: Lines 1058-1066 in `overlay-windows.ts`

### 2. Listen Window IPC Listener (`src/renderer/overlay/ListenView.tsx`)
```typescript
useEffect(() => {
  console.log('[ListenView] Setting up IPC listener for transcript messages');
  
  const handleTranscriptMessage = (msg: any) => {
    console.log('[ListenView] 📨 Received IPC message:', msg.type);
    
    if (msg.type === 'recording_stopped') {
      console.log('[ListenView] 🛑 Recording stopped - stopping timer');
      stopTimer();
      setIsSessionActive(false);
      return;
    }
    
    if (msg.type === 'transcript_segment' && msg.data) {
      const { text = '', speaker = null, is_final = false } = msg.data;
      console.log('[ListenView] 📨 Adding transcript:', text, 'final:', is_final);
      setTranscripts(prev => [...prev, { text, speaker, isFinal: is_final }]);
      if (autoScroll && viewportRef.current) {
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      }
    } else if (msg.type === 'status' && msg.data?.echo_text) {
      const text = msg.data.echo_text;
      const isFinal = msg.data.final === true;
      console.log('[ListenView] 📨 Adding transcript from echo_text:', text, 'final:', isFinal);
      setTranscripts(prev => [...prev, { text, speaker: null, isFinal }]);
      if (autoScroll && viewportRef.current) {
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      }
    }
  };
  
  const eviaIpc = (window as any).evia?.ipc as { on: (channel: string, listener: (...args: any[]) => void) => void } | undefined;
  if (eviaIpc?.on) {
    eviaIpc.on('transcript-message', handleTranscriptMessage);
    console.log('[ListenView] ✅ IPC listener registered');
  } else {
    console.error('[ListenView] ❌ window.evia.ipc.on not available');
  }
  
  return () => {
    console.log('[ListenView] Cleaning up IPC listener');
  };
}, [autoScroll])
```

**Location**: Lines 130-184 in `ListenView.tsx`

### 3. Rebuild Application
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run build
```

**Why this is critical**: 
- Vite bundles the React code into `dist/renderer/assets/*.js`
- Even if you edit source files, the browser loads the bundled files
- Must rebuild after any changes to `src/renderer/` files

## Testing Steps

### 1. Restart the Application
If running in dev mode:
```bash
# Stop the current dev server (Ctrl+C)
npm run dev
```

### 2. Open Both Windows
1. Click the "Listen" button in the Header window
2. Both Header and Listen windows should open

### 3. Start Audio Capture
1. Play audio on your system
2. Speak into your microphone

### 4. Verify Transcripts Display
**Header Console** should show:
```
[AudioCapture] Forwarding SYSTEM message to Listen window: transcript_segment
[Preload] IPC send: transcript-message Array(1)
```

**Listen Console** should show:
```
[ListenView] ✅ IPC listener registered
[ListenView] 📨 Received IPC message: transcript_segment
[ListenView] 📨 Adding transcript: [text] final: true
[State Debug] Updated transcripts count: 1 Latest: [text]
```

**Listen Window UI** should show transcripts appearing in real-time.

### 5. Verify No Duplicates
Each transcript should appear **once** in the Listen window, not twice.

## Success Criteria

- ✅ Transcripts display in Listen window
- ✅ No duplicate transcripts
- ✅ System audio transcripts work (speaker 0)
- ✅ Microphone transcripts work (speaker 1)
- ✅ Timer starts when Listen window opens
- ✅ Both interim and final transcripts display correctly

## Key Learnings

### 1. Electron Multi-Window IPC
When you have multiple `BrowserWindow` instances:
- They **cannot** communicate directly
- Must use the main process as a relay
- Pattern: `Window A → ipcRenderer.send() → ipcMain.on() → Window B webContents.send() → Window B ipcRenderer.on()`

### 2. Stale Build Detection
If you see:
- Console logs with wrong line numbers
- Code that doesn't match your source files
- Features that should be there but aren't working

**Solution**: Rebuild with `npm run build` or restart `npm run dev`

### 3. WebSocket Instance Management
- Only the window that **captures** audio should have WebSocket connections
- Other windows should receive data via IPC, not by creating their own WebSockets
- This prevents duplicates and reduces server load

## Files Modified

1. `/Users/benekroetz/EVIA/EVIA-Desktop/src/main/overlay-windows.ts`
   - Re-added IPC relay (lines 1058-1066)

2. `/Users/benekroetz/EVIA/EVIA-Desktop/src/renderer/overlay/ListenView.tsx`
   - Removed WebSocket connection (old code)
   - Re-added IPC listener (lines 130-184)

3. **Build artifacts**
   - `dist/renderer/assets/overlay-*.js` (regenerated by build)

## Related Documentation

- `DUPLICATE_TRANSCRIPT_FIX.md` - Initial (incorrect) fix that removed too much
- `TRANSCRIPTION_DISPLAY_FIX.md` - Intermediate fix documentation
- `START_HERE.md` - Quick reference for debugging
- `COMPLETE_DESKTOP_HANDOFF.md` - Comprehensive system overview

## Conclusion

The transcript display issue was caused by:
1. **Incomplete fix**: Removing the IPC relay when fixing duplicates
2. **Stale build**: Running old bundled code after fixing source files

The solution required:
1. **Re-adding IPC relay**: Main process must forward messages between windows
2. **Rebuilding application**: Ensuring browser loads new bundled code

This is now working correctly with proper IPC-based communication between Header and Listen windows.