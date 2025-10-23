# Critical UI Fixes - Planning Document

## Issue Analysis & Assignment

### 🟢 DESKTOP ISSUES (We will fix)

#### 1. **Listen Window Overlaps Ask Window** ⚠️ CRITICAL
**Problem**: When Ask is already open and Listen is pressed, Listen appears on top of Ask instead of side-by-side.

**Root Cause**: Looking at the terminal logs:
```
[overlay-windows] win:ensureShown called for listen
[overlay-windows] 🔧 listen window loading from Vite dev server
[overlay-windows] Opening DevTools for listen window
[overlay-windows] getVisibility() returning: { ask: true, settings: false, listen: false, shortcuts: false }
[overlay-windows] ensureShown complete for listen
```

The layout is only calculated AFTER the window is shown, not before. The fix we implemented sets bounds before showing, but `ensureShown` doesn't call `layoutChildWindows` immediately.

**Fix**: In `overlay-windows.ts`, modify `ensureShown` to call `layoutChildWindows()` BEFORE showing the window.

---

#### 2. **Cmd+Enter Closes Both Ask AND Listen Windows** ⚠️ CRITICAL
**Problem**: Pressing `Cmd+Enter` to close the Ask window also closes the Listen window.

**Root Cause**: The global shortcut handler in `overlay-windows.ts` toggles the Ask window without checking if it's focused. The shortcut is registered globally, so when Ask closes, the visibility state changes and triggers a layout recalculation that also hides Listen.

**Evidence from logs**:
```
[overlay-windows] toggleWindow('ask'): ask=false (closing all others)
[overlay-windows] saveState (debounced): {"ask":false,"settings":false,"listen":false,"shortcuts":false}
```

**Fix**: 
1. Make `Cmd+Enter` only close the currently focused window, not toggle Ask
2. Or, change the shortcut handler to ONLY affect the Ask window without touching Listen's state

---

#### 3. **Session State Not Cleared on Language Change** ⚠️ CRITICAL
**Problem**: After changing language to German, the Ask window retains the previous English session's content.

**Evidence from logs**:
```
[overlay-windows] 🌐 Language changed from other window: de
[overlay-windows] 🌐 Language changed: de
```

But no `clear-session` event is being sent to AskView.

**Root Cause**: Language change broadcasts `language-changed` event, but doesn't trigger session clearing in AskView.

**Fix**: When language changes, also send `clear-session` IPC to AskView to reset its state (question, response, etc.).

---

#### 4. **Input Auto-Focus Not Working** 🟡 MEDIUM
**Problem**: When Ask window opens, keyboard input doesn't focus automatically.

**Root Cause**: The `inputRef.current?.focus()` might be called before the window is fully visible or the DOM is ready.

**Fix**: Add a small delay (e.g., `setTimeout`) after visibility change or use `requestAnimationFrame` to ensure the DOM is ready before focusing.

---

#### 5. **Ask Window Resize on Move (Regression)** 🟡 MEDIUM
**Problem**: Moving the window around still makes the Ask window smaller, even though we implemented a fix.

**Evidence from logs**:
```
[IPC] 📏 adjust-window-height: ask 58px → 231px
```

This happens during window movement.

**Root Cause**: The `lastResponseRef` check isn't preventing all resize triggers. The `ResizeObserver` is still firing on layout changes caused by window movement.

**Fix**: Add a flag to track if the window is being moved (via IPC from main process) and skip resize during movement.

---

### 🔴 BACKEND ISSUES (Not Desktop's fault)

#### 6. **Transcript in Wrong Language**
**Problem**: Generated transcript is in German even when language is set to English.

**Evidence from logs**:
```
ListenView.tsx:225 [ListenView] 📨 transcript_segment: Hallo, wie geht's? Wie geht es dir? speaker: 1
```

This is AFTER the language was set to English. The user says "maybe because the groq limit has been reached" but the transcript is coming from Deepgram, not Groq.

**Likely Cause**: 
- Deepgram language parameter not being set correctly
- OR Desktop's WebSocket connection not passing the correct language to backend

**Desktop Check**: Verify that `overlay-entry.tsx` passes the correct language when starting audio capture.

---

#### 7. **Insights in Wrong Language**
**Problem**: Insights are in German when language is set to English.

**Evidence from logs**:
```
insightsService.ts:58 [Insights] Received Glass format with follow-ups: {summaryCount: 2, topicHeader: 'Gesprächsstart', ...}
```

`topicHeader: 'Gesprächsstart'` is German.

**Root Cause**: Backend issue - insights are being generated in the wrong language.

**Desktop's Role**: Desktop is correctly passing `language: en` to the insights fetch request:
```
ListenView.tsx:477 [ListenView] 🌐 Fetching insights in language: en
```

So this is 100% a backend issue.

---

#### 8. **Ask Responses in English When Clicking German Insights**
**Problem**: When clicking a German insight, the Ask response is in English.

**Root Cause**: Backend's `/ask` endpoint is not respecting the language parameter.

**Desktop's Role**: Desktop is correctly passing the language parameter as proven in the previous reports.

---

#### 9. **Session Not Stopped When Language Changed**
**Problem**: Backend keeps sending data to Deepgram after language change, even though UI reset.

**Evidence from logs**:
```
[Main] 🌐 Broadcasting language change to all windows: de
[Main] ✅ Sent language-changed to ask window
[Main] ✅ Sent language-changed to settings window
[Main] ✅ Sent language-changed to listen window
```

But no WebSocket close is being triggered.

**Root Cause**: Desktop is broadcasting the language change, but it's not stopping the active recording session.

**Fix**: In `overlay-entry.tsx`, when language changes and a recording is active, stop the recording (call `stopCapture()`).

---

#### 10. **Old Session Data Persists**
**Problem**: Pressing "Zuhören" shows old German summary and English transcript from last session.

**Root Cause**: ListenView clears transcripts and insights on `recording_started`:
```typescript
ListenView.tsx:152 [ListenView] 🧹 Cleared previous session transcripts & insights
```

But the clearing happens AFTER the recording starts, and the backend might be sending old data before the clear.

**Fix**: Clear the session BEFORE starting the recording, not after.

---

#### 11. **Timer Stops When Pressing "Zuhören"**
**Problem**: When starting a session, the timer stops.

**Evidence from logs**:
```
ListenView.tsx:148 [ListenView] ▶️ Recording started - starting timer
```

But user reports timer stopping.

**Root Cause**: Need to check the timer logic in ListenView.

---

#### 12. **Groq Rate Limit Error**
**Problem**: `Error code: 429 - Rate limit reached`

**Root Cause**: Backend/Groq issue, not Desktop.

**Desktop's Role**: Display the error clearly to the user (which we already do).

---

## Fix Priority

### Phase 1: CRITICAL Session State & Window Management (30 min)
1. ✅ Fix Listen window overlap (modify `ensureShown` to layout BEFORE showing)
2. ✅ Fix `Cmd+Enter` closing both windows (only close focused window)
3. ✅ Clear session on language change (send `clear-session` to AskView on language change)
4. ✅ Stop recording on language change (call `stopCapture()` in overlay-entry.tsx)

### Phase 2: UI Polish (15 min)
5. ✅ Fix input auto-focus (add delay/RAF)
6. ✅ Fix resize on move regression (add movement flag)
7. ✅ Clear session BEFORE starting recording (reorder ListenView logic)

### Phase 3: Backend Issues (Not our scope)
8. ⚠️ Report transcript language issue to backend team
9. ⚠️ Report insights language issue to backend team
10. ⚠️ Report ask response language issue to backend team

---

## Testing Plan

After fixes, test this exact sequence:

1. **Start in English**
   - Open Ask, type question, verify auto-focus works
   - Press `Cmd+Enter`, verify only Ask closes
   - Open Ask again, then Listen, verify Listen is side-by-side (not overlapping)
   - Move windows with arrow keys, verify Ask doesn't resize

2. **During English Session**
   - Start recording
   - Verify transcript is English
   - Verify timer is running
   - Click insight, verify response is English

3. **Language Change**
   - Change to German while recording
   - Verify recording stops immediately
   - Verify Ask window clears
   - Verify Listen window clears

4. **Start in German**
   - Start new German session
   - Verify transcript is German (if backend fixed)
   - Verify insights are German (if backend fixed)
   - Click insight, verify response is German (if backend fixed)

5. **Window Management**
   - With both Ask and Listen open
   - Press `Cmd+Enter` in Ask window
   - Verify only Ask closes, Listen stays open

---

## Files to Modify

1. `/Users/benekroetz/EVIA/EVIA-Desktop/src/main/overlay-windows.ts`
   - Fix `ensureShown` to layout before showing
   - Fix `Cmd+Enter` shortcut handler

2. `/Users/benekroetz/EVIA/EVIA-Desktop/src/renderer/overlay/overlay-entry.tsx`
   - Stop recording on language change
   - Add `clear-session` broadcast on language change

3. `/Users/benekroetz/EVIA/EVIA-Desktop/src/renderer/overlay/AskView.tsx`
   - Fix auto-focus timing
   - Add movement flag to prevent resize during window move

4. `/Users/benekroetz/EVIA/EVIA-Desktop/src/renderer/overlay/ListenView.tsx`
   - Clear session BEFORE starting recording

---

## Backend Issues to Report

Create a separate document for backend team with these issues:

1. **Deepgram/Transcript Language**: Even when Desktop sends `language: 'en'`, transcripts come back in German
2. **Insights Language**: Insights are generated in wrong language despite correct language parameter
3. **Ask Response Language**: `/ask` endpoint responds in wrong language despite correct language parameter
4. **Session Persistence**: Backend continues sending audio data after Desktop closes WebSocket connection on language change

---

## Execution

Will now implement Phase 1 & 2 fixes in order.

