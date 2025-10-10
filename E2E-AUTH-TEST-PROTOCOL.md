# E2E Authentication Flow Test Protocol ✅

## 🚀 YOU CAN TEST NOW! All code is complete.

**Status:** Ready for manual E2E testing  
**Time Required:** 15-20 minutes  
**Prerequisites:** Backend + Frontend + Desktop dev servers running

---

## Phase 1: Pre-flight Checklist (5 min)

### 1.1 Clean Slate - Reset All Auth State

```bash
# Delete existing token from macOS Keychain
security delete-generic-password -s evia -a token 2>/dev/null || echo "No existing token (OK)"

# Delete Desktop auth state file
rm -f ~/Library/Application\ Support/EVIA\ Desktop/auth-state.json

# Clear Frontend localStorage (run in browser DevTools console after opening Frontend)
# localStorage.clear(); // Run this after opening http://localhost:5173
```

### 1.2 Start Backend (Terminal 1)

```bash
cd /Users/benekroetz/EVIA/EVIA-backend
docker-compose up
# Wait for: "Application startup complete"
# Verify: http://localhost:8000/health should return {"status":"healthy"}
```

### 1.3 Start Frontend (Terminal 2)

```bash
cd /Users/benekroetz/EVIA/EVIA-Frontend
npm run dev
# Wait for: "Local: http://localhost:5173/"
# Verify: Open http://localhost:5173 - should show login page
```

### 1.4 Start Desktop Renderer (Terminal 3)

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
npm run dev:renderer
# Wait for: "Local: http://localhost:5174/"
# Note: This won't be directly accessed by browser (Electron loads it)
```

### 1.5 Start Desktop Main Process (Terminal 4)

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
EVIA_DEV=1 npm run dev:main
# Wait for Electron window to appear
# Watch console for: "[HeaderController] 🚀 Initializing..."
```

---

## Phase 2: Test Flow #1 - First-Time User (10 min)

### Step 1: Verify Welcome Window Appears ✅

**Expected:**
- Electron window opens (400×340px, centered)
- Shows "Welcome to EVIA" glassmorphism UI
- Two option cards visible:
  1. "Quick start with default API key" → "Open Browser to Log in" button
  2. "Use Personal API keys" → "Enter Your API Key" button (not yet implemented)

**Verify in Desktop Console:**
```
[HeaderController] 🚀 Initializing...
[HeaderController] Initial state data: { hasToken: false, ... }
[HeaderController] Determined state: welcome
[HeaderController] State transition: welcome → welcome
[overlay-windows] ✅ Welcome window shown
```

**Screenshot:** Take screenshot of Welcome window

---

### Step 2: Click "Open Browser to Log in" ✅

**Action:** Click the "Open Browser to Log in" button in Welcome window

**Expected:**
- Browser opens to: `http://localhost:5173/login?source=desktop`
- Frontend shows login page with blue banner: "🖥️ Logging in for EVIA Desktop"
- Desktop Welcome window stays open (doesn't close yet)

**Verify in Desktop Console:**
```
[WelcomeEntry] Login button clicked, opening external URL
[Shell] ✅ Opened external URL: http://localhost:5173/login?source=desktop
```

**Verify in Browser DevTools Console:**
```
(URL bar shows: http://localhost:5173/login?source=desktop)
```

**Screenshot:** Take screenshot of login page with desktop banner

---

### Step 3: Log In on Frontend ✅

**Action:** Enter credentials and click "Sign In"
- Username: (your test username)
- Password: (your test password)

**Expected (Frontend):**
- Toast appears: "Login successful"
- After 1 second, browser redirects to `evia://auth-callback?token=...`
- Browser may show "Open EVIA Desktop?" dialog (if protocol handler prompt appears)

**Verify in Browser DevTools Console:**
```
[Auth] 🖥️ Desktop source detected (source=desktop), preparing redirect...
[Auth] ✅ Token retrieved successfully
[Auth] 📦 Token length: XXX characters
[Auth] 🔗 Redirect URL constructed: evia://auth-callback?token=...[REDACTED]
[Auth] 🚀 Executing desktop redirect now...
```

**Expected (Desktop):**
- Welcome window closes
- Permission window opens (285×220px, centered)

**Verify in Desktop Console:**
```
[Protocol] 🔗 macOS open-url: evia://auth-callback?token=...
[Auth] ✅ Received token, delegating to HeaderController
[HeaderController] 🔑 Auth callback received, storing token
[HeaderController] ✅ Token stored in keytar
[HeaderController] State transition: welcome → permissions
[overlay-windows] ✅ Welcome window closed
[overlay-windows] ✅ Permission window shown
```

**Screenshot:** Take screenshot of Permission window

---

### Step 4: Grant Microphone Permission ✅

**Action:** Click "Grant Microphone Access" button

**Expected:**
- macOS native permission dialog appears: "EVIA Desktop would like to access the microphone"
- Click "OK"
- Permission window updates: Microphone shows green checkmark ✓

**Verify in Desktop Console:**
```
[PermissionHeader] Requesting microphone permission...
[Permissions] 📢 Requesting microphone permission...
[Permissions] ✅ Microphone permission result: granted
[PermissionHeader] Permission check result: { microphone: 'granted', screen: '...' }
```

**Screenshot:** Take screenshot showing microphone granted

---

### Step 5: Grant Screen Recording Permission ✅

**Action:** Click "Grant Screen Recording Access" button

**Expected:**
- System Preferences opens to "Privacy & Security" → "Screen & System Audio Recording"
- Find "EVIA Desktop" (or Electron) in the list
- Toggle it ON
- Return to EVIA Desktop

**Note:** macOS may require app restart after granting screen recording permission

**Verify in Desktop Console:**
```
[PermissionHeader] Opening System Preferences for screen recording...
[Permissions] 🔧 Opening System Preferences for: screen
[Permissions] ✅ System Preferences opened
```

**After Granting (may need to relaunch app):**
```
[PermissionHeader] Permission check result: { microphone: 'granted', screen: 'granted' }
```

**Screenshot:** Take screenshot of System Preferences with EVIA enabled

---

### Step 6: Continue to Main Header ✅

**Expected (Auto or Manual):**
- When both permissions granted, "Continue to EVIA" green button appears
- Click it (or it auto-continues after 500ms)
- Permission window closes
- Main header (EviaBar) appears

**Verify in Desktop Console:**
```
[PermissionHeader] All permissions granted, auto-continuing in 500ms...
[PermissionEntry] All permissions granted, transitioning to main header...
[Permissions] ✅ Marking permissions complete via HeaderController
[HeaderController] ✅ Permissions marked as complete
[HeaderController] State transition: permissions → ready
[overlay-windows] ✅ Permission window closed
[overlay-windows] ✅ Header window shown
```

**Verify Persistence:**
```bash
# Check token stored in keytar
security find-generic-password -s evia -a token -w
# Should output: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Check auth state saved
cat ~/Library/Application\ Support/EVIA\ Desktop/auth-state.json
# Should show: { "permissionsCompleted": true }
```

**Screenshot:** Take screenshot of main header (EviaBar)

---

## Phase 3: Test Flow #2 - Returning User (2 min)

### Step 7: Quit and Relaunch ✅

**Action:**
1. Quit EVIA Desktop (Cmd+Q or close window)
2. Relaunch: `EVIA_DEV=1 npm run dev:main`

**Expected:**
- **No Welcome window**
- **No Permission window**
- Main header (EviaBar) appears **immediately**

**Verify in Desktop Console:**
```
[HeaderController] 🚀 Initializing...
[HeaderController] Loaded persisted state: { permissionsCompleted: true }
[HeaderController] Initial state data: { hasToken: true, micPermission: 'granted', screenPermission: 'granted', permissionsCompleted: true }
[HeaderController] Determined state: ready
[HeaderController] State transition: welcome → ready
[overlay-windows] ✅ Header window shown
```

**Screenshot:** Take screenshot showing immediate header appearance

---

## Phase 4: Test Flow #3 - Logout (3 min)

### Step 8: Logout ✅

**Action:** 
1. Open Settings window (click Settings button in header)
2. Click "Logout" button (if implemented, otherwise use DevTools)

**Alternative (DevTools Console in Electron):**
```javascript
window.evia.auth.logout()
```

**Expected:**
- Main header closes
- Welcome window appears
- Token deleted from keytar
- Auth state file reset

**Verify in Desktop Console:**
```
[Auth] ✅ Logging out via HeaderController
[HeaderController] 🚪 Logging out...
[HeaderController] ✅ Logged out, returning to welcome
[HeaderController] State transition: ready → welcome
[overlay-windows] ✅ Header window closed (if exists)
[overlay-windows] ✅ Welcome window shown
```

**Verify Cleanup:**
```bash
# Token should be deleted
security find-generic-password -s evia -a token -w 2>&1
# Should output: "The specified item could not be found in the keychain."

# Auth state should be reset
cat ~/Library/Application\ Support/EVIA\ Desktop/auth-state.json
# Should show: { "permissionsCompleted": false }
```

**Screenshot:** Take screenshot of Welcome window after logout

---

## Phase 5: Test Flow #4 - Error Handling (5 min)

### Step 9: Test Invalid Credentials ✅

**Action:**
1. Click "Open Browser to Log in" from Welcome window
2. Enter **wrong** credentials on Frontend
3. Click "Sign In"

**Expected (Frontend):**
- Error toast appears: "Login failed" / "Invalid username or password"
- After 2 seconds, browser redirects to `evia://auth-callback?error=...`

**Expected (Desktop):**
- Error dialog appears: "Login Failed" with error message
- Welcome window stays open (no transition)

**Verify in Desktop Console:**
```
[Protocol] 🔗 macOS open-url: evia://auth-callback?error=...
[Auth] ❌ Callback error: Invalid username or password
[HeaderController] ❌ Auth error received: ...
[HeaderController] State transition: welcome → welcome
```

**Screenshot:** Take screenshot of error dialog

---

### Step 10: Test Permission Revocation Detection ✅

**Action:**
1. Log in successfully (Welcome → Login → Permissions granted → Main header)
2. Quit EVIA Desktop
3. Open System Preferences → Privacy & Security → Screen Recording
4. **Disable** EVIA Desktop / Electron
5. Relaunch EVIA Desktop

**Expected:**
- Permission window appears (not main header)
- Shows microphone ✓ granted, screen recording ✗ not granted
- User can re-grant screen recording

**Verify in Desktop Console:**
```
[HeaderController] 🚀 Initializing...
[HeaderController] Initial state data: { hasToken: true, micPermission: 'granted', screenPermission: 'denied', permissionsCompleted: true }
[HeaderController] Determined state: permissions
[HeaderController] State transition: welcome → permissions
[overlay-windows] ✅ Permission window shown
```

**Screenshot:** Take screenshot showing screen permission as not granted

---

## Phase 6: Protocol Handler Verification

### Test Deep Link Manually (Sanity Check)

**In Terminal:**
```bash
# Test success callback
open "evia://auth-callback?token=test_token_12345"

# Test error callback
open "evia://auth-callback?error=Test%20error%20message"
```

**Expected:**
- EVIA Desktop receives the deep link
- Console shows protocol handler logs
- HeaderController processes the callback

**Note:** This won't complete the flow (fake token), but verifies protocol registration works.

---

## Success Criteria Checklist ✅

### First-Time User Flow
- [ ] Welcome window appears on first launch
- [ ] "Open Browser to Log in" opens Frontend with `?source=desktop`
- [ ] Frontend shows desktop banner
- [ ] Login succeeds → browser redirects to `evia://auth-callback?token=...`
- [ ] Desktop receives token via deep link
- [ ] Token stored in keytar (verify with `security find-generic-password`)
- [ ] Welcome window closes
- [ ] Permission window appears
- [ ] Microphone permission granted → checkmark appears
- [ ] Screen recording permission granted → checkmark appears
- [ ] "Continue to EVIA" button appears
- [ ] Click continue → Permission window closes
- [ ] Main header appears
- [ ] Auth state saved to `auth-state.json`

### Returning User Flow
- [ ] Relaunch app → Main header appears immediately
- [ ] No Welcome window shown
- [ ] No Permission window shown
- [ ] Console shows "Determined state: ready"

### Logout Flow
- [ ] Logout → Main header closes
- [ ] Welcome window appears
- [ ] Token deleted from keytar
- [ ] Auth state reset (`permissionsCompleted: false`)

### Error Handling
- [ ] Invalid credentials → Error dialog in Desktop
- [ ] Welcome window stays open after error
- [ ] Permission revoked → Permission window appears on next launch
- [ ] Deep links work manually (`open "evia://auth-callback?token=..."`)

---

## Troubleshooting Guide

### Issue: Protocol Handler Not Working (deep links ignored)

**Symptoms:** Browser redirects to `evia://` but nothing happens in Desktop

**Solutions:**
1. **Dev Mode Registration:**
   ```bash
   # Verify protocol registered
   cd /Users/benekroetz/EVIA/EVIA-Desktop
   grep -A5 "setAsDefaultProtocolClient" src/main/main.ts
   ```

2. **Manually Register Protocol (macOS dev workaround):**
   ```bash
   # Create a minimal app bundle for protocol registration
   cd /Users/benekroetz/EVIA/EVIA-Desktop
   npm run build
   open dist/mac-arm64/EVIA\ Desktop.app
   # Launch the built app once to register protocol, then quit
   # Now dev mode should work: open "evia://auth-callback?token=test"
   ```

3. **Alternative: Use `second-instance` event (works immediately):**
   - In another Terminal: `open "evia://auth-callback?token=test"`
   - Should trigger `second-instance` event even if `open-url` doesn't work

---

### Issue: Welcome/Permission Windows Not Appearing

**Symptoms:** Blank screen or no window on launch

**Solutions:**
1. **Check Vite Dev Server:**
   ```bash
   curl http://localhost:5174/welcome.html
   # Should return HTML (not 404)
   ```

2. **Check Build Files:**
   ```bash
   ls -la /Users/benekroetz/EVIA/EVIA-Desktop/dist/renderer/
   # Should show: welcome.html, permission.html, index.html, overlay.html
   ```

3. **Force Rebuild:**
   ```bash
   cd /Users/benekroetz/EVIA/EVIA-Desktop
   rm -rf dist/
   npm run build
   ```

4. **Check Console for Load Errors:**
   - Look for: "Failed to load URL" or CSP errors
   - Verify: `VITE_DEV_SERVER_URL = 'http://localhost:5174'` in overlay-windows.ts

---

### Issue: Token Not Stored in Keytar

**Symptoms:** Console shows "Token stored" but `security find-generic-password` returns nothing

**Solutions:**
1. **Check Keytar Permissions:**
   ```bash
   # Grant Terminal access to Keychain (if prompted)
   # Or grant EVIA Desktop.app access in Keychain Access.app
   ```

2. **Verify Keytar Working:**
   ```javascript
   // In Electron DevTools console:
   const keytar = require('keytar');
   await keytar.setPassword('test-service', 'test-account', 'test-password');
   await keytar.getPassword('test-service', 'test-account'); // Should return 'test-password'
   ```

3. **Check Node Version:**
   ```bash
   node --version  # Should be 20.x.x (same as Electron)
   ```

---

### Issue: Permissions Not Detected

**Symptoms:** Permission window shows "unknown" or "denied" even after granting

**Solutions:**
1. **Restart App After Granting Screen Recording:**
   - macOS caches permission state
   - Quit and relaunch EVIA Desktop

2. **Check systemPreferences API:**
   ```javascript
   // In Electron main process (add to main.ts temporarily):
   const { systemPreferences } = require('electron');
   console.log('Mic:', systemPreferences.getMediaAccessStatus('microphone'));
   console.log('Screen:', systemPreferences.getMediaAccessStatus('screen'));
   ```

3. **Manual Permission Grant:**
   - System Preferences → Privacy & Security → Microphone → Add EVIA Desktop
   - System Preferences → Privacy & Security → Screen & System Audio Recording → Add EVIA Desktop

---

### Issue: Frontend Redirect Not Firing

**Symptoms:** Login succeeds but no redirect to `evia://`

**Solutions:**
1. **Check `?source=desktop` Parameter:**
   ```javascript
   // In browser DevTools console:
   console.log(window.location.search); // Should show "?source=desktop"
   ```

2. **Check Token in localStorage:**
   ```javascript
   // In browser DevTools console:
   console.log(localStorage.getItem('auth_token')); // Should show JWT
   ```

3. **Check Console Logs:**
   - Look for: `[Auth] 🖥️ Desktop source detected`
   - If missing, URL parameter might be lost (check React Router config)

---

## Performance Metrics

### Expected Timings
- Welcome window → visible: < 500ms
- Login → redirect: 1-2 seconds (includes toast delay)
- Deep link → Desktop receives: < 100ms
- Permission check interval: every 1000ms
- State transitions: < 200ms

### Console Log Patterns (Success)
```
[HeaderController] 🚀 Initializing...
[HeaderController] Determined state: welcome
[overlay-windows] ✅ Welcome window shown
[Shell] ✅ Opened external URL
[Protocol] 🔗 macOS open-url: evia://auth-callback?token=...
[HeaderController] 🔑 Auth callback received
[HeaderController] State transition: welcome → permissions
[Permissions] ✅ Microphone permission result: granted
[Permissions] ✅ System Preferences opened
[PermissionHeader] All permissions granted
[HeaderController] ✅ Permissions marked as complete
[HeaderController] State transition: permissions → ready
[overlay-windows] ✅ Header window shown
```

---

## Final Verification Script

```bash
#!/bin/bash
# Run this after completing all tests

echo "🔍 E2E Auth Flow Verification"
echo "=============================="
echo ""

# 1. Check token in keytar
echo "1. Keytar Token Check:"
security find-generic-password -s evia -a token -w 2>/dev/null && echo "   ✅ Token exists in Keychain" || echo "   ❌ No token found"
echo ""

# 2. Check auth state file
echo "2. Auth State File Check:"
if [ -f ~/Library/Application\ Support/EVIA\ Desktop/auth-state.json ]; then
    echo "   ✅ State file exists:"
    cat ~/Library/Application\ Support/EVIA\ Desktop/auth-state.json | jq .
else
    echo "   ❌ State file not found"
fi
echo ""

# 3. Check protocol registration (requires built app)
echo "3. Protocol Handler Check:"
if [ -d "dist/mac-arm64/EVIA Desktop.app" ]; then
    echo "   ✅ Built app exists (protocol should be registered)"
    defaults read dist/mac-arm64/EVIA\ Desktop.app/Contents/Info.plist CFBundleURLTypes 2>/dev/null && echo "   ✅ Protocol defined in Info.plist" || echo "   ⚠️  Check Info.plist"
else
    echo "   ⚠️  No built app (dev mode only)"
fi
echo ""

# 4. Check permissions (requires Electron app running)
echo "4. System Permissions Check:"
echo "   Run this in Electron DevTools:"
echo "   window.evia.permissions.check().then(console.log)"
echo ""

echo "=============================="
echo "📸 Don't forget to take screenshots for each step!"
echo "✅ If all checks pass, E2E flow is working correctly!"
```

**Save and run:**
```bash
chmod +x verify-auth.sh
./verify-auth.sh
```

---

## Next Steps After Successful Test

1. **Document Results:**
   - Attach all screenshots to test report
   - Record any console warnings/errors
   - Note timing measurements

2. **Build DMG:**
   ```bash
   cd /Users/benekroetz/EVIA/EVIA-Desktop
   npm run build
   # DMG will be in: dist/EVIA Desktop-0.1.0-arm64.dmg
   ```

3. **Test Production Build:**
   - Install DMG
   - Test same flow (protocol registration is built-in now)
   - Verify no dev server dependencies

4. **Report Success:**
   - "AUTH FLOW VERIFIED ✅"
   - Include: DMG link, screenshots, console logs, any issues found

---

## Emergency Rollback

If critical issues found:

```bash
# Desktop
cd /Users/benekroetz/EVIA/EVIA-Desktop
git checkout HEAD~1  # Rollback last commit

# Frontend
cd /Users/benekroetz/EVIA/EVIA-Frontend
git checkout HEAD~1  # Rollback last commit

# Clean state
security delete-generic-password -s evia -a token
rm ~/Library/Application\ Support/EVIA\ Desktop/auth-state.json
```

---

## Test Status Report Template

```markdown
# E2E Auth Flow Test Report

**Tester:** [Your Name]
**Date:** [Date]
**Branch:** desktop-mvp-finish (Desktop), frontend-auth-redirect (Frontend)

## Test Results

### First-Time User Flow
- [ ] Welcome window: PASS/FAIL (screenshot)
- [ ] Browser redirect: PASS/FAIL (screenshot)
- [ ] Token callback: PASS/FAIL (console log)
- [ ] Permission window: PASS/FAIL (screenshot)
- [ ] Mic permission: PASS/FAIL (screenshot)
- [ ] Screen permission: PASS/FAIL (screenshot)
- [ ] Main header: PASS/FAIL (screenshot)

### Returning User Flow
- [ ] Immediate header: PASS/FAIL (console log)

### Logout Flow
- [ ] State reset: PASS/FAIL (verification script)

### Error Handling
- [ ] Invalid credentials: PASS/FAIL (screenshot)
- [ ] Permission revocation: PASS/FAIL (screenshot)

## Issues Found
1. [Issue description]
2. [Issue description]

## Performance
- Welcome → visible: [XXX]ms
- Login → redirect: [XXX]s
- Total flow time: [XXX]s

## Screenshots
[Attach all screenshots]

## Console Logs
[Paste relevant console logs]

## Recommendation
✅ APPROVE FOR MERGE
❌ NEEDS FIXES (see issues)
```

---

**YOU ARE READY TO TEST NOW! 🚀**

Follow Phase 1 to prepare, then run through Phases 2-5 systematically.

