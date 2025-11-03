# 🧪 DIAGNOSTIC TEST WITH EXTENSIVE LOGGING

## Status: ULTRA MODE DEBUGGING APPLIED

All dragging and positioning code now has **extensive diagnostic logging** to find the root cause of the failures.

---

## What Was Changed

### 1. ✅ Added Extensive Logging to `win:moveHeaderTo`

Every drag event now logs:
- Input coordinates `(x, y)` from renderer
- Current header bounds before move
- Display bounds and workArea
- Requested bounds (input `x, y` + current `width, height`)
- Clamped bounds (after boundary enforcement)
- Actual bounds after `setBounds()` is called
- Whether `setBounds()` actually worked

### 2. ✅ Added Extensive Logging to `clampBounds()`

Every clamping operation now logs:
- Input bounds
- Calculated boundaries (minX, maxX, minY, maxY)
- Output bounds
- Whether clamping was applied

### 3. ✅ Throttled Mouse Move to 60fps

Prevented IPC queue overload by throttling `handleMouseMove` to call `moveHeaderTo` at most 60 times per second (every 16ms).

### 4. ✅ Fixed Settings Window Positioning

**Corrected logic** (from screenshot):
- **Default**: Settings RIGHT edge aligned with header RIGHT edge, BELOW header
- **Header at bottom**: Settings flips ABOVE header
- **Header too far right/left**: Settings shifts to stay on screen

**Before (WRONG)**:
```typescript
let x = hb.x + hb.width  // Settings LEFT edge at header RIGHT edge (wrong!)
```

**After (CORRECT)**:
```typescript
let x = hb.x + hb.width - settingsW  // Settings RIGHT edge at header RIGHT edge ✅
```

---

## How to Test

### Step 1: Start EVIA in Dev Mode with Console Open

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run dev
```

**IMPORTANT**: Keep the terminal visible to see console logs!

### Step 2: Test Dragging Header

1. **Drag header to the RIGHT** slowly with mouse
2. Watch the terminal for logs like:
   ```
   [EviaBar] 🖱️ Mouse move: requesting (1234, 56)
   [win:moveHeaderTo] 📥 Input: (1234, 56)
   [win:moveHeaderTo] 📊 Current header bounds: { x: 1200, y: 50, width: 421, height: 47 }
   [win:moveHeaderTo] 🖥️ Display bounds: { x: 0, y: 0, width: 1920, height: 1080 }
   [win:moveHeaderTo] 🖥️ Display workArea: { x: 0, y: 25, width: 1920, height: 1055 }
   [win:moveHeaderTo] 📐 Requested bounds: { x: 1234, y: 56, width: 421, height: 47 }
   [clampBounds] 📥 Input: (1234, 56), size: 421x47
   [clampBounds] 📏 Boundaries: minX=0, maxX=1499, minY=25, maxY=1033
   [clampBounds] 📤 Output: (1234, 56), clamped: x=false, y=false
   [win:moveHeaderTo] 🔒 Clamped bounds: { x: 1234, y: 56, width: 421, height: 47 }
   [win:moveHeaderTo] 📏 Clamping applied: x=false, y=false
   [win:moveHeaderTo] ✅ Actual bounds after setBounds: { x: 1234, y: 56, width: 421, height: 47 }
   ```

3. **Try to drag header OFF the right edge**
4. Watch for logs showing clamping:
   ```
   [EviaBar] 🖱️ Mouse move: requesting (1600, 56)
   [clampBounds] 📥 Input: (1600, 56), size: 421x47
   [clampBounds] 📏 Boundaries: minX=0, maxX=1499, minY=25, maxY=1033
   [clampBounds] 📤 Output: (1499, 56), clamped: x=true, y=false  ← SHOULD CLAMP HERE!
   [win:moveHeaderTo] ✅ Actual bounds after setBounds: { x: 1499, y: 56, width: 421, height: 47 }
   ```

5. **IF CLAMPING FAILS**: The logs will show:
   - Either `clampBounds()` is returning wrong values
   - OR `header.setBounds()` is not respecting the clamped values
   - OR `win:moveHeaderTo` is not being called at all

### Step 3: Test Settings Positioning

1. **Move header to MIDDLE of screen** (default position)
2. **Hover settings button** (3 dots on right side of header)
3. Settings should appear **BELOW header, RIGHT-ALIGNED** (red box in your screenshot)
4. Check terminal logs:
   ```
   [layoutChildWindows] 📐 Settings: showAbove=false, x=XXX, y=YYY, headerRight=ZZZ, settingsRight=ZZZ
   ```
   **Verify**: `headerRight` should equal `settingsRight` (right edges aligned)

5. **Move header to BOTTOM of screen** with arrow keys
6. **Hover settings button** again
7. Settings should **FLIP ABOVE** header
8. Check logs:
   ```
   [layoutChildWindows] 📐 Settings: showAbove=true, x=XXX, y=YYY, ...
   ```

### Step 4: Test Child Windows During Drag

1. **Open Ask window** (`Cmd+Enter`)
2. **Drag header with mouse** to different positions
3. Watch for logs showing `layoutChildWindows()` being called continuously
4. Verify Ask window follows header smoothly (no "appearing in borders")

---

## What to Report

### If Dragging Off-Screen STILL Happens:

Report these logs:
1. The last `[EviaBar] 🖱️ Mouse move` log before it went off-screen
2. The corresponding `[win:moveHeaderTo]` logs
3. The `[clampBounds]` logs showing boundaries and output
4. Whether `setBounds()` log shows clamping was applied

### If Settings Positioning is STILL Wrong:

Report:
1. Screenshot showing where settings appears
2. The `[layoutChildWindows] 📐 Settings:` log
3. The values of `headerRight` and `settingsRight` in the log

### If Child Windows Don't Reposition During Drag:

Report:
1. Whether `layoutChildWindows()` logs appear during drag
2. How often they appear (should be ~60 times per second)

---

## Expected Diagnostic Output

### Successful Clamping (Header Hits Right Edge)

```
[EviaBar] 🖱️ Mouse move: requesting (1600, 50)
[win:moveHeaderTo] 📥 Input: (1600, 50)
[clampBounds] 📥 Input: (1600, 50), size: 421x47
[clampBounds] 📏 Boundaries: minX=0, maxX=1499, minY=25, maxY=1033
[clampBounds] 📤 Output: (1499, 50), clamped: x=true, y=false  ✅ CLAMPED!
[win:moveHeaderTo] 🔒 Clamped bounds: { x: 1499, y: 50, width: 421, height: 47 }
[win:moveHeaderTo] ✅ Actual bounds after setBounds: { x: 1499, y: 50, width: 421, height: 47 }
```

### Failed Clamping (Bug - Header Goes Off-Screen)

```
[EviaBar] 🖱️ Mouse move: requesting (1600, 50)
[win:moveHeaderTo] 📥 Input: (1600, 50)
[clampBounds] 📥 Input: (1600, 50), size: 421x47
[clampBounds] 📏 Boundaries: minX=0, maxX=1499, minY=25, maxY=1033
[clampBounds] 📤 Output: (1499, 50), clamped: x=true, y=false  ✅ Clamping looks correct
[win:moveHeaderTo] 🔒 Clamped bounds: { x: 1499, y: 50, width: 421, height: 47 }
[win:moveHeaderTo] ✅ Actual bounds after setBounds: { x: 1600, y: 50, width: 421, height: 47 }  ❌ BUG! setBounds() ignored clamped value!
[win:moveHeaderTo] ❌ setBounds FAILED! Expected (1499, 50), got (1600, 50)
```

### Correct Settings Positioning

```
[layoutChildWindows] 📐 Settings: showAbove=false, x=1058, y=97, headerRight=1479, settingsRight=1298
```
**Bug**: `headerRight` (1479) ≠ `settingsRight` (1298) → Not aligned!

**Fixed**:
```
[layoutChildWindows] 📐 Settings: showAbove=false, x=1239, y=97, headerRight=1479, settingsRight=1479
```
**Correct**: `headerRight` (1479) === `settingsRight` (1479) → ✅ Aligned!

---

## Analysis Plan

Based on the logs, we can determine:

### Scenario A: `clampBounds()` Returns Wrong Values
- **Symptom**: Logs show `maxX` is too small (not at screen edge)
- **Fix**: Adjust boundary calculation in `clampBounds()`

### Scenario B: `header.setBounds()` Ignores Clamped Values
- **Symptom**: Logs show clamped values are correct, but actual bounds after `setBounds()` are different
- **Fix**: Electron bug? Try alternative approach (e.g., native `movable: false` + custom drag)

### Scenario C: `win:moveHeaderTo` Not Being Called
- **Symptom**: No logs from `win:moveHeaderTo` appear during drag
- **Fix**: IPC bridge issue in preload or renderer not calling correctly

### Scenario D: Child Windows Don't Reposition
- **Symptom**: `layoutChildWindows()` logs don't appear during drag
- **Fix**: Add explicit call or use different hook

---

## Next Steps

1. **Run the test** and collect logs
2. **Report findings** with specific log excerpts
3. **I will analyze** and apply targeted fix based on evidence
4. **Iterate** until all issues are resolved

---

**Status**: ⏳ AWAITING USER TEST WITH DIAGNOSTIC LOGS
**Build**: ✅ Successful
**Linter**: ✅ Clean
**Logging**: ✅ Extensive diagnostic output enabled

---

🔬 **Start testing with**: `cd /Users/benekroetz/EVIA/EVIA-Desktop && npm run dev`

