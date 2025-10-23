# 📡 EVIA-DESKTOP SESSION STATE DETECTION - BACKEND INTEGRATION GUIDE

**Date**: 2025-10-23  
**For**: @EVIA-Backend/ Agent  
**Purpose**: Document exactly how Desktop determines and broadcasts session stage

---

## 🎯 THE PROBLEM

**User Report**: "EVIA doesn't know whether something is before, during, or after the meeting"

**Example**:
```
Question (while recording - "Stop" button visible): "Ist das hier vor oder während dem Meeting?"

EVIA Response: "**Vor dem Meeting**" ❌ WRONG

Expected: "**Während des Meetings**" ✅ (User is actively recording)
```

---

## ✅ HOW DESKTOP DETERMINES SESSION STATE

### 1. State Source: `listenStatus` in EviaBar.tsx

**File**: `src/renderer/overlay/EviaBar.tsx`  
**State Variable**: `listenStatus`

```typescript
const [listenStatus, setListenStatus] = useState<'before' | 'in' | 'after'>('before');
```

**Visual Mapping** (What User Sees):

| `listenStatus` | Button Label (German) | Button Label (English) | What It Means |
|----------------|----------------------|------------------------|---------------|
| `'before'`     | **"Zuhören"** (Listen) | **"Listen"** | Before meeting - ready to start |
| `'in'`         | **"Stopp"** (Stop) | **"Stop"** | During meeting - actively recording |
| `'after'`      | **"Fertig"** (Done) | **"Done"** | After meeting - recording stopped |

---

## 📡 HOW DESKTOP BROADCASTS SESSION STATE

### Step 1: Convert `listenStatus` to `session_state`

**File**: `src/renderer/overlay/EviaBar.tsx` (lines ~90-100)

```typescript
useEffect(() => {
  const eviaIpc = (window as any).evia?.ipc;
  if (eviaIpc?.send) {
    // Map 'in' → 'during' for backend compatibility
    const sessionState = listenStatus === 'in' ? 'during' : listenStatus;
    
    // Store in localStorage as fallback
    localStorage.setItem('evia_session_state', sessionState);
    
    // Broadcast to all windows via IPC
    eviaIpc.send('session-state-changed', sessionState);
    
    console.log('[EviaBar] 📡 Broadcast session state:', sessionState, '(from listenStatus:', listenStatus, ')');
  }
}, [listenStatus]);
```

**Mapping**:
- `listenStatus: 'before'` → `session_state: 'before'` ✅
- `listenStatus: 'in'` → `session_state: 'during'` ✅
- `listenStatus: 'after'` → `session_state: 'after'` ✅

---

### Step 2: AskView Receives and Sends to Backend

**File**: `src/renderer/overlay/AskView.tsx` (lines ~60-80)

```typescript
const [sessionState, setSessionState] = useState<'before' | 'during' | 'after'>(() => {
  // Initialize from localStorage
  const stored = localStorage.getItem('evia_session_state');
  if (stored === 'before' || stored === 'during' || stored === 'after') {
    console.log('[AskView] 🎯 Initial session state from localStorage:', stored);
    return stored;
  }
  return 'before'; // Default
});

// Listen for IPC broadcasts from EviaBar
useEffect(() => {
  const eviaIpc = (window as any).evia?.ipc;
  if (eviaIpc?.on) {
    const handleSessionStateChanged = (newState: 'before' | 'during' | 'after') => {
      console.log('[AskView] 🎯 Session state changed:', newState);
      setSessionState(newState);
    };
    eviaIpc.on('session-state-changed', handleSessionStateChanged);
  }
}, []);
```

**When user asks a question**:

```typescript
const handle = streamAsk({ 
  baseUrl, 
  chatId, 
  prompt: actualPrompt, 
  language, 
  sessionState,  // ← SENT TO BACKEND
  token
});
```

---

### Step 3: Backend Receives `session_state`

**File**: `src/renderer/lib/evia-ask-stream.ts` (lines ~30-50)

```typescript
export type StreamAskParams = {
  baseUrl: string
  chatId: number
  prompt: string
  language: 'de' | 'en'
  sessionState?: 'before' | 'during' | 'after'  // ← PARAMETER
  token: string
  signal?: AbortSignal
}

export function streamAsk(params: StreamAskParams): StreamAskHandle {
  const payload: any = { 
    chat_id: params.chatId, 
    prompt: params.prompt,
    language: params.language, 
    stream: true 
  }
  
  if (params.sessionState) {
    payload.session_state = params.sessionState;  // ← SENT TO BACKEND
    console.log('[evia-ask-stream] 🎯 Session state:', params.sessionState);
  }
  
  fetch(`${params.baseUrl}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${params.token}` },
    body: JSON.stringify(payload)
  })
}
```

**Backend Receives**:
```json
{
  "chat_id": 11,
  "prompt": "Ist das hier vor oder während dem Meeting?",
  "language": "de",
  "stream": true,
  "session_state": "during"  // ← THIS IS THE KEY
}
```

---

## 🔍 STATE TRANSITION FLOW

### User Journey:

```
1. App Opens
   ├─ listenStatus = 'before'
   ├─ Button shows: "Zuhören" (Listen)
   └─ session_state = 'before' ✅

2. User Clicks Listen Button
   ├─ startCapture() called
   ├─ listenStatus = 'in'
   ├─ Button shows: "Stopp" (Stop)
   ├─ IPC broadcast: 'during'
   └─ session_state = 'during' ✅

3. User Asks Question (While Recording)
   ├─ AskView reads sessionState = 'during'
   ├─ Sends to backend: { session_state: 'during' }
   └─ Backend should respond with "WÄHREND des Meetings" ✅

4. User Clicks Stop Button
   ├─ stopCapture() called
   ├─ listenStatus = 'after'
   ├─ Button shows: "Fertig" (Done)
   ├─ IPC broadcast: 'after'
   └─ session_state = 'after' ✅

5. User Asks Question (After Recording)
   ├─ AskView reads sessionState = 'after'
   ├─ Sends to backend: { session_state: 'after' }
   └─ Backend should respond with follow-up/summary advice ✅
```

---

## 🐛 DEBUGGING: HOW TO VERIFY DESKTOP IS SENDING CORRECT STATE

### Console Logs to Check (Desktop DevTools)

**When user clicks Listen button**:
```javascript
[EviaBar] 📡 Broadcast session state: during (from listenStatus: in)
[AskView] 🎯 Session state changed: during
```

**When user asks a question**:
```javascript
[evia-ask-stream] 🎯 Session state: during
```

**Backend logs** (from your terminal selection):
```
2025-10-23 12:29:58,773 - api.services.groq_service - INFO - [SESSION-STATE] Applied session_state=before to prompt
```

---

## ❌ THE BUG: Backend Not Using session_state Correctly

### Backend Logs Show:

```
Line 358: [SESSION-STATE] Applied session_state=before to prompt
```

**But user clicked "Stop" button (listenStatus = 'in'), so Desktop sent `session_state: 'during'`**

**Possible Backend Issues**:

1. **Backend ignoring session_state parameter**
   - Check `groq_service.py` line ~270: Is it reading `session_state` from request?

2. **Backend defaulting to 'before' if parameter missing**
   - Check if Desktop's `session_state` is actually being sent in request

3. **Backend using cached/stale state**
   - Check if Redis/memory cache is overriding request parameter

---

## ✅ VERIFICATION CHECKLIST FOR BACKEND

### Test 1: Before State
```bash
# Desktop state: listenStatus = 'before' (button shows "Zuhören")
# Expected payload: { session_state: 'before' }
# Expected backend log: [SESSION-STATE] Applied session_state=before
```

### Test 2: During State (**FAILING**)
```bash
# Desktop state: listenStatus = 'in' (button shows "Stopp")
# Expected payload: { session_state: 'during' }
# Expected backend log: [SESSION-STATE] Applied session_state=during
# ❌ ACTUAL: [SESSION-STATE] Applied session_state=before
```

### Test 3: After State
```bash
# Desktop state: listenStatus = 'after' (button shows "Fertig")
# Expected payload: { session_state: 'after' }
# Expected backend log: [SESSION-STATE] Applied session_state=after
```

---

## 🔧 BACKEND FIX NEEDED

### Check These Files:

1. **`backend/api/routes/ask.py`**
   - Line where request body is parsed
   - Verify: `session_state = request.get('session_state')` is being read

2. **`backend/api/services/groq_service.py`**
   - Line ~260-280 where session context is applied
   - Verify: Using the REQUEST parameter, not a cached/default value

### Expected Backend Behavior:

```python
# In groq_service.py (line ~260)
session_state = request_data.get('session_state')  # From Desktop request

if session_state == 'before':
    context = "KONTEXT: Der Nutzer bereitet sich auf ein Gespräch vor..."
elif session_state == 'during':
    context = "KONTEXT: Der Nutzer ist WÄHREND eines aktiven Gesprächs..."  # ← SHOULD USE THIS
elif session_state == 'after':
    context = "KONTEXT: Das Gespräch ist beendet..."
else:
    context = ""  # No context if not provided

print(f'[SESSION-STATE] Applied session_state={session_state} to prompt')  # ← Should log 'during'
```

---

## 📊 SUMMARY FOR BACKEND

**Desktop IS sending `session_state` correctly**:
- ✅ State transitions: `'before'` → `'during'` → `'after'`
- ✅ IPC broadcast working
- ✅ localStorage fallback working
- ✅ Payload includes `session_state` parameter

**Backend NEEDS to**:
1. Read `session_state` from POST `/ask` request body
2. Use it to determine conversation context
3. NOT default to 'before' when Desktop sends 'during'
4. Log which state is being applied (for debugging)

---

## 🎯 EXPECTED RESULT AFTER FIX

**Question (while recording)**:
```json
{
  "chat_id": 11,
  "prompt": "Ist das hier vor oder während dem Meeting?",
  "language": "de",
  "session_state": "during"  // ← Desktop sends this
}
```

**Backend Should Log**:
```
[SESSION-STATE] Applied session_state=during to prompt
```

**EVIA Response**:
```
**Während des Meetings**. Sie sind gerade in einem aktiven Gespräch. 
Konzentrieren Sie sich darauf, aktiv zuzuhören und die Bedürfnisse des Interessenten zu verstehen.
```

---

**Desktop implementation**: ✅ Complete and working  
**Backend integration**: ❌ Needs fix (ignoring session_state parameter)

---

**Created**: 2025-10-23  
**Status**: Desktop ready, waiting for Backend fix

