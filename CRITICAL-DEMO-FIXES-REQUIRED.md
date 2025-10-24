# 🚨 CRITICAL DEMO FIXES - MUST FIX BEFORE TOMORROW

**Date**: 2025-10-24  
**Severity**: CRITICAL  
**Demo**: Tomorrow

---

## ROOT CAUSE ANALYSIS

### Issue 1: Shortcuts Window Position ❌ DESKTOP
**Problem**: Shortcuts appears over header instead of right of settings  
**Root Cause**: `layoutChildWindows()` positions shortcuts at header center, not relative to settings  
**Fix**: Position shortcuts to the right of settings window when both are visible  
**File**: `overlay-windows.ts:530-542`  
**Severity**: HIGH (UI bug, bad UX)

### Issue 2: Shortcuts Translation ❌ DESKTOP  
**Problem**: Shortcuts don't translate to German when language changes  
**Root Cause**: `ShortcutsView.tsx` listens for `language-changed` but doesn't react to it  
**Fix**: Force re-render or update state when language changes  
**File**: `ShortcutsView.tsx`  
**Severity**: MEDIUM (feature incomplete)

### Issue 3: Session State CRITICAL ❌ DESKTOP + BACKEND
**Problem**: Desktop sends wrong session_state to backend  
**Symptoms**:
- User sees "Listen" button (before meeting) but Ask says "DURING meeting"
- User is in call but insights say "No transcripts available"  
- Post-call insights say "DURING meeting" instead of "AFTER"

**Root Causes**:
1. **DESKTOP**: `listenStatus` not syncing with backend session lifecycle
2. **DESKTOP**: Not calling `/session/start` when Listen pressed (code is there but not working)
3. **BACKEND**: Defaulting to 'during' when no session_state sent

**Evidence from logs**:
```
[overlay-windows] win:ensureShown called for listen  // Desktop shows Listen window
INFO: [ASK-DEBUG] Received session_state from Desktop: 'during'  // But sends 'during' to backend!
```

**Desktop Issue**: The `/session/start` call in `EviaBar.tsx:237-266` is NOT being executed  
**Backend Issue**: Backend defaults to 'during' instead of 'before'

**Severity**: CRITICAL (core functionality broken)

### Issue 4: Insights Display ❌ BACKEND
**Problem**: Insights show "No transcripts available" during call when user has been speaking  
**Evidence**:
```
INFO: [SESSION-FILTER] Retrieved 1 transcripts for chat_id=11 (session_filter=ON)
```
Backend HAS transcripts, but frontend shows "No transcripts available"

**Root Cause**: Frontend insights rendering or backend response format issue  
**Severity**: HIGH (feature appears broken)

---

## DESKTOP FIXES REQUIRED

### FIX 1: Shortcuts Window Position
**File**: `src/main/overlay-windows.ts:530-542`

```typescript
// BEFORE (WRONG):
if (visible.shortcuts) {
  const shortcutsWin = createChildWindow('shortcuts')
  const shortcutsW = WINDOW_DATA.shortcuts.width
  const shortcutsH = WINDOW_DATA.shortcuts.height
  
  let x = hb.x + (hb.width / 2) - (shortcutsW / 2)  // ❌ Centers at header
  const y = hb.y
  
  layout.shortcuts = { x: Math.round(x), y: Math.round(y), width: shortcutsW, height: shortcutsH }
}

// AFTER (CORRECT):
if (visible.shortcuts) {
  const shortcutsWin = createChildWindow('shortcuts')
  const shortcutsW = WINDOW_DATA.shortcuts.width
  const shortcutsH = WINDOW_DATA.shortcuts.height
  
  // Position to the right of settings window if settings is visible
  let x, y
  if (visible.settings && layout.settings) {
    // Glass parity: Shortcuts appears to the right of settings
    x = layout.settings.x + layout.settings.width + PAD
    y = layout.settings.y
  } else {
    // Fallback: Center at header
    x = hb.x + (hb.width / 2) - (shortcutsW / 2)
    y = hb.y
  }
  
  // Clamp to screen
  x = Math.max(work.x, Math.min(x, work.x + work.width - shortcutsW))
  
  layout.shortcuts = { x: Math.round(x), y: Math.round(y), width: shortcutsW, height: shortcutsH }
}
```

---

### FIX 2: Shortcuts Translation
**File**: `src/renderer/overlay/ShortcutsView.tsx`

**CRITICAL**: The shortcuts view needs to UPDATE when language changes. Currently it receives the event but doesn't re-render.

**Add state for language**:
```typescript
const [currentLanguage, setCurrentLanguage] = useState(language);

useEffect(() => {
  const handleLanguageChanged = (newLang: string) => {
    console.log('[ShortcutsView] 🌐 Language changed to:', newLang);
    setCurrentLanguage(newLang as 'de' | 'en');
  };
  
  const eviaIpc = (window as any).evia?.ipc;
  if (eviaIpc) {
    eviaIpc.on('language-changed', handleLanguageChanged);
  }
  
  return () => {
    if (eviaIpc) {
      eviaIpc.off('language-changed', handleLanguageChanged);
    }
  };
}, []);

// Then use currentLanguage instead of language prop for translations
```

---

### FIX 3: Session State Integration (CRITICAL)
**File**: `src/renderer/overlay/EviaBar.tsx`

**Problem**: The `/session/start` and `/session/complete` calls are in the code but NOT WORKING.

**Why**: Looking at the logs, I see:
```
[overlay-windows] win:ensureShown called for listen
```

But I don't see:
```
[EviaBar] 🎯 Calling /session/start for chat_id: X
```

This means the `handleListenClick` function in `EviaBar.tsx` is NOT calling the `/session/start` endpoint!

**Root Cause**: The `handleListenClick` in EviaBar.tsx transitions `listenStatus` from 'before' → 'in', but this happens in the HEADER window, not the Listen window. The `/session/start` call is in the code but perhaps not being reached due to early returns or missing auth/chat_id.

**Need to investigate**: Why is the `/session/start` call not executing?

---

## BACKEND FIXES REQUIRED

### FIX 1: Default Session State
**File**: `backend/api/routes/ask.py` or `backend/api/services/groq_service.py`

**Problem**: Backend defaults to 'during' when no session_state is provided.

**Fix**: Default to 'before' instead of 'during':

```python
# BEFORE:
session_state = request_data.get('session_state', 'during')  # ❌ Wrong default

# AFTER:
session_state = request_data.get('session_state', 'before')  # ✅ Correct default
```

**Rationale**: Most of the time, user is NOT in a meeting. 'before' is the safe default.

---

### FIX 2: Insights "No transcripts" Issue  
**Need to investigate**: Why does backend return transcripts but frontend shows "No transcripts available"?

**Possible causes**:
1. Backend response format incorrect
2. Frontend parsing issue
3. Timing issue (frontend renders before backend responds)

**Files to check**:
- `backend/api/routes/insights.py` (response format)
- Desktop `ListenView.tsx` (insights rendering)

---

## TESTING PLAN (MUST DO BEFORE DEMO)

### Test 1: Shortcuts Position
1. Open Settings (⋯)
2. Click "Edit Shortcuts"
3. ✅ VERIFY: Shortcuts appears TO THE RIGHT of Settings, not overlapping header
4. ✅ VERIFY: Can move shortcuts window independently

### Test 2: Shortcuts Translation
1. Open Settings
2. Change language to German
3. Click "Edit Shortcuts"
4. ✅ VERIFY: Shortcut labels are in German
5. Change language to English
6. ✅ VERIFY: Shortcut labels change to English

### Test 3: Session State (CRITICAL)
**Before Meeting**:
1. Open app (should show "Listen" button)
2. Ask EVIA: "Are we before, during, or after the meeting?"
3. ✅ VERIFY: Response says "BEFORE the meeting"

**During Meeting**:
1. Press "Listen" button
2. Speak for 10 seconds
3. While still recording, Ask EVIA: "Are we before, during, or after the meeting?"
4. ✅ VERIFY: Response says "DURING the meeting"
5. ✅ VERIFY: Backend logs show `[SESSION] Started session for chat_id: X`

**After Meeting**:
1. Press "Done" button
2. Click an insight
3. ✅ VERIFY: Response acknowledges meeting is COMPLETE/AFTER
4. ✅ VERIFY: Backend logs show `[SESSION] Completed session, archived N transcripts`

### Test 4: Insights Display
1. Press "Listen", speak for 20 seconds
2. Press "Stop" (NOT Done)
3. Click "Insights" tab
4. ✅ VERIFY: Insights show summary/topics/actions, NOT "No transcripts available"

---

## PRIORITY ORDER

### MUST FIX (P0 - Demo Blockers):
1. ✅ **Session State Integration** - Core functionality, makes or breaks demo
2. ✅ **Insights Display** - Core feature, must work

### SHOULD FIX (P1 - UX Issues):
3. ✅ **Shortcuts Position** - Bad UX but not a blocker
4. ✅ **Shortcuts Translation** - Incomplete feature

---

## TIME ESTIMATES

- **Fix 1 (Shortcuts Position)**: 10 minutes
- **Fix 2 (Shortcuts Translation)**: 15 minutes
- **Fix 3 (Session State Desktop)**: 30 minutes (need to debug why calls aren't executing)
- **Fix 3 (Session State Backend)**: 5 minutes (change default)
- **Fix 4 (Insights)**: 20 minutes (need to investigate)

**Total**: ~80 minutes (1.5 hours)

---

## NEXT STEPS

1. **IMPLEMENT Desktop fixes 1 & 2** (quick wins)
2. **DEBUG Session State issue** (why /session/start not called?)
3. **COORDINATE with Backend** (default session_state, insights format)
4. **TEST everything** with the checklist above
5. **DO A FULL DEMO RUN** before tomorrow

---

**STATUS**: Analysis complete, fixes ready to implement  
**BLOCKERS**: Need to debug why `/session/start` not executing  
**RISK**: HIGH if session state not fixed by tomorrow

