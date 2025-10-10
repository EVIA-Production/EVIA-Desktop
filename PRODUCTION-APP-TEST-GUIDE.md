# EVIA Desktop Production App - Test Guide

## 🎯 Summary

After extensive debugging, we discovered that **dev mode screen recording permissions are impossible to fix** due to macOS process hierarchy. The solution is to use the **production app**.

---

## 🔍 Root Cause Analysis

### The Dev Mode Problem

**Process Hierarchy:**
```
Cursor (com.cursor.Cursor)
  └─ npm
      └─ node
          └─ Electron (com.github.Electron)
              └─ EVIA Desktop
```

**Why It Fails:**
1. macOS TCC system checks the "responsible process"
2. The responsible process is the user-facing app that initiated the action
3. For dev mode, that's **Cursor**, not Electron
4. Even though Electron.app has Screen Recording permission, macOS checks Cursor's permission first
5. The permission check fails due to process attribution issues

**Evidence:**
- macOS prompt says: **"Cursor" would like to record...** (not Electron)
- Even after granting Electron permission, still shows `denied`
- Multiple Electron.app bundles (EVIA + Glass) caused confusion
- Process hierarchy cannot be changed in dev mode

---

## ✅ The Solution: Production App

**What's Different:**
- **Bundle ID:** `com.evia.desktop` (unique, not generic `com.github.Electron`)
- **Process Hierarchy:** EVIA Desktop (standalone, no parent)
- **Responsible Process:** EVIA Desktop itself
- **macOS Prompt:** "EVIA Desktop would like to record..." ✅

**Build Details:**
- **DMG:** `dist/EVIA Desktop-0.1.0-arm64.dmg` (2.7GB)
- **Installed:** `/Applications/EVIA Desktop.app`
- **Code Signed:** Ad-hoc signature with full entitlements
- **Entitlements:** screen-recording, microphone, camera, JIT ✅

---

## 🚀 Testing Instructions

### Step 1: Launch Production App

```bash
open -a "EVIA Desktop"
```

**Alternative:** Double-click "EVIA Desktop" in Applications folder

---

### Step 2: Expected Flow

1. **Welcome Window Appears**
   - Shows "Welcome to EVIA" message
   - "Get Started" text
   - "Open Browser to Log In" button

2. **Click "Open Browser to Log In"**
   - Browser opens to: `http://localhost:5173/login?source=desktop`
   - Welcome window closes immediately

3. **Log In**
   - Enter credentials
   - Click "Sign In"
   - Redirects to: `evia://auth-callback?token=...`

4. **Permission Window Appears**
   - Shows two permissions:
     - 🎤 Microphone (should be instant "Access Granted")
     - 🖥️ Screen Recording (click to grant)

5. **Grant Screen Recording**
   - Click "Grant Screen Recording Access"
   - **macOS prompts: "EVIA Desktop would like to record..."** ✅
   - Click "Open System Settings"
   - Add "EVIA Desktop" to Screen Recording list
   - Toggle it ON
   - Return to permission window

6. **Auto-Continue**
   - Permission window shows both granted
   - Auto-continues to main header (3-second countdown)
   - Main header appears at top of screen

---

### Step 3: Verify Success

**Check Terminal Output:**
```
[HeaderController] Initial state data: {
  hasToken: true,
  micPermission: 'granted',
  screenPermission: 'granted',  ← Should be 'granted'
  permissionsCompleted: false
}
[HeaderController] Determined state: ready  ← Should be 'ready'
[HeaderController] State transition: permissions → ready
```

**Visual Confirmation:**
- ✅ Main header visible at top of screen
- ✅ German text: "Deutsch sprechen"
- ✅ Listen and Ask buttons functional
- ✅ No permission window visible

---

## 📊 Success Criteria

| Criterion | Expected | Status |
|-----------|----------|--------|
| macOS prompts for "EVIA Desktop" | ✅ Yes | ⏳ Testing |
| Screen Recording permission grants | ✅ Yes | ⏳ Testing |
| Permission window shows both granted | ✅ Yes | ⏳ Testing |
| Auto-continues to main header | ✅ Yes | ⏳ Testing |
| Main header appears and functions | ✅ Yes | ⏳ Testing |
| E2E flow completes without errors | ✅ Yes | ⏳ Testing |

---

## 🐛 Troubleshooting

### Issue: Still prompts for Cursor

**Diagnosis:** Old Electron processes still running

**Fix:**
```bash
pkill -9 -f Electron
pkill -9 -f electron
open -a "EVIA Desktop"
```

---

### Issue: "EVIA Desktop" not in Screen Recording list

**Diagnosis:** App hasn't triggered the permission request yet

**Fix:**
1. Click "Grant Screen Recording Access" button
2. Wait for macOS prompt
3. Click "Open System Settings"
4. Use [+] button to add EVIA Desktop manually

---

### Issue: Permission still shows denied

**Diagnosis:** macOS TCC cache needs refresh

**Fix:**
```bash
# Reset TCC for EVIA Desktop
tccutil reset ScreenCapture com.evia.desktop

# Restart the app
pkill -f "EVIA Desktop"
open -a "EVIA Desktop"
```

---

### Issue: App crashes on launch

**Diagnosis:** Backend or Frontend not running

**Fix:**
```bash
# Check Backend
curl http://localhost:8000/api/health

# Check Frontend
curl http://localhost:5173

# If either fails, start them:
cd /Users/benekroetz/EVIA/EVIA-Backend && uvicorn main:app --reload &
cd /Users/benekroetz/EVIA/EVIA-Frontend && npm run dev &
```

---

## 📁 Files and Locations

**Production App:**
- DMG: `/Users/benekroetz/EVIA/EVIA-Desktop/dist/EVIA Desktop-0.1.0-arm64.dmg`
- Installed: `/Applications/EVIA Desktop.app`
- Bundle ID: `com.evia.desktop`

**Auth State:**
- State file: `~/Library/Application Support/evia-desktop/auth-state.json`
- Keychain: `evia-desktop` service

**Logs:**
- Console: Check "EVIA Desktop" process in Console.app
- Terminal: Run from terminal to see stdout/stderr

---

## 🎉 After Successful Test

Once the production app E2E flow works:

1. **Document Success:**
   - Screenshot the main header
   - Save terminal logs
   - Note any issues encountered

2. **Merge Branches:**
   ```bash
   cd /Users/benekroetz/EVIA/EVIA-Desktop
   git checkout main
   git merge desktop-mvp-finish
   git push origin main
   
   cd /Users/benekroetz/EVIA/EVIA-Frontend
   git checkout main
   git merge frontend-vite-fix
   git push origin main
   ```

3. **Signal MVP Complete:**
   ```
   ✅ MVP FINALIZED
   
   DMG: /Users/benekroetz/EVIA/EVIA-Desktop/dist/EVIA Desktop-0.1.0-arm64.dmg
   Size: 2.7GB
   Bundle ID: com.evia.desktop
   Platform: macOS (arm64)
   
   E2E Flow: ✅ Complete
   - Welcome → Login → Permissions → Header
   - Auth integration working
   - Permissions working (microphone + screen recording)
   - Main header functional
   
   Known Limitations:
   - Dev mode permissions don't work (process hierarchy issue)
   - Must use production app for testing
   - DMG is large (includes debug symbols)
   ```

---

## 🔑 Key Learnings

1. **macOS TCC is process-hierarchy aware**
   - Checks "responsible process", not just immediate process
   - Dev environments (Cursor → npm → Electron) can't work
   - Production apps (standalone) work correctly

2. **Multiple Electron.app bundles cause confusion**
   - All show as "Electron" in System Settings
   - Must use exact paths to distinguish
   - Production apps avoid this with unique bundle IDs

3. **Code signing must include entitlements**
   - electron-builder doesn't auto-include entitlements with ad-hoc signing
   - Must manually re-sign after build
   - Entitlements verified via `codesign -d --entitlements`

4. **Process attribution matters**
   - macOS shows parent process name in permission prompts
   - User sees "Cursor" even though Electron makes the request
   - Confusing UX, hard to debug

---

## 📞 Need Help?

If issues persist:
1. Check Console.app for "EVIA Desktop" errors
2. Verify Backend/Frontend are running
3. Reset auth state: `rm ~/Library/Application\ Support/evia-desktop/auth-state.json`
4. Clear Keychain: `security delete-generic-password -s evia-desktop`
5. Restart Mac (last resort for TCC issues)

---

**Status:** Production app ready for testing
**Date:** October 10, 2024
**Build:** EVIA Desktop 0.1.0-arm64
**Branch:** desktop-mvp-finish


