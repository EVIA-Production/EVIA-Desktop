# Critical Fixes Round 2 - Analysis & Solutions

## 🔴 Test Results

### ✅ Test 1: Listen Window Layout
**Status**: PASS  
**What Works**: Listen appears side-by-side with Ask (not overlapping)

### ❌ Test 2: Cmd+Enter Closes Listen
**Status**: FAIL  
**Issue**: When pressing Cmd+Enter while in "Fertig" mode (recording finished), Ask opens but Listen disappears

**Root Cause**:
```typescript
// EVIA-Desktop/src/main/overlay-windows.ts:676-690
if (name === 'ask') {
  const newVis: WindowVisibility = {
    ask: !current,
    settings: false,
    listen: false,    // ❌ ALWAYS closes Listen - THIS IS THE BUG
    shortcuts: false,
  }
}
```

**Fix**: Check if Listen is currently visible and preserve its state when opening Ask:
```typescript
if (name === 'ask') {
  // Check actual current visibility (not persisted state)
  const listenWin = childWindows.get('listen')
  const isListenCurrentlyVisible = listenWin && !listenWin.isDestroyed() && listenWin.isVisible()
  
  const newVis: WindowVisibility = {
    ask: !current,
    settings: false,
    listen: isListenCurrentlyVisible,  // ✅ Preserve Listen if visible
    shortcuts: false,
  }
}
```

---

### ❌ Test 3: Ask Doesn't Clear on Language Change
**Status**: FAIL  
**Issue**: When changing language, Ask window still shows old German output

**Root Cause**: The `clear-session` IPC is being sent and received, but AskView needs to also clear on language-changed event.

**Current Flow**:
1. overlay-entry.tsx sends `clear-session` ✅
2. AskView receives `clear-session` ✅
3. BUT: If Ask window was closed during language change, the event is lost ❌

**Fix**: AskView should ALSO listen for `language-changed` IPC event and clear state:
```typescript
eviaIpc.on('language-changed', (newLang: string) => {
  console.log('[AskView] 🌐 Language changed to', newLang, '- clearing state');
  // Clear all state on language change
  setResponse('');
  setCurrentQuestion('');
  setPrompt('');
  setIsStreaming(false);
  setIsLoadingFirstToken(false);
  lastResponseRef.current = '';
});
```

---

### ❌ Test 4: Input Doesn't Auto-Focus
**Status**: FAIL  
**Issue**: When Ask window opens, keyboard input goes to previous focus (textbox, console, etc.)

**Root Cause**: The auto-focus code uses `requestAnimationFrame` + `setTimeout(100ms)`, but this isn't reliable when:
- DevTools is open (steals focus)
- Window is being created for first time (DOM not ready)
- Multiple windows are opening simultaneously

**Fix**: Use longer delay + retry mechanism + explicit window focus:
```typescript
const focusInput = () => {
  if (inputRef.current) {
    // First, ensure window itself has focus
    const win = (window as any).evia?.window;
    if (win?.focus) {
      win.focus();
    }
    
    // Then focus input with retry
    requestAnimationFrame(() => {
      setTimeout(() => {
        inputRef.current?.focus();
        
        // Verify focus worked - if not, retry once
        setTimeout(() => {
          if (document.activeElement !== inputRef.current) {
            console.warn('[AskView] ⚠️ Focus failed, retrying...');
            inputRef.current?.focus();
          }
        }, 100);
      }, 200);  // Increased delay from 100ms to 200ms
    });
  }
};
```

---

### ❌ Test 5: Old Insights Data
**Status**: FAIL  
**Issue**: When opening Listen, old German insights appear (default summary)

**Root Cause**: ListenView clears transcripts on `recording_started`, but insights might be loaded from localStorage or not cleared on language change.

**Fix**: ListenView should also listen for `language-changed` and clear insights:
```typescript
eviaIpc.on('language-changed', (newLang: string) => {
  console.log('[ListenView] 🌐 Language changed to', newLang, '- clearing insights');
  setInsights(null);  // Clear old language insights
});
```

---

## 📋 Implementation Plan

### Priority 1: Fix toggleWindow('ask') - Test 2
**File**: `src/main/overlay-windows.ts`  
**Line**: 676-690  
**Change**: Preserve Listen's visibility when opening Ask

### Priority 2: Fix AskView language clearing - Test 3
**File**: `src/renderer/overlay/AskView.tsx`  
**Line**: ~200 (IPC listeners section)  
**Change**: Add `language-changed` listener to clear state

### Priority 3: Fix ListenView insights clearing - Test 5
**File**: `src/renderer/overlay/ListenView.tsx`  
**Line**: ~160 (IPC listeners section)  
**Change**: Add `language-changed` listener to clear insights

### Priority 4: Fix auto-focus - Test 4
**File**: `src/renderer/overlay/AskView.tsx`  
**Line**: ~218-240 (auto-focus useEffect)  
**Change**: Increase delay, add retry, ensure window focus

---

## 🧪 Testing Plan

After fixes, verify:
1. ✅ Listen + Ask can be open together
2. ✅ Pressing Cmd+Enter with both open closes Ask, preserves Listen
3. ✅ Changing language clears Ask content
4. ✅ Changing language clears Listen insights
5. ✅ Opening Ask automatically focuses input (type immediately)

---

**Status**: Ready to implement  
**Estimated Time**: 15 minutes  
**Risk**: Low (isolated changes, no refactoring)

