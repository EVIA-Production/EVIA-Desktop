# 🎯 TEST CRITICAL FIX: Arrow Key Resize

## ⚡ Quick Test (2 minutes)

### Start App
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run dev
```

---

### THE TEST

1. **Open Ask** → Press Cmd+Enter

2. **Ask a question** → Type "What is 2+2?" and press Enter

3. **Wait for full response** → You should see complete answer

4. **✅ CHECK**: Ask window sized to fit response (NOT just input bar)

5. **Press Cmd+Up** → Move EVIA up

6. **🔴 CRITICAL CHECK**: 
   - ✅ **PASS**: Ask window STAYS LARGE, response still visible
   - ❌ **FAIL**: Ask window shrinks, response hidden (same as photo you sent)

7. **Press Cmd+Down, Cmd+Left, Cmd+Right** → Move EVIA around

8. **✅ CHECK**: Ask window ALWAYS maintains size, response always visible

---

## Expected Behavior

**BEFORE Fix** (what you experienced):
```
Ask question → See response ✅
Press arrow key → Response disappears ❌
(Ask shrinks to just input bar - the photo you sent)
```

**AFTER Fix** (what should happen now):
```
Ask question → See response ✅
Press arrow key → Response STAYS VISIBLE ✅
Press more arrows → Response STILL VISIBLE ✅
```

---

## Console Logs to Watch

Open DevTools (Ask window) and watch for:

**When you ask the question**:
```
[AskView] 📏 ResizeObserver (debounced): 100px → 350px (delta: 250px) [STORED]
```

**When you press arrow keys**:
```
[AskView] 🔧 Restoring content height: 100px → 350px (arrow key movement detected)
```

**Good sign**: You see "Restoring content height" every time you press arrow keys  
**Bad sign**: You see nothing when pressing arrows (fix not working)

---

## Visual Check

**After asking "What is 2+2?"**:

✅ **CORRECT** (Ask should look like this):
```
┌─────────────────────────────────┐
│  EVIA-Antwort               [X] │
├─────────────────────────────────┤
│  Input: [What is 2+2?        ] │
│                                 │
│  Response:                      │
│  The answer is 4.               │
│                                 │  ← Window expands to fit response
│                                 │
│  TTFT: 234ms ✓                 │
└─────────────────────────────────┘
```

❌ **INCORRECT** (what was happening before):
```
┌─────────────────────────────────┐
│  EVIA-Antwort               [X] │  ← Only this visible
└─────────────────────────────────┘
(Response hidden below window - the red box in your photo)
```

---

## Result Form

```
Test: Arrow Key Resize Fix

1. Ask opens with full response visible:     [ ] YES  [ ] NO
2. After Cmd+Up, response still visible:     [ ] YES  [ ] NO
3. After Cmd+Down, response still visible:   [ ] YES  [ ] NO
4. After Cmd+Left, response still visible:   [ ] YES  [ ] NO
5. After Cmd+Right, response still visible:  [ ] YES  [ ] NO

Console shows "Restoring content height":    [ ] YES  [ ] NO

OVERALL: [ ] PASS (all YES)  [ ] FAIL (any NO)
```

---

## If It Still Fails

**Check**:
1. Did you run `npm run dev` in `/EVIA-Desktop`? (not root EVIA folder)
2. Do you see the new console logs in DevTools?
3. Is DevTools open for the Ask window (not header)?

**Send me**:
- Screenshot of Ask window after pressing arrow key
- Console logs from Ask window DevTools

---

**This is THE critical fix for your arrow key issue!** 🎯  
**Test it now and let me know if the response stays visible!** ✅

