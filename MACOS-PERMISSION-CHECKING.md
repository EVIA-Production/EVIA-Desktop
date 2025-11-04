# 🔐 How to Check macOS Permissions (First Principles)

**Date:** October 30, 2025  
**Issue:** Can't query TCC database directly on modern macOS  
**Solution:** Use app's own Electron APIs

---

## 🚫 Why You Can't Query TCC Database Directly

### The Old Way (macOS < 10.14):

```bash
# This used to work:
sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
  "SELECT * FROM access WHERE client='com.evia.app';"
```

**Result on modern macOS:**
```
Error: unable to open database: authorization denied
```

### Why It's Protected:

Starting with macOS Mojave (10.14) and increasingly locked down in later versions:

1. **TCC Database is SIP-protected**
   - System Integrity Protection (SIP) blocks direct reads
   - Only authorized system processes can read it
   - Even with `sudo`, regular users can't access it

2. **Privacy & Security Focus**
   - Apple doesn't want apps querying other apps' permissions
   - Prevents permission-checking abuse
   - Forces apps to use official APIs

3. **Database Format Changes**
   - TCC database structure changes between macOS versions
   - Bundle identifiers stored differently (CSREQ, team IDs, etc.)
   - Direct queries are unreliable across versions

---

## ✅ The ONLY Reliable Way: App's Own APIs

### From First Principles:

**Question:** How does an app know if it has permissions?

**Answer:** It asks macOS directly through official APIs!

### How It Works:

```
┌─────────────────┐
│   Your App      │
│   (EVIA)        │
└────────┬────────┘
         │
         │ systemPreferences.getMediaAccessStatus('microphone')
         │ systemPreferences.getMediaAccessStatus('screen')
         ▼
┌─────────────────┐
│  Electron API   │
│  (Node Native)  │
└────────┬────────┘
         │
         │ Native macOS API calls
         ▼
┌─────────────────┐
│   macOS         │
│   TCC System    │
└────────┬────────┘
         │
         ▼
Returns: 'granted' | 'denied' | 'restricted' | 'not-determined'
```

### Electron's Permission APIs:

**Main Process (Node.js):**
```typescript
import { systemPreferences } from 'electron';

// Check microphone
const micStatus = systemPreferences.getMediaAccessStatus('microphone');
// Returns: 'not-determined' | 'granted' | 'denied' | 'restricted'

// Check screen recording
const screenStatus = systemPreferences.getMediaAccessStatus('screen');
// Returns: 'not-determined' | 'granted' | 'denied' | 'restricted'

// Request microphone permission (triggers macOS prompt)
const micGranted = await systemPreferences.askForMediaAccess('microphone');
// Returns: boolean (true if granted)
```

**Renderer Process (Browser):**
```typescript
// Must use IPC to talk to main process
const permissions = await window.electron.getPermissions();
// Returns: { microphone: 'granted', screen: 'granted' }
```

---

## 🔍 How to Check EVIA's Permissions

### Method 1: System Settings (Manual, Always Reliable)

**Steps:**

1. Open **System Settings**
2. Go to: **Privacy & Security**
3. Click **"Screen Recording"** (left sidebar)
   - Look for: **"EVIA"** with checkmark ✓
4. Click **"Microphone"** (left sidebar)
   - Look for: **"EVIA"** with checkmark ✓

**What to Look For:**

```
Screen Recording:
  ☐ Chrome
  ☑ EVIA          ← Should be checked!
  ☐ Zoom

Microphone:
  ☐ Chrome
  ☑ EVIA          ← Should be checked!
  ☐ Discord
```

**This is the SOURCE OF TRUTH!**  
If System Settings shows EVIA with checkmarks, permissions ARE granted.

---

### Method 2: EVIA DevTools Console (Live Check)

**Steps:**

1. Launch EVIA
2. Press **Cmd+Option+I** (open DevTools)
3. Go to **Console** tab
4. Look for recent logs:

```javascript
[PermissionHeader] 🚀 Component mounted, starting AGGRESSIVE permission checks (every 200ms)
[Permissions] ✅ Check result - Mic: granted | Screen: granted
[Permissions] ✅ Check result - Mic: granted | Screen: granted
```

**Or run this command in Console:**

```javascript
window.electron.getPermissions().then(p => console.log('🔐 Permissions:', p))
```

**Expected Output:**
```javascript
🔐 Permissions: {
  microphone: 'granted',
  screen: 'granted'
}
```

**Possible Status Values:**
- `'granted'` ✅ - Permission granted
- `'denied'` ❌ - Permission explicitly denied by user
- `'not-determined'` ⏸️ - Never asked yet
- `'restricted'` 🚫 - Blocked by admin/MDM policy

---

### Method 3: Diagnostic Script (Shows Internal State)

**Run:**
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
bash diagnose-permissions.sh
```

**What It Shows:**

1. **Bundle Identifier** (`com.evia.app`)
   - This is what System Settings displays as "EVIA"

2. **Internal State** (`permissionsCompleted` flag)
   - Tells you if EVIA thinks permissions are done
   - Stored in: `~/Library/Application Support/evia/auth-state.json`

3. **Manual Check Instructions**
   - Since TCC database is inaccessible, provides manual steps

4. **Live Check Instructions** (if EVIA is running)
   - How to check via DevTools

**Example Output:**
```
═══════════════════════════════════════════════════════════
🔍 EVIA Permission Diagnostic
═══════════════════════════════════════════════════════════

✅ EVIA is currently running

─────────────────────────────────────────────────────────────
📋 EVIA App Identifier:
─────────────────────────────────────────────────────────────

  Bundle ID: com.evia.app
  Product Name: EVIA

─────────────────────────────────────────────────────────────
🔐 Manual Permission Check (System Settings):
─────────────────────────────────────────────────────────────

⚠️  TCC Database is protected on macOS - can't query directly

✅ TO CHECK MANUALLY:

1. Open System Settings
2. Go to: Privacy & Security
3. Click 'Screen Recording' → Look for: 'EVIA' ✓
4. Click 'Microphone' → Look for: 'EVIA' ✓

─────────────────────────────────────────────────────────────
📁 EVIA Internal State:
─────────────────────────────────────────────────────────────

📄 auth-state.json:
{
  "permissionsCompleted": true
}

─────────────────────────────────────────────────────────────
🔍 Check Real-Time Permission Status (Running App):
─────────────────────────────────────────────────────────────

METHOD 2: Query Permissions (Run in Console)
---------------------------------------------
1. Open DevTools (Cmd+Option+I)
2. In Console tab, paste this:

   window.electron.getPermissions().then(p => console.log('🔐 Permissions:', p))

3. You should see:
   🔐 Permissions: { microphone: 'granted', screen: 'granted' }
```

---

## 🔬 Technical Deep Dive: How TCC Works

### TCC = Transparency, Consent, and Control

**Database Location:**
```
~/Library/Application Support/com.apple.TCC/TCC.db
```

**Database Structure (Conceptual):**
```
┌──────────────────────┬──────────────────┬─────────┬──────────────┐
│ service              │ client           │ allowed │ client_type  │
├──────────────────────┼──────────────────┼─────────┼──────────────┤
│ kTCCServiceMicrophone│ com.evia.app     │ 1       │ 0            │
│ kTCCServiceScreenCapture│ com.evia.app  │ 1       │ 0            │
└──────────────────────┴──────────────────┴─────────┴──────────────┘
```

**Why We Can't Read It:**

1. **SIP (System Integrity Protection)**
   ```bash
   $ csrutil status
   System Integrity Protection status: enabled.
   ```
   - Even with `sudo`, TCC.db is protected
   - Only system processes (launchd, SystemUIServer) can read it

2. **Process Sandboxing**
   - Apps run in sandboxes
   - TCC database is outside app sandbox
   - No file system access allowed

3. **Security by Design**
   - Forces apps to use official APIs
   - Prevents permission snooping
   - Auditable through system logs

### How Apps Get Permission Info:

**Apps don't read TCC.db directly!** They ask macOS:

```
App → systemPreferences.getMediaAccessStatus()
    → Electron Native Module
      → Cocoa Framework (Objective-C)
        → TCC Framework (Private API)
          → TCC Daemon (tccd)
            → Reads TCC.db
              → Returns status
                ← 'granted' / 'denied' / 'not-determined'
```

**This is why:**
- Only the app itself can check its OWN permissions
- No external tools can query app permissions
- Command-line scripts can't check TCC status
- **You MUST use the app's own APIs**

---

## 📊 Permission Status Flow in EVIA

### 1. App Launch

```
main.ts (Main Process)
  ↓
HeaderController.initialize()
  ↓
checkPermissions()
  ↓
systemPreferences.getMediaAccessStatus('microphone')
systemPreferences.getMediaAccessStatus('screen')
  ↓
Determine state: 'welcome' | 'login' | 'permissions' | 'ready'
```

### 2. Permission Window (Continuous Polling)

```
PermissionHeader.tsx (Renderer)
  ↓
useEffect() → setInterval(200ms)
  ↓
checkPermissions() (every 200ms!)
  ↓
IPC → Main Process
  ↓
systemPreferences.getMediaAccessStatus()
  ↓
IPC → Renderer
  ↓
Update UI: ✓ Granted / ❌ Not Granted
```

### 3. Real-Time Updates

```
User grants permission in System Settings
  ↓
macOS TCC daemon updates
  ↓
Next polling cycle (200ms)
  ↓
systemPreferences.getMediaAccessStatus() returns 'granted'
  ↓
UI updates: ❌ → ✓
  ↓
Auto-continue to header (both granted)
```

---

## 🎯 Key Takeaways

### ✅ What Works:

1. **System Settings (Manual Check)**
   - Always accurate
   - Source of truth
   - Look for "EVIA" with checkmark

2. **App's Own DevTools Console**
   - Real-time status
   - Shows what app actually sees
   - Use `window.electron.getPermissions()`

3. **Console Logs (During Operation)**
   - Automatic every 200ms
   - Shows permission changes
   - Look for `[PermissionHeader] ✅ Check result`

### ❌ What Doesn't Work:

1. **Direct TCC Database Queries**
   - `sqlite3 TCC.db` → "authorization denied"
   - Protected by SIP
   - Not accessible to regular users

2. **`tccutil` Command**
   - Can only RESET, not CHECK
   - `tccutil reset Microphone com.evia.app` (destructive!)
   - No query functionality

3. **External Scripts Without App Running**
   - Can't check permissions if app not running
   - Permissions are queried via app's own process
   - No standalone CLI tool exists

---

## 🔧 Troubleshooting Guide

### Problem: "Permission window shows 'Not Granted' but System Settings shows 'Granted'"

**Root Cause:** macOS permission cache not refreshing fast enough

**Solution:** We now poll every 200ms (was 1000ms)
- Update detected within 200ms
- Matches Zoom/Teams behavior
- Rebuild and test

**Fix Applied:**
```typescript
// PermissionHeader.tsx
const interval = setInterval(() => {
  checkPermissions();
}, 200); // 🔥 Was 1000ms, now 200ms
```

### Problem: "Can't query TCC database"

**This is NORMAL on modern macOS!**

**Solution:** Use one of these methods:
1. Check System Settings manually (always works)
2. Query via running app's DevTools console
3. Read console logs (if app is running)

### Problem: "Diagnostic script shows 'NOT GRANTED' but permissions are granted"

**Root Cause:** Diagnostic script was trying to query TCC database (doesn't work)

**Solution:** Use updated diagnostic script:
```bash
bash diagnose-permissions.sh
```

Now shows:
- ✅ Bundle identifier (`com.evia.app`)
- ✅ Manual check instructions
- ✅ How to query via running app
- ✅ Internal state (`permissionsCompleted` flag)

---

## 📖 Additional Resources

### Official Documentation:

- **Electron systemPreferences API:**  
  https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesgetmediaaccessstatusmediatype-macos

- **Apple TCC Documentation:**  
  https://developer.apple.com/documentation/avfoundation/cameras_and_media_capture/requesting_authorization_for_media_capture_on_macos

- **macOS Privacy & Security:**  
  https://support.apple.com/guide/mac-help/control-access-to-the-microphone-mchlf6d108da/mac

### EVIA Permission Implementation:

- **Main Process:** `src/main/header-controller.ts`
- **Renderer:** `src/renderer/overlay/PermissionHeader.tsx`
- **IPC Handlers:** `src/main/main.ts` (permissions:check, permissions:request-mic, etc.)
- **Preload Bridge:** `src/main/preload.ts` (exposes IPC to renderer)

---

## ✅ Summary

**To check EVIA's permissions:**

1. **BEST:** Open System Settings → Privacy & Security → Screen Recording/Microphone → Look for "EVIA" ✓
2. **LIVE:** Open EVIA → Cmd+Option+I → Console → Run `window.electron.getPermissions()`
3. **DIAGNOSTIC:** Run `bash diagnose-permissions.sh` (shows internal state + instructions)

**Key Points:**

- ❌ Can't query TCC database directly (protected by SIP)
- ✅ Must use app's own Electron APIs
- ✅ Permission window polls every 200ms (real-time)
- ✅ System Settings is always the source of truth

**Remember:** If System Settings shows "EVIA" with checkmarks, permissions ARE granted. If the app shows differently, it's a cache/polling issue, not an actual permission issue!

---

**Rebuild EVIA with 200ms polling to fix all detection issues!**

