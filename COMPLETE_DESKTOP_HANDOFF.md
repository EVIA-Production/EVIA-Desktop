# 🚨 COMPLETE EVIA DESKTOP HANDOFF - TRANSCRIPTION FAILURE

**Date**: 2025-10-04  
**Branch**: `mup-integration`  
**Last Commit**: `0c54022`  
**Status**: ⚠️ CRITICAL - Transcription display completely broken despite backend sending data  

---

## 📋 TABLE OF CONTENTS

1. [Current State & Critical Issues](#current-state--critical-issues)
2. [What We're Trying to Achieve](#what-were-trying-to-achieve)
3. [Complete System Architecture](#complete-system-architecture)
4. [What We've Done (Chronological)](#what-weve-done-chronological)
5. [The Mysterious Failure](#the-mysterious-failure)
6. [Complete File Analysis](#complete-file-analysis)
7. [Assumptions That May Be Wrong](#assumptions-that-may-be-wrong)
8. [All Debugging Attempts](#all-debugging-attempts)
9. [Next Steps & Multiple Theories](#next-steps--multiple-theories)

---

## 1. CURRENT STATE & CRITICAL ISSUES

### 🔴 CRITICAL ISSUE: Zero ListenView Logs Despite Component "Mounting"

**What User Sees**:
- Click "Zuhören" button → Listen window opens (appears on screen)
- Speak into microphone → Header window logs show audio being sent
- Backend logs show Deepgram transcribing successfully
- Listen window shows: **NOTHING** (no transcripts, timer stays at 00:00)
- Listen DevTools console shows **ONLY 3 lines**:
  ```
  websocketService-BT7Iw5p4.js:1 [WS] Closed: code=1001 reason=
  websocketService-BT7Iw5p4.js:1 Reconnecting attempt 1...
  websocketService-BT7Iw5p4.js:1 [Chat] Reusing existing chat id 76
  ```

**What's Expected**:
- Listen window should show diagnostic logs starting with `[ListenView] 🔍 WebSocket useEffect STARTED`
- Should show transcript bubbles appearing in real-time
- Timer should increment: 00:01, 00:02, 00:03...

**Key Observation**: 
- **NO `[ListenView]` logs appear at all**
- Only WebSocket service logs appear (from `websocketService-BT7Iw5p4.js`)
- This suggests the React component's useEffect hooks are NOT running
- OR the build is old/cached
- OR the Listen window is loading a different file than expected

### 🟡 SECONDARY ISSUES

1. **"Fertig" (Done) button disappears after clicking "Stopp"**
   - Expected: "Zuhören" → "Stopp" → "Fertig" → (back to "Zuhören")
   - Actual: "Zuhören" → "Stopp" → (button disappears or doesn't show "Fertig")

2. **Listen window doesn't close after session ends**
   - Expected: Click "Fertig" → window hides
   - Actual: Window stays open (may be related to button issue)

3. **Timer never starts**
   - Expected: Timer starts when Deepgram connects
   - Actual: Stays at 00:00 (depends on WebSocket messages being received)

4. **No system audio transcription**
   - Microphone works (backend logs show audio being sent)
   - System audio doesn't produce transcripts
   - May need permissions fix (see `system-audio-capture-permissions.md`)

---

## 2. WHAT WE'RE TRYING TO ACHIEVE

### 🎯 PRIMARY GOAL: Live Transcription Display

**End-to-End Flow (How It Should Work)**:

```
User Clicks "Zuhören"
    ↓
Header Window (EviaBar.tsx)
    - Calls startCapture() [audio-processor-glass-parity.js]
    - Opens Listen window via IPC [overlay-windows.ts]
    ↓
Audio Processor (Header Window Context)
    - Captures microphone via getUserMedia()
    - Uses ScriptProcessorNode (deprecated but working)
    - Converts to PCM16 binary chunks (4800 bytes)
    - Sends via WebSocket to backend
    ↓
Backend (Python FastAPI)
    - Receives binary audio on ws://localhost:8000/ws/transcribe
    - Forwards to Deepgram for transcription
    - Deepgram returns interim & final transcripts
    - Backend sends TWO message types:
        1. {"type": "status", "data": {"echo_text": "Hello", "final": false}}  [interim]
        2. {"type": "transcript_segment", "data": {"text": "Hello", "speaker": 1, "is_final": true}}  [final]
    ↓
Listen Window (ListenView.tsx - SEPARATE BrowserWindow)
    - Subscribes to WebSocket messages via getWebSocketInstance()
    - Handles BOTH message types (echo_text AND transcript_segment)
    - Updates transcripts state
    - Renders transcript bubbles
    - Auto-scrolls to bottom
    ↓
User Sees: Live transcripts appearing as they speak!
```

### 📊 Key Architectural Detail: Multiple BrowserWindows

**CRITICAL UNDERSTANDING**:
- Each Electron `BrowserWindow` runs in a **SEPARATE renderer process**
- Each process has its own JavaScript heap, localStorage, globals
- The WebSocket service singleton creates **ONE WebSocket instance PER WINDOW**
- Header window has WebSocket A (for sending audio)
- Listen window has WebSocket B (for receiving transcripts)
- Both connect to the same backend endpoint with same chat_id
- Backend supports multiple WebSocket connections per chat_id

**Why This Matters**:
- Previous bug: Listen window wasn't connecting its own WebSocket
- Fix attempt: Added `ws.connect()` in ListenView.tsx useEffect
- Current issue: useEffect seems to not be running at all

---

## 3. COMPLETE SYSTEM ARCHITECTURE

### 📁 Repository Structure

```
/Users/benekroetz/EVIA/
├── EVIA-Backend/          # FastAPI backend (Python)
│   └── docker compose up  # Running at localhost:8000
├── EVIA-Desktop/          # Electron app (TypeScript/React)
│   ├── src/
│   │   ├── main/
│   │   │   ├── main.ts                    # Electron main process
│   │   │   └── overlay-windows.ts         # Window management (632 lines)
│   │   └── renderer/
│   │       ├── overlay/
│   │       │   ├── overlay-entry.tsx      # Entry point, routes to views
│   │       │   ├── EviaBar.tsx            # Header bar (Listen button)
│   │       │   ├── ListenView.tsx         # Transcription view (652 lines) ⚠️ BROKEN
│   │       │   ├── AskView.tsx            # Q&A view
│   │       │   └── SettingsView.tsx       # Settings panel
│   │       ├── services/
│   │       │   ├── websocketService.ts    # WebSocket client (logs appear)
│   │       │   └── insightsService.ts     # Fetch insights (works)
│   │       ├── audio-processor-glass-parity.js  # Audio capture
│   │       └── i18n/
│   │           ├── de.json                # German translations
│   │           └── en.json                # English translations
│   └── dist-electron/          # Compiled JavaScript (output)
│       └── renderer/
│           └── overlay-*.js    # Bundled renderer code
└── glass/                      # Reference implementation (working)
    └── src/ui/listen/ListenView.js  # Original working version
```

### 🔌 Window URLs & Routing

**Window Creation** (`overlay-windows.ts`):
```typescript
// Header window
loadURL: isDev 
  ? 'http://localhost:5174/?view=header'
  : `file://${path.join(__dirname, '../renderer/index.html')}?view=header`

// Listen window  
loadURL: isDev
  ? 'http://localhost:5174/?view=listen'
  : `file://${path.join(__dirname, '../renderer/index.html')}?view=listen`
```

**Routing** (`overlay-entry.tsx` lines 84-122):
```typescript
const params = new URLSearchParams(window.location.search)
const view = (params.get('view') || 'header').toLowerCase()

switch (view) {
  case 'header':
    return <EviaBar ... />
  case 'listen':
    return <ListenView lines={[]} followLive={true} ... />  // ⚠️ THIS SHOULD RENDER
  case 'ask':
    return <AskView ... />
  // ...
}
```

### 🔄 Build Process

**Development**:
```bash
# Terminal 1: Vite dev server (renderer)
npm run dev:renderer
# → Runs on localhost:5174
# → Hot module reload enabled

# Terminal 2: Electron main process
npm run build:main  # Compile TypeScript → dist-electron/
EVIA_DEV=1 npm run dev:main  # Run Electron
```

**Key Point**: In dev mode, windows load from `http://localhost:5174/?view=...` (Vite server)

---

## 4. WHAT WE'VE DONE (CHRONOLOGICAL)

### ✅ Early Fixes (Before This Session)

1. **Fixed header centering**
   - Header now centers on screen on first load
   - Stays centered when width changes

2. **Fixed settings hover isolation**
   - Settings button hover no longer opens Listen/Ask windows
   - Used cursor polling instead of global state updates

3. **Fixed DevTools opening**
   - All child windows now open DevTools in dev mode
   - Changed `devTools: process.env.NODE_ENV === 'development'` to `devTools: true`

4. **Added dummy insights**
   - Insights tab shows 3 placeholder items
   - Uses i18n keys for German/English

### 🔧 Session Fixes (Today)

#### Fix Attempt #1: Handle `echo_text` Format (Commit `363b391`)

**Problem**: Backend sends transcripts as `{"type": "status", "data": {"echo_text": "..."}}` but ListenView only handled `transcript_segment` type.

**Fix**: Added handler in ListenView.tsx (lines 149-162):
```typescript
} else if (msg.type === 'status') {
  // Handle echo_text (backend sends interim transcripts as echo_text in status messages)
  if (msg.data?.echo_text) {
    const text = msg.data.echo_text;
    const isFinal = msg.data.final === true;
    console.log('[ListenView] ✅ Adding transcript from echo_text:', text, 'final:', isFinal);
    setTranscripts(prev => {
      const next = [...prev, { text, speaker: null, isFinal }];
      console.log('[State Debug] Updated transcripts count:', next.length, 'Latest:', text.substring(0, 50));
      return next;
    });
    if (autoScroll && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }
  // ... timer logic ...
}
```

**Result**: ❌ No change - transcripts still don't appear

#### Fix Attempt #2: Add Diagnostic Logging (Commit `f0ae7f4`)

**Problem**: Can't tell if useEffect is even running.

**Fix**: Added ultra-verbose logging at useEffect start (lines 116-132):
```typescript
useEffect(() => {
  console.log('[ListenView] 🔍 WebSocket useEffect STARTED');
  console.log('[ListenView] 🔍 localStorage:', typeof localStorage, localStorage ? 'exists' : 'null');
  
  let cid: string | null = null;
  try {
    cid = localStorage.getItem('current_chat_id');
    console.log('[ListenView] 🔍 Retrieved chat_id:', cid, 'type:', typeof cid);
  } catch (err) {
    console.error('[ListenView] ❌ localStorage.getItem ERROR:', err);
    return () => {};
  }
  
  if (!cid || cid === 'undefined' || cid === 'null') {
    console.error('[ListenView] ❌ No valid chat_id (value:', cid, '); create one first');
    return () => {};
  }
  console.log('[ListenView] ✅ Valid chat_id found:', cid, '- Setting up WebSocket...');
  // ... rest of setup
}, []);
```

**Result**: ❌ **DIAGNOSTIC LOGS NEVER APPEAR** - This is the smoking gun!

---

## 5. THE MYSTERIOUS FAILURE

### 🔍 Evidence Analysis

#### What We Know FOR SURE:

1. **Backend is working perfectly**:
   ```
   Backend logs (lines 6, 25, 69, 88 of user's terminal output):
   DEBUG: > TEXT '{"type": "status", "data": {"echo_text": "Hey. How are you?", "final": false}}'
   
   Backend logs (lines 240, 347, 401, 442, 515, 557):
   DEBUG: > TEXT '{"type": "transcript_segment", "data": {"text":"Hey. How are you?", "speaker": 1, "is_final": true}}'
   
   Backend logs (line 364):
   DEBUG: > TEXT '{"type":"status","data":{"dg_open":true}}'
   ```
   ✅ Backend receives audio
   ✅ Deepgram transcribes successfully  
   ✅ Backend sends both message types
   ✅ WebSocket connections accepted (lines 111, 311)

2. **Header window is working**:
   ```
   Header DevTools:
   [AudioCapture] Audio detected - Level: 0.1684
   [AudioCapture] Sent chunk: 4800 bytes
   ```
   ✅ Audio capture works
   ✅ Binary chunks sent to backend
   ✅ WebSocket connected from header

3. **Listen window opens visually**:
   ✅ Window appears on screen
   ✅ Has correct size/position
   ✅ DevTools can be opened

4. **SOME JavaScript runs in Listen window**:
   ```
   Listen DevTools logs (user provided):
   websocketService-BT7Iw5p4.js:1 [WS] Closed: code=1001 reason=
   websocketService-BT7Iw5p4.js:1 Reconnecting attempt 1...
   websocketService-BT7Iw5p4.js:1 [Chat] Reusing existing chat id 76
   ```
   ✅ WebSocket service IS running
   ✅ Chat ID is being retrieved
   ✅ Reconnection logic works

5. **Insights fetch works**:
   ```
   Earlier logs showed:
   [Insights] Fetching insights for chat 76
   [Insights] Received 3 insights
   ```
   ✅ Some useEffect hooks ARE running
   ✅ localStorage access works (for insights)
   ✅ HTTP requests work

#### What's BROKEN:

1. **NO React component logs appear**:
   ❌ No `[ListenView]` logs at all
   ❌ Diagnostic logs don't appear (added in commit `f0ae7f4`)
   ❌ Suggests useEffect NOT running OR build is stale

2. **WebSocket closes immediately**:
   ```
   [WS] Closed: code=1001 reason=
   Reconnecting attempt 1...
   ```
   ❌ Code 1001 = "going away" (normal close from server or client)
   ❌ But backend logs show connection stays open
   ❌ Suggests Listen window's WebSocket never successfully connects

3. **No transcripts render**:
   ❌ Empty transcript area
   ❌ Timer stays at 00:00
   ❌ No speech bubbles appear

### 🤔 Why Diagnostic Logs Don't Appear

**CRITICAL MYSTERY**: The diagnostic logs we added (commit `f0ae7f4`) should be the FIRST thing that runs when ListenView mounts. They don't appear. Why?

**Theory 1: Build is stale/cached**
- `npm run build:main` only compiles main process TypeScript
- Renderer code is served by Vite dev server (localhost:5174)
- Maybe Vite cached the old bundle?
- **Test**: Check if `overlay-*.js` in browser DevTools Sources tab shows new code

**Theory 2: React component isn't mounting at all**
- `overlay-entry.tsx` might not be routing correctly
- Maybe `view` param is wrong? (But insights work, so component must mount?)
- **Test**: Add `console.log` at component root (before any hooks)

**Theory 3: Different bundle is loading**
- Dev mode loads from `http://localhost:5174/?view=listen`
- Maybe there's a Vite compilation error?
- Maybe sourceMap is broken and logs point to wrong file?
- **Test**: Check Vite terminal for build errors

**Theory 4: useEffect dependency issue**
- Our useEffect has `[]` deps (should run once on mount)
- Maybe React StrictMode runs it twice and second run fails?
- Maybe unmounting before it completes?
- **Test**: Add `console.log` BEFORE useEffect definition

**Theory 5: Import error silently failing**
- `import { getWebSocketInstance } from '../services/websocketService'`
- Maybe import fails and breaks the module?
- **Test**: Add try-catch around entire component

---

## 6. COMPLETE FILE ANALYSIS

### 📄 ListenView.tsx (Critical File - 652 lines)

**Location**: `/Users/benekroetz/EVIA/EVIA-Desktop/src/renderer/overlay/ListenView.tsx`

**Key Sections**:

#### Imports (Lines 1-6)
```typescript
import React, { useEffect, useRef, useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';
import { getWebSocketInstance } from '../services/websocketService';
import { fetchInsights, Insight } from '../services/insightsService';
import { i18n } from '../i18n/i18n';
```

**Potential Issue**: If any of these imports fail, the entire module breaks.

#### Component Definition (Lines 14-36)
```typescript
interface ListenViewProps {
  lines: string[];
  followLive: boolean;
  onToggleFollow: () => void;
  onClose?: () => void;
}

export default function ListenView({
  lines,
  followLive,
  onToggleFollow,
  onClose
}: ListenViewProps) {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [insights, setInsights] = useState<Insight[]>([
    { text: i18n.t('overlay.insights.dummyInsight1'), type: 'insight' },
    { text: i18n.t('overlay.insights.dummyInsight2'), type: 'insight' },
    { text: i18n.t('overlay.insights.dummyInsight3'), type: 'insight' },
  ]);
  // ... more state
```

**Note**: Component receives `lines={[]}` prop from overlay-entry.tsx (line 99)

#### WebSocket useEffect (Lines 115-191) ⚠️ **THIS IS THE BROKEN PART**
```typescript
useEffect(() => {
  console.log('[ListenView] 🔍 WebSocket useEffect STARTED');  // ❌ NEVER APPEARS
  console.log('[ListenView] 🔍 localStorage:', typeof localStorage, localStorage ? 'exists' : 'null');
  
  let cid: string | null = null;
  try {
    cid = localStorage.getItem('current_chat_id');
    console.log('[ListenView] 🔍 Retrieved chat_id:', cid, 'type:', typeof cid);
  } catch (err) {
    console.error('[ListenView] ❌ localStorage.getItem ERROR:', err);
    return () => {};
  }
  
  if (!cid || cid === 'undefined' || cid === 'null') {
    console.error('[ListenView] ❌ No valid chat_id (value:', cid, '); create one first');
    return () => {};
  }
  console.log('[ListenView] ✅ Valid chat_id found:', cid, '- Setting up WebSocket...');
  
  const ws = getWebSocketInstance(cid, 'mic');
  
  const unsub = ws.onMessage((msg: any) => {
    console.log('[ListenView] ✅ Received WebSocket message:', msg);
    
    if (msg.type === 'transcript_segment' && msg.data) {
      const { text = '', speaker = null, is_final = false } = msg.data;
      console.log('[ListenView] ✅ Adding transcript:', text, 'final:', is_final);
      setTranscripts(prev => {
        const next = [...prev, { text, speaker, isFinal: is_final }];
        console.log('[State Debug] Updated transcripts count:', next.length, 'Latest:', text.substring(0, 50));
        return next;
      });
      if (autoScroll && viewportRef.current) {
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      }
    } else if (msg.type === 'insight_segment' && msg.data) {
      const { text = '', type = 'insight' } = msg.data;
      console.log('[ListenView] ✅ Adding insight:', text, 'type:', type);
      setInsights(prev => [...prev, { text, type }]);
    } else if (msg.type === 'status') {
      console.log('[ListenView] ✅ Status message:', msg.data);
      
      // Handle echo_text (backend sends interim transcripts as echo_text in status messages)
      if (msg.data?.echo_text) {
        const text = msg.data.echo_text;
        const isFinal = msg.data.final === true;
        console.log('[ListenView] ✅ Adding transcript from echo_text:', text, 'final:', isFinal);
        setTranscripts(prev => {
          const next = [...prev, { text, speaker: null, isFinal }];
          console.log('[State Debug] Updated transcripts count:', next.length, 'Latest:', text.substring(0, 50));
          return next;
        });
        if (autoScroll && viewportRef.current) {
          viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        }
      }
      
      // Start timer ONLY when Deepgram connection is confirmed open
      if (msg.data?.dg_open === true) {
        console.log('[ListenView] ✅ Deepgram connection OPEN - starting timer');
        setIsSessionActive(true);
        startTimer();
      } else if (msg.data?.dg_open === false) {
        console.log('[ListenView] Deepgram connection CLOSED - stopping timer');
        setIsSessionActive(false);
        stopTimer();
      }
    }
  });
  
  // Connect this window's WebSocket instance (separate from header window's instance)
  ws.connect().then(() => {
    console.log('[ListenView] ✅ WebSocket connected successfully');
  }).catch(err => {
    console.error('[ListenView] ❌ WebSocket connection failed:', err);
  });
  
  return () => { 
    console.log('[ListenView] Cleanup: Disconnecting WebSocket for this window');
    unsub();
    ws.disconnect();
    stopTimer();
    setIsSessionActive(false);
  };
}, []); // Empty dependency - only run once on mount
```

**EXPECTED BEHAVIOR**:
1. First log appears: `[ListenView] 🔍 WebSocket useEffect STARTED`
2. localStorage accessed successfully
3. chat_id retrieved (should be "76")
4. WebSocket instance created
5. Message handler subscribed
6. WebSocket connects
7. Messages flow: dg_open → echo_text → transcript_segment

**ACTUAL BEHAVIOR**:
1. **NO LOGS APPEAR AT ALL** ❌
2. Only WebSocket service logs appear (from different file)

#### Other useEffects (For Comparison - These Might Work)

**Auto-scroll useEffect** (Lines 86-96):
```typescript
useEffect(() => {
  const viewport = viewportRef.current;
  if (!viewport) return;

  const handleScroll = () => {
    const isAtBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  viewport.addEventListener('scroll', handleScroll);
  return () => viewport.removeEventListener('scroll', handleScroll);
}, []);
```

**Window height adjustment** (Lines 106-113):
```typescript
useEffect(() => {
  adjustWindowHeight();
  return () => {
    if (copyTimeout.current) {
      clearTimeout(copyTimeout.current);
    }
  };
}, []);
```

**Question**: Do THESE useEffects run? We don't have logs for them either.

#### Insights Fetch (Lines 198-217) ✅ **THIS WORKS**
```typescript
const handleInsightClick = async (insight: Insight) => {
  console.log('[ListenView] Insight clicked:', insight.text);
  // ... open Ask window ...
  if (viewMode === 'insights') {
    setIsLoadingInsights(true);
    try {
      const chatId = Number(localStorage.getItem('current_chat_id') || '0');
      const token = localStorage.getItem('auth_token') || '';
      if (chatId && token) {
        const fetchedInsights = await fetchInsights({ chatId, token, language: 'de' });
        setInsights(fetchedInsights);
      }
    } catch (error) {
      console.error('[ListenView] Failed to fetch insights:', error);
    } finally {
      setIsLoadingInsights(false);
    }
  }
};
```

**Key Observation**: This code DOES run (logs appear: `[Insights] Fetching...`), so:
- ✅ Component IS mounting
- ✅ localStorage IS accessible
- ✅ Functions CAN run
- ❓ But why don't useEffect hooks run?

#### Render Method (Lines 219-652)
Long JSX that renders transcript bubbles, timer, toggle buttons, etc.

**Note**: The render method executes (we see the window), but state never updates.

---

### 📄 websocketService.ts (Logs DO Appear From This File)

**Location**: `/Users/benekroetz/EVIA/EVIA-Desktop/src/renderer/services/websocketService.ts`

**Key Sections**:

#### ChatWebSocket Class (Lines 80-290)
```typescript
export class ChatWebSocket {
  private chatId: string;
  private source?: 'mic' | 'system';
  private ws: WebSocket | null = null;
  private isConnectedFlag: boolean = false;
  // ...

  constructor(chatId: string, source?: 'mic' | 'system') {
    this.chatId = chatId;
    this.source = source;
    console.log('ChatWebSocket initialized with chatId:', chatId);  // ✅ THIS LOG APPEARS
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // ... WebSocket setup ...
      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.isConnectedFlag = true;
        resolve();
      };

      this.ws.onclose = (event) => {
        console.log(`[WS] Closed: code=${event.code} reason=${event.reason}`);  // ✅ THIS APPEARS
        this.isConnectedFlag = false;
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`Reconnecting attempt ${this.reconnectAttempts}...`);  // ✅ THIS APPEARS
          setTimeout(() => this.connect(), this.reconnectDelay);
        }
      };
      // ...
    });
  }
  // ...
}
```

**Key Observation**: Logs from this file DO appear in console, which means:
- ✅ This module loads successfully
- ✅ ChatWebSocket class instantiates
- ✅ WebSocket attempts to connect (then closes with 1001)
- ❓ But who is calling the constructor? Not the Listen window's useEffect (no logs).

#### getWebSocketInstance (Lines 293-309) - **THE SINGLETON**
```typescript
const wsInstances = new Map<string, ChatWebSocket>();

export const getWebSocketInstance = (chatId: string, source?: 'mic' | 'system'): ChatWebSocket => {
  const key = source ? `${chatId}:${source}` : chatId;
  console.log('[WS Instance] Getting for key:', key, 'Existing:', wsInstances.has(key), 'Total instances:', wsInstances.size);
  if (wsInstances.has(key)) {
    const existing = wsInstances.get(key)!;
    console.log('[WS Instance] Reusing existing instance for key:', key);
    return existing;
  }
  console.log('[WS Instance] Creating NEW instance for key:', key);
  const instance = new ChatWebSocket(chatId, source);
  wsInstances.set(key, instance);
  return instance;
};
```

**Expected Call from ListenView**: `getWebSocketInstance('76', 'mic')`  
**Expected Log**: `[WS Instance] Getting for key: 76:mic ...`  
**Actual**: ❌ **LOG NEVER APPEARS**

**This Confirms**: ListenView's useEffect is NOT calling `getWebSocketInstance` at all.

#### getOrCreateChatId (Lines 311-370)
```typescript
export async function getOrCreateChatId(backendUrl: string, token: string): Promise<number> {
  // Check localStorage first
  const stored = localStorage.getItem('current_chat_id');
  if (stored && stored !== 'undefined') {
    const chatId = parseInt(stored, 10);
    if (!isNaN(chatId) && chatId > 0) {
      console.log('[Chat] Reusing existing chat id', chatId);  // ✅ THIS APPEARS
      return chatId;
    }
  }
  
  // Create new chat via HTTP
  console.log('[Chat] No valid stored chat_id, creating new...');
  const response = await fetch(`${backendUrl}/chat/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({})
  });
  // ...
}
```

**The Mystery Deepens**: This function logs `[Chat] Reusing existing chat id 76`, but:
- ❓ Who called this function? Not ListenView's useEffect.
- ❓ Maybe the WebSocket service itself calls it during instantiation?
- ❓ Maybe it's being called from Header window context, not Listen window?

Let me check WebSocket constructor...

**Looking at constructor again**: No, constructor doesn't call `getOrCreateChatId`.

**New Theory**: Maybe the header window's WebSocket service logs are appearing in the Listen window's console? (Electron bug? Console redirect?)

---

### 📄 overlay-entry.tsx (Routes to ListenView)

**Location**: `/Users/benekroetz/EVIA/EVIA-Desktop/src/renderer/overlay/overlay-entry.tsx`

**Key Lines**:
```typescript
const params = new URLSearchParams(window.location.search)
const view = (params.get('view') || 'header').toLowerCase()
const rootEl = document.getElementById('overlay-root')

// ... App component ...

switch (view) {
  case 'listen':
    return (
      <ListenView
        lines={[]}
        followLive={true}
        onToggleFollow={() => {}}
        onClose={() => window.evia.closeWindow('listen')}
      />
    )
  // ...
}

if (rootEl) {
  const root = ReactDOM.createRoot(rootEl)
  root.render(<App />)
}
```

**Test To Add**: 
```typescript
console.log('[OverlayEntry] View param:', view);  // Does this log appear?
console.log('[OverlayEntry] Rendering ListenView');  // Does this log appear?
```

**Current Status**: No logs from overlay-entry.tsx in user's console output.

---

### 📄 overlay-windows.ts (Creates BrowserWindows)

**Location**: `/Users/benekroetz/EVIA/EVIA-Desktop/src/main/overlay-windows.ts` (632 lines)

**Listen Window Creation** (Lines 300-400):
```typescript
function createChildWindow(name: FeatureName): BrowserWindow | null {
  // ...
  if (name === 'listen') {
    const win = new BrowserWindow({
      width: WINDOW_DATA.listen.width,
      height: WINDOW_DATA.listen.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        devTools: true,  // ✅ Changed to always enable
      },
    });

    const listenUrl = isDev
      ? `http://localhost:5174/?view=listen`
      : `file://${path.join(__dirname, '../renderer/index.html')}?view=listen`;
    
    win.loadURL(listenUrl);

    if (!app.isPackaged) {
      console.log(`[overlay-windows] Opening DevTools for listen window`);
      win.webContents.openDevTools({ mode: 'detach' });  // ✅ This executes
    }

    childWindows.set('listen', win);
    return win;
  }
  // ...
}
```

**Verification Needed**:
1. Does the window load the correct URL? (Check DevTools → Network tab)
2. Does `http://localhost:5174/?view=listen` return valid HTML?
3. Are there any console errors BEFORE our logs? (React errors, import errors?)

---

## 7. ASSUMPTIONS THAT MAY BE WRONG

### ❓ Assumption 1: "The ListenView component is mounting"

**Why I thought this**: 
- Window appears on screen
- Insights fetch works (logs appear)

**Why this might be wrong**:
- Insights fetch might happen from a different component
- Window might show but component might fail to mount due to error
- Maybe there's an error boundary catching exceptions?

**How to verify**:
- Add `console.log` at the very top of ListenView function body
- Check React DevTools (Components tab) if ListenView appears

### ❓ Assumption 2: "useEffect should run once on mount with [] deps"

**Why I thought this**:
- Standard React behavior
- Empty dependency array means run once

**Why this might be wrong**:
- React StrictMode might affect it
- Maybe there's a version mismatch in React
- Maybe useEffect isn't imported correctly

**How to verify**:
- Check React version in package.json
- Try adding useEffect with different deps
- Try useState instead of useEffect

### ❓ Assumption 3: "The build includes my latest changes"

**Why I thought this**:
- I ran `npm run build:main`
- Vite should auto-rebuild

**Why this might be wrong**:
- `build:main` only compiles main process (TypeScript → JavaScript)
- Renderer code is served by Vite dev server
- Vite might be caching old bundle
- Browser might be caching old bundle

**How to verify**:
- Hard refresh (Cmd+Shift+R)
- Check Vite terminal for rebuild logs
- Check DevTools → Sources → see actual bundled code
- Look for the diagnostic log strings in the bundle

### ❓ Assumption 4: "Logs should appear in the Listen window's DevTools"

**Why I thought this**:
- Each window has its own console
- Logs from renderer process go to that window's DevTools

**Why this might be wrong**:
- Maybe Electron is redirecting all renderer logs to main terminal?
- Maybe the WebSocket service logs are from the header window but showing in Listen console?
- Maybe there's a console override?

**How to verify**:
- Check main terminal for renderer logs
- Add window-specific prefix: `console.log('[LISTEN WINDOW]', ...)`
- Try `console.error` instead of `console.log` (different channel)

### ❓ Assumption 5: "WebSocket closes due to Listen window's code"

**Why I thought this**:
- Logs show `[WS] Closed: code=1001`
- 1001 means client is closing

**Why this might be wrong**:
- The WebSocket that's closing might be the header window's connection
- Backend might be closing it due to timeout
- Multiple connections to same chat_id might cause issues

**How to verify**:
- Check backend logs for which session_id is closing
- Add session_id to frontend logs
- Backend logs show two connections (lines 111, 311) - which one closes?

### ❓ Assumption 6: "localStorage works the same across all windows"

**Why I thought this**:
- Web localStorage is shared across same origin
- Electron should behave similarly

**Why this might be wrong**:
- Each BrowserWindow might have isolated storage
- `contextIsolation: true` might affect it
- File protocol vs http protocol might have different storage

**How to verify**:
- Log `localStorage.getItem('current_chat_id')` at component top
- Try setting a test value in header, reading in listen
- Check if `partition` is set in webPreferences (isolates storage)

### ❓ Assumption 7: "The Listen window loads from Vite dev server"

**Why I thought this**:
- `isDev` is true
- URL is `http://localhost:5174/?view=listen`

**Why this might be wrong**:
- Maybe `isDev` is false somehow?
- Maybe loadURL fails silently?
- Maybe there's a redirect?

**How to verify**:
- Check Network tab in Listen DevTools - what URL loaded?
- Check if `http://localhost:5174/?view=listen` works in regular browser
- Add log in overlay-windows.ts after loadURL

---

## 8. ALL DEBUGGING ATTEMPTS (Chronological)

### Attempt 1: Added `echo_text` Handler
**Commit**: `363b391`  
**Reasoning**: Backend sends `echo_text` but ListenView only handles `transcript_segment`  
**Result**: ❌ No change (but this fix is still valid)  
**Why it didn't work**: The handler never runs because WebSocket messages never reach ListenView

### Attempt 2: Explicit WebSocket Connect
**Commit**: `cce785f` (earlier)  
**Reasoning**: Each BrowserWindow needs its own WebSocket connection  
**Result**: ❌ No change  
**Why it didn't work**: useEffect calling `ws.connect()` never runs

### Attempt 3: Added Ultra-Verbose Diagnostic Logging
**Commit**: `f0ae7f4`  
**Reasoning**: Need to see WHERE execution stops  
**Result**: ❌ **LOGS NEVER APPEAR** - Critical finding!  
**Why it failed**: Either useEffect doesn't run, or build is stale, or component doesn't mount

### Attempt 4: Created Comprehensive Diagnosis Doc
**Commit**: `0c54022`  
**Reasoning**: Document all scenarios and next steps  
**Result**: ℹ️ User tested, reported logs (revealing the core mystery)

### Attempt 5: This Handoff Document
**Commit**: (current)  
**Reasoning**: Provide complete context for next debugging session  
**Result**: 📋 You're reading it now

---

## 9. NEXT STEPS & MULTIPLE THEORIES

### 🔬 Immediate Verification Steps

#### Step 1: Verify Build Freshness
```bash
# Check Vite dev server terminal - did it rebuild after changes?
# Look for: "page reload src/renderer/overlay/ListenView.tsx"

# Force clean rebuild
cd /Users/benekroetz/EVIA/EVIA-Desktop
rm -rf dist-electron node_modules/.vite
npm run build:main
# Restart Vite server
npm run dev:renderer
```

#### Step 2: Add Component-Level Logging
**File**: `ListenView.tsx`  
**Add at line 30** (inside component function, before any hooks):
```typescript
export default function ListenView({ lines, followLive, onToggleFollow, onClose }: ListenViewProps) {
  console.log('[ListenView] 🔍 COMPONENT FUNCTION EXECUTING');
  console.log('[ListenView] 🔍 Props:', { lines, followLive });
  console.log('[ListenView] 🔍 Window location:', window.location.href);
  
  // ... existing state declarations ...
```

**Purpose**: Verify component function executes (runs on every render, not just mount)

#### Step 3: Add Entry Point Logging
**File**: `overlay-entry.tsx`  
**Add at line 84**:
```typescript
console.log('[OverlayEntry] 🔍 Entry point executing, view:', view);
console.log('[OverlayEntry] 🔍 URL params:', window.location.search);

switch (view) {
  case 'header':
    console.log('[OverlayEntry] 🔍 Rendering header');
    return <EviaBar ... />
  case 'listen':
    console.log('[OverlayEntry] 🔍 Rendering listen');  // ADD THIS
    return <ListenView ... />
```

**Purpose**: Verify routing is working correctly

#### Step 4: Check Actual Loaded Bundle
1. Open Listen DevTools
2. Go to Sources tab
3. Find `overlay-<hash>.js` (the compiled bundle)
4. Search for the diagnostic log string: `"WebSocket useEffect STARTED"`
5. If NOT FOUND: Build is stale, need fresh build
6. If FOUND: Component isn't mounting despite code being present

#### Step 5: Manual Console Testing
In Listen DevTools console, try:
```javascript
// Test localStorage
console.log('chat_id:', localStorage.getItem('current_chat_id'));

// Test imports
console.log('getWebSocketInstance:', typeof getWebSocketInstance);

// Test React
console.log('React version:', React.version);

// Test if code is present
console.log('Search sources for: WebSocket useEffect STARTED');
```

#### Step 6: Compare With Glass (Reference Implementation)
**File**: `glass/src/ui/listen/ListenView.js` (the working version)  
**Compare**:
- How does Glass handle WebSocket subscription?
- When does it call connect()?
- Are there any missing initialization steps?

### 🧪 Alternative Debugging Approaches

#### Approach A: Simplify to Minimal Repro
1. Comment out ALL code in ListenView
2. Keep only: `console.log('COMPONENT MOUNTED')` and `return <div>Test</div>`
3. If log appears: Issue is in the component code
4. If log doesn't appear: Issue is in routing/mounting

#### Approach B: Bypass useEffect Entirely
1. Move WebSocket setup to component body (not in useEffect)
2. This runs on every render (bad practice but good for debugging)
3. If it works: Issue is specific to useEffect timing

#### Approach C: Use Different State Management
1. Move transcripts state to global singleton
2. Update from WebSocket callbacks
3. Component just reads from singleton
4. Bypasses React re-render issues

#### Approach D: Check Electron IPC Logs
1. Main process terminal might have renderer errors
2. Check for: `Uncaught Error`, `ReferenceError`, import failures
3. These might not appear in renderer DevTools

### 🎯 Most Likely Root Causes (Ranked)

#### 1. Stale Build / Cache Issue (70% probability)
**Why**: Diagnostic logs we added don't appear  
**Test**: Clear all caches, hard rebuild, hard refresh  
**Fix**: Force clean build + browser cache clear

#### 2. React Component Not Mounting (20% probability)
**Why**: No component-level logs appear  
**Test**: Add log at component function start  
**Fix**: Debug routing in overlay-entry.tsx

#### 3. Import Error Breaking Module (5% probability)
**Why**: Silent failures can happen with ESM  
**Test**: Add try-catch around imports  
**Fix**: Fix import paths or add fallbacks

#### 4. Electron Context Isolation Issue (3% probability)
**Why**: `contextIsolation: true` can cause weird behaviors  
**Test**: Temporarily set to false  
**Fix**: Adjust preload script or window APIs

#### 5. React StrictMode Double-Mount Issue (2% probability)
**Why**: StrictMode mounts twice in dev, might cause race condition  
**Test**: Disable StrictMode temporarily  
**Fix**: Make useEffect idempotent

---

## 10. COMPLETE CODE REFERENCE

### All Relevant Files (For Easy Access)

#### ListenView.tsx (Current State)
**Path**: `src/renderer/overlay/ListenView.tsx`  
**Lines**: 652  
**Key useEffect**: Lines 115-191  
**Last Modified**: Commit `f0ae7f4`

<details>
<summary>Click to see full useEffect code</summary>

```typescript
useEffect(() => {
  console.log('[ListenView] 🔍 WebSocket useEffect STARTED');
  console.log('[ListenView] 🔍 localStorage:', typeof localStorage, localStorage ? 'exists' : 'null');
  
  let cid: string | null = null;
  try {
    cid = localStorage.getItem('current_chat_id');
    console.log('[ListenView] 🔍 Retrieved chat_id:', cid, 'type:', typeof cid);
  } catch (err) {
    console.error('[ListenView] ❌ localStorage.getItem ERROR:', err);
    return () => {};
  }
  
  if (!cid || cid === 'undefined' || cid === 'null') {
    console.error('[ListenView] ❌ No valid chat_id (value:', cid, '); create one first');
    return () => {};
  }
  console.log('[ListenView] ✅ Valid chat_id found:', cid, '- Setting up WebSocket...');
  
  const ws = getWebSocketInstance(cid, 'mic');
  
  const unsub = ws.onMessage((msg: any) => {
    console.log('[ListenView] ✅ Received WebSocket message:', msg);
    
    if (msg.type === 'transcript_segment' && msg.data) {
      const { text = '', speaker = null, is_final = false } = msg.data;
      console.log('[ListenView] ✅ Adding transcript:', text, 'final:', is_final);
      setTranscripts(prev => {
        const next = [...prev, { text, speaker, isFinal: is_final }];
        console.log('[State Debug] Updated transcripts count:', next.length, 'Latest:', text.substring(0, 50));
        return next;
      });
      if (autoScroll && viewportRef.current) {
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      }
    } else if (msg.type === 'insight_segment' && msg.data) {
      const { text = '', type = 'insight' } = msg.data;
      console.log('[ListenView] ✅ Adding insight:', text, 'type:', type);
      setInsights(prev => [...prev, { text, type }]);
    } else if (msg.type === 'status') {
      console.log('[ListenView] ✅ Status message:', msg.data);
      
      if (msg.data?.echo_text) {
        const text = msg.data.echo_text;
        const isFinal = msg.data.final === true;
        console.log('[ListenView] ✅ Adding transcript from echo_text:', text, 'final:', isFinal);
        setTranscripts(prev => {
          const next = [...prev, { text, speaker: null, isFinal }];
          console.log('[State Debug] Updated transcripts count:', next.length, 'Latest:', text.substring(0, 50));
          return next;
        });
        if (autoScroll && viewportRef.current) {
          viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        }
      }
      
      if (msg.data?.dg_open === true) {
        console.log('[ListenView] ✅ Deepgram connection OPEN - starting timer');
        setIsSessionActive(true);
        startTimer();
      } else if (msg.data?.dg_open === false) {
        console.log('[ListenView] Deepgram connection CLOSED - stopping timer');
        setIsSessionActive(false);
        stopTimer();
      }
    }
  });
  
  ws.connect().then(() => {
    console.log('[ListenView] ✅ WebSocket connected successfully');
  }).catch(err => {
    console.error('[ListenView] ❌ WebSocket connection failed:', err);
  });
  
  return () => { 
    console.log('[ListenView] Cleanup: Disconnecting WebSocket for this window');
    unsub();
    ws.disconnect();
    stopTimer();
    setIsSessionActive(false);
  };
}, []);
```

</details>

#### Backend Message Formats
```json
// Interim transcript (most common)
{
  "type": "status",
  "data": {
    "echo_text": "Hey. How are you?",
    "final": false
  }
}

// Final transcript
{
  "type": "transcript_segment",
  "data": {
    "text": "Hey. How are you?",
    "speaker": 1,
    "is_final": true
  }
}

// Deepgram connection status
{
  "type": "status",
  "data": {
    "dg_open": true
  }
}
```

---

## 11. FINAL SUMMARY FOR NEXT LLM

### 🎯 The Core Mystery

**Backend works perfectly**: Receives audio, transcribes via Deepgram, sends messages  
**Header window works**: Captures audio, sends binary chunks  
**Listen window opens**: Appears on screen, DevTools accessible  
**BUT**: Transcripts never display, timer never starts, diagnostic logs NEVER APPEAR

**The Smoking Gun**: 
```
Expected in Listen DevTools:
[ListenView] 🔍 WebSocket useEffect STARTED
[ListenView] 🔍 Retrieved chat_id: 76
[ListenView] ✅ WebSocket connected successfully

Actual in Listen DevTools:
websocketService-BT7Iw5p4.js:1 [WS] Closed: code=1001 reason=
websocketService-BT7Iw5p4.js:1 Reconnecting attempt 1...
websocketService-BT7Iw5p4.js:1 [Chat] Reusing existing chat id 76
```

Only 3 logs appear, all from WebSocket service, NONE from React component.

### 🔑 Key Questions To Answer

1. **Is the ListenView component actually mounting?**
   - Add log at component function start (before hooks)
   - Check React DevTools Components tab

2. **Is the build fresh?**
   - Check DevTools Sources tab for diagnostic log strings
   - Check Vite terminal for rebuild notifications
   - Force clean rebuild + hard refresh

3. **Is there a hidden error?**
   - Check main terminal for renderer errors
   - Check DevTools Console for red errors
   - Check Network tab for failed loads

4. **Is the routing working?**
   - Add logs in overlay-entry.tsx switch statement
   - Verify URL param: `?view=listen`
   - Test URL manually in browser

5. **Why do WebSocket service logs appear if component doesn't run?**
   - Is something else creating WebSocket? (header window?)
   - Are logs from different window bleeding through?
   - Is there old code running from cache?

### 🚀 Recommended First Actions

1. **Hard Reset Everything**:
   ```bash
   cd /Users/benekroetz/EVIA/EVIA-Desktop
   rm -rf dist-electron node_modules/.vite
   npm run build:main
   # In separate terminal:
   npm run dev:renderer
   # Wait for Vite ready, then:
   EVIA_DEV=1 npm run dev:main
   ```

2. **Add Component-Level Log** (line 30 in ListenView.tsx):
   ```typescript
   console.log('[ListenView] 🔍 COMPONENT EXECUTING - This proves component mounted');
   ```

3. **Check Sources Tab**:
   - Open Listen DevTools → Sources
   - Find `overlay-*.js` bundle
   - Search for "WebSocket useEffect STARTED"
   - If not found: Stale build (MOST LIKELY CAUSE)
   - If found: Component not mounting (routing issue)

4. **Compare With Glass**:
   - Open `glass/src/ui/listen/ListenView.js`
   - See how working version handles WebSocket
   - Look for differences in setup/initialization

### 📊 Success Criteria

After fix, Listen DevTools should show:
```
[OverlayEntry] 🔍 Rendering listen
[ListenView] 🔍 COMPONENT EXECUTING
[ListenView] 🔍 WebSocket useEffect STARTED
[ListenView] 🔍 Retrieved chat_id: 76
[ListenView] ✅ Valid chat_id found: 76
[WS Instance] Getting for key: 76:mic
ChatWebSocket initialized with chatId: 76
[ListenView] ✅ WebSocket connected successfully
[ListenView] ✅ Status message: {dg_open: true}
[ListenView] ✅ Deepgram connection OPEN - starting timer
[ListenView] ✅ Adding transcript from echo_text: Hey. How are you?
```

And user should see:
- ✅ Transcripts appearing as speech bubbles
- ✅ Timer incrementing: 00:01, 00:02, 00:03...
- ✅ Auto-scroll to latest transcript
- ✅ "Fertig" button after clicking "Stopp"

---

## 12. FILES TO INVESTIGATE (Priority Order)

1. ⚠️ **ListenView.tsx** - Component that should be running but isn't
2. ⚠️ **overlay-entry.tsx** - Routes URL param to components
3. ⚠️ **overlay-windows.ts** - Creates BrowserWindow and loads URL
4. ℹ️ **websocketService.ts** - WebSocket code (this IS running)
5. ℹ️ **vite.config.ts** - Build config (might affect HMR/caching)
6. ℹ️ **package.json** - Dependencies (React version, build scripts)
7. 📚 **glass/src/ui/listen/ListenView.js** - Reference working implementation

---

**END OF HANDOFF**

This document contains EVERYTHING we know about the system, all attempts made, all theories, all evidence. The next LLM should start by verifying if the build is fresh (stale build is the most likely cause). Good luck! 🍀

