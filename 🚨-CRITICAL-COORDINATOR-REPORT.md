# 🚨 CRITICAL COORDINATOR REPORT - DRAGGING & POSITIONING FAILURES

## Executive Summary

**Status**: ❌ CRITICAL FAILURES - All 5 fixes failed in production testing

**User Report**:
1. ❌ Windows and header CAN STILL be dragged into borders
2. ❌ Windows do NOT adjust positioning while being dragged
3. ❌ No floating (not yet implemented - expected)
4. ❌ Settings window positioning is WRONG (appears at upper-right, should be at lower-right by default)
5. ❌ Can STILL drag header out of screen

**Root Cause Analysis**: The `will-move` event handler approach is fundamentally flawed for this use case.

---

## CRITICAL ISSUE #1: `will-move` Event Not Firing for Renderer-Initiated Drags

### The Problem

The `will-move` event handler I implemented:
```typescript
headerWindow.on('will-move', (event, newBounds) => {
  const clamped = clampBounds(newBounds)
  if (clamped.x !== newBounds.x || clamped.y !== newBounds.y) {
    event.preventDefault()
    headerWindow.setBounds(clamped)
    layoutChildWindows(vis)
  }
})
```

**Why This Fails**:
1. `will-move` event fires for SYSTEM-initiated moves (dragging via `-webkit-app-region: drag`)
2. BUT our header is dragged via **JavaScript in the renderer** (`EviaBar.tsx` lines 294-302)
3. When renderer calls `eviaIpc.windows.moveHeaderTo(x, y)`, which calls the IPC handler `win:moveHeaderTo`, this does NOT trigger the `will-move` event
4. The `will-move` event only fires for native drag operations, not IPC-initiated `setBounds()` calls

### Evidence from Code

**EviaBar.tsx** (lines 294-302):
```typescript
const handleMouseMove = (event: MouseEvent) => {
  if (!dragState.current) return;
  event.preventDefault();
  const dx = event.screenX - dragState.current.startX;
  const dy = event.screenY - dragState.current.startY;
  (window as any).evia?.windows?.moveHeaderTo?.(
    dragState.current.initialX + dx,
    dragState.current.initialY + dy,
  );
};
```

**overlay-windows.ts** `win:moveHeaderTo` handler (lines 1234-1247):
```typescript
ipcMain.handle('win:moveHeaderTo', (_event, x: number, y: number) => {
  const header = getOrCreateHeaderWindow()
  // 🔴 CRITICAL FIX #3c: Enforce screen boundaries when dragging
  // User requested: "should not be able to be partially dragged outside of the screen"
  const bounds = clampBounds({ ...header.getBounds(), x, y })
  header.setBounds(bounds)
  saveState({ headerBounds: bounds })
  
  // 🔴 FIX #3d: Recalculate child window positions when header is dragged
  // This ensures Listen/Ask windows stay properly positioned relative to header
  const vis = getVisibility()
  layoutChildWindows(vis)
  
  return { ok: true }
})
```

**The Issue**: This handler DOES call `clampBounds()` and `layoutChildWindows()`, so theoretically it should work. Let me investigate why it's not working.

---

## CRITICAL ISSUE #2: Settings Window Positioning Logic is BACKWARDS

### User's Requirement (from screenshot annotation)

**Default**: Settings should appear at **LOWER-RIGHT** corner of header (the box drawn in the screenshot)
- Settings window's upper-left corner should align with header's lower-right corner

**Current Implementation** (WRONG):
```typescript
// Default: lower-left corner of settings at upper-right corner of header
let x = hb.x + hb.width  // This aligns LEFT edge of settings with RIGHT edge of header
```

This is placing settings at the **UPPER-RIGHT** corner (settings left edge at header right edge), but the user wants **LOWER-RIGHT** corner.

### Correct Logic Should Be

**Default Position**:
- Settings should appear BELOW and TO THE RIGHT of header
- Visual: Header has a "..." button on its right side
- Settings should appear with its TOP-LEFT corner slightly below and to the right of that button

**From User's Drawing**:
The red box shows settings should be positioned at the bottom-right of the header, not the top-right.

---

## CRITICAL ISSUE #3: Continuous Repositioning During Drag Not Working

### The Problem

I added `layoutChildWindows(vis)` to:
1. The `win:moveHeaderTo` handler ✅ (should work for mouse dragging)
2. The `animate()` function inside `nudgeHeader()` ✅ (should work for arrow key movement)

But the user reports windows don't adjust during dragging. This suggests:
1. Either `layoutChildWindows()` is not being called frequently enough
2. Or `layoutChildWindows()` is being called but the child windows aren't updating their position fast enough
3. Or there's a race condition between `header.setBounds()` and `layoutChildWindows()`

---

## ROOT CAUSE ANALYSIS: Why Clamping Isn't Working

### Theory 1: `clampBounds()` is Broken

Let me trace the logic:
```typescript
function clampBounds(bounds: Electron.Rectangle): Electron.Rectangle {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const display = screen.getDisplayNearestPoint({ x: centerX, y: centerY })
  
  const screenBounds = display.bounds
  const workArea = display.workArea
  
  const minX = screenBounds.x
  const maxX = screenBounds.x + screenBounds.width - bounds.width
  
  const minY = workArea.y
  const maxY = workArea.y + workArea.height - bounds.height
  
  const clamped = {
    x: Math.max(minX, Math.min(bounds.x, maxX)),
    y: Math.max(minY, Math.min(bounds.y, maxY)),
    width: bounds.width,
    height: bounds.height,
  }
  
  return clamped
}
```

**This looks correct**. It should clamp to screen boundaries.

### Theory 2: `win:moveHeaderTo` is Called Too Frequently

From `EviaBar.tsx`, `handleMouseMove` is called on EVERY `mousemove` event. If the user drags fast, this could be called hundreds of times per second. Maybe:
1. The IPC calls are queued up
2. By the time they execute, the drag has already moved the window off-screen
3. Electron's IPC is asynchronous, so there's a delay between renderer calling `moveHeaderTo` and main process executing it

### Theory 3: The Header Is Actually Being Moved Off-Screen BEFORE `clampBounds()` is Applied

Wait, looking at the code again:
```typescript
ipcMain.handle('win:moveHeaderTo', (_event, x: number, y: number) => {
  const header = getOrCreateHeaderWindow()
  const bounds = clampBounds({ ...header.getBounds(), x, y })
  header.setBounds(bounds)
  // ...
})
```

This creates a NEW bounds object with the requested `x, y`, then clamps it, then sets it. This should work.

BUT... what if the header's `width` and `height` in `header.getBounds()` are wrong at this moment? Let me check if there's a timing issue.

---

## CRITICAL INSIGHT: The REAL Problem

Looking at the screenshot, the user can drag the header **partially** off-screen. This means:
1. `clampBounds()` is NOT being called at all during drag
2. OR `clampBounds()` is being called but returning the wrong values
3. OR `header.setBounds()` is not being called with the clamped values

### Debugging Steps Required

1. **Add extensive logging to `win:moveHeaderTo`**:
   - Log every call with input `x, y`
   - Log the clamped bounds
   - Log the display info
   - Log the actual bounds after `setBounds()` is called

2. **Check if `win:moveHeaderTo` is actually being called**:
   - The renderer might not be correctly calling the IPC method

3. **Check the IPC preload bridge**:
   - Verify `evia.windows.moveHeaderTo` is correctly exposed

---

## SOLUTION APPROACH

### Option 1: Throttled IPC with Client-Side Validation

Instead of calling `moveHeaderTo` on every `mousemove`, throttle it and pre-validate bounds on the client side.

### Option 2: Continuous Polling During Drag

Have the main process continuously check header position and clamp it during drag operations.

### Option 3: Use Native Electron Window Dragging with Bounds

Set `movable: true` on the header window and use Electron's built-in bounds limiting.

**Recommendation**: Option 1 is most reliable and performant.

---

## COMPREHENSIVE FIX PLAN

### Fix 1: Add Extensive Logging to Diagnose

Add logging to every step of the drag → clamp → set bounds flow to see where it's failing.

### Fix 2: Throttle Mouse Move Handler

Throttle `handleMouseMove` to call `moveHeaderTo` at most 60 times per second (every 16ms).

### Fix 3: Pre-Clamp in Renderer

Calculate screen bounds in the renderer and pre-clamp the position before sending to main process.

### Fix 4: Fix Settings Positioning

Correct the logic to match user's requirements:
- **Default**: Settings upper-left at header lower-right (BELOW header, aligned to right edge)
- **Header at bottom**: Flip settings ABOVE header
- **Header too far right**: Shift settings left

### Fix 5: Implement Continuous Repositioning

Use `requestAnimationFrame` or a timer to continuously update child window positions during drag.

---

## DETAILED CODE FIXES

### Fix 1: Enhanced Logging in `win:moveHeaderTo`

```typescript
ipcMain.handle('win:moveHeaderTo', (_event, x: number, y: number) => {
  const header = getOrCreateHeaderWindow()
  const currentBounds = header.getBounds()
  
  console.log(`[win:moveHeaderTo] 📥 Input: (${x}, ${y})`)
  console.log(`[win:moveHeaderTo] 📊 Current bounds:`, currentBounds)
  
  const display = screen.getDisplayNearestPoint({ x, y })
  console.log(`[win:moveHeaderTo] 🖥️ Display:`, {
    bounds: display.bounds,
    workArea: display.workArea
  })
  
  const requestedBounds = { ...currentBounds, x, y }
  console.log(`[win:moveHeaderTo] 📐 Requested bounds:`, requestedBounds)
  
  const clampedBounds = clampBounds(requestedBounds)
  console.log(`[win:moveHeaderTo] 🔒 Clamped bounds:`, clampedBounds)
  
  header.setBounds(clampedBounds)
  
  const actualBounds = header.getBounds()
  console.log(`[win:moveHeaderTo] ✅ Actual bounds after setBounds:`, actualBounds)
  
  saveState({ headerBounds: clampedBounds })
  
  const vis = getVisibility()
  layoutChildWindows(vis)
  
  return { ok: true }
})
```

### Fix 2: Throttled Mouse Move in EviaBar.tsx

```typescript
const handleMouseMove = (event: MouseEvent) => {
  if (!dragState.current) return;
  event.preventDefault();
  
  // 🔴 THROTTLE: Only update position every 16ms (60fps)
  const now = Date.now();
  if (lastMoveTime && now - lastMoveTime < 16) {
    return;
  }
  lastMoveTime = now;
  
  const dx = event.screenX - dragState.current.startX;
  const dy = event.screenY - dragState.current.startY;
  
  const newX = dragState.current.initialX + dx;
  const newY = dragState.current.initialY + dy;
  
  console.log(`[EviaBar] 🖱️ Mouse move: (${newX}, ${newY})`);
  
  (window as any).evia?.windows?.moveHeaderTo?.(newX, newY);
};
```

### Fix 3: Corrected Settings Positioning

```typescript
if (visible.settings) {
  const settingsWin = createChildWindow('settings')
  const settingsW = WINDOW_DATA.settings.width  // 240px
  const settingsH = WINDOW_DATA.settings.height // 388px
  
  // 🔴 USER REQUIREMENT (from screenshot): 
  // Default: Settings appears at LOWER-RIGHT corner of header
  // Settings upper-left corner aligns with header lower-right corner
  
  const spaceBelow = (work.y + work.height) - (hb.y + hb.height)
  const spaceAbove = hb.y - work.y
  const gap = 5
  
  // Determine if we need to flip above
  const showAbove = spaceBelow < (settingsH + gap + 20) && spaceAbove > spaceBelow
  
  // Horizontal position: Align settings RIGHT edge with header RIGHT edge
  // (or shift left if would go off-screen)
  let x = hb.x + hb.width - settingsW  // Align right edges
  
  // If this would place settings off the left edge, shift right
  const leftEdge = screenBounds.x + 10
  if (x < leftEdge) {
    x = leftEdge
  }
  
  // Vertical position
  let y
  if (showAbove) {
    // Show ABOVE: settings bottom edge at header top edge
    y = hb.y - settingsH - gap
  } else {
    // Show BELOW (DEFAULT): settings top edge at header bottom edge
    y = hb.y + hb.height + gap
  }
  
  // Final clamp
  const rightEdge = screenBounds.x + screenBounds.width - 10
  const minX = leftEdge
  const maxX = rightEdge - settingsW
  const minY = work.y + 10
  const maxY = work.y + work.height - settingsH - 10
  
  x = Math.max(minX, Math.min(x, maxX))
  y = Math.max(minY, Math.min(y, maxY))
  
  layout.settings = { x: Math.round(x), y: Math.round(y), width: settingsW, height: settingsH }
  console.log(`[layoutChildWindows] 📐 Settings: showAbove=${showAbove}, x=${x}, y=${y}`)
}
```

---

## IMMEDIATE ACTION ITEMS

1. **Add extensive logging** to diagnose why clamping isn't working
2. **Run EVIA in dev mode** and watch console logs while dragging
3. **Check if `win:moveHeaderTo` is being called** at all
4. **Verify screen bounds values** are correct
5. **Test with single display** vs multiple displays

---

## QUESTIONS FOR NEXT AGENT

1. Is `win:moveHeaderTo` being called during drag? (Check console logs)
2. What are the actual screen bounds values? (Log `display.bounds` and `display.workArea`)
3. Is `clampBounds()` returning the correct values? (Log input vs output)
4. Is `header.setBounds()` actually setting the bounds? (Log before/after)
5. Are there any errors in the console during drag?

---

## RISK ASSESSMENT

**Current State**: CRITICAL - Core functionality broken
**User Impact**: SEVERE - Cannot use EVIA properly, windows go off-screen
**Deployment Status**: BLOCKED - Must fix before deploying

---

## RECOMMENDATION

**DO NOT DEPLOY** until these issues are resolved. The current state is worse than before the "fixes" were applied.

**Next Steps**:
1. Revert to last known working state if necessary
2. Add comprehensive logging
3. Test in dev mode with console open
4. Fix issues one by one with verification at each step
5. Create minimal reproducible test case

---

**Report Created**: 2025-11-03 12:00
**Status**: CRITICAL FAILURES
**Priority**: P0 - IMMEDIATE FIX REQUIRED
**Estimated Fix Time**: 2-4 hours with proper debugging

---


