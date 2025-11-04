# 🎯 Production Mode Testing Checklist

**Build Complete**: All critical fixes applied and production app built.

---

## 🚀 **START PRODUCTION APP**

```bash
open /Users/benekroetz/EVIA/EVIA-Desktop/dist/mac-arm64/EVIA.app
```

---

## ✅ **CRITICAL FIXES TO VERIFY**

### **1. Header Visibility (CRITICAL)**
- [ ] Header visible on app startup
- [ ] Click "Listen" button
- [ ] **Header stays visible** (does NOT disappear) ✅
- [ ] Click "Ask" button
- [ ] **Header still visible** ✅
- [ ] Both windows open, **header still visible** ✅

**Status**: Should be FIXED ✅  
**Root Cause Fixed**: Added `eviaIpc.off` method to preload, proper listener cleanup

---

### **2. Auto-Focus on Ask Window**
- [ ] Press `Cmd+Enter` or click "Ask" button
- [ ] Ask window opens
- [ ] **Input field is auto-focused** (cursor blinking in input) ✅
- [ ] Close Ask window (`Cmd+W` or toggle off)
- [ ] Reopen Ask window
- [ ] **Input field auto-focused again** ✅

**Status**: Should be FIXED ✅  
**Root Cause Fixed**: Added `win.focus()` in `overlay-windows.ts`

---

### **3. Window Positioning**
- [ ] Open Listen window only
- [ ] **Listen window centered under header** ✅
- [ ] Open Ask window (both visible now)
- [ ] **Both windows centered as a group under header** ✅
- [ ] **Listen window does NOT jump to far left** ✅

**Status**: Should be FIXED ✅  
**Root Cause Fixed**: Center entire group (Listen + Gap + Ask) instead of just Ask

---

### **4. Rate Limit Error Handling**
- [ ] Open Ask window
- [ ] Type a question and press Enter
- [ ] If rate limit error occurs, **user-friendly message shows** (not raw JSON)
- [ ] Message should say something like "Rate limit reached, please try again"

**Status**: Should be FIXED ✅  
**Root Cause Fixed**: Backend yields generic error, frontend detects and displays friendly message

---

### **5. Transcription (Backend Required)**
- [ ] Start backend API (`cd EVIA-Backend && source .venv/bin/activate && uvicorn backend.main:app --reload`)
- [ ] In EVIA app, click "Listen"
- [ ] **Speak into microphone**
- [ ] **Transcription appears in Listen window** ✅
- [ ] **Timer increments** (00:01, 00:02, etc.) ✅

**Status**: Needs backend running to test

---

### **6. App Quit (Cmd+Q)**
- [ ] Press `Cmd+Q`
- [ ] **App quits cleanly** ✅
- [ ] Check terminal for any crash logs (should be none)

**Status**: Should be FIXED ✅  
**Root Cause Fixed**: Proper IPC cleanup prevents crashes on quit

---

## 🔧 **SMOOTH MOVEMENT (Advanced Testing)**

### **6a. Rapid Arrow Key Presses**
- [ ] Press and hold `Cmd+→` rapidly (or `Cmd+←`)
- [ ] **Windows move smoothly** (no teleporting) ✅

**Status**: Code in place, needs testing

---

### **6b. Right Edge Boundary**
- [ ] Press `Cmd+→` repeatedly until header reaches right edge
- [ ] **Header reaches the exact right edge** (no gap) ✅

**Status**: Code in place, needs testing

---

### **6c. Drag Beyond Screen**
- [ ] Drag header with mouse towards screen edge
- [ ] **Header stops at screen boundary** (cannot be dragged off-screen) ✅
- [ ] **Child windows reposition correctly** ✅

**Status**: Code in place, needs testing

---

## 🐛 **KNOWN ISSUES (Not Blocking)**

1. **Hold Arrow Key to Float**: Not implemented (low priority)
2. **Backend Connection Errors**: Expected if backend not running
3. **SystemAudioDump Permissions**: May prompt twice (normal behavior)

---

## 📝 **TESTING NOTES**

**After testing, report:**

1. Which tests **PASSED** ✅
2. Which tests **FAILED** ❌
3. Any new issues observed
4. Console logs if errors occur

---

## 🎯 **SUCCESS CRITERIA**

**Minimum for Production:**
- ✅ Header stays visible (critical #1-#3)
- ✅ App quits cleanly (#6)
- ✅ Transcription works with backend (#5)

**Nice to Have:**
- ✅ Smooth movement (#6a-#6c)
- ✅ Rate limit friendly errors (#4)

---

## 🚀 **NEXT STEPS AFTER SUCCESSFUL TEST**

If all critical tests pass:
1. ✅ Update `🚨-COORDINATOR-HANDOFF-CRITICAL.md` with test results
2. ✅ Deploy to production
3. ✅ Monitor for any issues

---

**Good luck! The header fix was the blocker, everything else should work now.** 🎯

