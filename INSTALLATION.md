# EVIA Desktop - Installation Guide

## macOS Installation

### Step 1: Download
Download the appropriate version for your Mac:
- **Apple Silicon (M1/M2/M3)**: `EVIA-1.0.4-arm64-mac.zip`
- **Intel Mac**: `EVIA-1.0.4-mac.zip`

### Step 2: Extract
Double-click the zip file to extract `EVIA.app`

### Step 3: Open (First Launch Only)

**Important:** macOS will show a security warning because the app isn't notarized. This is normal for apps distributed outside the Mac App Store.

**To open the app:**

1. **Right-click** (or Control+Click) on `EVIA.app` in Finder
2. Select **"Open"** from the context menu
3. A dialog will appear saying "EVIA is from an unidentified developer"
4. Click **"Open"** button
5. The app will launch and be saved as an exception for future launches

**After the first launch**, you can double-click the app normally - no more warnings!

### Troubleshooting

**If right-click → Open doesn't show "Open" option:**
- Make sure you're right-clicking on `EVIA.app` itself (not the zip file)
- Try Control+Click instead of right-click
- If you see "Open Anyway" button, click it

**If you still can't open:**
1. Go to **System Settings** → **Privacy & Security**
2. Scroll down to **Security**
3. You should see a message about EVIA being blocked
4. Click **"Open Anyway"**
5. Enter your password if prompted

### Why This Happens

EVIA uses ad-hoc code signing (not Developer ID) to keep the app free. macOS Gatekeeper requires apps to be notarized by Apple, which costs $99/year for a Developer ID certificate. The right-click → Open method is Apple's approved way to run apps from trusted sources that aren't notarized.

---

**Need Help?** Contact support at [your support email]
