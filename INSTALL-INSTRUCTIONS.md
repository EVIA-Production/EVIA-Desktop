# EVIA Desktop Installation Instructions

## ⚠️ Important: Development Build Notice

This is a **development build** that is not code-signed with an Apple Developer ID certificate. macOS Gatekeeper will block it by default.

---

## Installation Steps

### Option 1: Remove Quarantine (Recommended for Testing)

1. **Download** the DMG file to your Downloads folder

2. **Open Terminal** and run:
   ```bash
   # Remove quarantine attribute from DMG
   xattr -cr ~/Downloads/EVIA-*.dmg
   
   # Mount and install the app
   open ~/Downloads/EVIA-*.dmg
   # Drag EVIA.app to Applications
   
   # Remove quarantine from installed app
   xattr -cr /Applications/EVIA.app
   ```

3. **Launch EVIA** from Applications folder

---

### Option 2: Manual Gatekeeper Override

1. **Try to open** EVIA normally (you'll see the "damaged" error)

2. **Open System Settings** → Privacy & Security

3. **Scroll down** to the Security section

4. **Click "Open Anyway"** next to the EVIA blocked message

5. **Confirm** when prompted

---

## Why This Happens

- **Development builds** use ad-hoc signing (for local testing only)
- **Production builds** require an Apple Developer ID certificate ($99/year)
- Downloaded apps are **quarantined** by macOS for security

---

## For Developers

### Local Testing (No Download)
```bash
# Build locally (no quarantine)
npm run build

# Run directly from dist
open dist/mac-arm64/EVIA.app
```

### Production Signing (Future)
Requires Apple Developer Program membership and:
```bash
# Sign with Developer ID
codesign --force --deep --sign "Developer ID Application: Your Name (TEAM_ID)" \
  --options runtime \
  --entitlements build/entitlements.mac.plist \
  dist/mac-arm64/EVIA.app

# Notarize with Apple
xcrun notarytool submit dist/EVIA-1.0.0-arm64.dmg \
  --apple-id your@email.com \
  --team-id TEAM_ID \
  --password app-specific-password
```

---

## Security Note

**Only install from trusted sources.** If you downloaded this from an untrusted source, do NOT bypass Gatekeeper.

