# 🔐 Code Signing Guide — Taylos Desktop

**Updated:** February 2026
**Covers:** macOS (Apple Developer ID) + Windows (Certum SimplySign)

---

## ⚡ Quick Reference

| Platform | Certificate | Status |
|----------|-------------|--------|
| **macOS** | Apple Developer ID Application | Purchased 22.02.2026, pending activation |
| **Windows** | Certum Standard Code Signing | ✅ Fully issued (serial `1ea222...`, expires 25.02.2027) |

---

## 🍎 macOS: Apple Developer ID Signing + Notarization

### Prerequisites
- Apple Developer Program membership (purchased, awaiting activation)
- macOS with Xcode Command Line Tools: `xcode-select --install`
- `.env` file with signing credentials (see `.env.release.example`)

### Step 1: Activate Membership

1. Log into https://developer.apple.com/account/
2. If you see "Schließen Sie den Kauf Ihrer Mitgliedschaft ab":
   - Click the blue link to complete purchase
   - If it loops to payment: contact Apple Developer Support (0800 2000 136) with invoice `W1505182544`
3. Once activated, note your **Team ID** (10-char string from Membership page)

### Step 2: Create Certificates

1. Go to **Certificates, Identifiers & Profiles** → **Certificates** → **+**
2. Select **Developer ID Application** → Continue
3. Create a CSR (Keychain Access → Certificate Assistant → Request Certificate)
4. Upload CSR, download `.cer`, double-click to install in Keychain
5. Repeat for **Developer ID Installer** (needed for signed PKGs)

### Step 3: Configure Sign in with Apple (for OAuth)

1. **Certificates, Identifiers & Profiles** → **Identifiers** → **+**
2. Select **App IDs** → Register app with bundle ID (e.g., `com.taylos.app`)
3. Enable **Sign in with Apple** → Configure
4. Set Return URL: `https://api.taylos.ai/oauth/apple/callback`
5. Note the **Client ID** (bundle ID format) → set as `APPLE_CLIENT_ID` in backend env

### Step 4: Set Environment Variables

```bash
# .env (NEVER commit this file!)
APPLE_ID=your@email.com
APPLE_ID_PASSWORD=xxxx-xxxx-xxxx-xxxx  # App-specific password
APPLE_TEAM_ID=XXXXXXXXXX               # From Membership page
```

### Step 5: Build Signed + Notarized DMG

```bash
# Load env vars
export $(cat .env | xargs)

# Build (signs + notarizes automatically via scripts/notarize.js)
npm run build
```

Build time: ~30s signing + 5-10 min notarization (Apple's servers).

### Step 6: Verify

```bash
# Verify code signature
codesign -dv --verbose=4 dist/mac-arm64/Taylos.app
# → Authority=Developer ID Application: Your Name (TEAM_ID)

# Verify notarization
spctl -a -vv -t install dist/mac-arm64/Taylos.app
# → accepted, source=Notarized Developer ID

# Verify stapling
xcrun stapler validate dist/mac-arm64/Taylos.app
```

---

## 🪟 Windows: Certum SimplySign Code Signing

### Certificate Details
- **Type:** Standard Code Signing
- **Serial:** `1ea222376000b123508cf1d56e0f9d87`
- **Expires:** 25 February 2027
- **Activation code:** `8VC4M8`

### Step 1: Activate SimplySign

1. Download **SimplySign mobile app** (iOS/Android)
2. Open the reset link:
   ```
   https://cloudsign.webnotarius.pl/arc/app/resetseed?token=15bd2738d3b4243d5fca8e07ccd78ae49945af80501c83b2a763b71562855fa2
   ```
3. Enter activation code: `8VC4M8` → generates QR code
4. Scan QR with SimplySign mobile app ("Other activation methods" → Scan QR)

### Step 2: Install Desktop App & Export Certificate

1. Download **SimplySign Desktop** from [Certum website](https://www.certum.eu/simplysign)
2. Install and sign in
3. Right-click tray icon → **Managing Certificates** → **List**
4. Right-click your certificate → **Export as .p12** (set a strong password)
5. Save as `certs/certum-taylos.p12` (add `certs/` to `.gitignore`!)

### Step 3: Configure Environment

```bash
# .env
WIN_CSC_LINK=./certs/certum-taylos.p12
WIN_CSC_KEY_PASSWORD=your-export-password
```

### Step 4: Build Signed Windows Installer

```bash
# Load env vars
export $(cat .env | xargs)

# Build (electron-builder picks up WIN_CSC_* automatically)
npm run build
```

### Step 5: Verify

After building, the `.exe` / `.msi` should:
- Show "Benedict Kroetz" (or your name) as publisher
- No SmartScreen warning (may take a few days for reputation to build)
- Auto-update will work without security warnings

---

## 🔄 GitHub Actions CI/CD (Optional)

Add these secrets to your GitHub repo for automated signed builds:

```yaml
# .github/workflows/desktop-release.yml
env:
  # macOS
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  CSC_LINK: ${{ secrets.CSC_LINK }}        # Base64-encoded .p12
  CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
  # Windows
  WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}  # Base64-encoded Certum .p12
  WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
  # Publishing
  GH_TOKEN: ${{ secrets.GH_TOKEN }}
```

**To base64-encode a certificate for CI:**
```bash
base64 -i certificate.p12 | pbcopy  # macOS — paste into GitHub Secrets
```

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "No identity found" | Run `security find-identity -v -p codesigning` — if empty, reinstall certificate |
| Notarization failed | Check: `xcrun notarytool log <id> --apple-id ... --team-id ... --password ...` |
| App still shows warning after signing | Staple: `xcrun stapler staple dist/mac-arm64/Taylos.app` then rebuild DMG |
| Windows SmartScreen warning | Normal for new certificates — reputation builds over ~1 week of downloads |
| `WIN_CSC_LINK` error | Ensure `.p12` path is relative to project root or absolute |
