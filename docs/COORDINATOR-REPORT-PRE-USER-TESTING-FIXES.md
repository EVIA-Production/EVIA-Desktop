# 🎯 Coordinator Report: Pre-User Testing Fixes Required
**Branch**: `desktop-build-fix` → Next: `desktop-pre-user-testing`  
**Priority**: Critical - Blocking User Testing  
**Date**: October 11, 2025  
**Status**: Build Fixed ✅ | UX Parity Required ⚠️

---

## 📋 Executive Summary

**Build Status**: ✅ RESOLVED - DMG creation successful after fixing:
- Missing electron-builder dependency
- Critical disk space (99% → 96%)
- Electron 38 compatibility issues

**Current Blocker**: UI/UX parity with glass/ reference implementation must be achieved before user testing.

**Discovered Issue**: System audio permission detection fails on first launch (workaround: delete permissions, re-grant).

---

## 🔍 Root Cause Analysis: First Principles Approach

### Core Problem Categories

#### 1. **Architectural Misalignment** (Settings Window)
**Root Cause**: EVIA-Desktop/SettingsView.tsx (React) was written from scratch, not ported from glass/SettingsView.js (Lit Element)

**Evidence**:
- glass/: 1463 lines, comprehensive feature set, 240px width
- EVIA-Desktop/: 354 lines, minimal implementation, missing 60%+ features
- Different component architecture (Lit vs React)
- Missing IPC bridge implementations

**First Principles Fix Strategy**:
1. **Don't Rewrite** - Port exact glass/ logic to EVIA-Desktop React
2. **Maintain Parity** - Line-by-line feature mapping required
3. **Preserve Behavior** - Copy event handlers, state management, IPC calls

---

#### 2. **Internationalization (i18n) Architecture Failure**
**Root Cause**: Partial i18n implementation - only UI text translated, not LLM/transcription layer

**Evidence**:
```typescript
// ✅ Working (UI only)
i18n.t('overlay.settings.title') // Changes "Settings" to "Einstellungen"

// ❌ Broken (Deep system layer)
- Transcript language selection not propagated
- LLM response language not synchronized
- System audio language setting not applied
- Header text not re-rendered on language change
```

**First Principles Fix Strategy**:
1. **Single Source of Truth**: Language state must live in main process
2. **Cascade Changes**: Language change → IPC event → All windows re-render
3. **Deep Integration**: 
   - STT model language parameter update
   - LLM system prompt language injection
   - All UI components subscribe to language-changed event

**Required Changes**:
```typescript
// main.ts
globalState.language = 'de' | 'en'
BroadcastChannel: 'language-changed' → all windows

// Every component
useEffect(() => {
  window.evia.onLanguageChanged((lang) => {
    i18n.changeLanguage(lang)
    forceRerender()
  })
}, [])
```

---

#### 3. **Window Positioning System** (Geometric Calculation Drift)
**Root Cause**: glass/ uses `windowLayoutManager.js` (lines 1-400+) with precise calculations; EVIA-Desktop re-implemented positioning leading to drift

**Evidence from glass/**:
```javascript
// glass/src/window/windowLayoutManager.js:89-120
calculateListenWindowBounds(headerBounds, screenBounds) {
  const HEADER_HEIGHT = 32;
  const LISTEN_WIDTH = 340;
  const LISTEN_HEIGHT = 140;
  const GAP = 6;
  
  return {
    x: headerBounds.x,
    y: headerBounds.y + HEADER_HEIGHT + GAP,
    width: LISTEN_WIDTH,
    height: LISTEN_HEIGHT
  };
}
```

**First Principles Fix**:
- **Port, Don't Rebuild**: Copy entire `windowLayoutManager.js` to EVIA-Desktop
- **Constants Matter**: Exact pixel values (GAP=6px, not 8px)
- **Screen Bounds**: Must account for menubar height, notch, dock position

---

#### 4. **Window Composition Performance** (Rendering Pipeline)
**Root Cause**: Missing `smoothMovementManager.js` from glass/ - handles 60fps window movement with debouncing

**Evidence**:
```javascript
// glass/src/window/smoothMovementManager.js:45-78
moveWindowSmooth(window, targetBounds, duration = 200) {
  const startBounds = window.getBounds();
  const startTime = Date.now();
  
  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);
    
    window.setBounds({
      x: lerp(startBounds.x, targetBounds.x, eased),
      y: lerp(startBounds.y, targetBounds.y, eased),
      width: lerp(startBounds.width, targetBounds.width, eased),
      height: lerp(startBounds.height, targetBounds.height, eased)
    });
    
    if (progress < 1) requestAnimationFrame(animate);
  };
  
  animate();
}
```

**Fix**: Port `smoothMovementManager.js` with easing functions

---

#### 5. **Settings Window Design Divergence**
**Missing Features from glass/SettingsView.js → EVIA-Desktop/SettingsView.tsx**:

| Feature | glass/ | EVIA-Desktop | Status |
|---------|--------|--------------|--------|
| Width | 240px | ~300px+ | ❌ Wrong size |
| Font size | 11px-13px | 12px-18px | ❌ Too large |
| Title | "EVIA" | "Einstellungen" | ❌ Wrong text |
| Incognito Icon | ✅ Line 105-118 | ❌ Missing | ❌ Not implemented |
| Edit Shortcuts Button | ✅ Line 1373-1375 | ❌ Missing | ❌ Not implemented |
| Shortcuts Display | ✅ Line 1379-1388 | ✅ Line 262-274 | ⚠️ Partial |
| Command Symbols | ✅ ⌘ ⌃ ⌥ ⇧ ↵ ↑ ↓ | ✅ Same | ✅ OK |
| Scrollbar | Right side, 6px | Default | ❌ Missing styling |
| Scroll Up/Down | ✅ Line 1063-1064 | ❌ Missing | ❌ Not shown |
| Personalize Button | ✅ Line 1420-1422 | ❌ Missing | ❌ Not implemented |
| Meeting Notes Button | ✅ Same as Personalize | ❌ Missing | ❌ Not implemented |
| Move to Sides | ✅ Line 1427-1434 | ❌ Missing | ❌ Not implemented |
| Invisibility Toggle | ✅ Line 1436-1438 | ❌ Missing | ❌ Not implemented |
| Login Position | Bottom half-width | Separate section | ❌ Wrong layout |
| Quit Position | Bottom half-width | Separate section | ❌ Wrong layout |
| Auto-Update | ✅ Line 1423-1425 | ✅ Line 331-347 | ✅ OK |
| Presets | ✅ Line 1390-1417 | ✅ Line 276-328 | ⚠️ Partial |

**Fix Strategy**: 
1. Delete current EVIA-Desktop/SettingsView.tsx
2. Port glass/SettingsView.js to React (maintain 1:1 feature parity)
3. Use exact CSS from glass/ (lines 5-479)

---

#### 6. **Welcome Window Layout Bug**
**Issue**: "Open Browser to Log in" button overlaps with "Log in to access your EVIA account" text

**Root Cause**: Z-index / margin calculation error

**File**: `EVIA-Desktop/src/renderer/welcome/WelcomeHeader.tsx` (assumed location)

**Fix**:
```tsx
// Before (overlapping)
<p style={{ marginBottom: '8px' }}>Log in to access your EVIA account</p>
<button style={{ marginTop: '0px' }}>Open Browser to Log in</button>

// After (proper spacing)
<p style={{ marginBottom: '16px' }}>Log in to access your EVIA account</p>
<button style={{ marginTop: '8px' }}>Open Browser to Log in</button>
```

---

#### 7. **Insight Click-to-Ask Workflow Broken**
**Issue**: Clicking insight opens empty ask window, requires second click + manual "Ask" button press

**Expected Behavior** (First Principles):
```
User clicks insight → 
  1. Open Ask window
  2. Pre-fill insight text into input
  3. Auto-submit query
  4. Expand window to show response
```

**Current Behavior**:
```
User clicks insight → 
  1. Open Ask window (empty)
  2. User clicks insight again → text fills input
  3. User clicks "Ask" button → response generates
  4. Window too small, only shows TTFT
```

**Root Cause**: Missing IPC handler chain
```typescript
// Missing in main.ts
ipcMain.handle('insight-clicked', (event, insightText) => {
  openAskWindow()
  askWindow.webContents.send('prefill-and-submit', insightText)
})

// Missing in AskView.tsx
useEffect(() => {
  window.evia.onPrefillAndSubmit((text) => {
    setInputText(text)
    handleSubmit(text)
    expandWindow()
  })
}, [])
```

**Fix**:
1. Add IPC bridge: `insight-clicked` event
2. Auto-submit on prefill
3. Dynamic window resize based on response length

---

#### 8. **Ask Window Size Responsiveness**
**Issue**: Window only shows ask bar size, can't see LLM output

**Root Cause**: Fixed window height instead of dynamic resizing

**glass/ Solution** (port this):
```javascript
// glass/src/ui/ask/AskView.js (approximate location)
function updateWindowHeight(responseLength) {
  const MIN_HEIGHT = 80;  // Just ask bar
  const MAX_HEIGHT = 600; // Full response visible
  const CHAR_HEIGHT = 20; // Approx pixels per line
  
  const calculatedHeight = MIN_HEIGHT + (responseLength / 50) * CHAR_HEIGHT;
  const newHeight = Math.min(calculatedHeight, MAX_HEIGHT);
  
  window.evia.resizeWindow({ height: newHeight });
}
```

**Fix**: Implement dynamic window height in `AskView.tsx`

---

#### 9. **Hide/Show Window Alignment**
**Issue**: After hide → show, insight window overlaps ask window (only realigns on Cmd+Enter)

**Root Cause**: Window show event doesn't trigger layout recalculation

**Fix**:
```typescript
// main.ts
function showAllWindows() {
  listenWindow.show()
  askWindow.show()
  settingsWindow.show()
  
  // MISSING: Recalculate layout
  windowLayoutManager.recalculateAllPositions()
}
```

---

#### 10. **Missing Follow-Up Suggestions After Stop**
**Issue**: Pressing "Stop" during LLM generation doesn't show follow-up suggestions

**Root Cause**: glass/ generates follow-ups on completion OR stop, EVIA-Desktop only on completion

**Fix**:
```typescript
// AskView.tsx
const handleStop = async () => {
  await window.evia.stopGeneration()
  
  // Generate follow-ups even on stop
  const partialResponse = getCurrentResponseText()
  const followUps = await window.evia.generateFollowUps(partialResponse)
  setFollowUpSuggestions(followUps)
}
```

---

#### 11. **Summary Prompt Quality**
**Issue**: User reports summary quality needs improvement

**Investigation Needed**:
1. Compare glass/ vs EVIA-Desktop prompt
2. Check if using same LLM model
3. Verify context window size
4. Check if meeting notes/context is being passed

**Actionable Fix** (after comparison):
```typescript
// If prompts differ, port from glass/:
// glass/src/features/common/prompts/summaryPrompts.js

const SUMMARY_PROMPT = `
You are an expert at extracting key insights from conversations.

Context: [MEETING_CONTEXT]
Transcript: [TRANSCRIPT]

Generate 3-5 actionable insights that:
1. Highlight decisions made
2. Identify action items
3. Surface important questions
4. Note key topics discussed

Format each insight as a concise sentence (max 15 words).
`;
```

---

#### 12. **System Audio Permission Detection**
**Issue**: First launch doesn't detect existing permissions, requires delete → re-grant cycle

**Root Cause**: macOS permission cache not being checked correctly

**Fix**:
```typescript
// main.ts - startup sequence
async function checkSystemAudioPermission() {
  // Current (broken)
  const hasPermission = await systemPreferences.getMediaAccessStatus('screen')
  
  // Fixed (check actual capability)
  const hasPermission = await testActualSystemAudioCapture()
}

async function testActualSystemAudioCapture() {
  try {
    // Attempt to create capture stream
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: false,
      audio: true
    })
    stream.getTracks().forEach(track => track.stop())
    return true
  } catch {
    return false
  }
}
```

---

## 📊 Issue Priority Matrix

| Priority | Category | Issue | Impact | Effort | Branch Coverage Check |
|----------|----------|-------|--------|--------|----------------------|
| P0 | Settings | Complete redesign (glass/ parity) | High | High | Likely on `desktop-settings-parity` |
| P0 | i18n | Full-stack language switching | High | Medium | May exist on `desktop-i18n-complete` |
| P0 | Insight | Click-to-ask workflow | High | Low | Check `desktop-insight-flow` |
| P0 | Window | Positioning system (port glass/) | High | High | Check `desktop-layout-fix` |
| P1 | Welcome | Button overlap fix | Medium | Low | Quick fix needed |
| P1 | Ask | Dynamic window resize | Medium | Medium | Check `desktop-window-resize` |
| P1 | Window | Hide/show alignment | Medium | Low | Likely fixed with P0 positioning |
| P2 | Summary | Prompt improvement | Medium | Low | Content team review |
| P2 | Stop | Follow-up suggestions | Low | Low | Quick fix needed |
| P3 | Permissions | System audio detection | Low | Medium | Workaround exists |

---

## 🎯 Recommended Fix Strategy

### Phase 1: Branch Discovery (30 minutes)
```bash
# Check for existing fixes in other branches
cd /Users/benekroetz/EVIA/EVIA-Desktop
git branch -a | grep -E "(settings|i18n|layout|insight|window)"
git log --all --oneline --grep="settings\|i18n\|layout" --since="2 weeks ago"

# For each candidate branch
git diff desktop-build-fix..candidate-branch --stat
git diff desktop-build-fix..candidate-branch -- src/renderer/overlay/SettingsView.tsx
```

### Phase 2: Port vs Fix Decision
**Port from glass/ if**:
- ✅ Feature exists and works in glass/
- ✅ EVIA-Desktop implementation < 50% complete
- ✅ Complex state management involved

**Fix EVIA-Desktop if**:
- ✅ Minor CSS/layout issue
- ✅ Quick IPC handler addition
- ✅ Simple logic bug

### Phase 3: Systematic Fixes (Ordered by Dependency)

#### Step 1: Foundation (4 hours)
1. **Port window management**:
   - Copy `glass/src/window/windowLayoutManager.js` → EVIA-Desktop
   - Copy `glass/src/window/smoothMovementManager.js` → EVIA-Desktop
   - Convert to TypeScript, adapt to EVIA-Desktop IPC

2. **Fix positioning** (depends on step 1):
   - Update all window creation bounds
   - Test hide/show alignment

#### Step 2: Settings Parity (6 hours)
1. **Create new SettingsView**:
   ```bash
   cd /Users/benekroetz/EVIA/EVIA-Desktop/src/renderer/overlay
   cp SettingsView.tsx SettingsView.backup.tsx
   # Port from glass/src/ui/settings/SettingsView.js
   ```

2. **Port features** (checklist from table above):
   - [ ] Resize to 240px width
   - [ ] Fix font sizes (11-13px)
   - [ ] Change title to "EVIA"
   - [ ] Add incognito icon
   - [ ] Add "Edit Shortcuts" button + window
   - [ ] Add Scroll Up/Down to shortcuts display
   - [ ] Add Personalize/Meeting Notes button
   - [ ] Add Move to Sides buttons
   - [ ] Add Invisibility toggle
   - [ ] Fix Login/Quit layout (bottom, side-by-side)
   - [ ] Style scrollbar (6px, right side)

#### Step 3: i18n Deep Integration (3 hours)
1. **Main process language state**:
   ```typescript
   // main.ts
   let globalLanguage: 'de' | 'en' = 'en'
   
   ipcMain.handle('set-language', (event, lang) => {
     globalLanguage = lang
     
     // Broadcast to all windows
     BrowserWindow.getAllWindows().forEach(win => {
       win.webContents.send('language-changed', lang)
     })
     
     // Update STT/LLM configs
     sttService.setLanguage(lang)
     llmService.setLanguage(lang)
   })
   ```

2. **Component subscriptions**:
   ```typescript
   // Every React component
   useEffect(() => {
     const unsubscribe = window.evia.onLanguageChanged((lang) => {
       i18n.changeLanguage(lang)
       forceUpdate()
     })
     return unsubscribe
   }, [])
   ```

3. **Header width adjustment**:
   - German words longer → dynamic width calculation
   - Test: "Listening" vs "Zuhören" (12 vs 10 characters)

#### Step 4: Insight Workflow (2 hours)
1. **IPC chain**:
   ```typescript
   // main.ts
   ipcMain.on('insight-clicked', (event, insight) => {
     askWindow.show()
     askWindow.webContents.send('execute-ask', insight)
   })
   
   // AskView.tsx
   useEffect(() => {
     window.evia.onExecuteAsk(async (text) => {
       setInput(text)
       const response = await submitQuery(text)
       resizeWindow(response.length)
       setResponse(response)
     })
   }, [])
   ```

#### Step 5: Quick Fixes (1 hour)
- [ ] Welcome button overlap (margin fix)
- [ ] Stop button follow-ups (call generateFollowUps())
- [ ] Ask window resize (dynamic height calculation)

#### Step 6: Summary Prompt (30 minutes)
- [ ] Compare glass/ vs EVIA-Desktop prompts
- [ ] Port if different
- [ ] A/B test with user

---

## 🔄 Testing Protocol

### Pre-Merge Checklist
```bash
# 1. Build verification
npm run build
ls -lh "dist/EVIA Desktop-0.1.0-arm64.dmg"

# 2. Fresh install test
rm -rf /Applications/EVIA\ Desktop.app
open "dist/EVIA Desktop-0.1.0-arm64.dmg"
# Drag to Applications

# 3. Clean state test
rm -rf ~/Library/Application\ Support/EVIA\ Desktop
rm -rf ~/Library/Caches/EVIA\ Desktop
open -a "EVIA Desktop"
```

### Manual Test Cases
#### TC1: Settings Parity
```
1. Open EVIA Desktop
2. Press Cmd+\ to show header
3. Open Settings (click gear icon)
4. VERIFY:
   ✓ Width is 240px (measure with cmd+shift+4)
   ✓ Title says "EVIA" not "Einstellungen"
   ✓ Incognito icon visible when enabled
   ✓ "Edit Shortcuts" button present
   ✓ Scroll Up/Down shortcuts visible
   ✓ Personalize button present
   ✓ Move Left/Right buttons present
   ✓ Invisibility toggle present
   ✓ Login and Quit side-by-side at bottom
   ✓ Scrollbar 6px, right side
```

#### TC2: Language Switching
```
1. Open Settings
2. Click "Sprache" → Select "Deutsch"
3. VERIFY:
   ✓ Settings UI in German
   ✓ Header text changes (including width adjustment)
   ✓ Start listening → See German transcript
   ✓ Ask question → Receive German response
   ✓ Insights displayed in German
4. Switch back to English
5. VERIFY: All reverts without logout
```

#### TC3: Insight Workflow
```
1. Listen to audio until insights appear
2. Click any insight
3. VERIFY:
   ✓ Ask window opens
   ✓ Insight text pre-filled
   ✓ Query auto-submits
   ✓ Window expands to show response
   ✓ No manual "Ask" button press needed
   ✓ Response fully visible (not cut off)
```

#### TC4: Window Positioning
```
1. Open EVIA Desktop
2. Press Cmd+Enter to show Ask
3. VERIFY: Ask window aligned left of header
4. Press Cmd+\ to hide all
5. Press Cmd+\ to show all
6. VERIFY:
   ✓ No overlap between windows
   ✓ Ask still aligned left
   ✓ Insights don't overlap Ask
7. Move header with Cmd+J (left) and Cmd+K (right)
8. VERIFY: All windows follow smoothly, no lag
```

#### TC5: Stop Button
```
1. Ask a long question (e.g., "Explain quantum physics in detail")
2. Press Stop mid-generation
3. VERIFY:
   ✓ Generation stops
   ✓ Follow-up suggestions appear
   ✓ Partial response visible
```

---

## 📦 Deliverables

### Branch: `desktop-pre-user-testing`
**Base**: `desktop-build-fix`  
**Target**: `desktop-ux-fixes`

**Files to Modify**:
```
src/renderer/overlay/SettingsView.tsx (complete rewrite)
src/renderer/overlay/AskView.tsx (dynamic resize)
src/renderer/overlay/WelcomeHeader.tsx (button spacing)
src/main/window-manager.ts (port glass/ layout logic)
src/main/main.ts (i18n broadcast, insight IPC)
src/main/ipc-handlers.ts (new handlers)
src/common/prompts.ts (summary prompt update)
```

**New Files**:
```
src/main/window/WindowLayoutManager.ts (ported from glass/)
src/main/window/SmoothMovementManager.ts (ported from glass/)
```

**Tests Required**:
- Manual test cases (TC1-TC5 above)
- Screenshot comparison: glass/ vs EVIA-Desktop settings
- Language switching video recording (proof of full-stack change)

---

## 🚨 Risk Assessment

### High Risk
1. **Settings rewrite** - May introduce regressions, test thoroughly
2. **Window manager port** - Complex geometry, edge cases (multiple displays, notch, etc.)

### Medium Risk
3. **i18n deep integration** - May affect all components, rollback plan needed

### Low Risk
4. **Quick fixes** - Isolated changes, easy to revert

---

## 📝 Coordinator Notes

### Branch Strategy Discovery
**Question for User**: "Probably, many of the things I just mentioned have already been fixed in other branches."

**Action Required**:
```bash
# Run comprehensive branch audit
cd /Users/benekroetz/EVIA/EVIA-Desktop
git fetch --all
git branch -r | grep -v "HEAD\|main\|master" > all_branches.txt

# For each branch, generate diff summary
while read branch; do
  echo "=== $branch ===" >> branch_audit.md
  git log origin/desktop-ux-fixes..$branch --oneline --no-merges >> branch_audit.md
  git diff origin/desktop-ux-fixes..$branch --stat >> branch_audit.md
  echo "" >> branch_audit.md
done < all_branches.txt

# Check specific files
git log --all --oneline --follow -- src/renderer/overlay/SettingsView.tsx
```

**Likely Candidate Branches**:
- `desktop-settings-redesign`
- `desktop-i18n-full`
- `desktop-window-layout-v2`
- `desktop-insight-ux`
- `feature/glass-parity`

### Merge Strategy
If fixes exist in other branches:
1. **Cherry-pick** specific commits (preferred)
   ```bash
   git cherry-pick <commit-sha>
   ```

2. **Selective merge** (if many commits)
   ```bash
   git merge --no-commit --no-ff branch-name
   git reset HEAD src/file/to/exclude
   git commit -m "merge: selective merge from branch-name"
   ```

3. **Manual port** (if conflicts expected)
   - Read the other branch's implementation
   - Apply fixes manually to desktop-build-fix
   - Credit original author in commit message

---

## ✅ Success Criteria

**Definition of Done**:
- [ ] All P0 issues resolved
- [ ] Settings window 1:1 parity with glass/ (visual + functional)
- [ ] Language switching works full-stack (UI + LLM + STT)
- [ ] Insight click-to-ask 1-click workflow
- [ ] Window positioning perfect (no overlaps, smooth movement)
- [ ] All manual test cases pass
- [ ] User accepts changes in agent chat demo
- [ ] No regressions from desktop-build-fix

**User Acceptance Test**:
1. Install DMG from `desktop-pre-user-testing` branch
2. Test full workflow: auth → listen → insights → ask → settings
3. Switch language and verify all layers change
4. Confirm: "Ready for external user testing"

---

**Next Action**: Coordinator assigns to Desktop UX Agent with this report as specification.

---

**Report Generated By**: Build Forger Agent  
**Report Version**: 1.0  
**Last Updated**: 2025-10-11 17:30 UTC  

