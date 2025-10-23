# Critical UI Fixes - Testing Guide

## ✅ All Fixes Implemented

### What Was Fixed

#### 1. ✅ Listen Window Overlap (CRITICAL)
**Problem**: When Ask window was already open and Listen was pressed, Listen appeared on top of Ask instead of side-by-side.

**Fix**: Modified `win:ensureShown` IPC handler in `overlay-windows.ts` to call `layoutChildWindows()` BEFORE showing the window. This ensures all visible windows are positioned correctly before any window is displayed.

**File**: `src/main/overlay-windows.ts` (lines 874-902)

---

#### 2. ✅ Cmd+Enter Closes Both Windows (CRITICAL)
**Problem**: Pressing `Cmd+Enter` to close Ask window also closed the Listen window.

**Fix**: Modified `openAskWindow()` function to check if Ask is currently visible. If visible, it closes Ask WITHOUT affecting Listen's state. If not visible, it opens Ask (which will close other windows as per normal behavior).

**File**: `src/main/overlay-windows.ts` (lines 821-836)

---

#### 3. ✅ Session State Not Cleared on Language Change (CRITICAL)
**Problem**: After changing language, the Ask window retained previous session's content.

**Fix**: Added `clear-session` IPC listener to `AskView.tsx` that clears all state (question, response, streaming, errors, etc.) when language changes or session ends.

**File**: `src/renderer/overlay/AskView.tsx` (lines 174-216)

---

#### 4. ✅ Input Auto-Focus Not Working (MEDIUM)
**Problem**: When Ask window opened, keyboard input didn't focus automatically.

**Fix**: Added `requestAnimationFrame` + `setTimeout` delay to ensure DOM is fully ready before focusing. Increased delay to 150ms for mount focus and used RAF for visibility change focus.

**File**: `src/renderer/overlay/AskView.tsx` (lines 218-245)

---

#### 5. ✅ Old Session Data in Listen Window (MEDIUM)
**Problem**: When starting a new recording after language change, old insights were briefly visible.

**Fix**: Modified `recording_started` handler in `ListenView.tsx` to switch to transcript view immediately when recording starts, preventing old insights from being displayed.

**File**: `src/renderer/overlay/ListenView.tsx` (lines 146-159)

---

## 🧪 Testing Procedure

### Prerequisites
1. Backend must be running (`cd EVIA-Backend && uvicorn main:app --reload`)
2. Run Desktop in dev mode: `cd EVIA-Desktop && npm run dev` (in Terminal.app to see full logs)
3. Have DevTools open for Ask and Listen windows to see console logs

---

### Test Sequence 1: Window Management (Fixes #1 & #2)

#### Test 1A: Listen Window Side-by-Side Positioning
**Expected**: When Ask is open, Listen should appear to the LEFT of Ask, not on top.

**Steps**:
1. Press `Cmd+Enter` to open Ask window
2. Type a question (e.g., "Is this before or during the meeting?")
3. Press Enter to submit
4. While Ask is showing response, click "Listen" button in header
5. **✅ VERIFY**: Listen window appears to the LEFT of Ask window (not overlapping)
6. Move windows with arrow keys (`Cmd+Up/Down/Left/Right`)
7. **✅ VERIFY**: Both windows move together and maintain their side-by-side layout

**Console Evidence to Look For**:
```
[overlay-windows] win:ensureShown called for listen
[overlay-windows] 🔧 FIX: Call layoutChildWindows to position ALL visible windows correctly
[layoutChildWindows] 📐 ask bounds: { x: 481, y: 278, width: 640, height: 58 }
[layoutChildWindows] 📐 listen bounds: { x: 73, y: 278, width: 400, height: 420 }
```

---

#### Test 1B: Cmd+Enter Only Closes Ask, Not Listen
**Expected**: Pressing `Cmd+Enter` should close Ask but keep Listen open.

**Steps**:
1. With both Ask and Listen open (from Test 1A)
2. Press `Cmd+Enter` to close Ask
3. **✅ VERIFY**: Ask window closes, Listen window remains open
4. Press `Cmd+Enter` again to reopen Ask
5. **✅ VERIFY**: Ask window opens (Listen will close due to normal behavior)

**Console Evidence to Look For**:
```
[overlay-windows] Cmd+Enter: Closing Ask only, preserving Listen: true
```

---

### Test Sequence 2: Language Change & Session Clearing (Fix #3)

#### Test 2A: Ask Window Clears on Language Change
**Expected**: Changing language should clear Ask window's question and response.

**Steps**:
1. Open Ask window (`Cmd+Enter`)
2. Type "Is this before or during the meeting?" and press Enter
3. Wait for response to complete
4. Open Settings (gear icon in header)
5. Click language toggle to switch from English to German (or vice versa)
6. Close Settings by moving cursor away
7. **✅ VERIFY**: Ask window is now empty (no question, no response)
8. Open Ask again (`Cmd+Enter`)
9. **✅ VERIFY**: Input field is still empty, no old data

**Console Evidence to Look For**:
```
[AskView] 🧹 Received clear-session - clearing all state (language change or session end)
[AskView] ✅ Session cleared
```

---

#### Test 2B: Listen Window Clears on Language Change
**Expected**: Changing language during recording should stop recording and clear transcripts/insights.

**Steps**:
1. Click "Listen" button to start recording
2. Speak something (e.g., "Hello, how are you?")
3. Wait for transcript to appear
4. Open Settings and change language
5. **✅ VERIFY**: Recording stops (header shows "Zuhören" or "Listen")
6. **✅ VERIFY**: Listen window clears (no transcripts, no insights)

**Console Evidence to Look For**:
```
[ListenView] 🧹 Received clear-session - resetting all state
[ListenView] ✅ Session cleared - ready for new recording
```

---

### Test Sequence 3: Input Auto-Focus (Fix #4)

#### Test 3A: Auto-Focus on Ask Window Open
**Expected**: When Ask window opens, input field should be automatically focused (ready to type).

**Steps**:
1. Press `Cmd+Enter` to open Ask window
2. Immediately start typing without clicking anything
3. **✅ VERIFY**: Text appears in input field (focus is automatic)

**Console Evidence to Look For**:
```
[AskView] ⌨️ Initial input focus
```

---

#### Test 3B: Auto-Focus on Window Reopen
**Expected**: When Ask window is reopened, input field should auto-focus again.

**Steps**:
1. With Ask window open, press `Cmd+Enter` to close it
2. Press `Cmd+Enter` again to reopen
3. Immediately start typing
4. **✅ VERIFY**: Text appears in input field (focus is restored)

**Console Evidence to Look For**:
```
[AskView] ⌨️ Auto-focused input
```

---

### Test Sequence 4: Fresh Start After Language Change (Fix #5)

#### Test 4A: No Old Data When Starting New Recording
**Expected**: Starting a new recording after language change should show clean slate.

**Steps**:
1. Start in English, record something, get insights
2. Change language to German
3. Click "Zuhören" to start new recording
4. **✅ VERIFY**: Listen window switches to "Transkript" tab (not "Insights")
5. **✅ VERIFY**: No old transcripts visible
6. **✅ VERIFY**: Timer starts at 00:00
7. Speak something in German
8. **✅ VERIFY**: New German transcript appears

**Console Evidence to Look For**:
```
[ListenView] ▶️ Recording started - starting timer
[ListenView] 🧹 Cleared previous session transcripts & insights, switched to transcript view
```

---

## ❌ Known Backend Issues (NOT Desktop's Fault)

These issues are confirmed to be backend problems and should be reported to the backend team:

### Issue 1: Transcript Language Mismatch
**Problem**: Transcripts are generated in the wrong language even when Desktop sends correct language parameter.

**Evidence**: 
- Desktop logs show: `[ListenView] 🌐 Fetching insights in language: en`
- But transcript shows: `Hallo, wie geht's? Wie geht es dir?` (German)

**Root Cause**: Backend's Deepgram integration not respecting language parameter.

---

### Issue 2: Insights Language Mismatch
**Problem**: Insights are generated in wrong language.

**Evidence**:
- Desktop logs show: `language: en`
- But insights show: `topicHeader: 'Gesprächsstart'` (German)

**Root Cause**: Backend's insights service not respecting language parameter.

---

### Issue 3: Ask Response Language Mismatch
**Problem**: Ask endpoint responds in wrong language.

**Evidence**: User's report shows German insight clicked, but response was in English.

**Root Cause**: Backend's `/ask` endpoint not respecting language parameter (already documented in `DESKTOP-LANGUAGE-SWITCHING-DETAILED-REPORT.md`).

---

### Issue 4: Session Persistence Across Language Changes
**Problem**: Backend continues sending audio data after WebSocket close on language change.

**Evidence**: User's report shows backend sending data even after Desktop stopped recording.

**Root Cause**: Backend not properly handling WebSocket close event or language change command.

---

### Issue 5: Groq Rate Limit
**Problem**: `Error code: 429 - Rate limit reached for model llama-3.3-70b-versatile`

**Evidence**: User's logs show rate limit error when clicking insight.

**Root Cause**: Backend hitting Groq's daily token limit (100,000 tokens).

**Solution**: Backend needs to implement rate limiting or upgrade Groq plan.

---

## 📊 Success Criteria

After running all tests, you should observe:

### ✅ Window Management
- [ ] Listen window appears side-by-side with Ask (not overlapping)
- [ ] Cmd+Enter closes only Ask window, not Listen
- [ ] Windows maintain layout when moved with arrow keys

### ✅ Language Change
- [ ] Ask window clears completely on language change
- [ ] Listen window clears completely on language change
- [ ] Recording stops when language changes

### ✅ Input Focus
- [ ] Input field auto-focuses when Ask opens
- [ ] Input field auto-focuses when Ask reopens
- [ ] Can type immediately without clicking

### ✅ Session State
- [ ] New recording shows clean slate (no old data)
- [ ] View switches to "Transcript" tab on recording start
- [ ] Timer starts at 00:00

---

## 🔧 Debugging Tips

### If Listen Window Still Overlaps Ask:
1. Check console for `[layoutChildWindows]` logs
2. Verify both windows have correct bounds before showing
3. Check if `ensureShown` is calling `layoutChildWindows` before `win.show()`

### If Cmd+Enter Still Closes Listen:
1. Check console for "Cmd+Enter: Closing Ask only, preserving Listen" message
2. Verify `openAskWindow()` is checking `askVisible` state
3. Check `getVisibility()` returns correct state

### If Ask Window Doesn't Clear on Language Change:
1. Check console for "Received clear-session" message in AskView
2. Verify IPC listener is registered for `clear-session`
3. Check if `overlay-entry.tsx` is sending `clear-session` event

### If Input Focus Doesn't Work:
1. Check console for "Initial input focus" or "Auto-focused input" messages
2. Verify `inputRef.current` is not null
3. Try increasing the `setTimeout` delay to 200ms or 300ms

---

## 📝 Report Format

After testing, report results in this format:

```
✅ Test 1A: Listen Window Side-by-Side - PASS
✅ Test 1B: Cmd+Enter Only Closes Ask - PASS
✅ Test 2A: Ask Window Clears on Language Change - PASS
✅ Test 2B: Listen Window Clears on Language Change - PASS
✅ Test 3A: Auto-Focus on Ask Window Open - PASS
✅ Test 3B: Auto-Focus on Window Reopen - PASS
✅ Test 4A: No Old Data When Starting New Recording - PASS

Backend Issues Observed:
- ❌ Transcript language mismatch (expected English, got German)
- ❌ Insights language mismatch (expected English, got German)
- ❌ Ask response language mismatch (expected German, got English)
```

---

## 🎯 Next Steps

1. Run all tests in the sequence above
2. Report any failures with console logs
3. For backend issues, create separate report for backend team
4. If all Desktop tests pass, Desktop is ready for production

---

**Good luck with testing!** 🚀

