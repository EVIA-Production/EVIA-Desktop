# EVIA Installation Guide

## ⚠️ Important Security Notice

EVIA is currently distributed **without Apple notarization** (which requires a $99/year Apple Developer Program membership). 

**This means you will see a security warning.** This is normal and expected for open-source/independent apps. EVIA is safe to use.

---

## 📥 Installation Steps (ZIP Method - Recommended)

1. **Download** `EVIA-1.0.2-arm64-mac.zip`
2. **Double-click** to extract it
3. **Drag** `EVIA.app` to your **Applications** folder
4. **Right-click** (or Control-click) on `EVIA.app` and select **Open**
5. Click **"Open"** in the dialog box

> **Note:** You only need to do the Right-click → Open step **once**. After that, it opens normally.

---

## ❓ Troubleshooting

### "EVIA is damaged and can't be opened"
This should be fixed in v1.0.2. If you still see it:
1. Open Terminal
2. Run: `xattr -cr /Applications/EVIA.app`
3. Try opening again

### Permissions
EVIA needs these permissions to work:
- **Microphone**: To hear you
- **Screen Recording**: To capture system audio (meeting audio)

---

## 📧 Support
Email: bene@tryevia.ai
