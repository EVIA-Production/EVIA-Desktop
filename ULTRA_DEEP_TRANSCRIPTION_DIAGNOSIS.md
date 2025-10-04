# 🔬 ULTRA-DEEP TRANSCRIPTION DIAGNOSIS

**Date**: 2025-10-04  
**Branch**: `mup-integration`  
**Commit**: `f0ae7f4`  
**Status**: DIAGNOSTIC MODE - VERBOSE LOGGING ENABLED  

---

## 🎯 **CRITICAL ISSUES IDENTIFIED**

### **1. ZERO WebSocket Logs in Listen Window**
**Symptom**: Backend sends transcripts, but Listen window shows NO `[ListenView]` logs at all.

**Evidence**:
```
Backend: ✅ Sends "echo_text": "Hey. How are you?"
Backend: ✅ Sends {"type":"status","data":{"dg_open":true}}
Backend: ✅ Sends {"type":"transcript_segment",...}

Listen DevTools: ❌ NO "[ListenView] 🔍" logs
Listen DevTools: ❌ NO "[ListenView] ✅" logs  
Listen DevTools: ❌ NO "[ListenView] Setting up WebSocket" logs
Listen DevTools: ✅ ONLY shows: "[Insights] Received 3 insights"
```

**Hypothesis**: The WebSocket `useEffect` hook is **NOT RUNNING AT ALL**, despite:
- Component IS mounting (insights fetch works)
- Other `useEffect` hooks ARE running (auto-scroll, window height)
- No visible React errors

**Possible Root Causes**:
1. **localStorage failing** - `localStorage.getItem('current_chat_id')` throws error in Listen window context
2. **React hydration issue** - useEffect order/timing problem
3. **Import error** - `getWebSocketInstance` import failing silently
4. **Hidden exception** - Error before first `console.log` that's caught by React

---

## 🧪 **DIAGNOSTIC CHANGES (Commit `f0ae7f4`)**

Added **ULTRA-VERBOSE logging** to `ListenView.tsx` line 115-132:

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
  // ... rest of WebSocket setup
}, []);
```

**What These Logs Tell Us**:
- If **NO logs appear**: useEffect not running → React mounting issue
- If **first log appears**: useEffect started → problem is AFTER that line
- If **localStorage error**: Window context issue → need IPC solution
- If **chat_id null**: State management issue → check header window storage

---

## 🧪 **TEST PROCEDURE**

### **Step 1: Restart Desktop App**
```bash
# Terminal 1: Keep backend running
cd /Users/benekroetz/EVIA/EVIA-Backend
docker compose up

# Terminal 2: Rebuild and restart desktop
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run build:main
EVIA_DEV=1 npm run dev:main
```

### **Step 2: Open Listen Window**
1. Click **"Zuhören"** button in header
2. **IMMEDIATELY** open Listen DevTools (View → Toggle Developer Tools)
3. Clear console (`Cmd+K`)
4. Look for the **FIRST log** that appears

### **Step 3: Analyze Logs**

#### **Scenario A: NO Logs at All**
```
Listen DevTools:
[Insights] Fetching insights for chat 76
[Insights] Received 3 insights
```

**Diagnosis**: useEffect not running → Component mounting issue or React error boundary catching exception

**Next Steps**:
1. Check for React errors in console (red text)
2. Check if `useEffect` import is correct at top of file
3. Verify Vite build isn't stripping the useEffect
4. Add `console.log('ListenView component mounted')` at component root (line 30)

---

#### **Scenario B: useEffect Starts, Then Stops**
```
Listen DevTools:
[ListenView] 🔍 WebSocket useEffect STARTED
[ListenView] 🔍 localStorage: object exists
```

**Diagnosis**: useEffect running but failing during localStorage access

**Next Steps**:
1. Check if `chat_id` is stored correctly in localStorage
2. Try: `localStorage.getItem('current_chat_id')` in Listen DevTools console manually
3. If null: Header window didn't persist chat_id → check header logs

---

#### **Scenario C: chat_id Retrieved but No WebSocket Setup**
```
Listen DevTools:
[ListenView] 🔍 WebSocket useEffect STARTED
[ListenView] 🔍 Retrieved chat_id: 76 type: string
[ListenView] ✅ Valid chat_id found: 76 - Setting up WebSocket...
```

**Diagnosis**: Issue in `getWebSocketInstance` or WebSocket subscription

**Next Steps**:
1. Check for `[WS Instance] Getting for key: 76:mic` log (should appear next)
2. If missing: Import error or websocketService.ts issue
3. If present but no connection: Backend connection issue

---

#### **Scenario D: WebSocket Connects but No Messages**
```
Listen DevTools:
[ListenView] ✅ WebSocket connected successfully
(no transcript messages)
```

**Diagnosis**: WebSocket connected but messages not being received

**Next Steps**:
1. Check backend logs for which connection is receiving messages
2. Check if Listen window's WebSocket is timing out (backend log: "receive timeout")
3. Verify `onMessage` subscription is registered

---

## 🐛 **OTHER ISSUES**

### **Issue 2: "Fertig" Button Disappearing**
**Status**: **LIKELY CSS OR I18N ISSUE** (code logic is correct)

**Button Logic (EviaBar.tsx lines 208-212)**:
```typescript
const listenLabel = listenStatus === 'before' 
  ? i18n.t('overlay.header.listen')  // "Zuhören"
  : listenStatus === 'in' 
  ? i18n.t('overlay.header.stop')    // "Stopp"
  : i18n.t('overlay.header.done');   // "Fertig"
```

**State Machine (EviaBar.tsx lines 146-165)**:
```typescript
'before' → 'in' (start listening)
'in' → 'after' (stop listening, window STAYS visible)
'after' → 'before' (done, hide window)
```

**Verify**:
1. Open Header DevTools
2. Click "Zuhören" → should log `[EviaBar] Listen → Stop: Showing listen window`
3. Click "Stopp" → should log `[EviaBar] Stop → Done: Window stays visible`
4. Check if button label changes to "Fertig"
5. If button is invisible: Check CSS for `.listen-done` class (line 299-304)
6. If button shows wrong label: Check i18n translation for `overlay.header.done`

---

### **Issue 3: Listen Window Doesn't Hide After "Fertig"**
**Status**: **DEPENDS ON Issue 2** (button must exist to be clicked)

**Expected Flow**:
1. Click "Fertig" → `listenStatus` changes from `'after'` to `'before'`
2. Line 163: `evia.windows.hide('listen')` is called
3. Window hides

**Verify**:
1. After clicking "Fertig", check Header DevTools for: `[EviaBar] Done → Listen: Hiding listen window`
2. If log appears but window doesn't hide: IPC issue (check overlay-windows.ts)
3. If log doesn't appear: Button click not triggering handler

---

### **Issue 4: Timer Not Working**
**Status**: **DEPENDS ON Issue 1** (WebSocket must connect and receive `dg_open: true`)

**Expected Flow**:
1. Listen window connects to WebSocket
2. Backend sends: `{"type":"status","data":{"dg_open":true}}`
3. ListenView receives message (line 165-168)
4. `setIsSessionActive(true)` + `startTimer()` called
5. Timer increments every second

**Verify**:
1. After fixing Issue 1, check for: `[ListenView] ✅ Deepgram connection OPEN - starting timer`
2. If log appears but timer doesn't increment: Check `startTimer()` function
3. If log doesn't appear: Backend not sending status message or Listen window not receiving it

---

## 📊 **EXPECTED vs ACTUAL LOGS**

### **Expected Logs (Full E2E Working)**:

#### **Header DevTools**:
```
[EviaBar] Listen → Stop: Showing listen window
[AudioCapture] Starting capture...
[AudioCapture] Audio detected - Level: 0.1684
[AudioCapture] Sent chunk: 4800 bytes
```

#### **Listen DevTools**:
```
[ListenView] 🔍 WebSocket useEffect STARTED
[ListenView] 🔍 localStorage: object exists
[ListenView] 🔍 Retrieved chat_id: 76 type: string
[ListenView] ✅ Valid chat_id found: 76 - Setting up WebSocket...
[WS Instance] Getting for key: 76:mic Existing: false
ChatWebSocket initialized with chatId: 76
[ListenView] ✅ WebSocket connected successfully
[ListenView] ✅ Status message: {dg_open: true}
[ListenView] ✅ Deepgram connection OPEN - starting timer
[ListenView] ✅ Status message: {echo_text: "Hey. How are you?", final: false}
[ListenView] ✅ Adding transcript from echo_text: Hey. How are you? final: false
[State Debug] Updated transcripts count: 1 Latest: Hey. How are you?
```

#### **Backend Logs**:
```
WebSocket connection established with session_id: ...
Deepgram connection opened.
> TEXT '{"type":"status","data":{"dg_open":true}}'
Interim segment (speaker=None, len=18)
> TEXT '{"type": "status", "data": {"echo_text": "Hey. How are you?", "final": false}}'
```

### **Actual Logs (Current Broken State)**:

#### **Header DevTools**: ✅ WORKING
```
[AudioCapture] Audio detected - Level: 0.1684
[AudioCapture] Sent chunk: 4800 bytes
```

#### **Listen DevTools**: ❌ BROKEN
```
ChatWebSocket initialized with chatId: 76
[Chat] Reusing existing chat id 76
[Insights] Fetching insights for chat 76
[Insights] Received 3 insights
[WS] Closed: code=1001 reason=
Reconnecting attempt 1...
```

#### **Backend Logs**: ✅ WORKING (sends transcripts)
```
> TEXT '{"type":"status","data":{"dg_open":true}}'
> TEXT '{"type": "status", "data": {"echo_text": "Hey. How are you?", "final": false}}'
```

**GAP**: Listen window is NOT logging WebSocket setup or message receipt!

---

## 🚀 **ACTION PLAN**

### **Immediate Actions (User Testing)**:

1. **Restart app with new diagnostic build** (commit `f0ae7f4`)
2. **Open Listen DevTools IMMEDIATELY** after clicking "Zuhören"
3. **Copy ALL console logs** from Listen window (even if empty)
4. **Report back which Scenario (A, B, C, or D)** matches the logs

### **Next Steps Based on Scenario**:

- **Scenario A**: Add component-level logging, check React errors
- **Scenario B**: Investigate localStorage cross-window access in Electron
- **Scenario C**: Debug `getWebSocketInstance` import/execution
- **Scenario D**: Verify WebSocket message routing and subscriptions

---

## 📝 **SYSTEM AUDIO NOTE**

System audio transcription not working is a **SEPARATE ISSUE** from microphone transcription. 

**Evidence**: Backend logs show **ONLY microphone audio being received** (all audio chunks are from mic source).

**To diagnose system audio**:
1. First fix microphone transcription (Issue 1)
2. Then follow `@system-audio-capture-permissions.md` to enable system audio capture
3. Requires:
   - Screen Recording permission for Electron
   - System Audio helper binary signed with entitlements
   - TCC database entry for `com.github.Electron`

**Defer system audio debugging** until microphone transcription works.

---

## 🎯 **SUCCESS CRITERIA**

After fixes, Listen window should show:

```
✅ [ListenView] 🔍 WebSocket useEffect STARTED
✅ [ListenView] ✅ Valid chat_id found: 76
✅ [ListenView] ✅ WebSocket connected successfully  
✅ [ListenView] ✅ Deepgram connection OPEN - starting timer
✅ [ListenView] ✅ Adding transcript from echo_text: Hey. How are you?
✅ Timer: 00:01, 00:02, 00:03...
✅ Transcripts appear in UI as speech bubbles
✅ "Fertig" button appears after clicking "Stopp"
✅ Listen window hides after clicking "Fertig"
```

---

## 🔧 **FILES CHANGED (This Commit)**

1. `src/renderer/overlay/ListenView.tsx` (lines 115-132)
   - Added: Ultra-verbose logging at useEffect start
   - Added: Defensive try-catch around localStorage
   - Added: Enhanced validation for null/undefined chat_id

---

## 🤝 **HANDOFF TO USER**

**Test the diagnostic build and report back the EXACT console logs from Listen DevTools.**

Specifically, look for:
1. Does `[ListenView] 🔍 WebSocket useEffect STARTED` appear?
2. Does `[ListenView] 🔍 Retrieved chat_id: ...` appear?
3. Does `[ListenView] ✅ WebSocket connected successfully` appear?
4. Any errors in red text?

**If STILL no logs**, the issue is at the React component level, and we'll need to add logging at component mount (before any useEffect runs).

---

**END OF DIAGNOSTIC DOCUMENT**  
**Next: User testing → Report scenario → Targeted fix based on logs**

