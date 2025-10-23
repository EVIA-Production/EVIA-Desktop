# 🧪 TEST GUIDE - Ultra-Deep Fixes

**Commit**: `0c49e38` on `prep-fixes/desktop-polish`  
**Fixes**: Ask expansion + Listen/Ask spacing  
**Duration**: 5 minutes

---

## ⚡ QUICK TEST

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run dev
```

---

## TEST 1: Ask Window Expansion (2 min) ✅

### Problem (Before):
- Long German responses cut off at ~400px
- User had to scroll to see full answer
- Window didn't expand

### Fix:
- Now uses `scrollHeight` (full content) like Glass
- Window expands up to 700px automatically

### How to Test:

1. **Open Ask**: Press `Cmd+Enter`

2. **Ask a long German question**:
   ```
   Erkläre mir ausführlich, was passiert, wenn ich den Listen Button drücke, was die Insights sind, und wie ich EVIA am besten verwenden kann. Bitte sei sehr detailliert.
   ```

3. **Wait for full response**

4. **✅ VERIFY**:
   - Window grows smoothly as text appears
   - All text visible without scrolling (if < 700px)
   - No cut-off content
   - Console shows: `[AskView] 📏 Measuring content: visible=XXpx, scroll=YYYpx`

5. **If scroll > visible**:
   - ✅ **BEFORE FIX**: Window stayed at ~400px (scroll hidden)
   - ✅ **AFTER FIX**: Window expands to `scroll` value

---

## TEST 2: Listen/Ask Spacing (2 min) ✅

### Problem (Before):
- User reported "slight overlap"
- 8px gap was too tight

### Fix:
- Increased gap from 8px to 12px (50% wider)

### How to Test:

1. **Open Ask first**: Press `Cmd+Enter`

2. **Then open Listen**: Press `Cmd+K` or click "Listen" button

3. **✅ VERIFY**:
   - Listen appears to the LEFT of Ask
   - Clear visible gap between windows
   - No overlapping edges
   - Gap looks wider than before (~12px)

4. **Visual Check**:
   - ✅ Windows don't touch
   - ✅ Clean separation
   - ✅ Professional appearance

---

## TEST 3: Arrow Keys (1 min) ✅

### Verify Previous Fix Still Works:

1. **With Ask window showing content**:
   - Press `Cmd+Up` (move up)
   - Press `Cmd+Down` (move down)
   - Press `Cmd+Left` (move left)
   - Press `Cmd+Right` (move right)

2. **✅ VERIFY**:
   - Ask window maintains its size
   - No "zap" or resize flash
   - Content fully visible after move
   - Smooth movement

---

## 📊 EXPECTED CONSOLE OUTPUT

### Ask Window Expansion:

```
[AskView] 📏 Measuring content: visible=250px, scroll=580px
[AskView] 📏 ResizeObserver (debounced): 100px → 585px (delta: 485px) [STORED]
```

**Explanation**:
- `visible=250px`: What contentRect.height shows (clamped by CSS)
- `scroll=580px`: Actual full content height
- Window resizes to `585px` (580 + 5px padding)

---

## 🐛 IF SOMETHING DOESN'T WORK

### Ask Still Cut Off:

**Check**:
```bash
# In DevTools Console:
document.querySelector('.ask-container').scrollHeight
```

**Expected**: Should match window.innerHeight (within 5px)

**If not**: 
- Clear cache: `Cmd+Shift+R`
- Restart app
- Check console for errors

---

### Windows Still Overlap:

**Check**:
```bash
# In Main Process Console (terminal):
# Look for:
[layoutChildWindows] 📐 ask bounds: { x: ..., y: ..., width: ..., height: ... }
[layoutChildWindows] 📐 listen bounds: { x: ..., y: ..., width: ..., height: ... }
```

**Calculate gap**:
```
gap = askBounds.x - (listenBounds.x + listenBounds.width)
```

**Expected**: `gap >= 12`

**If < 12**:
- Restart app (state might be cached)
- Check PAD value in overlay-windows.ts (should be 12)

---

## ✅ SUCCESS CRITERIA

All tests pass if:

- [ ] Ask window expands for long responses (up to 700px)
- [ ] No scrolling needed for content < 700px
- [ ] Clear 12px gap between Listen and Ask
- [ ] No visual overlap
- [ ] Arrow keys don't cause resize (previous fix still works)
- [ ] Console shows correct measurements

---

## 📋 PENDING ITEMS

### Settings Glass-Parity:

**Status**: Waiting for user decision

**Options**:
1. **Minimal** (~150 lines): App title, account info, shortcuts, language, logout, quit
2. **Current** (353 lines): Keep existing complexity
3. **Full Glass** (1462 lines): Match Glass exactly (not recommended)

**User**: Please specify which approach you want

---

## 📸 VISUAL REFERENCE

### Ask Expansion:

**Before**:
```
┌─────────────────────┐
│ Ask Window          │
│                     │
│ Question: ...       │
│                     │
│ Answer: ...         │ ← Content cut here (400px)
│ [scrollbar visible] │
└─────────────────────┘
```

**After**:
```
┌─────────────────────┐
│ Ask Window          │
│                     │
│ Question: ...       │
│                     │
│ Answer: ...         │
│ ... more content    │
│ ... all visible     │
│ ... up to 700px     │
│                     │
└─────────────────────┘
```

---

### Listen/Ask Spacing:

**Before** (8px):
```
┌─────┐  ┌─────┐
│     │ 8│     │  ← Tight gap
│     │  │     │
└─────┘  └─────┘
Listen   Ask
```

**After** (12px):
```
┌─────┐    ┌─────┐
│     │ 12 │     │  ← Clear gap
│     │    │     │
└─────┘    └─────┘
Listen     Ask
```

---

**Ready to test!** 🚀

**All fixes pushed to GitHub** ✅  
**Branch**: `prep-fixes/desktop-polish`  
**Commit**: `0c49e38`

