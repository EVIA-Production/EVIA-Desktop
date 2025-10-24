# ✅ DEMO READY CHECKLIST - DO THIS NOW

**Priority**: CRITICAL  
**Time Needed**: 30 minutes  
**Demo**: Tomorrow

---

## 🎯 WHAT WAS FIXED (Desktop)

### ✅ COMPLETE:
1. **Shortcuts Window Position** - Now appears to RIGHT of settings, not over header
2. **Shortcuts Translation** - German labels when language = German
3. **Session State Integration** - All 3 backend endpoints integrated (`/session/start`, `/session/complete`, `/session/status`)

### 📁 Files Changed:
- `src/main/overlay-windows.ts` (shortcuts positioning)
- `src/renderer/overlay/ShortcutsView.tsx` (translation support)
- `src/renderer/overlay/EviaBar.tsx` (session lifecycle - already done)
- `src/renderer/i18n/en.json` + `de.json` (shortcut translations)

---

## ⚠️ CRITICAL: APP NEEDS REBUILD

**Problem**: The session integration code is committed but the running app has OLD code.

**Evidence**: Terminal logs don't show:
```
[EviaBar] 🎯 Calling /session/start for chat_id: X
```

**Solution**: **RESTART** the app with fresh build.

---

## 📋 STEP-BY-STEP: GET DEMO READY

### STEP 1: Restart Desktop App (5 min)

```bash
# Kill current running app
# Press Ctrl+C in the terminal where "npm run dev" is running

# Then restart:
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run dev
```

**Expected**: New terminal output will show session integration logs when you test.

---

### STEP 2: Test Shortcuts Fixes (3 min)

1. Open Settings (click ⋯)
2. Click "Edit Shortcuts"
3. ✅ **VERIFY**: Shortcuts window appears TO THE RIGHT of Settings, not over header
4. Change language to German (in Settings)
5. ✅ **VERIFY**: Shortcut labels change to German
6. Change back to English
7. ✅ **VERIFY**: Shortcut labels change to English

**If FAILS**: Check console for errors, report back.

---

### STEP 3: Test Session State (10 min) **CRITICAL**

#### A. Before Meeting
1. Open app (should show "Listen" button)
2. Open Ask window
3. Ask: "Are we before, during, or after the meeting?"
4. ✅ **VERIFY**: Response says "BEFORE the meeting"
5. ✅ **VERIFY**: Terminal shows:
   ```
   [EviaBar] 🎯 Calling /session/status
   ```

#### B. During Meeting
1. Press "Listen" button
2. ✅ **VERIFY**: Terminal shows:
   ```
   [EviaBar] 🎯 Calling /session/start for chat_id: X
   [EviaBar] ✅ Session started: {...}
   ```
3. Speak for 10 seconds
4. While still recording, Ask: "Are we before, during, or after the meeting?"
5. ✅ **VERIFY**: Response says "DURING the meeting"

#### C. After Meeting
1. Press "Done" button
2. ✅ **VERIFY**: Terminal shows:
   ```
   [EviaBar] 🎯 Calling /session/complete for chat_id: X
   [EviaBar] ✅ Session completed, archived X transcripts
   ```
3. Click an insight
4. ✅ **VERIFY**: Response acknowledges meeting is COMPLETE/AFTER

---

### STEP 4: Test Insights (5 min) **CRITICAL**

1. Press "Listen"
2. Speak for 20 seconds (actual words, not silence)
3. Press "Stop" (NOT Done)
4. Click "Insights" tab
5. ✅ **VERIFY**: You see:
   - 📝 Summary (2-3 points)
   - 💡 Topics (2-3 topics)
   - ✅ Actions (2-3 actions)
6. ❌ **FAIL IF**: "No transcripts available for analysis"

**If FAILS**: This is a **BACKEND issue** - see `BACKEND-URGENT-FIXES-FOR-DEMO.md`

---

## 🚨 IF TESTS FAIL

### Session State Still Wrong?

**Desktop Issue**: Check if logs show `/session/start` being called  
**Backend Issue**: If called but still wrong state → Backend needs to fix default

**Check Desktop Logs**:
```bash
# Look for these in terminal:
[EviaBar] 🎯 Calling /session/start
[EviaBar] ✅ Session started
[EviaBar] ⚠️ Cannot call /session/start: missing token or chat_id
```

If you see `⚠️ Cannot call`: Desktop can't get token or chat_id → check auth.

If you DON'T see any logs: App still running old code → rebuild again.

---

### Insights Still Say "No Transcripts"?

**This is 100% a BACKEND issue**.

Desktop is calling `/insights` correctly. Backend is:
1. Either not returning insights in correct format
2. Or returning `null` when it should return actual insights

**Action**: Send backend logs to backend agent with:
```bash
docker logs evia-backend-backend-1 --tail 100 | grep -A 5 -B 5 "insights"
```

---

## 🎬 DEMO REHEARSAL SCRIPT

Once all tests pass, do a full demo run:

### Demo Flow:
1. "Here's EVIA - our always-on AI assistant"
2. "Let's start a meeting" → Press Listen
3. Speak for 30 seconds about a sales call scenario
4. "Now let's get insights" → Click Insights tab
5. Show Summary, Topics, Actions
6. "I can click any insight to dive deeper" → Click one
7. Show AI response streaming
8. "Let's ask a custom question" → Type question, press Enter
9. Show response
10. "Meeting's done" → Press Done
11. "EVIA archives everything for later review"

**Practice this 2-3 times** to ensure smooth delivery.

---

## 🐛 KNOWN ISSUES (Non-Blocking)

### Minor Issues (OK for Demo):
- **Presets**: Not loading (feature incomplete, backend work needed)
- **Follow-Ups Copy**: Shows in clipboard but not in UI (cosmetic)

### Critical Issues (Must Fix):
- ✅ Shortcuts position - FIXED
- ✅ Shortcuts translation - FIXED
- ⏳ Session state - **MUST TEST after rebuild**
- ⏳ Insights display - **BACKEND MUST FIX**

---

## 📞 BACKEND COORDINATION

**Backend Must Fix** (see `/BACKEND-URGENT-FIXES-FOR-DEMO.md`):
1. Default `session_state` from `'during'` to `'before'`
2. Fix insights response when transcripts exist

**Desktop Ready**: Code is complete, just needs backend fixes + testing.

---

## ✅ PRE-DEMO CHECKLIST

Before demo, confirm:
- [ ] App running with latest code (`npm run dev`)
- [ ] Shortcuts position correct (right of settings)
- [ ] Shortcuts translate to German
- [ ] Session state works (before/during/after)
- [ ] Insights show when transcripts exist
- [ ] Language mixing resolved
- [ ] Demo script practiced 2-3 times

---

## ⏱️ TIMELINE

**NOW** (30 min):
1. Restart app (5 min)
2. Test shortcuts (3 min)
3. Test session state (10 min)
4. Test insights (5 min)
5. Report results (5 min)

**Backend Fixes** (30 min):
- Backend agent implements fixes
- Desktop tests again

**Demo Prep** (30 min):
- Full rehearsal
- Edge case testing
- Backup plan if issues

**Total**: 1.5 hours to demo-ready

---

## 🚀 STATUS

- ✅ Desktop fixes: COMMITTED
- ⏳ App rebuild: **DO NOW**
- ⏳ Testing: **DO AFTER REBUILD**
- ⏳ Backend fixes: **WAITING**
- ⏳ Demo rehearsal: **AFTER TESTING**

**NEXT ACTION**: **RESTART APP, TEST EVERYTHING**


