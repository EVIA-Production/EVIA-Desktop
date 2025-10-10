# EVIA Desktop E2E Manual Testing Guide

**Date:** October 10, 2025  
**Purpose:** Manual verification of complete auth flow  
**Estimated Time:** 10-15 minutes

---

## 🎯 Test Objectives

1. ✅ Verify Welcome window appears (no header visible)
2. ✅ Test login button opens browser correctly
3. ✅ Test token redirect from frontend to desktop
4. ✅ Verify token storage in keytar
5. ✅ Test permissions flow
6. ✅ Verify main header appears only when ready
7. ✅ Test error handling (`evia://auth-callback?error=bad`)
8. ✅ Test logout flow returns to welcome

---

## 📋 Pre-Requisites

### Services Running:
- ✅ Backend: `http://localhost:8000` (confirmed running)
- ✅ Frontend: `http://localhost:5173` (confirmed running)

### Files Verified:
- ✅ `.env` file exists with correct URLs
- ✅ `HeaderController` has `getCurrentState()` method
- ✅ Header toggle checks auth state (`currentState !== 'ready'`)
- ✅ Welcome window uses `import.meta.env.VITE_FRONTEND_URL`
- ✅ Header border fix implemented (`margin: 1px 0`, `overflow: visible`)
- ✅ Welcome button centered (`align-self: center`)

---

## 🚀 Step-by-Step Testing

### Step 1: Start Desktop App

**Terminal 1 (Renderer):**
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run dev:renderer
```

**Expected Output:**
```
VITE v5.x.x ready in XXX ms
➜  Local:   http://localhost:5174/
```

**Terminal 2 (Main Process):**
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
EVIA_DEV=1 npm run dev:main
```

**Expected Output:**
```
[Electron] Starting...
[HeaderController] Initializing...
[HeaderController] Determined state: welcome
[overlay-windows] ✅ Welcome window shown
```

---

### Step 2: Verify Welcome Window

**Visual Checks:**
- ✅ Welcome window appears
- ✅ Main header is NOT visible
- ✅ Window title: "Welcome to EVIA"
- ✅ Subtitle: "Your AI-powered meeting assistant"
- ✅ Single option card with "Get Started" title
- ✅ Button text: "Open Browser to Log in"
- ✅ Button does NOT overlap "Get Started" text
- ✅ Footer: "EVIA keeps your personal data private — See details"
- ✅ Close button (×) in top-right corner
- ✅ Dark background with white inset border (Glass UI parity)

**Console Logs to Verify:**
```
[HeaderController] Determined state: welcome
[overlay-windows] ✅ Welcome window shown
```

---

### Step 3: Test Header Toggle (Should Be Blocked)

**Action:** Press `Cmd + \` (or `Ctrl + \` on Windows/Linux)

**Expected Behavior:**
- ❌ Header does NOT appear
- ✅ Console log: `[overlay-windows] ⛔ Header toggle blocked - user not ready (state: welcome)`

**This confirms:** Auth check is working correctly

---

### Step 4: Test Login Button

**Action:** Click "Open Browser to Log in" button

**Expected Behavior:**
- ✅ Browser opens to: `http://localhost:5173/login?source=desktop`
- ✅ Login page shows blue banner: "🖥️ Logging in for EVIA Desktop"
- ✅ Console logs:
  ```
  [WelcomeHeader] 🔍 Checking evia bridge: [object Object]
  [WelcomeHeader] ✅ Shell API available, opening browser...
  [Shell] ✅ Opened external URL: http://localhost:5173/login?source=desktop
  ```

---

### Step 5: Test "See Details" Link

**Action:** Click "See details" in footer

**Expected Behavior:**
- ✅ Browser opens to: `https://evia.work/privacy`
- ✅ Console log: `[Shell] ✅ Opened external URL: https://evia.work/privacy`

---

### Step 6: Test Token Redirect (Success Path)

Since we can't actually log in (would require valid credentials), we'll simulate the redirect:

**Action:** In browser address bar, type:
```
evia://auth-callback?token=test123
```

**Expected Behavior:**
- ✅ Desktop app receives callback
- ✅ Console logs:
  ```
  [main] 📥 Auth callback received
  [main] ✅ Token: test***  (first 4 chars shown)
  [main] 💾 Storing token in keytar...
  [HeaderController] ✅ Token stored successfully
  [HeaderController] State transition: welcome → permissions
  [overlay-windows] ✅ Permission window shown
  ```
- ✅ Welcome window closes
- ✅ Permission window opens (if permissions not already granted)
- **OR** (if permissions already granted in dev environment):
  ```
  [PermissionHeader] All permissions granted, auto-continuing...
  [HeaderController] State transition: permissions → ready
  [overlay-windows] ✅ Header window shown
  ```

---

### Step 7: Test Permissions Flow

**If Permission Window Appears:**

**Visual Checks:**
- ✅ Permission window title: "Grant Permissions"
- ✅ Microphone permission card
- ✅ Screen Recording permission card
- ✅ Status indicators (Granted/Not Granted)
- ✅ "Continue" button (enabled when all granted)

**Action:** Grant permissions if needed (macOS System Preferences)

**Expected Behavior:**
- ✅ After granting all permissions, click "Continue"
- ✅ Console log: `[HeaderController] State transition: permissions → ready`
- ✅ Permission window closes
- ✅ Main header appears

---

### Step 8: Verify Main Header Appears

**Visual Checks:**
- ✅ Main header is visible
- ✅ Header has glassmorphic design
- ✅ White border visible on ALL 4 sides (top, bottom, left, right)
- ✅ Bottom border is NOT cut off
- ✅ Header shows: EVIA logo, Listen button, Settings, etc.

**Console Logs:**
```
[HeaderController] State transition: permissions → ready
[overlay-windows] ✅ Header window shown
```

---

### Step 9: Test Header Toggle (Should Work Now)

**Action:** Press `Cmd + \`

**Expected Behavior:**
- ✅ Header toggles visibility (hide/show)
- ✅ No console errors
- ✅ Toggle works because `currentState === 'ready'`

---

### Step 10: Test Error Handling

**Action:** In browser, type:
```
evia://auth-callback?error=Invalid credentials
```

**Expected Behavior:**
- ✅ Desktop receives error callback
- ✅ Console logs:
  ```
  [main] 📥 Auth callback received
  [main] ❌ Error: Invalid credentials
  [HeaderController] ❌ Auth error, returning to welcome
  [HeaderController] State transition: ready → welcome
  ```
- ✅ Main header closes
- ✅ Welcome window appears again
- ✅ Error toast/notification shown (if implemented)

---

### Step 11: Test Logout Flow

**Prerequisite:** Must be in 'ready' state (header visible)

**Action:** 
1. Click Settings in header
2. Click "Logout" button (or trigger logout via IPC)

**Expected Behavior:**
- ✅ Console logs:
  ```
  [HeaderController] 🚪 Logout triggered
  [HeaderController] 🗑️ Deleting token from keytar...
  [HeaderController] ✅ Token deleted
  [HeaderController] State transition: ready → welcome
  ```
- ✅ Main header closes
- ✅ Welcome window appears
- ✅ App state reset to unauthenticated

---

### Step 12: Test Quit Button

**Action:** Click × button on Welcome window

**Expected Behavior:**
- ✅ Console log: `[app] 🚪 Quit triggered from Welcome window`
- ✅ App quits completely (all windows close)
- ✅ Electron process terminates

---

## ✅ Success Criteria Checklist

### Welcome Window:
- [ ] Appears on app launch (no header visible)
- [ ] Has correct UI design (Glass parity)
- [ ] Button doesn't overlap text
- [ ] "Open Browser to Log in" button works
- [ ] "See details" link opens privacy policy
- [ ] Close button quits app
- [ ] Dark background with white border

### Authentication:
- [ ] Browser opens to `/login?source=desktop`
- [ ] Frontend shows desktop indicator
- [ ] `evia://auth-callback?token=...` works
- [ ] Token stored in keytar
- [ ] Error handling works (`?error=...`)

### Header Blocking:
- [ ] Cmd+\ does nothing when not authenticated
- [ ] Cmd+\ works when authenticated
- [ ] Console shows "blocked" message when appropriate

### Permissions:
- [ ] Permission window shows (if needed)
- [ ] Permissions can be granted
- [ ] Auto-continues when all granted
- [ ] Transitions to ready state

### Main Header:
- [ ] Appears only when authenticated + permissions granted
- [ ] Has complete border on all 4 sides
- [ ] Bottom border NOT cut off
- [ ] Can be toggled with Cmd+\

### Logout:
- [ ] Deletes token from keytar
- [ ] Returns to welcome window
- [ ] Main header closes

---

## 🐛 Common Issues & Troubleshooting

### Issue 1: Welcome window doesn't appear
**Check:**
- Console for errors
- `HeaderController` initialization logs
- `.env` file exists

**Fix:**
- Restart app with `EVIA_DEV=1 npm run dev:main`

### Issue 2: Login button doesn't work
**Check:**
- Console logs for `[WelcomeHeader]` messages
- `.env` has `VITE_FRONTEND_URL=http://localhost:5173`

**Fix:**
- Verify `.env` file
- Check if `shell.openExternal` is accessible

### Issue 3: Header appears before login
**Check:**
- `HeaderController` state logs
- `handleHeaderToggle` auth check

**Fix:**
- Verify fix at `src/main/overlay-windows.ts:651-659`

### Issue 4: Header border cut off
**Check:**
- Window height in `overlay-windows.ts` (should be 49px)
- Header CSS in `EviaBar.tsx` (margin: 1px 0, overflow: visible)

**Fix:**
- Verify both fixes are present

### Issue 5: Protocol handler doesn't work
**Check:**
- `electron-builder.yml` has `protocols:` section
- App is in development mode (EVIA_DEV=1)

**Fix:**
- In dev mode, protocol may not work; test in production build

---

## 📸 Screenshot Checklist

Capture screenshots of:
1. ✅ Welcome window (clean state, no header)
2. ✅ Browser with login page (`?source=desktop` banner)
3. ✅ Permission window (if shown)
4. ✅ Main header (with complete border)
5. ✅ Main header bottom edge (proving border not cut off)
6. ✅ Console logs showing state transitions

---

## 📝 Testing Notes Template

```
# E2E Test Results - [Date/Time]

## Environment:
- macOS Version: 
- Node Version: 
- Electron Version: 

## Test Results:

### Welcome Window: ✅/❌
- Appears correctly: 
- UI matches Glass: 
- Button works: 

### Authentication: ✅/❌
- Browser opens: 
- Token redirect works: 
- Token stored: 

### Header Blocking: ✅/❌
- Blocked when not ready: 
- Works when ready: 

### Main Header: ✅/❌
- Appears when ready: 
- Border complete: 

### Logout: ✅/❌
- Returns to welcome: 
- Token deleted: 

## Issues Found:
[List any issues]

## Screenshots:
[Attach screenshots]

## Console Logs:
[Paste relevant logs]
```

---

## 🚀 Next Steps After Manual Testing

### If All Tests Pass:
1. ✅ Proceed to merge branches
2. ✅ Build DMG
3. ✅ Signal "MVP FINALIZED"

### If Issues Found:
1. ❌ Document all issues
2. ❌ Fix critical blockers
3. ❌ Re-test
4. ❌ Report to coordinator

---

**Guide Created:** October 10, 2025  
**Status:** Ready for manual testing  
**Estimated Testing Time:** 10-15 minutes  
**Required:** macOS with Xcode CLI tools, Node 20.x, active backend/frontend

