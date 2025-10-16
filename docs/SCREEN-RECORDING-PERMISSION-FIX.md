# macOS Screen Recording Permission Fix

## 🔍 Problem Analysis

### Symptoms
- ✅ Microphone permission granted successfully
- ❌ Screen Recording shows "denied" despite having permission in System Settings
- ❌ macOS prompts for Cursor permission instead of EVIA
- ❌ `systemPreferences.getMediaAccessStatus('screen')` returns `'denied'`

### Root Cause (Triple-Verified)

**THE ISSUE:** When running EVIA Desktop in development mode (`npm run dev:main`), Electron launches as a separate process with bundle identifier `com.github.Electron`. When the app checks for Screen Recording permission, macOS checks THIS bundle's permissions, not Cursor's.

**Why Cursor permission doesn't help:**
- Cursor (com.cursor.Cursor) has Screen Recording permission
- But the dev Electron bundle (com.github.Electron) does NOT
- macOS checks the IMMEDIATE process making the request, not parent processes
- Result: `systemPreferences.getMediaAccessStatus('screen')` returns `'denied'`

**Verified facts:**
1. ✅ Dev Electron bundle exists at: `node_modules/electron/dist/Electron.app`
2. ✅ Bundle identifier: `com.github.Electron` (verified via `PlistBuddy`)
3. ✅ Bundle lacks Screen Recording entitlements (verified via `codesign`)
4. ✅ TCC database has no entry for `com.github.Electron`
5. ✅ This matches Glass's documented issue EXACTLY

### Why Production Builds Will Work

In production (DMG/app bundle):
- App has unique bundle ID: `com.evia.desktop`
- App is properly code-signed with entitlements
- User grants permission to EVIA Desktop specifically
- No dev Electron bundle involved

---

## 💡 Solution: Two Approaches

### **Approach 1: Dev Mode Fix (Immediate)**

Sign the dev Electron bundle with entitlements so it can request Screen Recording permission.

**Pros:**
- ✅ Works for development/testing
- ✅ No need to rebuild after code changes
- ✅ Fast iteration

**Cons:**
- ⚠️ Must re-run after `npm install`
- ⚠️ Must re-run if Electron version changes
- ⚠️ Dev-only workaround

### **Approach 2: Production Build (Permanent)**

Build a proper DMG with code signing and entitlements.

**Pros:**
- ✅ Real solution for users
- ✅ Persistent permissions
- ✅ No manual signing needed

**Cons:**
- ⚠️ Must rebuild after each code change
- ⚠️ Slower iteration during development

---

## 🚀 Approach 1: Dev Mode Fix

### Step 1: Sign the Dev Electron Bundle

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop

# Run the signing script
./sign-dev-electron.sh
```

The script will:
1. Remove quarantine attributes
2. Ad-hoc sign Electron.app with entitlements
3. Verify the signature
4. Show next steps

### Step 2: Add Electron.app to Screen Recording Permissions

1. Open **System Settings**
2. Go to **Privacy & Security** → **Screen Recording**
3. Click the **[+]** button
4. Press **Cmd+Shift+G**
5. Paste the path:
   ```
   /Users/benekroetz/EVIA/EVIA-Desktop/node_modules/electron/dist/Electron.app
   ```
6. Click **Open**
7. **Toggle it ON**

### Step 3: Verify the TCC Entry (Optional)

```bash
# Reset Screen Recording permission for Electron (if needed)
tccutil reset ScreenCapture com.github.Electron

# Note: TCC database query requires Full Disk Access
# If you have Full Disk Access enabled for Terminal:
sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
  "SELECT service, client, auth_value FROM access WHERE client='com.github.Electron';"

# Expected: kTCCServiceScreenCapture|com.github.Electron|2
```

### Step 4: Restart EVIA Desktop

```bash
# Kill existing processes
pkill -f "electron.*EVIA"
pkill -f "vite.*5174"

# Start fresh
./start-e2e-test.sh
```

### Step 5: Test Screen Recording Permission

**Expected behavior:**
- ✅ Permission window shows screen as **'granted'**
- ✅ Terminal shows: `screen: 'granted'`
- ✅ Both buttons show "Access Granted"
- ✅ Green "Continue to EVIA" button appears
- ✅ Auto-continues to main header

---

## 🏗️ Approach 2: Production Build

### Step 1: Verify Entitlements Configuration

✅ Already configured in `electron-builder.yml`:
```yaml
mac:
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
```

✅ Entitlements file exists at: `build/entitlements.mac.plist`

### Step 2: Build Production DMG

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop

# Clean previous builds
rm -rf dist/ out/

# Build DMG
npm run build

# Output: out/EVIA-1.0.0.dmg
```

### Step 3: Install and Test

```bash
# Open the DMG
open out/EVIA-1.0.0.dmg

# Drag EVIA Desktop to Applications
# Launch from Applications

# Grant permissions when prompted:
# 1. Microphone → Allow
# 2. Screen Recording → Open System Settings → Add EVIA Desktop → Toggle ON
```

**Expected behavior:**
- ✅ macOS prompts for EVIA Desktop (not Cursor or Electron)
- ✅ Permissions persist across app restarts
- ✅ No need to re-sign after updates

---

## 📋 When to Use Each Approach

### Use Dev Mode Fix when:
- 🛠️ Actively developing/testing
- 🛠️ Need fast iteration
- 🛠️ Testing E2E flows
- 🛠️ Before merging branches

### Use Production Build when:
- 🚀 Testing final package
- 🚀 Pre-release verification
- 🚀 Sharing with testers
- 🚀 Creating release artifacts

---

## 🔄 Maintenance Notes

### After `npm install`
If you run `npm install` or Electron version changes, the dev bundle is replaced and loses its signature.

**Solution:** Re-run the signing script
```bash
./sign-dev-electron.sh
```

### After Electron Version Bump
Same as above - re-sign the new Electron bundle.

### After Code Changes
- **Dev mode:** No re-signing needed (code signature is on Electron, not your code)
- **Production:** Must rebuild DMG

---

## 🔍 Troubleshooting

### Permission Still Shows "Denied" (COMMON ISSUE!)

**⚠️ CRITICAL: Multiple Electron.app bundles cause confusion!**

If you have Glass (or other Electron apps) installed, you might have multiple `Electron.app` bundles:
- `/Users/benekroetz/EVIA/EVIA-Desktop/node_modules/electron/dist/Electron.app` ← **EVIA (correct)**
- `/Users/benekroetz/EVIA/glass/node_modules/electron/dist/Electron.app` ← **Glass (wrong)**

Both show as "Electron" in System Settings - indistinguishable in the UI!

**Solution: Use the automated fix script:**
```bash
./fix-electron-permission.sh
```

This script will:
1. Scan for all Electron.app bundles
2. Verify EVIA's Electron.app is signed
3. Reset TCC permissions
4. Kill all Electron processes
5. Guide you to remove ALL "Electron" entries
6. Guide you to add the CORRECT one (EVIA's)
7. Restart EVIA Desktop

---

### Manual Troubleshooting Steps

1. **Find all Electron.app bundles on your system:**
   ```bash
   mdfind "kMDItemFSName == 'Electron.app'"
   ```
   
   Correct path: `/Users/benekroetz/EVIA/EVIA-Desktop/node_modules/electron/dist/Electron.app`

2. **Verify Electron.app is in Screen Recording list:**
   - System Settings → Privacy & Security → Screen Recording
   - Look for "Electron" in the list
   - Ensure it's toggled ON
   - **CRITICAL:** If you see multiple "Electron" entries, remove ALL of them!

3. **Verify the EVIA Electron.app was added (not Glass):**
   ```bash
   ls -la /Users/benekroetz/EVIA/EVIA-Desktop/node_modules/electron/dist/Electron.app
   ```

4. **Verify signature has screen-recording entitlement:**
   ```bash
   codesign -d --entitlements - node_modules/electron/dist/Electron.app 2>&1 | \
     grep "com.apple.security.personal-information.screen-recording"
   ```
   Should output the entitlement key.

5. **Reset and re-grant (ensures clean state):**
   ```bash
   tccutil reset ScreenCapture com.github.Electron
   pkill -9 -f electron
   ```
   Then re-add the CORRECT Electron.app in System Settings using the EXACT path.

### macOS Asks for Cursor Instead of Electron

This is expected when:
- Cursor is the parent process
- macOS shows the "user-facing" app in the prompt

**Solution:** Ignore the prompt text, just ensure Electron.app is added to the Screen Recording list manually.

### "Database authorization denied" Error

You're trying to query the TCC database without Full Disk Access.

**Solution:** Either:
1. Grant Full Disk Access to Terminal in System Settings
2. Skip the TCC query step (not required for fix to work)

---

## 📚 References

- Glass documentation: `glass/docs/system-audio-capture-permissions.md`
- Apple TCC documentation: `man tccutil`
- Codesign entitlements: `man codesign`
- Electron macOS permissions: https://www.electronjs.org/docs/latest/tutorial/security#macos-permissions

---

## ✅ Success Criteria

**Dev Mode Fix Complete When:**
- [ ] `./sign-dev-electron.sh` runs without errors
- [ ] Electron.app appears in Screen Recording list
- [ ] Permission window shows screen as 'granted'
- [ ] Terminal logs: `screen: 'granted'`
- [ ] Auto-continues to main header

**Production Build Complete When:**
- [ ] `npm run build` succeeds
- [ ] DMG file created in `out/`
- [ ] App launches from DMG
- [ ] Permissions prompt for "EVIA Desktop"
- [ ] Permissions persist after restart

---

## 🎯 Next Steps

1. **Immediate:** Run `./sign-dev-electron.sh` to fix dev mode
2. **Testing:** Verify E2E flow works end-to-end
3. **Production:** Build DMG and test production build
4. **Merge:** After testing, merge branches and finalize MVP


