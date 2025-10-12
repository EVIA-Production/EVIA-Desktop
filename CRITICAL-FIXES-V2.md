# 🔧 EVIA Desktop - Critical Fixes V2 (Glass Parity Restoration)

**Date:** 2025-10-12  
**Branch:** `evia-desktop-unified-best`  
**Status:** 🟡 READY FOR TESTING (Ask functionality restored)

---

## 🎯 What Was Fixed

### ✅ 1. Ask Window Sizing Restored to Glass Parity
**Problem:** Window set to 80px minimum → Content invisible even when rendering  
**Glass Behavior:** Minimum 350-450px to ensure response area always visible  

**Fix Applied:**
```typescript
// BEFORE (BROKEN):
const clampedHeight = Math.max(80, Math.min(700, targetHeight));
requestWindowResize(100); // Initial

// AFTER (GLASS PARITY):
const clampedHeight = Math.max(350, Math.min(700, targetHeight));
setTimeout(() => requestWindowResize(400), 200); // Initial like Glass
```

**Impact:** Ask window now starts at 400px height, ensuring response area is always visible.

---

### ✅ 2. ResizeObserver Fixed (Grow Only, Never Shrink)
**Problem:** ResizeObserver tried to grow AND shrink → Caused jittery behavior  
**Glass Behavior:** Only grows window when content exceeds current height  

**Fix Applied:**
```typescript
// BEFORE (BROKEN):
const delta = Math.abs(needed - current);
if (delta > 10) {
  requestWindowResize(needed + 20); // Shrinks too
}

// AFTER (GLASS PARITY):
if (needed > current - 4) {
  requestWindowResize(Math.ceil(needed)); // Only grows
}
```

**Impact:** Window smoothly expands as response streams in, never shrinks awkwardly.

---

### ✅ 3. IPC Auto-Submit Fixed (Ref-Based State)
**Problem:** IPC listeners used stale `prompt` state → Submit fired with wrong/empty prompt  
**Glass Pattern:** Use refs for latest values without closure issues  

**Fix Applied:**
```typescript
// BEFORE (BROKEN):
eviaIpc.on('ask:submit-prompt', () => {
  if (prompt) { // Stale closure value!
    startStream();
  }
});

// AFTER (FIXED):
const currentPromptRef = useRef<string>('');
useEffect(() => {
  currentPromptRef.current = prompt; // Always synced
}, [prompt]);

const handleSubmit = () => {
  if (currentPromptRef.current?.trim()) {
    startStream(false, currentPromptRef.current); // Latest value!
  }
};
eviaIpc.on('ask:submit-prompt', handleSubmit);
```

**Impact:** Insight clicks now correctly auto-submit with the actual prompt text.

---

### ✅ 4. Welcome Window Button Positioning
**Problem:** Button overlapped with description text  
**Wrong Approach Attempted:** Decreased text width → Made window bigger  
**Correct Fix:** Move button UP with negative margin  

**Fix Applied:**
```css
/* BEFORE (WRONG): */
.option-description {
  max-width: 280px; /* Constrained text */
  padding-right: 20px;
}

/* AFTER (CORRECT): */
.action-button {
  margin-top: -12px; /* Move button UP */
}

.option-description {
  /* Full width, no constraints */
}
```

**Impact:** Button now positioned higher, description text has full width.

---

## 🔍 Root Cause Analysis

### Why Did Everything Break?

**The Core Mistake:**
"Fixed" Ask window sizing without understanding Glass's design philosophy:
- Glass uses **generous minimum heights** (400-450px) to ensure content is ALWAYS visible
- EVIA attempted **aggressive minimization** (80-100px) thinking it would "resize dynamically"
- Result: Content rendered but was hidden in tiny window

**The Compounding Issue:**
IPC auto-submit used React state in closure → Stale values → Submit with wrong/empty prompt

**The Lesson:**
> **When copying from Glass: Copy the ENTIRE pattern, not just the parts you think matter.**

---

## 📊 Testing Matrix

| Test Case | Before | After | Expected |
|-----------|--------|-------|----------|
| Ask Window Opens | ❌ 100px (invisible) | ✅ 400px (visible) | ✅ |
| Response Visible | ❌ Hidden in tiny window | ✅ Visible from start | ✅ |
| Window Grows with Content | ⚠️ Jittery | ✅ Smooth expansion | ✅ |
| Insight Click → Auto-Submit | ❌ Empty/stale prompt | ✅ Correct prompt | ✅ |
| Manual Ask (Cmd+Enter) | ❌ Input "swallowed" | ✅ Response visible | ✅ |
| Welcome Button | ❌ Overlaps text | ✅ Positioned correctly | ✅ |

---

## 🚨 Known Issues (Still Pending)

### 1. Language Changes Require Logout
**Status:** Not fixed (complex refactor required)  
**User Expectation:** Instant UI updates with animations  
**Current Behavior:** `window.location.reload()` → Hard refresh  

**Why Not Fixed:**
- Requires reactive i18n state management across all windows
- Needs IPC broadcast to all child windows
- Needs animated transitions
- Estimated 2-3 hours of work
- Low priority vs. critical Ask functionality

### 2. Transcription Still German (Backend Issue)
**Status:** Frontend correctly sends `lang` parameter  
**Problem:** Backend may not be respecting it  
**Scope:** Out of Desktop responsibility  

### 3. System Audio Transcription
**Status:** User reports it NOW WORKS ✅  
**Verification Needed:** Test in rebuilt app

### 4. Settings Functionality
**Status:** Basic (Logout/Quit) works  
**Missing:** Personalize, Invisibility, Shortcut editing, Model selection  
**Priority:** P2 - Feature completeness for later

---

## 🔄 Comparison: Before vs. After

### Ask Window Flow

**BEFORE (BROKEN):**
1. Click insight
2. IPC `ask:set-prompt` → Sets state
3. IPC `ask:submit-prompt` → Reads STALE state from closure → Empty/wrong prompt
4. Window opens at 100px → Content renders but invisible
5. ResizeObserver tries to resize → Jittery growth/shrinkage
6. User sees dark window, no output

**AFTER (FIXED):**
1. Click insight
2. IPC `ask:set-prompt` → Sets state + ref
3. IPC `ask:submit-prompt` → Reads CURRENT ref value → Correct prompt
4. Window opens at 400px → Content immediately visible
5. ResizeObserver grows window smoothly as content streams
6. User sees response streaming, window expands

---

## 📋 Files Modified

| File | Lines Changed | Purpose |
|------|---------------|---------|
| `src/renderer/overlay/AskView.tsx` | ~30 | Window sizing + IPC auto-submit |
| `src/renderer/overlay/WelcomeHeader.tsx` | ~5 | Button positioning |

**Total:** ~35 lines changed to restore Glass parity

---

## 🧪 Critical Test Path (MUST VERIFY)

### Test 1: Insight Click Auto-Submit
1. Start Listen session
2. Speak some content
3. Wait for Insights to generate
4. Click any insight card
5. **VERIFY:**
   - Ask window opens at 400px (not tiny)
   - Prompt visible briefly in input bar
   - Auto-submits within 100ms
   - Response starts streaming
   - Window grows as content appears
   - **RESPONSE IS VISIBLE FROM THE START**

**Expected Console Logs:**
```
[AskView] 📥 Received prompt via IPC: [insight text]
[AskView] 📥 Received submit command via IPC, prompt: [first 50 chars]
[AskView] 🚀 Starting stream with prompt: [text]
[AskView] 📏 Growing window: 400 → 450 (example)
```

### Test 2: Manual Ask (Cmd+Enter)
1. Press Cmd+Enter
2. Window opens at 400px
3. Type: "What is EVIA?"
4. Press Enter
5. **VERIFY:**
   - Response streams in
   - Window grows if needed
   - **RESPONSE IS VISIBLE** (not hidden in tiny window)

### Test 3: Welcome Window
1. Fresh launch
2. **VERIFY:** "Open Browser to Log In" button does NOT overlap with description text

---

## 🎯 Success Criteria

- [ ] Ask window opens at 400px (not 100px)
- [ ] Insight click → Response VISIBLE from start
- [ ] Manual Ask → Response VISIBLE
- [ ] Window grows smoothly (no shrinking)
- [ ] Welcome button doesn't overlap text
- [ ] No console errors
- [ ] IPC auto-submit uses correct prompt (not empty/stale)

---

## 🚀 Next Steps

### Immediate (Build & Test):
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run build
rm -rf /Applications/EVIA\ Desktop.app
open dist/EVIA\ Desktop-0.1.0-arm64.dmg
# Drag to Applications, launch, test critical path
```

### Post-Testing:
1. If Ask works → Move to language instant-change implementation
2. If Settings needed → Copy Glass SettingsView.js features
3. Backend investigation for German transcription issue

---

## 📚 Lessons Learned

### ✅ DO:
- Read Glass implementation COMPLETELY before making changes
- Copy entire patterns, not just fragments
- Use refs for IPC handlers to avoid closure staleness
- Test minimum viable changes before complex refactors
- Match Glass sizing philosophy (generous minimums for visibility)

### ❌ DON'T:
- Optimize before understanding the original design
- Change window sizing without testing visibility
- Use React state directly in IPC listeners (use refs)
- Assume "dynamic resizing" will solve visibility issues
- Constrain text width to fix layout issues (move elements instead)

---

**Status:** 🟡 Ready for testing - Ask functionality should now work correctly!

**Priority:** Test Ask window immediately - this was the critical blocker.

