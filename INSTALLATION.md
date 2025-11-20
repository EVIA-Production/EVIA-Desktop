# EVIA Installation Guide

## ⚠️ Important Security Notice

EVIA is currently distributed **without Apple notarization** (which requires a $99/year Apple Developer Program membership). 

**This means you will see a security warning.** This is normal and expected for open-source/independent apps. EVIA is safe to use.

---

## 📥 Installation Steps (ZIP Method - Recommended)

### 1. Download the Correct Version

- **Apple Silicon (M1/M2/M3)**: `EVIA-1.0.2-arm64-mac.zip`
- **Intel Macs**: `EVIA-1.0.2-x64-mac.zip`

> **Not sure?** Click Apple Menu  > About This Mac. If it says "Chip: Apple...", use Apple Silicon. If it says "Processor: Intel...", use Intel.

### 2. Install

1. **Double-click** the downloaded ZIP to extract it
2. **Drag** `EVIA.app` to your **Applications** folder
3. **Right-click** (or Control-click) on `EVIA.app` and select **Open**
4. Click **"Open"** in the dialog box

> **Note:** You only need to do the Right-click → Open step **once**. After that, it opens normally.

---

## ❓ Troubleshooting

### "EVIA is damaged and can't be opened"
This should be fixed in v1.0.2. If you still see it:
1. Open Terminal
2. Run: `xattr -cr /Applications/EVIA.app`
3. Try opening again

### "App not supported on this Mac"
This means you downloaded the wrong version (e.g., arm64 on an Intel Mac). Please check "About This Mac" and download the correct version.

### Permissions
EVIA needs these permissions to work:
- **Microphone**: To hear you
- **Screen Recording**: To capture system audio (meeting audio)

---

## 📧 Support
Email: bene@tryevia.ai
