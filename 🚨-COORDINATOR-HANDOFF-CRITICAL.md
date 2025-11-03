# 🚨 COORDINATOR HANDOFF - CRITICAL HEADER VISIBILITY BUG

**Date:** November 2, 2025  
**Status:** 🔴 **FATAL BUG - HEADER DISAPPEARS ON OPEN**  
**Assignee:** Next agent/coordinator  
**Priority:** P0 - BLOCKING ALL FUNCTIONALITY

---

## 📋 EXECUTIVE SUMMARY

**FATAL BUG:** Header window disappears immediately after EVIA opens (visible for <1 second), making the entire application unusable. User cannot access any functionality without the header.

**SUCCESSFUL FIXES COMPLETED:**
- ✅ Auto-focus on Ask window works perfectly
- ✅ Rate limit error messages display user-friendly text
- ✅ Smooth movement fixes applied (not fully tested due to header bug)

**CURRENT BLOCKER:** Header visibility issue prevents testing of all other functionality.

---

## 🎯 ORIGINAL GOAL

**User Request:** Fix all critical issues before deployment:
1. ✅ Auto-focus: Input field should auto-focus when Ask window opens (Cmd+Enter)
2. ✅ Rate limit messages: Show user-friendly errors instead of raw backend errors
3. ⚠️ Smooth movement: Multiple issues with arrow key movement and dragging
4. ❌ **Header visibility: Header disappears when Listen window opens** ← FATAL, NOT FIXED

---

## ✅ SUCCESSFUL FIXES (WORKING)

### Fix #1: Auto-Focus for Ask Window ✅
**Problem:** Input field didn't auto-focus when opening Ask window with Cmd+Enter.

**Root Cause:** Electron `BrowserWindow` wasn't focused by main process, so renderer's `inputRef.focus()` had no effect.

**Solution Applied:**
- Added `win.focus()` in `win:ensureShown` handler (line 1047)
- Added `win.focus()` in `toggleWindow` function (line 762)

**Status:** ✅ WORKING - User confirmed auto-focus now works in all scenarios

**Files Modified:**
- `src/main/overlay-windows.ts` (lines 1047, 762)

---

### Fix #2: User-Friendly Rate Limit Messages ✅
**Problem:** When Groq API rate limit hit, raw error JSON displayed to user.

**Root Cause:** Backend streamed error as plain text, frontend didn't intercept.

**Solution Applied:**
1. **Backend** (`backend/api/services/groq_service.py` line 520):
   - Modified to yield: `"Error generating suggestion: {e}"`
   
2. **Frontend** (`src/renderer/overlay/AskView.tsx` lines 539-565):
   - Added detection for "Error generating suggestion:" in stream
   - Checks for rate limit keywords
   - Displays localized error via `showError()`
   - Aborts stream to prevent raw error display

**Status:** ✅ WORKING - User confirmed friendly messages display correctly

**Files Modified:**
- `EVIA-Backend/backend/api/services/groq_service.py`
- `EVIA-Desktop/src/renderer/overlay/AskView.tsx`

---

### Fix #3: Smooth Movement Improvements ⚠️
**Problems Identified:**
1. Rapid key presses caused "teleporting" instead of smooth movement
2. Header stopped ~1cm before right screen edge
3. Windows could be dragged partially outside screen boundaries
4. Child windows didn't adjust position when header dragged

**Solutions Applied:**
1. **Rapid presses** (`overlay-windows.ts` lines 847-902):
   - Modified `nudgeHeader` to update `animationTarget` if animation in progress
   - Animation now calculates from target position, not current position
   
2. **Right edge boundary** (`overlay-windows.ts` lines 422-435):
   - Removed +10px buffer in `clampBounds` function
   - Changed `maxX` from `work.x + work.width - bounds.width + 10` to `work.x + work.width - bounds.width`
   
3. **Dragging boundaries** (`overlay-windows.ts` lines 1084-1098):
   - Applied `clampBounds` in `win:moveHeaderTo` IPC handler
   - Prevents dragging outside screen
   
4. **Child window layout on drag** (`overlay-windows.ts` lines 1095):
   - Added `layoutChildWindows(vis)` call after header drag
   - Recalculates child positions relative to new header position

**Status:** ⚠️ PARTIALLY APPLIED - Code changes made, but NOT TESTED by user due to header visibility bug

**Files Modified:**
- `EVIA-Desktop/src/main/overlay-windows.ts`

**REMAINING WORK:**
- Window flipping (above/below header) - NOT IMPLEMENTED
- Floating behavior when arrow key held - NOT IMPLEMENTED

---

## ❌ CRITICAL FAILURE: HEADER VISIBILITY

### The Fatal Bug

**Symptom:** Header window disappears immediately (<1 second) after EVIA opens.

**Impact:** 
- User cannot click Listen, Ask, or Settings buttons
- Entire application unusable
- Blocks all testing and deployment

**User Reports:**
1. "Header visible on open" (initially working)
2. "I press listen, the listen window appears, the header disappears" (first report)
3. "Still doesnt fix. The listen window pop up hides the header" (after multiple fix attempts)
4. "Now Header disappears on open immediately. I see for less than a second" (current state - FATAL)

---

### All Attempted Fixes (NONE WORKED)

#### Attempt #1: Added `header.moveTop()` after showing child
**File:** `overlay-windows.ts` line ~1058  
**Code:**
```typescript
const header = getOrCreateHeaderWindow()
header.setAlwaysOnTop(true, 'screen-saver')
header.moveTop()
```
**Result:** ❌ Header still disappeared when Listen opened

---

#### Attempt #2: Removed `win.moveTop()` from child windows
**Hypothesis:** Child window's `moveTop()` moved it above parent  
**Change:** Removed `win.moveTop()` call, only kept `header.moveTop()`  
**Result:** ❌ Header still disappeared

---

#### Attempt #3: Made Ask window independent (no parent)
**Hypothesis:** Parent/child relationship preventing proper z-order  
**Change:** 
```typescript
const isIndependent = name === 'shortcuts' || name === 'ask'
parent: isIndependent ? undefined : parent
```
**Result:** ❌ Header became invisible on startup (made things worse)

---

#### Attempt #4: Used actual window visibility instead of saved state
**Hypothesis:** Saved state causing incorrect window management  
**Change:** Built `finalVisibility` by checking actual window visibility, not persisted state  
**Result:** ❌ Header invisible on startup (made things worse)

---

#### Attempt #5: Removed ALL `moveTop()` calls
**Hypothesis:** `moveTop()` itself breaks Electron's z-order  
**Change:** Only used `setAlwaysOnTop`, no `moveTop()` anywhere  
**Result:** ❌ Header disappeared on startup (made things worse)

---

#### Attempt #6: REVERTED to original code + minimal fix
**Action:** Restored original `win:ensureShown` implementation, kept only `header.show()` + `header.moveTop()`  
**Result:** ❌ Header still disappears immediately on open (CURRENT STATE)

---

## 🔍 DIAGNOSTIC EVIDENCE

### Console Logs from Ask Window
```
[OverlayEntry] 🔍 View param: ask
[AskView] 🚀 Component mounted, initial focus
[AskView] ⌨️ Auto-focused input (attempt 1)
```

**Key Observation:** Only seeing Ask window logs, never seeing Header window logs. This suggests:
1. Header window might not be created
2. Header window created but immediately hidden
3. Header window created but covered by something

### Missing Logs
**Should see but DON'T:**
```
[overlay-windows] ✅ Header window shown
[overlay-windows] Header loading from...
[HeaderController] ✅ Auth valid - proceeding to show header
```

---

## 📊 CURRENT CODE STATE

### File: `src/main/overlay-windows.ts`

**Function: `win:ensureShown` (lines 1022-1066)**
```typescript
ipcMain.handle('win:ensureShown', (_event, name: FeatureName) => {
  console.log(`[overlay-windows] win:ensureShown called for ${name}`)
  // CRITICAL FIX: Only show the requested window
  let win = childWindows.get(name)
  if (!win || win.isDestroyed()) {
    win = createChildWindow(name)
  }
  
  const vis = getVisibility()
  const newVis = { ...vis, [name]: true }
  
  layoutChildWindows(newVis)
  
  if (win && !win.isDestroyed()) {
    win.show()
    win.setAlwaysOnTop(true, 'screen-saver')
    
    if (name === 'ask') {
      win.focus()  // ← Auto-focus fix (WORKING)
      console.log(`[overlay-windows] ✅ Ask window focused for input auto-focus`)
    }
  }
  
  // ← Attempted header fix (NOT WORKING)
  const header = getOrCreateHeaderWindow()
  if (header && !header.isDestroyed()) {
    header.setAlwaysOnTop(true, 'screen-saver')
    header.show()
    header.moveTop()
    console.log(`[overlay-windows] ✅ Header moved to top after showing ${name}`)
  }
  
  saveState({ visible: newVis })
  console.log(`[overlay-windows] ensureShown complete for ${name}`)
  return { ok: true }
})
```

**Function: `getOrCreateHeaderWindow` (lines 119-243)**
- Creates header with `show: false`
- Uses `ready-to-show` event to call `showInactive()` (line 188)
- Loads `overlay.html?view=header`
- Sets `alwaysOnTop: true` and `focusable: true`

---

## 🧩 THEORIES ON ROOT CAUSE

### Theory #1: Header Controller Issue
**Hypothesis:** `header-controller.ts` might be hiding the header or not creating it properly

**Evidence:**
- Only seeing Ask window logs, not header logs
- Might be an authentication/permission flow issue

**Investigation Needed:**
- Check if header-controller is actually calling `createHeaderWindow()`
- Verify authentication flow isn't redirecting to Welcome/Login

---

### Theory #2: Window Layering Bug in Electron
**Hypothesis:** macOS window management or Electron bug with `alwaysOnTop` windows

**Evidence:**
- Multiple attempts to fix z-order all failed
- Behavior changed depending on order of operations
- Glass (reference implementation) doesn't have this issue

**Investigation Needed:**
- Compare EVIA's window creation options with Glass exactly
- Check if there's an Electron version-specific bug
- Test on different macOS versions

---

### Theory #3: State File Corruption
**Hypothesis:** Saved state causing wrong windows to open/hide

**Evidence:**
- User console shows Ask window immediately
- Might be restoring state where Ask was open

**Investigation Needed:**
- Delete `~/Library/Application Support/EVIA/state.json`
- Check `persistedState.visible` values

---

### Theory #4: Parent/Child Window Bug
**Hypothesis:** Electron parent/child relationship broken in current setup

**Evidence:**
- Adding Ask as independent window broke startup
- Removing it didn't fix Listen covering header
- Glass uses parent/child successfully

**Investigation Needed:**
- Verify ALL child windows have `parent: header` set
- Check if Listen window parent relationship is correct
- Compare exact BrowserWindow options with Glass

---

## 🔬 DIAGNOSTIC STEPS FOR NEXT AGENT

### Step 1: Verify Header Window Creation
```bash
# Open EVIA
open /Users/benekroetz/EVIA/EVIA-Desktop/dist/mac-arm64/EVIA.app

# Check terminal logs for:
[HeaderController] 🚀 Initializing...
[HeaderController] ✅ Auth valid - proceeding to show header
[overlay-windows] Header loading from...
```

**If missing:** Problem is in header-controller or authentication flow

---

### Step 2: Check All Windows with Cmd+Tab
```
1. Open EVIA
2. Press Cmd+Tab (app switcher)
3. Count how many EVIA windows exist
```

**Expected:** Should see at least header window  
**If not:** Header window not being created at all

---

### Step 3: Open DevTools on All Windows
```
1. Open EVIA
2. Click anywhere on screen
3. Press Cmd+Option+I repeatedly (cycles through all windows)
4. Check Console in each window
```

**Look for:**
- Header window console (should show `[OverlayEntry] View param: header`)
- Any JavaScript errors

---

### Step 4: Delete State and Test Clean
```bash
pkill -9 EVIA
rm ~/Library/Application\ Support/EVIA/state.json
open /Users/benekroetz/EVIA/EVIA-Desktop/dist/mac-arm64/EVIA.app
```

**If this fixes it:** State corruption issue  
**If still broken:** Deeper bug

---

### Step 5: Compare with Glass Window Creation
**Files to compare:**
- EVIA: `overlay-windows.ts` lines 119-146 (header creation)
- Glass: `windowManager.js` lines 640-698 (header creation)

**Look for differences in:**
- `BrowserWindow` options
- `alwaysOnTop` usage
- `show` vs `showInactive` timing
- Parent/child relationships

---

## 📝 KNOWN WORKING CODE (DO NOT CHANGE)

### Auto-Focus Fix (WORKING - lines 1047, 762)
```typescript
if (name === 'ask') {
  win.focus()
  console.log(`[overlay-windows] ✅ Ask window focused for input auto-focus`)
}
```
**DO NOT REMOVE THIS**

### Rate Limit Error Handling (WORKING)
**Backend:** `groq_service.py` line 520
**Frontend:** `AskView.tsx` lines 539-565
**DO NOT CHANGE THESE**

---

## 🚫 WHAT NOT TO DO

Based on failed attempts, **DO NOT:**

1. ❌ Remove parent/child relationships from child windows
2. ❌ Make Ask window independent (breaks startup)
3. ❌ Remove ALL `moveTop()` calls (breaks visibility)
4. ❌ Change `updateWindows` logic (affects all windows)
5. ❌ Modify `layoutChildWindows` (positioning logic is correct)
6. ❌ Call `updateWindows` instead of `layoutChildWindows` in `ensureShown`

---

## 🎯 RECOMMENDED APPROACH FOR FIX

### Option A: Investigate Header Controller
**Priority:** HIGH  
**Reason:** Only seeing Ask logs, not header logs suggests header not being created

**Steps:**
1. Add extensive logging to `header-controller.ts` `initialize()` function
2. Verify `createHeaderWindow()` is actually being called
3. Check authentication flow isn't redirecting away from header

**Files to examine:**
- `src/main/header-controller.ts`
- `src/main/main.ts` (app initialization)

---

### Option B: Force Header Visibility
**Priority:** MEDIUM  
**Reason:** If header IS created but hidden, force it visible

**Approach:**
```typescript
// In win:ensureShown, be MORE aggressive:
const header = getOrCreateHeaderWindow()
if (header && !header.isDestroyed()) {
  header.setAlwaysOnTop(true, 'screen-saver')
  header.show()  // Not showInactive
  header.focus()  // Force focus
  header.moveTop()
  
  // Force re-render
  const bounds = header.getBounds()
  header.setBounds({ ...bounds, x: bounds.x + 1 })
  header.setBounds(bounds)
}
```

---

### Option C: Compare with Glass Exactly
**Priority:** HIGH  
**Reason:** Glass works, EVIA doesn't - find the difference

**Steps:**
1. Copy Glass's EXACT `BrowserWindow` options for header
2. Copy Glass's EXACT window showing logic
3. Copy Glass's EXACT z-order management

**Files to compare:**
- Glass: `windowManager.js` lines 640-750
- EVIA: `overlay-windows.ts` lines 119-243

---

## 📦 DEPLOYMENT STATUS

**BLOCKED:** Cannot deploy until header visibility fixed.

**Completed (Ready for deployment once header fixed):**
- ✅ Auto-focus
- ✅ Rate limit messages
- ⚠️ Smooth movement (needs testing)

**Remaining TODOs (Non-blocking):**
- Window flipping above/below header
- Floating behavior with held arrow keys
- AEC verification (TODO #5)
- System audio display verification (TODO #6)

---

## 🔄 HANDOFF CHECKLIST

For next agent taking over:

- [ ] Read this entire document
- [ ] Verify auto-focus fix is still working (don't break it)
- [ ] Verify rate limit fix is still working (don't break it)
- [ ] Run diagnostic steps 1-4 above
- [ ] Check header-controller logs in terminal
- [ ] Compare with Glass window creation exactly
- [ ] Test one fix at a time (don't change multiple things)
- [ ] Test immediately after each change
- [ ] Revert if change makes things worse

---

## 📞 CONTACT

**User:** benekroetz  
**Issue:** Header disappears immediately on open (FATAL)  
**User Feedback:** "It still disappears right after open. This is fatal."

**User is waiting for fix before deployment.**

---

## 🎬 FINAL NOTES

**What I did well:**
- Fixed auto-focus completely
- Fixed rate limit messages completely
- Applied smooth movement improvements
- Documented all attempts thoroughly

**What I did wrong:**
- Made header visibility worse with each attempt
- Changed too many things at once without testing
- Didn't investigate header-controller early enough
- Should have compared with Glass more carefully

**For next agent:**
- Focus on WHY header is disappearing, not just trying random fixes
- Use diagnostic steps to understand root cause first
- Test each change immediately
- Keep auto-focus and rate limit fixes intact
- Good luck! 🍀

---

**END OF REPORT**

