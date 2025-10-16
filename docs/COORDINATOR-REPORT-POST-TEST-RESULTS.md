
# 🔴 Coordinator Report: Post-Testing Critical Analysis

**Date:** 2025-10-12  
**Build:** EVIA Desktop-0.1.0-arm64.dmg (Post V2 Fixes)  
**Status:** 🔴 CRITICAL - Fixes Did Not Resolve Core Issues

---

## 📊 Test Results Summary

| Feature | Expected | Actual | Status |
|---------|----------|--------|--------|
| English Transcription | English | **German** | ❌ FAIL |
| English Insights | English | English | ✅ PASS |
| Insight Click → Ask Output | Visible response | **No output (swallowed)** | ❌ FAIL |
| Manual Ask (Cmd+Enter) | Visible response | **Unknown** (not tested) | ⚠️ PENDING |
| Settings Functionality | Enhanced | Basic (old) | ❌ FAIL (Expected) |

**Critical Failure Rate: 66% (2/3 core features broken)**

---

## 🔍 Deep Dive Analysis

### Issue 1: English Transcription → German Output

**Symptoms:**
- User sets language to English in Settings
- Starts Listen session
- Transcription appears in **German** (not English)
- BUT: Insights correctly appear in **English**

**What This Tells Us:**

1. **Frontend Language Setting Works:**
   - Evidence: Insights are in English
   - `fetchInsights()` correctly uses `i18n.getLanguage()`
   - Language state is propagating correctly

2. **WebSocket Language Parameter Issue:**
   ```typescript
   // Code in websocketService.ts:
   const currentLang = i18n.getLanguage() || 'de';
   const wsUrl = `${wsBase}/ws/transcribe?chat_id=${chatId}&token=${token}&source=${source}&lang=${currentLang}`;
   ```
   
   **Hypothesis A: i18n.getLanguage() returns wrong value at WebSocket connection time**
   - Possible: Language change happens AFTER WebSocket connects
   - Need to verify: When does WebSocket connect vs. when does language change?
   - Test: Check console logs for `[WS] 🌐 Connecting with language:`

   **Hypothesis B: Backend ignores `lang` parameter**
   - Evidence: Insights work (they use same backend)
   - Counter-evidence: WebSocket might use different endpoint logic
   - Need to verify: Backend WebSocket endpoint implementation

   **Hypothesis C: Language change doesn't reconnect WebSocket**
   - Current flow: Change language → Reload page → New WebSocket connection
   - But: User said "turned english" - did they reload? Or just toggle?
   - If no reload, old WebSocket (German) still connected

3. **Root Cause Likely:**
   - **Language toggle doesn't close/reconnect existing WebSocket**
   - Old WebSocket with `lang=de` stays connected
   - New language setting only affects NEW connections
   - Insights work because they're HTTP requests (not persistent connection)

**Fix Direction:**
- On language change, must DISCONNECT and RECONNECT WebSocket with new lang parameter
- OR: Implement backend support for runtime language switching via WebSocket message

---

### Issue 2: Insight Click → No Output (Still Swallowed)

**Symptoms:**
- Click insight
- Ask window opens
- Input appears briefly
- Window reshapes
- **NO output visible** (dark/empty window)

**What We Changed:**
1. ✅ Window minimum height: 80px → 400px
2. ✅ ResizeObserver: Now only grows (doesn't shrink)
3. ✅ IPC auto-submit: Using refs instead of stale state

**Why It Still Fails - Analysis:**

**Hypothesis A: Response IS rendering but NOT visible**
- Window opens at 400px (correct)
- Response streams in (maybe?)
- But CSS/styling hides it (dark background, dark text?)
- Need to verify: Check browser DevTools for actual DOM content

**Hypothesis B: IPC auto-submit timing issue**
- Prompt sets correctly (ref is updated)
- Submit fires too early (before prompt state renders?)
- `startStream()` reads wrong value despite ref fix
- Need to verify: Console logs for IPC sequence

**Hypothesis C: Parent window size constraint**
- User mentioned: "likely forced to have small frame by parent window"
- `overlay-windows.ts` might be overriding Ask window size
- Child window positioning logic might constrain height
- Need to verify: Glass overlay-windows.ts implementation

**Hypothesis D: Response never actually streams**
- Backend connection fails
- No LLM response
- Error swallowed silently
- Need to verify: Check for error toast, network errors

**Hypothesis E: React rendering issue**
- `response` state updates but component doesn't re-render
- `dangerouslySetInnerHTML` not triggering
- DOM not updating despite state change
- Need to verify: Add debug logs in render cycle

**Most Likely Root Cause:**
Given user said "window stays dark, no action":
1. **Response is NOT rendering at all** (not just hidden)
2. Either:
   - `startStream()` not actually being called
   - Stream starts but response state never updates
   - Backend error that's not being shown
3. The "swallow" behavior suggests input clears but nothing happens

**Critical Missing Information:**
- Console logs during insight click
- Network tab showing `/ask` request
- Error toast visibility
- DevTools inspection of Ask window DOM

---

### Issue 3: Settings Still Basic

**Status:** Expected - This was deferred  
**Impact:** Low priority vs. broken core features  
**Action:** Ignore until Ask functionality works

---

## 🎯 Next Steps: Investigation Protocol

### Before ANY code changes, we need DATA:

#### Investigation 1: WebSocket Language Connection
**Commands to run:**
```typescript
// In browser DevTools while testing:
1. Open Settings → Set to English
2. Check console for: "[WS] 🌐 Connecting with language: en"
3. Start Listen session
4. Check WebSocket URL in Network tab: ws://localhost:8000/ws/transcribe?...&lang=en
```

**Questions to answer:**
- Does WebSocket URL actually include `lang=en`?
- Does language change trigger WebSocket reconnection?
- What does backend receive (check backend logs)?

#### Investigation 2: Insight Click Ask Output
**Commands to run:**
```typescript
// In browser DevTools while testing:
1. Click insight
2. Watch console for:
   - "[ListenView] 🎯 Insight clicked"
   - "[Main] 📨 ask:set-prompt received"
   - "[AskView] 📥 Received prompt via IPC"
   - "[AskView] 📥 Received submit command via IPC, prompt: ..."
   - "[AskView] 🚀 Starting stream with prompt: ..."
3. Check Network tab for POST /ask request
4. Inspect Ask window DOM in Elements tab
```

**Questions to answer:**
- Does IPC actually fire?
- Does prompt reach AskView?
- Does `startStream()` get called?
- Does `/ask` request happen?
- Does response HTML exist in DOM (but hidden) or completely absent?

#### Investigation 3: Glass Reference Check
**Files to examine:**
```bash
# Compare EVIA vs Glass:
glass/src/ui/ask/AskView.js
  → How does Glass handle cross-window prompt relay?
  → What's the exact IPC pattern?
  → What are the window size constraints?

glass/src/ui/listen/ListenView.js
  → How does Glass send question to Ask window?
  → What IPC events are used?

glass/src/main/overlay-windows.js (or similar)
  → How are child windows positioned/sized?
  → Are there parent size constraints?
```

---

## 🔴 Critical Hypothesis: The Real Problem

### Theory: EVIA and Glass use DIFFERENT IPC architectures

**Glass Architecture (from code inspection):**
```javascript
// Glass ListenView sends question directly:
window.api.askView.onShowTextInput()
this.handleQuestionFromAssistant = (event, question) => {
  this.handleSendText(null, question);
};

// Glass Ask processes via sendMessage:
window.api.askView.sendMessage(text)
```

**EVIA Architecture (current implementation):**
```typescript
// EVIA uses custom cross-window IPC:
eviaIpc.send('ask:set-prompt', prompt);
eviaIpc.send('ask:submit-prompt');

// Ask window listens:
eviaIpc.on('ask:set-prompt', handleSetPrompt);
eviaIpc.on('ask:submit-prompt', handleSubmit);
```

**The Mismatch:**
- EVIA invented a CUSTOM IPC pattern not used by Glass
- Glass uses `window.api.askView.*` directly
- EVIA's pattern may not be wired correctly in main process
- IPC relay in overlay-windows.ts might not be working

**Evidence:**
- User says insight click "swallows" input
- This suggests IPC fires but doesn't complete
- Exactly what would happen if IPC relay is broken

---

## 🎯 Recommended Fix Strategy

### Option A: Copy Glass IPC Pattern EXACTLY

**Pros:**
- Known to work
- Less room for error
- Proven architecture

**Cons:**
- Requires rewriting cross-window communication
- More invasive changes
- Higher risk of breaking other things

### Option B: Debug Current EVIA IPC Pattern

**Pros:**
- Smaller changes
- Fix what we have
- Understand our own code better

**Cons:**
- Custom pattern may have fundamental flaws
- Could waste time debugging bad architecture

### Option C: Hybrid - Use Glass Pattern for Ask, Keep Rest

**Pros:**
- Surgical fix for critical feature
- Learn from Glass for Ask window specifically
- Can refactor rest later

**Cons:**
- Mixed architecture (technical debt)
- Partial Glass parity

---

## 📋 Proposed Investigation Checklist

Before writing ANY fix code:

- [ ] Capture console logs during insight click (full sequence)
- [ ] Verify WebSocket URL includes correct `lang` parameter
- [ ] Check backend logs for language parameter reception
- [ ] Inspect Ask window DOM to see if response HTML exists
- [ ] Confirm `/ask` POST request actually fires
- [ ] Read Glass AskView.js IPC implementation fully
- [ ] Read Glass overlay-windows.js child window sizing
- [ ] Compare Glass vs EVIA preload.js API exposure

---

## 🔍 Key Questions Needing Answers

### For Transcription Issue:
1. Does `i18n.getLanguage()` return 'en' when WebSocket connects?
2. Does WebSocket URL show `&lang=en` in Network tab?
3. Does backend log show receiving `lang=en`?
4. Does language change trigger WebSocket disconnect/reconnect?

### For Insight Click Issue:
1. Does `[Main] 📨 ask:set-prompt received` appear in console?
2. Does `[AskView] 📥 Received prompt via IPC` appear?
3. Does `[AskView] 🚀 Starting stream` appear?
4. Does POST `/ask` request show in Network tab?
5. Does Ask window DOM contain `.markdown-content` div?
6. Is Ask window actually 400px tall or being constrained?

### For Glass Parity:
1. How does Glass send question from ListenView to AskView?
2. What IPC events does Glass use (vs. EVIA's custom ones)?
3. Does Glass have child window size constraints?

---

## 🚨 Blocker Status

**CANNOT proceed with fixes until we have:**

1. ✅ Console log capture of full insight click sequence
2. ✅ Network tab verification of WebSocket `lang` parameter
3. ✅ Network tab verification of `/ask` POST request
4. ✅ Glass AskView.js IPC pattern understanding
5. ✅ DOM inspection of Ask window (response present but hidden vs. absent)

**Estimated Investigation Time:** 30-45 minutes  
**Estimated Fix Time (after investigation):** Unknown until root cause confirmed

---

## 💭 Assessment: What Went Wrong With Previous Fixes

### Fix Attempt V2 (Window Sizing + IPC Refs):
**What we thought was wrong:**
- Window too small (80px)
- IPC using stale state

**What we fixed:**
- Window sizing: 80px → 400px
- IPC: State closure → Refs

**Why it didn't work:**
- **We guessed at root cause without data**
- Assumed window size was THE problem
- Assumed IPC stale state was THE problem
- Didn't verify if response was actually rendering
- Didn't check if IPC relay was working at all
- Didn't compare with Glass architecture

**The Real Lesson:**
> **Debug first, fix second. No guessing.**

---

## 🎯 Recommended Next Action

**USER MUST PROVIDE:**

1. **Console logs** during insight click test:
   ```
   1. Open DevTools (F12)
   2. Go to Console tab
   3. Clear console
   4. Click an insight
   5. Copy ALL console output
   6. Paste in chat
   ```

2. **Network tab** during insight click:
   ```
   1. Open DevTools → Network tab
   2. Click insight
   3. Look for POST /ask request
   4. Screenshot or copy request details
   ```

3. **Ask window DOM inspection:**
   ```
   1. Click insight (Ask window opens)
   2. Right-click in Ask window → Inspect Element
   3. Look for .ask-container > .response-container
   4. Check if .markdown-content exists and has content
   5. Screenshot Elements tab
   ```

**THEN AND ONLY THEN:** Write targeted fix based on actual data.

---

**Status:** 🔴 INVESTIGATION REQUIRED - Cannot proceed without diagnostic data.

**Current Approach:** WRONG - We're guessing. Need data-driven debugging.

**Next Step:** User provides console logs + network inspection + DOM inspection.

