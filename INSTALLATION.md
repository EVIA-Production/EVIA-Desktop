# EVIA Installation Guide

## ⚠️ Important: macOS Security Notice

EVIA is currently distributed **without Apple notarization** (which requires a $99/year Apple Developer Program membership). This means macOS Gatekeeper will display a security warning when you first open the app.

**This is normal and expected.** EVIA is safe to use - the warning only appears because we haven't paid for Apple's notarization service yet.

---

## 📦 Two Installation Methods

We provide TWO download options. Choose the one that works best for you:

### ✅ Method 1: ZIP File (Recommended - Easier)

**This is the easiest method for unsigned apps.**

1. **Download** `EVIA-1.0.2-arm64.zip` from the [GitHub Releases page](https://github.com/EVIA-Production/EVIA-Desktop/releases)

2. **Extract** the ZIP file (double-click it in Downloads)

3. **Drag** `EVIA.app` to your `/Applications` folder

4. **Open EVIA**:
   - Navigate to `/Applications` in Finder
   - **Right-click** (or Control-click) on `EVIA.app`
   - Select **"Open"** from the menu
   - Click **"Open"** in the security dialog

5. **Done!** EVIA will now open normally. You only need to do the right-click process once.

---

### Method 2: DMG File (Traditional - Requires Terminal Command)

**If you prefer the traditional macOS installer experience:**

1. **Download** `EVIA-1.0.2-arm64.dmg` from the [GitHub Releases page](https://github.com/EVIA-Production/EVIA-Desktop/releases)

2. **Open** the DMG file (double-click it)

3. **Drag** `EVIA.app` to the `/Applications` folder

4. **Remove the quarantine flag** (required for unsigned apps):
   - Open **Terminal** (Applications > Utilities > Terminal)
   - Copy and paste this command:
     ```bash
     xattr -cr /Applications/EVIA.app
     ```
   - Press **Enter**

5. **Open EVIA**:
   - Navigate to `/Applications` in Finder
   - **Right-click** (or Control-click) on `EVIA.app`
   - Select **"Open"** from the menu
   - Click **"Open"** in the security dialog

6. **Done!** EVIA will now open normally.

---

## 🔒 Why is this necessary?

macOS Gatekeeper is designed to protect users by verifying that apps are from identified developers. Apps distributed without Apple's notarization process (which costs $99/year) will trigger this security check.

**EVIA is safe to use.** The steps above simply tell macOS that you trust the app.

---

## ❓ Troubleshooting

### "EVIA is damaged and can't be opened"

This error appears when:
1. You opened the DMG file without removing the quarantine flag
2. You downloaded via Safari/Chrome (which automatically applies quarantine)

**Solution**: Use Method 1 (ZIP) OR follow Method 2 completely, including the Terminal command.

### Permission Issues

After installation, EVIA will request permissions for:
- **Microphone** - To transcribe your voice
- **Screen Recording** - To capture system audio from meetings
- **Accessibility** (optional) - For keyboard shortcuts

Grant these permissions in System Preferences > Security & Privacy.

---

## 📧 Support

If you encounter any issues:
- Email: benedict@tryevia.ai
- GitHub Issues: https://github.com/EVIA-Production/EVIA-Desktop/issues

---

## 🔮 Future: Notarized Distribution

We're planning to enroll in the Apple Developer Program soon, which will eliminate these steps entirely. Future versions will install seamlessly with no security warnings.

