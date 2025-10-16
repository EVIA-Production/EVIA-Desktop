# 🧪 EVIA Desktop - Fresh User Test Protocol

**Comprehensive Multi-Phase Testing Guide**

---

## 📋 Document Info

- **Version:** 1.0
- **Branch:** `evia-desktop-unified-best`
- **Target:** macOS (Apple Silicon + Intel)
- **Estimated Time:** 45-60 minutes
- **Prerequisites:** Admin access, internet connection

---

## 🎯 Testing Philosophy

This protocol simulates a **completely fresh user** who:
1. Has never installed EVIA before
2. Has no cached data or tokens
3. Must grant macOS permissions from scratch
4. Expects a smooth, intuitive onboarding experience

**Goal:** Verify that EVIA Desktop achieves **Glass UI/UX parity** and provides a production-ready experience.

---

## 🧹 Phase 1: Complete Environment Reset (10 min)

### 1.1 Automated Reset Script

```bash
cd EVIA-Desktop
chmod +x fresh-user-test-setup.sh
./fresh-user-test-setup.sh
```

**What it does:**
- Deletes `~/Library/Application Support/EVIA Desktop`
- Clears `~/Library/Caches/EVIA Desktop`
- Removes Keychain auth tokens
- Resets macOS TCC permissions (Screen Recording, Microphone)
- Kills running EVIA/Electron processes

### 1.2 Manual Permission Cleanup (CRITICAL)

⚠️ **macOS sometimes caches permission state even after `tccutil reset`**

1. Open **System Settings**
2. Navigate to **Privacy & Security**
3. **Screen Recording:**
   - Find "EVIA Desktop" or "Electron"
   - Toggle OFF (or click `-` to remove)
4. **Microphone:**
   - Find "EVIA Desktop" or "Electron"
   - Toggle OFF (or click `-` to remove)
5. Close System Settings

### 1.3 Verify Clean State

```bash
# Check app data removed
ls ~/Library/Application\ Support/EVIA\ Desktop 2>/dev/null && echo "❌ FAIL: App data exists" || echo "✅ PASS: Clean"

# Check keychain removed
security find-generic-password -s "EVIA Desktop" 2>/dev/null && echo "❌ FAIL: Token exists" || echo "✅ PASS: Clean"

# Check no processes running
ps aux | grep -i evia | grep -v grep && echo "❌ FAIL: EVIA running" || echo "✅ PASS: Clean"
```

**Expected:** All `✅ PASS` results

---

## 🏗️ Phase 2: Build Production App (10 min)

### 2.1 Checkout Branch

```bash
cd EVIA-Desktop
git fetch --all
git checkout evia-desktop-unified-best
git pull origin evia-desktop-unified-best
```

### 2.2 Install Dependencies (if needed)

```bash
npm install
```

### 2.3 Build DMG

```bash
npm run build
```

**Expected Output:**
```
  • building        target=macOS-arm64 file=dist/EVIA Desktop-0.1.0-arm64.dmg
  • building        target=macOS-x64 file=dist/EVIA Desktop-0.1.0.dmg
```

### 2.4 Verify Build

```bash
ls -lh dist/EVIA\ Desktop*.dmg
```

**Expected:** DMG file(s) present, size ~100-200MB

---

## 📦 Phase 3: Fresh Installation (5 min)

### 3.1 Remove Existing App

```bash
rm -rf /Applications/EVIA\ Desktop.app
```

### 3.2 Open DMG

```bash
open dist/EVIA\ Desktop-0.1.0-arm64.dmg
```

### 3.3 Install App

1. Drag **"EVIA Desktop"** to **Applications** folder
2. Wait for copy to complete
3. Eject DMG

### 3.4 Verify Installation

```bash
ls -ld /Applications/EVIA\ Desktop.app
codesign -dv --verbose=4 /Applications/EVIA\ Desktop.app 2>&1 | grep "Identifier"
```

**Expected:** `Identifier=com.evia.desktop`

---

## 🧪 Phase 4: End-to-End Testing (30 min)

### Test Case 1: First Launch & Welcome Screen (3 min)

**Steps:**
1. Open **Launchpad** or **Applications** folder
2. Double-click **"EVIA Desktop"**
3. (If macOS Gatekeeper prompt appears, click **"Open"**)

**Expected Results:**
- ✅ Welcome window appears within 3 seconds
- ✅ Window has glassmorphic design (translucent, blurred background)
- ✅ Title: "Get Started with EVIA"
- ✅ Subtitle: "Welcome! To begin using EVIA..."
- ✅ Button: "Open Browser to Log In" (visible, clickable)
- ✅ Privacy policy link at bottom
- ✅ Window centered on screen
- ✅ No console errors in terminal (if running `npm start` for logs)

**Failure Modes:**
- ❌ Black screen → Check `overlay-windows.ts` CSP/loadURL
- ❌ Window doesn't appear → Check Console.app for crash logs
- ❌ Unstyled window → Check CSS imports in `WelcomeHeader.tsx`

---

### Test Case 2: Authentication Flow (5 min)

**Steps:**
1. Click **"Open Browser to Log In"** button

**Expected Results:**
- ✅ Default browser opens to EVIA login page
- ✅ Welcome window **closes immediately** (within 100ms)
- ✅ No lingering Welcome window in background

**Browser Login:**
1. Enter test credentials:
   - Email: `test@evia.com`
   - Password: `test1234`
2. Click **"Login"** button

**Expected Results:**
- ✅ Redirect to `evia://auth-callback?token=eyJ...`
- ✅ macOS prompts: "Open in EVIA Desktop?"
- ✅ Click **"Open"**
- ✅ Permission window appears (NOT main header yet)

**Failure Modes:**
- ❌ Browser doesn't open → Check IPC handler in `main.ts`
- ❌ Welcome window stays open → Check `window.close()` in `WelcomeHeader.tsx`
- ❌ Auth callback fails → Check protocol handler in `main.ts`

---

### Test Case 3: macOS Permissions Setup (10 min)

**Expected Initial State:**
- ✅ Permission window visible
- ✅ Glassmorphic design (matches Welcome window style)
- ✅ Title: "Grant Permissions"
- ✅ Two buttons visible:
  - "Grant Microphone Access" (enabled, blue theme)
  - "Grant Screen Recording Access" (enabled, blue theme)
- ✅ Icons for each permission type
- ✅ Window centered on screen
- ✅ Dimensions: 305x250px

#### 3.1 Microphone Permission

**Steps:**
1. Click **"Grant Microphone Access"** button

**Expected Results:**
- ✅ macOS system dialog appears: "EVIA Desktop would like to access the microphone"
- ✅ Dialog has two buttons: "Don't Allow" / "OK"
- ✅ Click **"OK"**
- ✅ Dialog closes
- ✅ Permission window updates:
  - Button text changes to "Microphone Access Granted"
  - Button disabled (gray, non-clickable)
  - Green checkmark icon appears
- ✅ No errors in terminal logs

**Failure Modes:**
- ❌ Dialog doesn't appear → Check `entitlements.mac.plist` for `com.apple.security.device.microphone`
- ❌ Button doesn't update → Check IPC response in `PermissionHeader.tsx`
- ❌ Infinite loop in logs → Check `checkingRef` in `checkPermissions`

#### 3.2 Screen Recording Permission

**Steps:**
1. Click **"Grant Screen Recording Access"** button

**Expected Results:**
- ✅ Terminal log: `📹 Triggering screen capture request to register app...`
- ✅ macOS System Settings opens automatically
- ✅ Navigates to **Privacy & Security > Screen Recording**
- ✅ "EVIA Desktop" appears in list (NOT "Electron" or "Cursor")
- ✅ Toggle is OFF (unchecked)

**Manual Grant:**
1. Click toggle to enable "EVIA Desktop"
2. macOS prompt: "EVIA Desktop will not be able to record..."
3. Click **"Quit & Reopen"**
4. EVIA quits and relaunches

**Expected Results:**
- ✅ Permission window reappears after relaunch
- ✅ Microphone still shows "Granted" (persisted)
- ✅ Screen Recording button updates to "Screen Recording Granted"
- ✅ Button disabled (gray, non-clickable)
- ✅ Green checkmark icon appears

**Failure Modes:**
- ❌ "Electron" appears instead of "EVIA Desktop" → Check bundle ID in `package.json` (`com.evia.desktop`)
- ❌ App doesn't appear in list → Check `desktopCapturer.getSources()` call in `main.ts`
- ❌ Permission not detected after grant → Check IPC polling in `PermissionHeader.tsx`

#### 3.3 Auto-Continue Transition

**Expected Results (NO user action required):**
- ✅ After both permissions granted, brief success message appears:
  - Text: "✅ All permissions granted"
  - Green background (rgba(0, 200, 0, 0.2))
  - Visible for ~200ms
- ✅ Permission window auto-closes (no "Continue" button!)
- ✅ Main EVIA header appears at top of screen
- ✅ Total transition time: <300ms

**Failure Modes:**
- ❌ "Continue to EVIA" button appears → Check `PermissionHeader.tsx` for button removal
- ❌ Window doesn't auto-close → Check `setTimeout` in `checkPermissions`
- ❌ Header doesn't appear → Check IPC call to `onContinue` in `overlay-entry.tsx`

---

### Test Case 4: Main Header & Window Management (5 min)

**Expected Initial State:**
- ✅ Header visible at top center of screen
- ✅ Glassmorphic design (blur, transparency, subtle gradient)
- ✅ Logo/title on left
- ✅ Buttons: "Listen", "Ask", Settings icon
- ✅ Width: ~300px, Height: ~50px
- ✅ Always on top (stays above other apps)

#### 4.1 Hide/Show Toggle (Cmd+\\)

**Steps:**
1. Press **Cmd+\\**

**Expected:**
- ✅ Header fades out and disappears
- ✅ Smooth animation (~150ms)
- ✅ No window flash or jitter

2. Press **Cmd+\\** again

**Expected:**
- ✅ Header fades in and reappears
- ✅ Same position as before
- ✅ Smooth animation

#### 4.2 Window Repositioning (Cmd+Arrow)

**Steps:**
1. Press **Cmd+Left Arrow**

**Expected:**
- ✅ Header moves to left side of screen
- ✅ Smooth animation (~200ms)
- ✅ Maintains alignment with top edge

2. Press **Cmd+Right Arrow**

**Expected:**
- ✅ Header moves to right side

3. Press **Cmd+Up Arrow** → Top center  
4. Press **Cmd+Down Arrow** → Bottom center

**Expected:**
- ✅ All transitions smooth
- ✅ No overlap with menu bar or dock
- ✅ Child windows (Listen/Ask) follow header position

---

### Test Case 5: Listen View & Transcription (5 min)

**Steps:**
1. Click **"Listen"** button in header

**Expected:**
- ✅ Listen window appears directly below header
- ✅ Seamless connection (no gap or overlap)
- ✅ Glassmorphic design
- ✅ Two tabs: "Transcript" (active) / "Insights"
- ✅ Empty state message: "Start speaking to see live transcript..."
- ✅ Recording indicator (pulsing red dot)

**Speak Test:**
1. Speak clearly: "This is a test of the EVIA transcription system."

**Expected:**
- ✅ Text appears in real-time (word by word)
- ✅ Words grouped into bubbles
- ✅ Timestamps visible
- ✅ Auto-scroll to latest text
- ✅ Smooth rendering (no lag)

**Stop Recording:**
1. Click **"Stop"** button

**Expected:**
- ✅ Recording indicator stops pulsing
- ✅ Final transcript complete
- ✅ Follow-up suggestions appear (if implemented)

**Failure Modes:**
- ❌ No transcript → Check WebSocket connection in `ListenView.tsx`
- ❌ "undefined chat_id" error → Check localStorage persistence
- ❌ Audio capture fails → Check `audio-processor.js` and worklet registration

---

### Test Case 6: Insights Generation & Click-to-Ask (5 min)

**Prerequisites:** Recording session completed with meaningful content (e.g., meeting discussion)

**Steps:**
1. Click **"Insights"** tab in Listen window

**Expected:**
- ✅ Insights tab activates
- ✅ Loading state if generating (spinner)
- ✅ Insight cards appear after generation (~5-10 seconds)
- ✅ Each card shows:
  - Icon (e.g., 💡, 🎯)
  - Title (e.g., "Key Decision")
  - Brief description
- ✅ Cards clickable (cursor changes to pointer)

**Click Insight Test:**
1. Click any insight card

**Expected:**
- ✅ Ask window opens (appears below Listen window)
- ✅ Insight's prompt pre-filled in Ask input bar
- ✅ Query **auto-submits** (no manual "Ask" click needed)
- ✅ Response starts streaming within 2 seconds (TTFT <2s)
- ✅ Ask window **dynamically resizes** to show full response
- ✅ Smooth resize animation (no jitter)

**Failure Modes:**
- ❌ Ask window stays tiny → Check `ResizeObserver` in `AskView.tsx`
- ❌ Prompt not pre-filled → Check IPC relay in `ListenView.tsx` `handleInsightClick`
- ❌ No auto-submit → Check `ask:submit-prompt` IPC call

---

### Test Case 7: Manual Ask Workflow (3 min)

**Steps:**
1. Press **Cmd+Enter** (opens Ask window if not already open)
2. Type in Ask input bar: "What is EVIA?"
3. Press **Enter** or click **"Ask"** button

**Expected:**
- ✅ Query submitted
- ✅ Loading indicator appears
- ✅ Response starts streaming (TTFT <2s)
- ✅ Markdown rendered correctly (bold, italic, lists, code blocks)
- ✅ Syntax highlighting for code (if applicable)
- ✅ Ask window resizes dynamically to fit response
- ✅ Scrollbar appears if content exceeds window height

**Copy Test:**
1. Click **"Copy"** button (if available) or select text
2. Cmd+C to copy

**Expected:**
- ✅ Text copied to clipboard (verify with Cmd+V in another app)

---

### Test Case 8: Settings View (3 min)

**Steps:**
1. Click **Settings icon** (gear icon) in header

**Expected:**
- ✅ Settings window opens
- ✅ Positioned to right of header (or below)
- ✅ Glassmorphic design
- ✅ Sections visible:
  - **Language** (dropdown: English, Deutsch, etc.)
  - **Shortcuts** (editable keybindings)
  - **Account** (Logout, Quit buttons)

#### 8.1 Language Setting

**Steps:**
1. Click language dropdown
2. Select "Deutsch"

**Expected:**
- ✅ Dropdown closes
- ✅ UI language updates (if implemented)
- ✅ Setting persisted (reload app → still Deutsch)

#### 8.2 Logout Test

**Steps:**
1. Scroll to **Account** section
2. Click **"Logout"** button (orange theme)

**Expected:**
- ✅ Button hover effect (color darkens)
- ✅ Click logs out user
- ✅ All windows close
- ✅ Welcome window reappears
- ✅ Terminal log: `✅ Logout successful`

**Failure Modes:**
- ❌ Nothing happens → Check IPC handler `auth:logout` in `main.ts`
- ❌ App crashes → Check error handling in `SettingsView.tsx`

#### 8.3 Quit Test

**Steps:**
1. Re-login and open Settings again
2. Click **"Quit EVIA"** button (red theme)

**Expected:**
- ✅ App quits completely
- ✅ All windows close
- ✅ Terminal log: `✅ Quit initiated`

**Verify Clean Quit:**
```bash
ps aux | grep -i evia | grep -v grep
```
**Expected:** No results (app fully quit)

---

### Test Case 9: Re-Login & Permission Skip (2 min)

**Purpose:** Verify that already-granted permissions are remembered

**Steps:**
1. Relaunch **EVIA Desktop** from Applications
2. Click **"Open Browser to Log In"**
3. Login with same credentials

**Expected:**
- ✅ After auth callback, **Permission window is skipped**
- ✅ Main header appears **immediately**
- ✅ No permission prompts
- ✅ App fully functional (Listen/Ask work)

**Failure Modes:**
- ❌ Permission window reappears → Check permission caching logic
- ❌ Permissions reset → macOS issue, need to investigate TCC persistence

---

## ✅ Phase 5: Success Criteria Validation

### Functional Requirements

- [ ] **F1:** First launch shows Welcome window
- [ ] **F2:** Login opens browser, closes Welcome
- [ ] **F3:** Permission window appears with correct styling
- [ ] **F4:** Microphone permission grantable via system dialog
- [ ] **F5:** Screen Recording permission grantable via System Settings
- [ ] **F6:** Auto-continue after permissions (no manual button)
- [ ] **F7:** Main header appears after permissions
- [ ] **F8:** Cmd+\\ toggles header visibility
- [ ] **F9:** Cmd+Arrow repositions header smoothly
- [ ] **F10:** Listen captures real-time audio transcription
- [ ] **F11:** Insights generated from transcript
- [ ] **F12:** Insight click opens Ask with auto-submit
- [ ] **F13:** Ask window dynamically resizes
- [ ] **F14:** Manual Ask workflow functional
- [ ] **F15:** Settings contains Logout & Quit buttons
- [ ] **F16:** Logout returns to Welcome
- [ ] **F17:** Quit fully closes app
- [ ] **F18:** Re-login skips permission window

### UI/UX Requirements (Glass Parity)

- [ ] **U1:** All windows use glassmorphic design (blur, transparency)
- [ ] **U2:** Consistent color palette (white text, subtle gradients)
- [ ] **U3:** Smooth animations (fade, slide, resize)
- [ ] **U4:** No window flash or jitter
- [ ] **U5:** Proper window alignment (no overlap or gaps)
- [ ] **U6:** Responsive to screen size changes
- [ ] **U7:** Keyboard shortcuts work reliably
- [ ] **U8:** Always-on-top behavior for header

### Performance Requirements

- [ ] **P1:** App launch time <3 seconds
- [ ] **P2:** Login flow <10 seconds (excluding user input)
- [ ] **P3:** Permission window transition <300ms
- [ ] **P4:** Transcription latency <500ms (real-time)
- [ ] **P5:** Ask TTFT <2 seconds
- [ ] **P6:** Window resize smooth (no visible lag)
- [ ] **P7:** No memory leaks (app can run >1 hour)

---

## 📊 Test Report Template

```markdown
# EVIA Desktop - Fresh User Test Report

**Tester:** [Name]  
**Date:** [YYYY-MM-DD HH:MM]  
**Branch:** evia-desktop-unified-best  
**Build:** EVIA Desktop-0.1.0-arm64.dmg  
**macOS Version:** [e.g., Sonoma 14.2.1]  
**Hardware:** [e.g., MacBook Pro M1, 16GB RAM]

---

## Test Results Summary

| Phase | Status | Duration | Notes |
|-------|--------|----------|-------|
| Phase 1: Reset | ✅ PASS | 8 min | Manual permission reset required |
| Phase 2: Build | ✅ PASS | 12 min | DMG created successfully |
| Phase 3: Install | ✅ PASS | 3 min | No Gatekeeper issues |
| Phase 4: E2E | ⚠️ PARTIAL | 35 min | See issues below |

---

## Test Cases

| TC# | Description | Status | Notes |
|-----|-------------|--------|-------|
| TC1 | Welcome Screen | ✅ PASS | |
| TC2 | Authentication | ✅ PASS | |
| TC3 | Permissions | ✅ PASS | Screen recording required app restart |
| TC4 | Header & Navigation | ✅ PASS | |
| TC5 | Listen & Transcription | ⚠️ PARTIAL | Lag at 5min mark |
| TC6 | Insights & Click-to-Ask | ✅ PASS | |
| TC7 | Manual Ask | ✅ PASS | |
| TC8 | Settings | ✅ PASS | Language change works |
| TC9 | Re-Login | ✅ PASS | |

---

## Issues Found

### Issue 1: [Title]
- **Severity:** P0 / P1 / P2 / P3
- **Test Case:** TC#
- **Steps to Reproduce:**
  1. [Step 1]
  2. [Step 2]
- **Expected:** [Expected behavior]
- **Actual:** [Actual behavior]
- **Screenshot:** [If applicable]
- **Console Logs:** [If applicable]

### Issue 2: [Title]
...

---

## Success Criteria Status

- **Functional:** 17/18 (94%) ✅
- **UI/UX:** 8/8 (100%) ✅
- **Performance:** 6/7 (86%) ⚠️

---

## Overall Assessment

- [ ] ✅ **Ready for user testing** - All critical paths functional
- [ ] ⚠️ **Ready with caveats** - Minor issues, workarounds available
- [ ] ❌ **Not ready** - Major blockers present

---

## Recommendations

1. [Recommendation 1]
2. [Recommendation 2]

---

## Tester Notes

[Additional observations, suggestions, or concerns]
```

---

## 🛠️ Troubleshooting Guide

### Problem: "App doesn't launch"
**Check:**
1. Console.app for crash logs (filter: "EVIA")
2. Terminal: `codesign -vvv /Applications/EVIA\ Desktop.app`
3. Gatekeeper: `xattr -dr com.apple.quarantine /Applications/EVIA\ Desktop.app`

### Problem: "Welcome window is black"
**Fix:**
1. Check `overlay-windows.ts` CSP headers
2. Verify `WelcomeHeader.tsx` CSS imports
3. Check terminal for React errors

### Problem: "Screen Recording permission not working"
**Fix:**
1. Verify bundle ID: `codesign -dv /Applications/EVIA\ Desktop.app 2>&1 | grep Identifier`
   - Expected: `com.evia.desktop`
2. Reset TCC manually:
   ```bash
   tccutil reset ScreenCapture com.evia.desktop
   ```
3. Ensure `entitlements.mac.plist` includes screen recording entitlement
4. Rebuild app completely: `npm run build`

### Problem: "Transcription not working"
**Check:**
1. WebSocket connection: Look for "WS connected" log
2. Audio worklet registration: Look for "AudioWorklet registered"
3. Backend running: `curl http://localhost:8000/health`
4. Chat ID persisted: Check localStorage in DevTools

### Problem: "Ask window stays tiny"
**Fix:**
1. Check `AskView.tsx` for `ResizeObserver` implementation
2. Verify IPC handler `window:resize-ask` in `main.ts`
3. Test with DevTools: Inspect Ask window dimensions

---

## 📚 Related Documentation

- **Quick Start Guide:** `QUICK-START-TESTING.md`
- **Branch Analysis:** `BRANCH-SCORING-ANALYSIS.md`
- **Glass Parity Report:** `GLASS-PARITY-VERIFICATION-REPORT.md`
- **Coordinator Report:** `COORDINATOR-REPORT-PRE-USER-TESTING-FIXES.md`

---

**Ready to test comprehensively!** 🚀
