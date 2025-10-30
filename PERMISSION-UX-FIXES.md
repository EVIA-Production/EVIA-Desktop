# 🔧 Permission UX Fixes - Action Plan

**Date:** October 30, 2025  
**Status:** 🛠️ IN PROGRESS

---

## 🐛 Issues Reported

### Issue 1: Permission State Not Updating After Relaunch
**Problem:**
- User grants screen recording in System Settings
- Relaunches EVIA
- EVIA shows mic=granted, screen=NOT granted (even though it's granted)
- Can't open header to check/fix

**Root Cause:**
- macOS `systemPreferences.getMediaAccessStatus('screen')` caches result
- Need to force refresh after relaunch
- `permissionsCompleted` flag prevents re-checking

**Impact:** 🔴 CRITICAL - Blocks user from using app

---

### Issue 2: Can't Access Permission Window After Granted
**Problem:**
- Once permissions granted, no way to re-open permission window
- Other apps allow this (e.g., for review, debugging, re-granting)

**Root Cause:**
- `permissionsCompleted` flag bypasses permission window
- No UI element to force show permission window

**Impact:** 🟡 MODERATE - Poor UX for debugging

---

### Issue 3: "Malicious Software" Warning on First Launch
**Problem:**
- macOS Gatekeeper shows: "EVIA is damaged and can't be opened"
- User has to right-click → Open (not intuitive)

**Root Cause:**
- App not signed with Apple Developer certificate
- Only ad-hoc signed (local development)

**Impact:** 🟡 MODERATE - Bad first impression, but workaround exists

---

### Issue 4: DevTools Window Too Small
**Problem:**
- DevTools console doesn't show up
- Window too small to resize to console tab

**Root Cause:**
- Permission window size too small for DevTools

**Impact:** 🟢 MINOR - Debugging inconvenience

---

## ✅ Solutions

### Solution 1: Fix Permission State Detection

**Changes Needed:**

1. **Add Force Refresh on App Relaunch** (`header-controller.ts`)
   - Clear cached permission status on app activation
   - Re-check permissions with delay to allow macOS to update

2. **Reset `permissionsCompleted` if Permissions Lost** (`header-controller.ts`)
   - If `permissionsCompleted=true` but permissions not granted
   - Reset flag and show permission window again

3. **Add Retry Logic** (`PermissionHeader.tsx`)
   - If screen recording still "not-determined" after 2 seconds
   - Force re-check with exponential backoff

**Code Changes:**

```typescript
// header-controller.ts

private async getStateData(): Promise<StateData> {
  const token = await keytar.getPassword('evia', 'token');
  const hasToken = !!token;
  
  let micPermission = 'unknown';
  let screenPermission = 'unknown';
  
  if (process.platform === 'darwin') {
    try {
      // 🔥 FIX: Force fresh permission check (bypass cache)
      micPermission = systemPreferences.getMediaAccessStatus('microphone');
      screenPermission = systemPreferences.getMediaAccessStatus('screen');
      
      // 🔥 FIX: If permissions completed but not granted, reset flag
      if (this.permissionsCompleted && (micPermission !== 'granted' || screenPermission !== 'granted')) {
        console.log('[HeaderController] ⚠️ Permissions lost after completion, resetting flag');
        this.permissionsCompleted = false;
        this.savePersistedState();
      }
    } catch (err) {
      console.warn('[HeaderController] Failed to get permission status:', err);
    }
  }
  
  return {
    hasToken,
    micPermission,
    screenPermission,
    permissionsCompleted: this.permissionsCompleted,
  };
}

// Add new method: Force re-check on app activation
public async onAppActivated() {
  console.log('[HeaderController] 🔄 App activated, forcing permission re-check...');
  
  // Wait 500ms for macOS to update permission status
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await this.checkPermissions();
}
```

```typescript
// main.ts - Hook into app activation event

app.on('activate', async () => {
  console.log('[Main] 🔄 App activated');
  
  // Force permission re-check (fixes macOS caching)
  await headerController.onAppActivated();
});
```

---

### Solution 2: Add "Show Permissions" Button

**Changes Needed:**

1. **Add Menu Item** (`main.ts`)
   - "View → Permissions" menu item
   - Always available (not just when needed)

2. **Add IPC Handler** (`header-controller.ts`)
   - `permissions:show-window` handler
   - Force show permission window even if `permissionsCompleted=true`

3. **Add Button to Header** (Optional)
   - Small "⚙️ Permissions" button in header
   - Opens permission window for review

**Code Changes:**

```typescript
// main.ts - Add menu item

const template: MenuItemConstructorOptions[] = [
  {
    label: 'View',
    submenu: [
      {
        label: 'Show Permissions',
        accelerator: 'CmdOrCtrl+P',
        click: async () => {
          await headerController.showPermissionWindow();
        }
      },
      { type: 'separator' },
      { role: 'toggleDevTools' },
    ]
  },
  // ... other menu items
];
```

```typescript
// header-controller.ts - Add force show method

public async showPermissionWindow() {
  console.log('[HeaderController] 🔐 Force showing permission window');
  
  // Close any existing windows
  closeWelcomeWindow();
  const header = getHeaderWindow();
  if (header) header.close();
  
  // Open permission window (even if completed)
  await this.transitionTo('permissions');
}
```

```typescript
// main.ts - Add IPC handler

ipcMain.handle('permissions:show-window', async () => {
  await headerController.showPermissionWindow();
});
```

---

### Solution 3: Proper Code Signing (Production)

**Two Approaches:**

#### Approach A: Apple Developer Certificate (Recommended for Distribution)

**Requirements:**
- Apple Developer Account ($99/year)
- Developer ID Application certificate
- Notarization with Apple

**Steps:**

1. **Get Certificate:**
   ```bash
   # List available certificates
   security find-identity -v -p codesigning
   
   # If no certificate, enroll in Apple Developer Program
   # https://developer.apple.com/programs/
   ```

2. **Update `electron-builder.yml`:**
   ```yaml
   mac:
     icon: src/main/assets/icon.png
     productName: EVIA
     identity: "Developer ID Application: Your Name (TEAM_ID)"
     hardenedRuntime: true
     gatekeeperAssess: false
     entitlements: build/entitlements.mac.plist
     entitlementsInherit: build/entitlements.mac.plist
     notarize: true
   ```

3. **Add Notarization Config:**
   ```yaml
   afterSign: scripts/notarize.js
   ```

4. **Build & Sign:**
   ```bash
   export APPLE_ID="your@email.com"
   export APPLE_ID_PASSWORD="app-specific-password"
   export APPLE_TEAM_ID="TEAM_ID"
   
   npm run build
   ```

**Result:**
- ✅ No "malicious software" warning
- ✅ Double-click to open (no right-click needed)
- ✅ Professional distribution

**Time:** 1-2 hours (setup) + $99/year

---

#### Approach B: Ad-hoc Signing + User Instructions (Current)

**For Development/Testing:**

Keep current ad-hoc signing but improve user instructions:

1. **Update Quick Start Guide:**
   ```markdown
   ### First Launch
   
   1. Download `EVIA-arm64.dmg`
   2. Drag EVIA.app to Applications
   3. **Right-click** EVIA.app → **Open** (don't double-click!)
   4. Click "Open" in the warning dialog
   5. From now on, double-click works normally
   
   **Why?** macOS Gatekeeper checks unsigned apps. This is a one-time step.
   ```

2. **Add Visual Instructions:**
   - Screenshot showing right-click → Open
   - GIF showing the full flow

3. **In-App Help:**
   - If permission denied, show: "Right-click EVIA.app → Open"

**Result:**
- ⚠️ Still shows warning first time
- ✅ Free (no Apple Developer account)
- ✅ Works for testing/demos

**Time:** 30 minutes (documentation only)

---

### Solution 4: Fix DevTools Window Size

**Changes Needed:**

1. **Increase Permission Window Size** (`overlay-windows.ts`)
   - Current: 500x400
   - New: 700x600 (enough for DevTools)

2. **Make Window Resizable** (for debugging)

**Code Changes:**

```typescript
// overlay-windows.ts

export function createPermissionWindow() {
  permissionWindow = new BrowserWindow({
    width: 700,        // 🔧 Increased from 500
    height: 600,       // 🔧 Increased from 400
    resizable: true,   // 🔧 Allow resize for DevTools
    // ... other options
  });
  
  // ... rest of code
}
```

---

## 🎯 Priority & Timeline

| Issue | Priority | Complexity | Time | Status |
|-------|----------|------------|------|--------|
| **Permission State Bug** | 🔴 CRITICAL | Medium | 1-2 hours | 🛠️ Next |
| **Show Permissions Button** | 🟡 MODERATE | Low | 30 min | 🛠️ Next |
| **DevTools Size** | 🟢 MINOR | Low | 5 min | 🛠️ Next |
| **Code Signing (Dev Instructions)** | 🟡 MODERATE | Low | 30 min | 🛠️ Next |
| **Code Signing (Production)** | 🟢 NICE-TO-HAVE | High | 2-4 hours + $99 | ⏸️ Later |

---

## 🚀 Implementation Order

### Phase 1: Critical Fixes (1-2 hours)
1. ✅ Fix permission state detection
2. ✅ Add force re-check on app activation
3. ✅ Reset `permissionsCompleted` if permissions lost
4. ✅ Increase DevTools window size

### Phase 2: UX Improvements (30-45 min)
5. ✅ Add "View → Permissions" menu item
6. ✅ Improve user instructions for "malicious software" warning
7. ✅ Test full flow

### Phase 3: Production (Optional, later)
8. ⏸️ Get Apple Developer certificate
9. ⏸️ Set up notarization
10. ⏸️ Build signed release

---

## 🧪 Testing Plan

### Test Case 1: Permission State Refresh
1. Fresh install (no permissions)
2. Grant mic permission
3. Relaunch app
4. ✅ Check: Mic shows as granted
5. Grant screen recording in System Settings
6. Relaunch app
7. ✅ Check: Screen recording shows as granted
8. ✅ Check: Auto-continues to header

### Test Case 2: Re-open Permission Window
1. All permissions granted
2. Click "View → Permissions" menu
3. ✅ Check: Permission window opens
4. Click "Continue"
5. ✅ Check: Returns to header

### Test Case 3: Permission Loss Detection
1. All permissions granted, app running
2. Revoke mic in System Settings
3. Activate app (Cmd+Tab)
4. ✅ Check: App detects permission loss
5. ✅ Check: Returns to permission window

### Test Case 4: DevTools Access
1. Open permission window
2. Open DevTools (Cmd+Option+I)
3. ✅ Check: Can access Console tab
4. ✅ Check: Can resize window

---

## 📖 Related Files

**To Modify:**
- `EVIA-Desktop/src/main/header-controller.ts` - Permission state logic
- `EVIA-Desktop/src/main/main.ts` - App activation hook, menu
- `EVIA-Desktop/src/renderer/overlay/PermissionHeader.tsx` - Retry logic
- `EVIA-Desktop/src/main/overlay-windows.ts` - Window size
- `EVIA-Desktop/QUICK-START-GUIDE.md` - User instructions
- `EVIA-Desktop/electron-builder.yml` - Code signing config (optional)

**To Create:**
- `EVIA-Desktop/scripts/notarize.js` - Notarization script (optional)
- `EVIA-Desktop/FIRST-LAUNCH-INSTRUCTIONS.md` - Visual guide

---

## 💡 Additional Improvements (Future)

1. **Permission Status Indicator in Header**
   - Small icons showing mic/screen status
   - Click to re-check or open System Settings

2. **Auto-Detect Permission Loss**
   - Listen for permission revocation events
   - Show alert: "Permission lost, please re-grant"

3. **Better Error Messages**
   - If screen recording fails during capture
   - Show: "Screen recording permission may have been revoked. Click here to check."

4. **Video Tutorial**
   - Embedded in app: "How to grant permissions"
   - Shows full System Settings flow

---

## ✅ Summary

**Immediate Fixes (Today):**
1. Fix permission state detection bug
2. Add "View → Permissions" menu
3. Increase window size for DevTools
4. Improve documentation

**Later (Optional):**
- Proper code signing with Apple Developer certificate

**Trade-off:**
- Ad-hoc signing = Free but manual first launch
- Proper signing = $99/year but seamless UX

For cold calling demos, proper signing is recommended (professional impression).

---

**Ready to implement? Let me know which solutions to prioritize!**

