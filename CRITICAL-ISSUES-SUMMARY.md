# ❌ CRITICAL ISSUES FOUND - USER TESTING 2025-10-23

**User**: Ben  
**Test Date**: 2025-10-23 12:30 UTC  
**Status**: 4 Critical Issues + 1 Backend Issue

---

## 1. ❌ SETTINGS VIEW NOT GLASS-PARITY

### Problem:
Settings view looks "EXACT same as before. Not at all like @glass/"

### Investigation:
```bash
# Our branch (prep-fixes/desktop-polish):
src/renderer/overlay/SettingsView.tsx: 353 lines

# Main branch (latest):
src/renderer/overlay/SettingsView.tsx: 539 lines

# Andre's commits on main:
c1dbc48 [REMAKE] settingsview account logged in reactive to actual status stage 4
043a933 [REMAKE] shortcuts settingsview stage 3
ddf5bf3 [REMAKE] settingsview stage 2 presets
1647f35 [REMAKE] Stage 1.2 settinggsview glass parity
```

### Root Cause:
Andre's "glass parity" commits ADDED features (539 lines), not simplified them. Neither main nor our branch has the minimal glass-style settings.

### Solution Needed:
1. Check `glass/` reference implementation for SettingsView
2. Create truly minimal glass-parity version
3. Remove all complex features (prompts, invisibility toggle, broadcast channel, etc.)
4. Keep only: Language toggle, Shortcuts display, Logout, Quit

---

## 2. ❌ ASK WINDOW DOESN'T EXPAND FOR LONGER OUTPUTS

### Problem:
"The ask window doesn't seem to be able to autoexpand for longer groq outputs (at least for german outputs)"

### Current Implementation:
```typescript
// AskView.tsx lines 70-115
const resizeTimeout = setTimeout(() => {
  const needed = Math.ceil(entry.contentRect.height);
  const delta = Math.abs(needed - current);
  if (delta > 3) {
    const targetHeight = needed + 5;
    storedContentHeightRef.current = targetHeight;
    requestWindowResize(targetHeight);
  }
}, 100);
```

### Possible Issues:
1. **Max height limit**: Window might be clamped to screen bounds
2. **Container not expanding**: `.ask-container` might have `max-height` CSS
3. **German text wrapping**: Longer German words might break layout

### Debug Steps:
1. Check `overlay-glass.css` for `.ask-container` max-height
2. Check `layoutChildWindows()` for height clamping
3. Add console log for `contentRect.height` vs `window.innerHeight`

---

## 3. ❌ LISTEN WINDOW OVERLAPS ASK WHEN ASK ALREADY OPEN

### Problem:
"The listen window doesn't fully open left to the ask window when the ask window is already opened at listen press (slight overlap)"

### Expected Behavior (from Test 1):
```
Test 1 works: When the ask window is open before I press listen, 
the listen window appears on top of the ask window.
```

**Wait, user said Test 1 WORKS, but also reports overlap issue?**

### Clarification Needed:
- Does Listen overlap Ask (issue) or appear on top (Test 1 success)?
- If overlap, how many pixels?
- Screenshot analysis needed

### Current Layout Code:
```typescript
// overlay-windows.ts lines 445-459
if (askVis && listenVis) {
  // Both windows: horizontal stack (listen left, ask center-aligned)
  let askXRel = headerCenterXRel - askW / 2
  let listenXRel = askXRel - listenW - PAD_LOCAL  // PAD_LOCAL = 8px
  
  // Clamp to screen bounds
  if (listenXRel < PAD_LOCAL) {
    listenXRel = PAD_LOCAL
    askXRel = listenXRel + listenW + PAD_LOCAL
  }
}
```

### Potential Fix:
Increase `PAD_LOCAL` or add extra spacing between windows.

---

## 4. ❌ SESSION STATE NOT DETECTED BY BACKEND

### Problem:
**User Report**:
```
Question (while recording - "Stopp" button visible):
"Ist das hier vor oder während dem Meeting?"

EVIA Response: "**Vor dem Meeting**" ❌ WRONG
Expected: "**Während des Meetings**" ✅
```

### Desktop Status:
✅ **Desktop IS sending correct session_state**

**Evidence from backend logs (user's terminal selection)**:
```
Line 358: [SESSION-STATE] Applied session_state=before to prompt
```

But user had "Stopp" button visible, meaning `listenStatus = 'in'`, so Desktop sent `session_state = 'during'`.

### Root Cause:
**Backend is NOT reading the `session_state` parameter from Desktop's request**

### Desktop Implementation (Verified Working):
```typescript
// EviaBar.tsx: Broadcasts session state changes
const sessionState = listenStatus === 'in' ? 'during' : listenStatus;
eviaIpc.send('session-state-changed', sessionState);

// AskView.tsx: Receives and sends to backend
const handle = streamAsk({ 
  sessionState,  // ← SENT TO BACKEND
  ...
});

// evia-ask-stream.ts: Includes in request payload
payload.session_state = sessionState;
```

**Backend Request Payload** (what Desktop sends):
```json
{
  "chat_id": 11,
  "prompt": "Ist das hier vor oder während dem Meeting?",
  "language": "de",
  "session_state": "during"  // ← THIS IS SENT BUT BACKEND IGNORES
}
```

### Solution:
✅ **Created**: `SESSION-STATE-DETECTION-GUIDE-FOR-BACKEND.md`  
📄 **Location**: `/Users/benekroetz/EVIA/EVIA-Desktop/SESSION-STATE-DETECTION-GUIDE-FOR-BACKEND.md`

**Backend needs to**:
1. Read `session_state` from POST `/ask` request body
2. Use it instead of defaulting to 'before'
3. Fix `groq_service.py` line ~260-280

---

## 5. ⚠️ BUTTONS NOT SYNCHRONIZED TO SESSION STAGE

### Problem:
"Also, the buttons are still not synchronized to the session stage - but that is a backend problem."

### Context:
User acknowledges this is a backend issue, not Desktop.

**Likely Issue**: Backend returns wrong button states in `/insights` or other endpoints.

---

## 📊 PRIORITY RANKING

| # | Issue | Severity | Owner | Status |
|---|-------|----------|-------|--------|
| 1 | Session state not detected | 🔴 CRITICAL | Backend | Needs fix |
| 2 | Ask window doesn't expand | 🔴 CRITICAL | Desktop | Needs debug |
| 3 | Listen/Ask overlap | 🟡 MEDIUM | Desktop | Needs clarification |
| 4 | Settings not glass-parity | 🟡 MEDIUM | Desktop | Needs design |
| 5 | Buttons not synchronized | 🟡 MEDIUM | Backend | Acknowledged |

---

## 🔧 IMMEDIATE ACTIONS NEEDED

### For Desktop Agent:
1. ✅ **Session state guide**: Created `SESSION-STATE-DETECTION-GUIDE-FOR-BACKEND.md`
2. ❌ **Ask expansion**: Debug why window doesn't grow for long text
3. ❌ **Listen/Ask spacing**: Verify overlap issue with screenshots
4. ❌ **Settings glass-parity**: Review glass reference, create minimal version

### For Backend Agent:
1. ❌ **Session state**: Read and fix based on `SESSION-STATE-DETECTION-GUIDE-FOR-BACKEND.md`
2. ❌ **Button synchronization**: Fix button states in API responses

---

## 📸 USER-PROVIDED SCREENSHOTS (Described)

1. **Settings View**: Shows old complex settings, not glass-style minimal
2. **Ask Window**: German output gets cut off, window doesn't expand enough
3. **Listen/Ask Overlap**: Slight overlap when Listen opens with Ask already visible

---

## ✅ WHAT'S WORKING

- ✅ Arrow key movement (no "zap")
- ✅ Language switching clears state
- ✅ Auth validation before sessions
- ✅ Auto-focus on Ask window
- ✅ Insights clearing on language change
- ✅ Session state DETECTION in Desktop (broadcasting works)

---

## ❌ WHAT'S BROKEN

- ❌ Session state USAGE by Backend (ignoring Desktop's parameter)
- ❌ Ask window expansion for long text
- ❌ Listen/Ask window spacing (slight overlap)
- ❌ Settings UI not minimal/glass-style

---

**Report Created**: 2025-10-23  
**Next Steps**: Address Desktop issues (Ask expansion, Listen spacing), wait for Backend to fix session_state

