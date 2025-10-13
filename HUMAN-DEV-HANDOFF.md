# 🔴 HUMAN DEVELOPER HANDOFF - Remaining Issues

**Date:** 2025-10-12  
**Your Task:** Fix the issues listed below

---

## 📍 CURRENT BRANCHES

**Frontend (EVIA-Desktop):**
```
Branch: staging-unified-v2
Commit: 129985e
Status: Pushed to GitHub
```

**Backend (EVIA-Backend):**
```
Branch: backend-mvp-finish
Commit: 16a61e9
Status: Pushed to GitHub
```

**To Get Latest:**
```bash
# Frontend
cd EVIA-Desktop
git checkout staging-unified-v2
git pull origin staging-unified-v2

# Backend
cd EVIA-Backend
git checkout backend-mvp-finish
git pull origin backend-mvp-finish
docker-compose up  # Restart backend
```

---

## 🔴 CRITICAL ISSUES (ALL BROKEN)

### **Issue 1: English Transcription Shows German**
**What Happens:**
- User sets language to "English" in Settings
- User clicks "Listen" and speaks English
- Transcript appears in **German** (wrong!)

**Expected:**
- Transcript should be in **English**

**Where to Fix:**
- **Backend:** `EVIA-Backend/backend/api/routes/websocket.py` line ~277-287
- The code checks `if dg_lang:` but then might not apply it correctly
- Frontend IS sending `&lang=en` in WebSocket URL (verified)
- Backend IS NOT using it (logs show it defaults to German)

**How to Verify:**
```bash
# Check backend logs while testing
docker logs evia-backend-backend-1 --tail 50 | grep '\[LANG\]'

# Should show:
# [LANG] Query param override: en (was: de)  ← If this appears, backend is working
# [LANG] FINAL language for Deepgram: en     ← Should be 'en' not 'de'
```

**If backend logs show `de` instead of `en`, the fix didn't work.**

---

### **Issue 2: Ask Input in German When Set to English**
**What Happens:**
- User sets language to "English"
- User types question in Ask window
- Response is in **German** (wrong!)

**Expected:**
- Response should be in **English**

**Where to Fix:**
- Same as Issue 1 - it's the language parameter problem

---

### **Issue 3: Groq Thinks User Query Is From Prospect**
**What Happens:**
- User has transcript: "Prospect: I want pricing. You: Sure!"
- User types in Ask bar: "What are their concerns?"
- Groq responds as if the PROSPECT asked the question (wrong!)

**Expected:**
- Groq should understand the question is FROM the user ABOUT the prospect

**Where to Fix:**
- **Backend:** `EVIA-Backend/backend/api/services/groq_service.py` line ~188-224
- The prompt needs to separate transcript from user query like this:

```python
# CORRECT FORMAT:
"""
Context from meeting:
[TRANSCRIPT START]
Prospect: I want pricing
You: Sure, let me explain
[TRANSCRIPT END]

User's Question: What are their concerns?
"""

# NOT like this (WRONG):
"""
Prospect: I want pricing
You: Sure, let me explain
User's Question: What are their concerns?
"""
```

**How to Verify:**
- Type a question in Ask window after getting a transcript
- Check if response talks about "their concerns" vs "your concerns"
- If Groq says "your concerns", it thinks user IS the prospect (wrong)

---

### **Issue 4: German Transcription Stops After a Few Segments**
**What Happens:**
- User speaks German
- First few transcripts appear
- Then backend stops logging and closes connection

**Expected:**
- Transcription should continue until user clicks "Stop"

**Where to Fix:**
- **Backend:** `EVIA-Backend/backend/api/routes/websocket.py` line ~787-992
- Check if timeout is causing early disconnect
- Should be 300s timeout with 25s keepalive pings

**How to Verify:**
```bash
# Check backend logs for timeout
docker logs evia-backend-backend-1 --tail 50 | grep -i timeout

# Should NOT show "WebSocket receive timeout" until user stops
```

---

### **Issue 5: Singularity Animation Not Working**
**What Happens:**
- User clicks "English" in Settings
- Header changes instantly (no animation)

**Expected:**
- Header should shrink to tiny point (500ms)
- Then expand with English text (500ms)
- Total: 1 second smooth animation

**Where to Fix:**
- **Frontend:** `EVIA-Desktop/src/renderer/overlay/overlay-entry.tsx` line ~42-90
- Animation uses `document.querySelector('.evia-main-header')`
- Might not find the element (header is in different window)

**How to Verify:**
```bash
# Open DevTools in Settings window
# Look for console logs:
[OverlayEntry] 🌀 Starting singularity animation...
[OverlayEntry] ✅ Singularity animation complete

# If missing, animation didn't run
```

**Possible Fix:**
The Settings window can't animate the Header window (different process). Animation needs to be in the Header window itself, not Settings window.

---

### **Issue 6: Windows Don't Close on Language Toggle**
**What Happens:**
- User clicks "English" in Settings
- Listen and Ask windows stay open (wrong!)

**Expected:**
- Listen window should close
- Ask window should close
- Settings window stays open

**Where to Fix:**
- **Frontend:** `EVIA-Desktop/src/renderer/overlay/overlay-entry.tsx` line ~33-40
- Code calls `eviaWindows.hide('listen')` and `eviaWindows.hide('ask')`
- Might not be working because Settings window can't control other windows

**Possible Fix:**
The language toggle needs to send IPC message to main process, which then closes the windows.

---

## 🔧 TESTING CHECKLIST

After fixes, test in this order:

```
1. Start backend: cd EVIA-Backend && docker-compose up

2. Install frontend: open dist/EVIA Desktop-0.1.0-arm64.dmg

3. Test Language Toggle:
   ✅ Settings → Click "English"
   ✅ Header should animate (shrink/expand)
   ✅ Listen window should close
   ✅ Ask window should close
   ✅ Settings stays open

4. Test English Transcription:
   ✅ Close Settings
   ✅ Click "Listen"
   ✅ Speak English
   ✅ Transcript should be in English (not German)

5. Test Ask Context:
   ✅ After transcript, click an insight
   ✅ Ask window opens
   ✅ Type: "What are their main concerns?"
   ✅ Response should treat "their" as prospect (not user)

6. Test Timeout:
   ✅ Start Listen, don't speak for 1 minute
   ✅ Connection should stay alive (no disconnect)

7. Check Backend Logs:
   docker logs evia-backend-backend-1 --tail 100 | grep '\[LANG\]'
   
   Should show:
   [LANG] Query param override: en (was: de)  ✅
   [LANG] FINAL language for Deepgram: en    ✅
```

---

## 📊 QUICK DIAGNOSIS

**If English transcription still German:**
→ Backend is NOT using the `lang` parameter from WebSocket URL
→ Fix: `EVIA-Backend/backend/api/routes/websocket.py` line ~277-287

**If Groq confuses user/prospect:**
→ Backend prompt doesn't separate transcript from query
→ Fix: `EVIA-Backend/backend/api/services/groq_service.py` line ~188-224

**If animation doesn't work:**
→ Settings window can't animate Header window (different processes)
→ Fix: Move animation to Header window, trigger via IPC

**If windows don't close:**
→ Settings window can't close other windows (different processes)
→ Fix: Send IPC to main process to close windows

---

## 📁 KEY FILES TO CHECK

**Backend:**
```
EVIA-Backend/backend/api/routes/websocket.py
EVIA-Backend/backend/api/services/groq_service.py
```

**Frontend:**
```
EVIA-Desktop/src/renderer/overlay/overlay-entry.tsx
EVIA-Desktop/src/main/overlay-windows.ts
```

**Logs:**
```bash
# Backend logs
docker logs evia-backend-backend-1 --tail 100

# Look for:
[LANG] Query param override: en    ← Should appear when lang=en
[LANG] FINAL language: en          ← Should show 'en' not 'de'
[PROMPT] Formatted with context    ← Should appear for Ask requests
```

---

## 🎯 PRIORITY ORDER

1. **CRITICAL:** Fix language parameter (Issues #1, #2)
   - Backend must use `lang` from WebSocket URL
   - This blocks all English transcription

2. **HIGH:** Fix Ask prompt context (Issue #3)
   - Backend must separate transcript from user query
   - This causes wrong responses

3. **MEDIUM:** Fix timeout (Issue #4)
   - Backend should use 300s timeout
   - This causes early disconnects

4. **LOW:** Fix animations (Issues #5, #6)
   - Frontend IPC architecture issue
   - Not blocking, just UX

---

## 💬 QUESTIONS TO ASK YOURSELF

1. **Is backend actually running with the new code?**
   ```bash
   cd EVIA-Backend
   git log --oneline -1  # Should show: 16a61e9
   docker-compose restart
   ```

2. **Are backend logs showing the new code paths?**
   ```bash
   docker logs evia-backend-backend-1 | grep '\[LANG\]'
   docker logs evia-backend-backend-1 | grep '\[PROMPT\]'
   ```

3. **Is frontend sending the lang parameter?**
   Open DevTools → Network → WS → Check URL contains `&lang=en`

---

## 📞 CONTACT POINTS

**If stuck:**
1. Check `BACKEND_TRANSCENDED_REPORT.md` (backend fixes explained)
2. Check `DESKTOP-ASCENDED-REPORT.md` (frontend integration explained)
3. Run `python3 test-desktop-ascended.py` (automated tests)

**Most likely issue:**
Backend code changes exist but aren't being executed because:
- Docker container running old code (restart needed)
- Wrong branch checked out (should be `backend-mvp-finish`)

---

**Good luck! Focus on Issue #1 first (language parameter). That's the blocker. 🚀**

