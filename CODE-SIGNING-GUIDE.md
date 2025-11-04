# 🔐 Code Signing Guide - Fix "Malicious Software" Warning

**Date:** October 30, 2025  
**Issue:** macOS shows "EVIA is damaged and can't be opened. You should move it to the Trash."

---

## ⚡ Quick Fix (No Code Signing Required)

### For Users: Right-Click → Open

**Current Workaround (30 seconds):**

1. **Download** `EVIA-arm64.dmg` from releases
2. **Drag** EVIA.app to Applications folder
3. **Right-click** EVIA.app (don't double-click!)
4. **Select** "Open" from menu
5. **Click** "Open" in warning dialog
6. ✅ **From now on**, double-click works normally

**Why does this happen?**
- macOS Gatekeeper checks app signatures
- Unsigned apps need manual approval (one-time only)
- After first "Open", macOS remembers your choice

**Visual Guide:**

```
┌─────────────────────────────────────┐
│ Applications                        │
│ ├── EVIA.app  👈 Right-click here  │
│ │   └── Open                        │
│ │   └── Open With                   │
│ │   └── Get Info                    │
│ └── Other apps...                   │
└─────────────────────────────────────┘
```

---

## 🔧 Terminal Fix (Advanced Users)

If you prefer terminal commands:

```bash
# Remove quarantine flag
xattr -cr /Applications/EVIA.app

# Ad-hoc sign (if needed)
codesign --force --deep --sign - /Applications/EVIA.app

# Launch
open /Applications/EVIA.app
```

---

## 🎯 Proper Code Signing (Recommended for Production)

### Why Sign Properly?

**Benefits:**
- ✅ No "damaged app" warning
- ✅ Double-click to open (no right-click needed)
- ✅ Professional user experience
- ✅ Eligible for App Store distribution (optional)
- ✅ Auto-updates work seamlessly
- ✅ Users trust signed apps more

**Drawbacks:**
- ❌ Requires Apple Developer account ($99/year)
- ❌ Setup time: 1-2 hours (one-time)
- ❌ Annual renewal required

**Recommendation:** Essential for distributing to customers, investors, or cold calling demos.

---

## 📋 Step-by-Step: Proper Code Signing

### Prerequisites

1. **Apple Developer Account**
   - Enroll: https://developer.apple.com/programs/
   - Cost: $99/year
   - Approval time: 24-48 hours

2. **macOS (Intel or Apple Silicon)**
   - Version: macOS 11+ (Big Sur or later)

3. **Xcode Command Line Tools**
   ```bash
   xcode-select --install
   ```

---

### Step 1: Get Developer ID Certificate

#### 1.1 Create Certificate Signing Request (CSR)

1. Open **Keychain Access** (Applications → Utilities)
2. Menu: **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**
3. Fill in:
   - **User Email:** your@email.com
   - **Common Name:** Your Name or Company
   - **CA Email:** Leave empty
   - **Request is:** Saved to disk
4. Click **Continue**, save `CertificateSigningRequest.certSigningRequest`

#### 1.2 Create Certificate on Apple Developer Portal

1. Go to: https://developer.apple.com/account/resources/certificates/list
2. Click **"+"** (Create a certificate)
3. Select: **Developer ID Application** (for distribution outside App Store)
4. Click **Continue**
5. Upload your `CertificateSigningRequest.certSigningRequest`
6. Click **Continue**
7. Download the certificate (`developerID_application.cer`)

#### 1.3 Install Certificate

1. Double-click `developerID_application.cer`
2. Keychain Access opens → Certificate is installed
3. Verify: Search for "Developer ID Application" in **My Certificates**

---

### Step 2: Update Electron Builder Config

Edit `electron-builder.yml`:

```yaml
mac:
  icon: src/main/assets/icon.png
  productName: EVIA
  # 🔐 Add your Developer ID identity
  identity: "Developer ID Application: Your Name (TEAM_ID)"
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  # 🔐 Enable notarization
  notarize: true

# Hook for notarization
afterSign: scripts/notarize.js
```

**Find your identity:**

```bash
security find-identity -v -p codesigning

# Output example:
# 1) ABC123... "Developer ID Application: Your Name (TEAM_ID)"
```

Copy the full identity string (including quotes) to `electron-builder.yml`.

---

### Step 3: Set Up Notarization

Apple requires notarization for macOS 10.14.5+ (Mojave).

#### 3.1 Generate App-Specific Password

1. Go to: https://appleid.apple.com/account/manage
2. Sign in with your Apple ID
3. Navigate to: **Security → App-Specific Passwords**
4. Click **"+"** (Generate password)
5. Label: "EVIA Notarization"
6. Copy the generated password (save it!)

#### 3.2 Store Credentials in Keychain

```bash
# Store Apple ID
xcrun notarytool store-credentials "EVIA-NOTARIZE-PROFILE" \
  --apple-id "your@email.com" \
  --team-id "TEAM_ID" \
  --password "xxxx-xxxx-xxxx-xxxx"
```

**Find your TEAM_ID:**
- Go to: https://developer.apple.com/account
- Click your name → Membership → Team ID

#### 3.3 Create Notarization Script

Create `scripts/notarize.js`:

```javascript
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization (not macOS)');
    return;
  }

  console.log('🔐 Notarizing app...');
  
  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  try {
    await notarize({
      tool: 'notarytool',
      appPath: appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    });
    
    console.log('✅ Notarization complete');
  } catch (error) {
    console.error('❌ Notarization failed:', error);
    throw error;
  }
};
```

#### 3.4 Install Notarization Tool

```bash
npm install --save-dev @electron/notarize
```

---

### Step 4: Build & Sign

#### 4.1 Set Environment Variables

Create `.env` file (don't commit this!):

```bash
# .env
APPLE_ID=your@email.com
APPLE_ID_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=ABC123XYZ
```

Add to `.gitignore`:

```bash
echo ".env" >> .gitignore
```

#### 4.2 Load Variables & Build

```bash
# Load environment variables
export $(cat .env | xargs)

# Build (will sign & notarize automatically)
npm run build

# Output: dist/EVIA-arm64.dmg (signed & notarized)
```

**Build time:**
- Signing: ~30 seconds
- Notarization: 5-10 minutes (Apple's server)

#### 4.3 Verify Signing

```bash
# Check code signature
codesign -dv --verbose=4 dist/mac-arm64/EVIA.app

# Should show:
# Authority=Developer ID Application: Your Name (TEAM_ID)
# Signed Time=...
# Info.plist=...

# Check notarization
spctl -a -vv -t install dist/mac-arm64/EVIA.app

# Should show:
# dist/mac-arm64/EVIA.app: accepted
# source=Notarized Developer ID
```

---

### Step 5: Test Distribution

#### 5.1 Test on Clean Machine (Virtual or Friend's Mac)

1. **Download** the signed DMG
2. **Double-click** to open (should work!)
3. **Drag** to Applications
4. **Double-click** EVIA.app (should work!)
5. ✅ **No warnings** should appear

#### 5.2 If Warnings Persist

```bash
# Re-check notarization status
xcrun stapler validate dist/mac-arm64/EVIA.app

# If not stapled, staple manually:
xcrun stapler staple dist/mac-arm64/EVIA.app
```

---

## 🎯 GitHub Actions Automation (Optional)

### Automate Signing in CI/CD

Update `.github/workflows/desktop-release.yml`:

```yaml
- name: Build & Sign
  env:
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    CSC_LINK: ${{ secrets.CSC_LINK }}  # Base64-encoded certificate
    CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}  # Certificate password
  run: npm run build
```

**Export Certificate for CI:**

```bash
# Export certificate to .p12 file
# In Keychain Access:
# 1. Right-click "Developer ID Application" certificate
# 2. Export → Save as .p12 (set password)
# 3. Base64 encode:

base64 -i certificate.p12 | pbcopy

# Paste into GitHub Secrets as CSC_LINK
```

---

## 📊 Comparison: Ad-hoc vs Proper Signing

| Aspect | Ad-hoc Signing | Proper Signing |
|--------|----------------|----------------|
| **Cost** | Free | $99/year |
| **Setup Time** | 0 min | 1-2 hours |
| **First Launch** | Right-click → Open | Double-click |
| **User Experience** | ⚠️ Warning dialog | ✅ No warnings |
| **Auto-updates** | ❌ May break | ✅ Works |
| **Distribution** | ⚠️ Manual workaround | ✅ Professional |
| **Trust** | ⚠️ Lower | ✅ Higher |
| **Recommended for** | Dev/Testing | Production/Customers |

---

## 🐛 Troubleshooting

### Issue: "No identity found for signing"

**Solution:**

```bash
# List available identities
security find-identity -v -p codesigning

# If empty, re-install certificate
# Download from: https://developer.apple.com/account/resources/certificates/list
```

---

### Issue: "Notarization failed"

**Check logs:**

```bash
xcrun notarytool log <submission-id> \
  --apple-id "your@email.com" \
  --team-id "TEAM_ID" \
  --password "xxxx-xxxx-xxxx-xxxx"
```

**Common causes:**
- Invalid Apple ID password
- Wrong Team ID
- Missing entitlements
- Hardened runtime not enabled

---

### Issue: "App still shows warning after signing"

**Verify notarization:**

```bash
# Check stapling
xcrun stapler validate dist/mac-arm64/EVIA.app

# If not stapled:
xcrun stapler staple dist/mac-arm64/EVIA.app

# Rebuild DMG
npm run build
```

---

## ✅ Recommended Approach

### For Cold Calling / Demos / Investors

**Use Proper Code Signing:**
- Professional first impression
- No awkward "damaged app" explanation
- Shows attention to detail
- Worth the $99/year investment

### For Internal Testing / Development

**Use Ad-hoc Signing + Clear Instructions:**
- Include one-pager: "How to Install EVIA"
- Add screenshot of right-click → Open
- Send quick Loom video showing the process
- Save $99 until ready for wider distribution

---

## 📖 Resources

- **Apple Developer Program:** https://developer.apple.com/programs/
- **Notarization Guide:** https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution
- **Electron Builder Signing:** https://www.electron.build/code-signing
- **Electron Notarize:** https://github.com/electron/notarize

---

## 🎯 Summary

**Quick Fix (Now):**
- Users: Right-click → Open (one-time only)
- Devs: `xattr -cr EVIA.app && codesign --force --deep --sign - EVIA.app`

**Proper Solution (Production):**
- Get Apple Developer account ($99/year)
- Set up certificate + notarization (1-2 hours)
- Build signed release (`npm run build`)
- Distribute with confidence ✅

**Trade-off:**
- Ad-hoc = Free but manual workaround
- Proper = $99 but professional UX

**For cold calling:** Proper signing recommended (eliminates friction, builds trust).

---

**Need help with setup? I can walk you through each step!**

