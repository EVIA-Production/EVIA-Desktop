# 🚨 URGENT: Fix Deployment Issues - Action Plan

**Date**: October 27, 2025  
**Priority**: CRITICAL  
**Time Required**: 60-90 minutes

---

## 📋 ISSUES IDENTIFIED

1. ❌ **"EVIA is damaged"** error - App won't open
2. ❌ **Malformed icon** - Looks wrong in Applications
3. ❌ **DMG design** - Not visually appealing
4. ⚠️ **Source code assets** - Can't delete from GitHub (but not critical)
5. ❌ **Broken links** - Release notes links return 404

---

## 🎯 FIX SEQUENCE (In Priority Order)

### 🔴 FIX #1: "EVIA is damaged" Error (5 min - IMMEDIATE)

**For Your Own Testing RIGHT NOW**:

```bash
# Run this in Terminal to test your current DMG:
sudo xattr -r -d com.apple.quarantine /Applications/EVIA.app
```

**Then try opening EVIA - it should work.**

**For Users**:
- Update your GitHub Release notes with clear instructions
- Copy from: `GITHUB-RELEASE-NOTES-TEMPLATE.md`
- Emphasize the `xattr` command at the top

**Long-term Solution**: Get Apple Developer ID and code sign (see below)

---

### 🟠 FIX #2: App Icon Issue (20 min)

**Problem**: electron-builder needs `.icns` format, not `.png`

**Solution**:

```bash
cd EVIA-Desktop

# Step 1: Generate proper ICNS icon
./scripts/generate-icns.sh

# Step 2: Update electron-builder.yml
# Change this line:
#   icon: src/main/assets/icon.png
# To:
#   icon: src/main/assets/icon.icns
```

**Edit `electron-builder.yml`**:

```yaml
mac:
  icon: src/main/assets/icon.icns  # ← Change from .png to .icns
  category: public.app-category.productivity
  # ... rest stays the same
```

**Step 3: Rebuild**:

```bash
./build-production.sh
```

**Step 4: Test the new DMG**:

```bash
# Open the DMG
open dist/EVIA-0.1.0-arm64.dmg

# Check:
# 1. Does EVIA icon look correct in DMG window?
# 2. After dragging to Applications, does icon look correct?
# 3. Does icon appear in Dock when running?
```

---

### 🟡 FIX #3: Release Notes Links (10 min)

**Problem**: Links using relative paths → 404 errors

**Solution**: Update GitHub Release notes with absolute URLs

1. Go to: https://github.com/EVIA-Production/EVIA-Desktop/releases/tag/v0.1.0
2. Click "Edit release"
3. Replace release notes with content from: `GITHUB-RELEASE-NOTES-TEMPLATE.md`
4. **Key changes**:
   - All links use full GitHub URLs (not relative)
   - Download links use `/releases/download/` paths
   - Documentation links use `/blob/main/` paths
5. Save

**All links should now work!**

---

### 🟢 FIX #4: DMG Layout (Optional - 15 min)

If you want a better DMG layout:

**Update `electron-builder.yml`**:

```yaml
dmg:
  format: UDZO
  writeUpdateInfo: false
  title: "Install EVIA v${version}"
  icon: src/main/assets/icon.icns
  iconSize: 128
  window:
    width: 660
    height: 400
    x: 200
    y: 120
  contents:
    - x: 180
      y: 200
      type: file
    - x: 480
      y: 200
      type: link
      path: /Applications
```

**Rebuild to see new layout.**

---

### ℹ️  FIX #5: Source Code Assets (INFO ONLY)

**Status**: Cannot be deleted (GitHub limitation)

**Solution**: Add note in release notes

Already included in `GITHUB-RELEASE-NOTES-TEMPLATE.md`:

```markdown
## ⚠️ IGNORE Source Code Files

The "Source code (zip)" and "Source code (tar.gz)" files below are 
automatically added by GitHub. **You don't need these**.

**Download the DMG files instead**.
```

**No action needed** - just inform users in release notes.

---

## 🚀 COMPLETE FIX WORKFLOW

### Phase 1: Icon Fix (20 min)

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop

# 1. Generate ICNS
./scripts/generate-icns.sh

# 2. Edit electron-builder.yml (change .png to .icns)
# Use your editor to change line 14:
# FROM: icon: src/main/assets/icon.png
# TO:   icon: src/main/assets/icon.icns

# 3. Rebuild
./build-production.sh

# 4. Test
open dist/EVIA-0.1.0-arm64.dmg
```

### Phase 2: Update GitHub Release (10 min)

1. Go to: https://github.com/EVIA-Production/EVIA-Desktop/releases/tag/v0.1.0
2. Click "Edit release"
3. Copy entire content from: `GITHUB-RELEASE-NOTES-TEMPLATE.md`
4. Paste and save
5. Test links by clicking them

### Phase 3: Upload New DMG (15 min)

1. Delete old DMG from release assets
2. Upload new DMG from `dist/` folder
3. Verify icon looks correct in download preview

### Phase 4: Test Installation (15 min)

On a clean Mac (or delete `/Applications/EVIA.app` first):

```bash
# 1. Download DMG from GitHub Release
# 2. Open DMG
# 3. Check icon appearance
# 4. Drag to Applications
# 5. Run xattr command:
sudo xattr -r -d com.apple.quarantine /Applications/EVIA.app

# 6. Open EVIA
# 7. Verify:
#    - App opens (no "damaged" error)
#    - Icon looks correct in Dock
#    - Login works
#    - Backend connects to Azure
```

---

## 🎯 SUCCESS CRITERIA

After completing all fixes:

- ✅ App icon displays correctly in DMG
- ✅ App icon displays correctly in Applications
- ✅ App icon displays correctly in Dock when running
- ✅ DMG window layout is clean
- ✅ All GitHub Release links work (no 404s)
- ✅ Users can open app using `xattr` command
- ✅ Release notes clearly explain installation steps

---

## 🔐 FUTURE FIX: Code Signing (Eliminates "damaged" Error)

**Why**: Currently unsigned → macOS blocks as "damaged"

**Solution**: Obtain Apple Developer ID

### Steps to Code Sign:

1. **Sign up for Apple Developer Program** ($99/year)
   - https://developer.apple.com/programs/

2. **Create Developer ID Certificate**
   - Log into Apple Developer portal
   - Certificates → Create new → Developer ID Application
   - Download and install on your Mac

3. **Update electron-builder.yml**:
   ```yaml
   mac:
     identity: "Developer ID Application: YOUR NAME (TEAM_ID)"
     hardenedRuntime: true
     gatekeeperAssess: false
     entitlements: build/entitlements.mac.plist
     entitlementsInherit: build/entitlements.mac.plist
   ```

4. **Rebuild**:
   ```bash
   ./build-production.sh
   ```

5. **Notarize** (required for Gatekeeper):
   ```bash
   # Automatically done by electron-builder if configured
   # OR manually:
   xcrun notarytool submit dist/EVIA-0.1.0-arm64.dmg \
     --apple-id YOUR_APPLE_ID \
     --team-id YOUR_TEAM_ID \
     --password YOUR_APP_SPECIFIC_PASSWORD \
     --wait
   ```

6. **Distribute signed DMG**
   - Users can double-click to open
   - No "damaged" warnings
   - No `xattr` command needed

**Time**: 1-2 hours for first setup  
**Cost**: $99/year Apple Developer membership  
**Benefit**: Professional, user-friendly installation

---

## 📊 PRIORITY SUMMARY

| Issue | Priority | Time | Status |
|-------|----------|------|--------|
| "Damaged" error | 🔴 CRITICAL | 5 min (workaround) | Instructions provided |
| Icon issue | 🟠 HIGH | 20 min | Script ready |
| Broken links | 🟡 MEDIUM | 10 min | Template ready |
| DMG layout | 🟢 LOW | 15 min | Optional improvement |
| Source code assets | ℹ️ INFO | 0 min | Can't be changed |
| Code signing | 🔐 FUTURE | 2 hours | Long-term solution |

---

## 🚨 DO THIS NOW (Next 30 Minutes)

### Immediate Actions:

1. **Run icon script**: `./scripts/generate-icns.sh` (2 min)
2. **Edit electron-builder.yml**: Change `.png` to `.icns` (1 min)
3. **Rebuild**: `./build-production.sh` (3 min)
4. **Update release notes**: Copy from template (10 min)
5. **Upload new DMG**: Replace asset (5 min)
6. **Test installation**: Follow Phase 4 above (10 min)

### Total Time: 30 minutes to fix all critical issues

---

## 📞 QUESTIONS?

- **Icon Script**: See `FIX-ICON-AND-DMG.md`
- **Damaged Error**: See `FIX-DAMAGED-APP-ERROR.md`
- **Release Notes**: See `GITHUB-RELEASE-NOTES-TEMPLATE.md`
- **Full Guide**: See `PRODUCTION-DEPLOYMENT-GUIDE.md`

---

**Status**: Action plan ready  
**Priority**: 🔴 Execute immediately  
**Expected Outcome**: Professional, working release within 30 minutes

**Let's fix this! 🚀**

