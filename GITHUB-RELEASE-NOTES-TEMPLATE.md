# EVIA Desktop v0.1.0 - Production Release

**Always-on-top AI assistant for macOS**

---

## 📥 **DOWNLOAD EVIA**

### ⭐ For Most Users (Apple Silicon - M1/M2/M3):
**[Download EVIA-0.1.0-arm64.dmg](https://github.com/EVIA-Production/EVIA-Desktop/releases/download/v0.1.0/EVIA-0.1.0-arm64.dmg)** (446 MB)

### For Intel Macs:
**[Download EVIA-0.1.0.dmg](https://github.com/EVIA-Production/EVIA-Desktop/releases/download/v0.1.0/EVIA-0.1.0.dmg)** (222 MB)

### Alternative Format (ZIP):
- [EVIA-0.1.0-arm64-mac.zip](https://github.com/EVIA-Production/EVIA-Desktop/releases/download/v0.1.0/EVIA-0.1.0-arm64-mac.zip) (Apple Silicon)

---

## ⚠️ IMPORTANT: Installation Instructions

**After downloading the DMG, you MUST run this command to bypass macOS security:**

```bash
# After dragging EVIA to Applications:
sudo xattr -r -d com.apple.quarantine /Applications/EVIA.app
```

**Then enter your Mac password and open EVIA normally.**

**Why?** EVIA is currently unsigned (no Apple Developer certificate). We're working on code signing to eliminate this step in future releases.

---

## ✨ Features

- 🎤 **Dual Audio Capture** - Microphone + system audio
- 🌐 **Real-time Transcription** - Powered by Deepgram
- 🧠 **AI Insights** - Summary, topics, and action items via Groq/LLaMA
- 💬 **Ask Functionality** - Streaming AI responses with markdown
- 🌍 **German + English** - Default German, English supported
- ⌨️ **Keyboard Shortcuts** - Cmd+K (Listen), Cmd+Shift+Return (Ask)
- 🔒 **Secure** - JWT auth stored in macOS Keychain

---

## 📋 System Requirements

| Requirement | Minimum |
|-------------|---------|
| **macOS** | 12 (Monterey) or later |
| **RAM** | 4 GB |
| **Storage** | 1 GB free |
| **Internet** | Required (connects to Azure backend) |
| **Processor** | Apple Silicon (M1/M2/M3) or Intel |

---

## 🎮 Quick Start

1. **Download** the DMG for your Mac type (Apple Silicon or Intel)
2. **Open** the DMG file
3. **Drag** EVIA to Applications folder
4. **Run** the security bypass command (see above)
5. **Open** EVIA from Applications
6. **Grant** permissions (Microphone, Screen Recording, Accessibility)
7. **Login** with your EVIA credentials
8. **Press Cmd+K** to start listening!

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Start/Stop listening |
| `Cmd+Shift+Return` | Open Ask window |
| `Cmd+\` | Show/Hide all windows |

---

## 🐛 Known Issues

### 1. "EVIA is damaged" Error
**Solution**: Run `sudo xattr -r -d com.apple.quarantine /Applications/EVIA.app`

### 2. Permissions Not Working
**Solution**: System Settings → Privacy & Security → Grant Microphone, Screen Recording, Accessibility

### 3. Transcripts Always in German
**Status**: Backend issue (not Desktop). Desktop sends language correctly. Fix in progress.

### 4. Large File Size (446 MB)
**Reason**: Includes Electron framework, Node modules, and native audio processing libraries.

---

## 📚 Documentation

- **Installation Guide**: https://github.com/EVIA-Production/EVIA-Desktop/blob/main/DOWNLOAD-AND-INSTALL.md
- **Deployment Guide**: https://github.com/EVIA-Production/EVIA-Desktop/blob/main/PRODUCTION-DEPLOYMENT-GUIDE.md
- **Architecture**: https://github.com/EVIA-Production/EVIA-Desktop/blob/main/EVIA-DESKTOP-ARCHITECTURE.md
- **README**: https://github.com/EVIA-Production/EVIA-Desktop/blob/main/README.md

---

## 🔄 What's Next

- **Code Signing**: Obtain Apple Developer ID to eliminate "damaged app" warnings
- **Auto-Update**: Implement automatic update checks
- **Crash Reporting**: Add Sentry or similar for production error tracking
- **Performance**: Optimize bundle size and startup time

---

## 💬 Support

**Issues?** Report at:
- GitHub Issues: https://github.com/EVIA-Production/EVIA-Desktop/issues
- Email: support@evia.com

**Include**:
- macOS version ( → About This Mac)
- Steps to reproduce
- Screenshot of error

---

## 📝 Changelog

### v0.1.0 (2025-10-27) - Initial Release

**New Features**:
- ✅ Always-on-top overlay windows
- ✅ Dual audio capture (mic + system)
- ✅ Real-time transcription
- ✅ AI insights generation
- ✅ Ask functionality with streaming
- ✅ German/English language support
- ✅ Keyboard shortcuts
- ✅ Secure authentication (JWT + Keychain)
- ✅ Azure backend integration

**Technical**:
- ✅ Electron 38.2.1
- ✅ React 19
- ✅ TypeScript
- ✅ macOS 12+ support
- ✅ Apple Silicon + Intel builds

---

## ⚠️ IGNORE Source Code Files

The "Source code (zip)" and "Source code (tar.gz)" files below are automatically added by GitHub. **You don't need these** - they're for developers only.

**Download the DMG files instead** (links at the top).

---

**Built with ❤️ for productive workflows**

**Version**: 0.1.0  
**Release Date**: October 27, 2025  
**Status**: Production Ready ✅

