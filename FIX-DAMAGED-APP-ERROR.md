# 🔧 FIX: "EVIA is damaged and can't be opened"

## Why This Happens

macOS Gatekeeper blocks unsigned apps downloaded from the internet. Since EVIA is **not signed with an Apple Developer ID**, macOS flags it as "damaged."

---

## ✅ SOLUTION 1: Remove Quarantine (Terminal - Recommended)

**After downloading and installing EVIA.app to Applications**:

```bash
# Open Terminal and run:
sudo xattr -r -d com.apple.quarantine /Applications/EVIA.app

# Enter your Mac password when prompted
# Then open EVIA normally
```

**This removes the quarantine flag and allows the app to run.**

---

## ✅ SOLUTION 2: Right-Click Method (Doesn't Always Work for Unsigned Apps)

1. Right-click EVIA.app in Applications
2. Select "Open"
3. Click "Open" in the security dialog

**Note**: This may NOT work for unsigned apps showing "damaged" error. Use Solution 1 instead.

---

## ✅ SOLUTION 3: Allow in System Settings

If Terminal command doesn't work:

1. Try to open EVIA.app (will fail)
2. Go to **System Settings → Privacy & Security**
3. Scroll to bottom, find "EVIA was blocked"
4. Click **"Open Anyway"**
5. Try opening EVIA again

---

## 🔐 PERMANENT FIX: Code Signing

To eliminate this error permanently:

1. **Obtain Apple Developer ID** ($99/year)
   - Sign up at https://developer.apple.com

2. **Export Certificate**
   - Download from Apple Developer portal
   - Install on build machine

3. **Update electron-builder.yml**:
   ```yaml
   mac:
     identity: "Developer ID Application: YOUR NAME (TEAM_ID)"
     hardenedRuntime: true
   ```

4. **Rebuild and Notarize**:
   ```bash
   npm run build
   # App will be signed and notarized
   ```

5. **Distribute signed DMG**
   - Users can double-click to open
   - No quarantine warnings

---

## 📋 For Users (Add to Download Page)

**Important**: EVIA is currently unsigned. After installation, you must run:

```bash
sudo xattr -r -d com.apple.quarantine /Applications/EVIA.app
```

**We're working on code signing to eliminate this step in future releases.**

---

**Status**: Temporary workaround until code signing implemented  
**Priority**: HIGH - Significant UX barrier

