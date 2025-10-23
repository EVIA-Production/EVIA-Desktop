# 🎯 TEST: No "Zap" on Arrow Keys

## ⚡ 60 Second Test

### Start
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run dev
```

---

### THE TEST

1. **Open Ask** → Press Cmd+Enter

2. **Ask a question** → "What is 2+2?" and press Enter

3. **Wait for response** → See full answer (window grows to fit)

4. **Press Cmd+Up 3 times** → Move EVIA up

5. **🎯 CRITICAL CHECK**:
   - ❌ **BEFORE FIX**: Window "zaps" (shrinks then grows) on each arrow press
   - ✅ **AFTER FIX**: Window just moves smoothly, NO resize/zap

6. **Press Cmd+Down, Cmd+Left, Cmd+Right** → Move around

7. **✅ VERIFY**: Smooth movement, no "zap" on any direction

---

## Visual Comparison

### ❌ BEFORE (What You Experienced)

```
Press Cmd+Up
  → Window briefly shrinks to input bar
  → Window immediately grows back
  → Visual "zap" or flicker
  → Looks janky
```

### ✅ AFTER (What Should Happen Now)

```
Press Cmd+Up
  → Window just moves up smoothly
  → No size change at all
  → Looks professional
```

---

## Console Check (Optional)

**Open DevTools → Console (Ask window)**

**When you ask the question** (normal):
```
[AskView] 📏 ResizeObserver (debounced): 100px → 350px [STORED]
```

**When you press arrow keys** (should be SILENT):
```
(No logs = good! Height preserved correctly)
```

**If you see THIS, something is wrong**:
```
[AskView] ⚠️ UNEXPECTED: Height mismatch detected, restoring: 58px → 350px
```

---

## Result

```
Test: Arrow Key "Zap" Fix

1. Ask window grows for response:           [ ] YES  [ ] NO
2. Cmd+Up moves smoothly (no zap):          [ ] YES  [ ] NO  
3. Cmd+Down moves smoothly (no zap):        [ ] YES  [ ] NO
4. Cmd+Left moves smoothly (no zap):        [ ] YES  [ ] NO
5. Cmd+Right moves smoothly (no zap):       [ ] YES  [ ] NO
6. No "⚠️ UNEXPECTED" in console:           [ ] YES  [ ] NO

OVERALL: [ ] PASS (all YES)  [ ] FAIL (any NO)
```

---

## What Changed

**Technical**: `layoutChildWindows()` now preserves Ask window's current height instead of resetting to default (58px).

**User Experience**: 
- BEFORE: Visible "zap" on every arrow press ❌
- AFTER: Smooth movement, no resize ✅

---

**This eliminates the ugly "zap"!** 🎯  
**Test it and let me know if movement is smooth!** ✅

