# 🔧 Listen Button State Reset on Language Change - FIX COMPLETE

**Date**: October 22, 2025  
**Issue**: Listen button state not resetting when language is changed during session  
**Severity**: High - UX confusion  
**Status**: ✅ FIXED  

---

## 🐛 PROBLEM

**User Scenario**:
1. Start listening → Button shows "Stopp/Stop"
2. Stop listening → Button shows "Fertig/Done"
3. Change language in Settings → Session closes
4. 🔴 **Bug**: Button still shows "Stopp/Stop" or "Fertig/Done" instead of resetting to "Zuhören/Listen"

**Why This Matters**:
- Users expect the button to reset to "Listen" when session is cleared
- Current behavior is confusing - session is closed but button suggests it's still active
- Can lead to users thinking the app is broken or stuck

---

## 🔍 ROOT CAUSE

### Backend Behavior (Correct ✅)
- Backend closes WebSocket on language change
- Backend sends session termination signal
- All server-side state is cleared

### Desktop IPC (Correct ✅)
**File**: `src/renderer/overlay/overlay-entry.tsx` (Lines 84-93)

When language is changed:
```typescript
// Send IPC messages to clear session
eviaIpc.send('clear-session');  // To ListenView
eviaIpc.send('language-changed', newLang);  // To all windows
```

### EviaBar State Management (Bug ❌)
**File**: `src/renderer/overlay/EviaBar.tsx`

**The Problem**:
- `EviaBar` maintains `listenStatus` state: `'before'` | `'in'` | `'after'`
- This state controls the button label:
  - `'before'` → "Zuhören/Listen"
  - `'in'` → "Stopp/Stop"
  - `'after'` → "Fertig/Done"
- **EviaBar was NOT listening for `language-changed` or `clear-session` IPC events**
- When language changed, `listenStatus` stayed at `'in'` or `'after'`
- Button showed wrong label for the actual state

---

## ✅ SOLUTION

### Code Changes

**File**: `src/renderer/overlay/EviaBar.tsx` (Lines 80-107)

**Added IPC Listeners**:
```typescript
// 🔧 FIX: Reset listen button state when language is changed or session is cleared
useEffect(() => {
  const handleLanguageChanged = () => {
    console.log('[EviaBar] 🌐 Language changed - resetting listen button to "before" state');
    setListenStatus('before');
    setIsListenActive(false);
  };

  const handleSessionClosed = () => {
    console.log('[EviaBar] 🧹 Session closed - resetting listen button to "before" state');
    setListenStatus('before');
    setIsListenActive(false);
  };

  const eviaIpc = (window as any).evia?.ipc;
  if (eviaIpc) {
    eviaIpc.on('language-changed', handleLanguageChanged);
    eviaIpc.on('clear-session', handleSessionClosed);
    console.log('[EviaBar] ✅ Registered language-changed and clear-session listeners');
  }

  return () => {
    if (eviaIpc) {
      eviaIpc.off('language-changed', handleLanguageChanged);
      eviaIpc.off('clear-session', handleSessionClosed);
    }
  };
}, []);
```

**What This Does**:
1. **Listens for `language-changed` event**: Sent when user toggles language
2. **Listens for `clear-session` event**: Sent when session is manually cleared
3. **Resets state**: `setListenStatus('before')` + `setIsListenActive(false)`
4. **Button updates**: React re-renders with new label ("Zuhören/Listen")

---

## 🧪 TESTING

### Test Case 1: Language Change During Recording
**Steps**:
1. Press "Zuhören/Listen" → Button shows "Stopp/Stop"
2. Start speaking (transcription appears)
3. Open Settings → Change language
4. ✅ **Expected**: Button resets to "Zuhören/Listen" (or "Listen" if English)
5. ✅ **Expected**: Transcripts cleared
6. ✅ **Expected**: Windows closed

### Test Case 2: Language Change After Recording (Done State)
**Steps**:
1. Press "Zuhören/Listen" → Record → Press "Stopp/Stop"
2. Button shows "Fertig/Done"
3. Insights appear
4. Open Settings → Change language
5. ✅ **Expected**: Button resets to "Zuhören/Listen" (or "Listen" if English)
6. ✅ **Expected**: Insights cleared
7. ✅ **Expected**: Windows closed

### Test Case 3: Language Change When Idle
**Steps**:
1. Button shows "Zuhören/Listen" (idle state)
2. Open Settings → Change language
3. ✅ **Expected**: Button stays at "Zuhören/Listen" (or changes to "Listen" if switching to English)
4. ✅ **Expected**: No state change needed (already at 'before')

---

## 🔄 STATE FLOW DIAGRAM

### Before Fix (Broken)
```
1. Idle: "Zuhören" (listenStatus='before')
   ↓ [User clicks]
2. Recording: "Stopp" (listenStatus='in')
   ↓ [User toggles language]
3. Language changed → Session closed → Windows hidden
   ❌ Button still shows "Stopp" (listenStatus='in') ← STUCK!
```

### After Fix (Correct)
```
1. Idle: "Zuhören" (listenStatus='before')
   ↓ [User clicks]
2. Recording: "Stopp" (listenStatus='in')
   ↓ [User toggles language]
3. Language changed → IPC: 'language-changed' received
   ✅ setListenStatus('before')
   ✅ Button resets to "Zuhören"
```

---

## 📊 IMPACT

### User Experience
- ✅ **Clarity**: Button state always matches actual session state
- ✅ **Consistency**: Language toggle fully resets UI to idle state
- ✅ **Trust**: No more "stuck" button states

### Code Quality
- ✅ **Clean**: Single source of truth for session state (IPC events)
- ✅ **Maintainable**: All session reset logic in one place
- ✅ **Debuggable**: Console logs show state transitions

---

## 🔗 RELATED FILES

| File | Role | Changes |
|------|------|---------|
| `overlay-entry.tsx` | Language toggle coordinator | ✅ Already sends IPC events |
| `EviaBar.tsx` | Listen button UI | ✅ **FIXED**: Now listens for IPC events |
| `ListenView.tsx` | Transcript display | ✅ Already listens for `clear-session` |
| `AskView.tsx` | Ask window | ✅ Already listens for `abort-ask-stream` |

---

## 🚀 NEXT STEPS

1. ✅ Code fix applied to `EviaBar.tsx`
2. ⏳ Build Desktop app
3. ⏳ Test all 3 test cases above
4. ⏳ Verify console logs show state transitions
5. ⏳ Merge to main branch

---

## 📝 CHANGELOG

### EviaBar.tsx (Lines 80-107)
**Added**:
- IPC listener for `language-changed` event
- IPC listener for `clear-session` event
- State reset logic: `setListenStatus('before')` + `setIsListenActive(false)`
- Console logs for debugging

**No Breaking Changes**: This is purely additive - adds missing event listeners.

---

**Fix Status**: ✅ COMPLETE  
**Build Required**: Yes  
**Testing Required**: Yes  
**Estimated Test Time**: 5 minutes  

---

**This fix ensures the Listen button always reflects the actual session state, even when language is changed mid-session.**

