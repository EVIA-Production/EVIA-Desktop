# EVIA Installation Guide

## ⚠️ Important Security Notice

EVIA is currently distributed **without Apple notarization** (which requires a $99/year Apple Developer Program membership). 

**This means you WILL see a security warning.** This is normal and expected for open-source/independent apps. EVIA is safe to use.

---

## 📥 Installation Steps (ZIP Method)

### 1. Download the Correct Version

- **Apple Silicon (M1/M2/M3)**: `EVIA-1.0.2-arm64-mac.zip`
- **Intel Macs**: `EVIA-1.0.2-x64-mac.zip` (Most older Macs)

> **Note:** If you see "Software needs to be updated", you downloaded the wrong version. Try the other one.

### 2. Install & Bypass Security Warning

1. **Double-click** the ZIP to extract `EVIA.app`
2. **Drag** `EVIA.app` to **Applications**
3. **Right-click** (Control-click) on `EVIA` and select **Open**
4. You will see a popup: *"Apple cannot check it for malicious software"*
5. Click **"Open"** (or "Open Anyway")

**If you don't see "Open" option:**
1. Go to **System Settings** > **Privacy & Security**
2. Scroll down to "Security" section
3. You will see "EVIA was blocked..."
4. Click **"Open Anyway"**
5. Enter your Mac password if asked

> **Success:** You only need to do this **once**. EVIA is now whitelisted and will open normally next time.

---

## ❓ Troubleshooting

### "EVIA is damaged"
Run this command in Terminal: `xattr -cr /Applications/EVIA.app`

### Permissions
Grant **Microphone** and **Screen Recording** permissions when prompted to enable AI features.

---

## 📧 Support
Email: bene@tryevia.ai
