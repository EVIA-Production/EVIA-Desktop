# EVIA-DESKTOP

**Always-on-top AI assistant for macOS** | Production Ready ✅

[![Status](https://img.shields.io/badge/status-production-green)]()
[![Version](https://img.shields.io/badge/version-1.0-blue)]()
[![Electron](https://img.shields.io/badge/electron-38.2.1-blue)]()
[![React](https://img.shields.io/badge/react-18-blue)]()

---

## 🚀 QUICK START

### Prerequisites

- **macOS 12+** (Apple Silicon or Intel)
- **Node.js 20+**
- **Backend Running**: EVIA-Backend at `http://localhost:8000`

### Installation

```bash
# Clone repository
cd EVIA-Desktop

# Install dependencies
npm install

# Build native modules
npm run rebuild
```

### Development

```bash
# Start backend first
cd ../EVIA-Backend
docker-compose up

# In new terminal, start desktop app
cd ../EVIA-Desktop
npm run dev
```

### Production Build

```bash
npm run build

# Output: dist/mac-arm64/EVIA.app
open dist/mac-arm64/EVIA.app
```

### Signed Releases + Auto-Update

- CI workflow: `.github/workflows/release-desktop.yml`
- Trigger: push a tag like `v1.0.5`
- Required secrets/env: see `.env.release.example`
- Release artifacts and update metadata are published to a release-only GitHub repo.

---

## ✨ FEATURES

- **🎤 Dual Audio Capture**: Microphone + system audio (ScreenCaptureKit)
- **🌐 Real-time Transcription**: Powered by Deepgram WebSocket
- **🧠 AI Insights**: Summary, topics, and action items via Groq/LLaMA
- **💬 Ask Functionality**: Streaming AI responses with markdown rendering
- **🌍 German Language**: Default language (English supported)
- **🪟 Always-on-top**: Overlay windows that never get buried
- **⌨️ Keyboard Shortcuts**: Cmd+K (Listen), Cmd+Shift+Return (Ask)
- **🔒 Secure**: JWT auth stored in macOS Keychain

---

## 📚 DOCUMENTATION

**For detailed architecture and all fixes**:
👉 [EVIA-DESKTOP-ARCHITECTURE.md](./EVIA-DESKTOP-ARCHITECTURE.md) (comprehensive guide)

**For current state and quick reference**:
👉 [EVIAContext.md](./EVIAContext.md) (current state summary)

---

## 🎮 USAGE

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Toggle Listen (start/stop recording) |
| `Cmd+Shift+Return` | Toggle Ask window |
| `Cmd+\` | Show/Hide all windows |

### Main Controls

**Header Bar** (always visible):
- **Fertig**: Start/stop listening (gray → red when active)
- **Fragen**: Toggle Ask window
- **Anzeigen/Ausblenden**: Show/hide all child windows
- **⋯** (3-dot): Settings (hover to show)

**Listen Window** (Cmd+K):
- **Transkript**: Live transcription
- **Erkenntnisse**: AI insights (summary, topics, actions)
  - Click any insight to open Ask window with pre-filled prompt

**Ask Window** (Cmd+Shift+Return):
- Type question → Press Enter
- Get streaming AI response with markdown formatting
- Window auto-resizes to fit response

---

## 🏗️ ARCHITECTURE

```
Main Process (Node.js)
├── main.ts              # App lifecycle, menu bar
├── overlay-windows.ts   # Window management (1455 lines) ⭐
├── header-controller.ts # State machine, permissions
└── preload.js           # IPC security boundary

Renderer Process (React)
├── EviaBar.tsx          # Header controls (435 lines)
├── ListenView.tsx       # Transcription + insights (1085 lines) ⭐
├── AskView.tsx          # Questions + answers (673 lines) ⭐
├── SettingsView.tsx     # Preferences
└── audio-processor.js   # Audio capture (800+ lines)
```

**See [EVIA-DESKTOP-ARCHITECTURE.md](./EVIA-DESKTOP-ARCHITECTURE.md) for full details**

---

## 🔧 TROUBLESHOOTING

### Windows don't appear

```bash
# Remove corrupted state
rm ~/Library/Application\ Support/evia/overlay-state.json

# Restart app
open dist/mac-arm64/EVIA.app
```

### Permissions not working

```bash
# Reset macOS permissions
tccutil reset Microphone com.evia.app
tccutil reset ScreenCapture com.evia.app
tccutil reset Accessibility com.evia.app

# Restart app and grant permissions when prompted
```

### Backend connection refused

```bash
# Ensure backend is running
cd EVIA-Backend
docker-compose up

# Wait for: "Application startup complete"
```

### Listen opens when pressing "Fragen"

**Solution**: This was FIX #34 (persisted state leak). Ensure latest code is deployed.

### Ask window wrong size

**Solution**: This was FIX #32 (visibility detection). Ensure latest code is deployed.

---

## 🧪 TESTING

### Manual Testing

```bash
# Full test protocol
npm run test:manual

# Quick smoke test
npm run test:quick
```

**Key Scenarios**:
1. Press "Fragen" before Listen → Only Ask opens ✅
2. Press "Listen" → Transcription appears ✅
3. Press "Stopp" → Insights generate ✅
4. Click insight → Ask opens with prompt ✅
5. Close and reopen Ask → Content persists at correct size ✅

---

## 📦 PROJECT STRUCTURE

```
EVIA-Desktop/
├── src/
│   ├── main/                  # Main process (Electron)
│   │   ├── main.ts           # Entry point
│   │   ├── overlay-windows.ts # Window management ⭐
│   │   ├── header-controller.ts
│   │   └── preload.js        # IPC bridge
│   ├── renderer/              # Renderer process (React)
│   │   ├── overlay/          # UI components
│   │   │   ├── EviaBar.tsx
│   │   │   ├── ListenView.tsx ⭐
│   │   │   ├── AskView.tsx ⭐
│   │   │   └── ...
│   │   ├── audio-processor.js
│   │   └── i18n/             # Translations
│   └── assets/               # Images, icons, styles
├── native/                    # Swift native modules
│   └── mac/SystemAudioCapture/
├── dist/                      # Build output
├── electron-builder.yml       # Build config
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🐛 KNOWN ISSUES

### 1. Groq Rate Limits
- **Issue**: Free tier limited to 100k tokens/day
- **Impact**: After limit, Ask requests fail with 429 error
- **Solution**: Upgrade to Groq Dev Tier or use different API key

### 2. Dual Permissions (macOS)
- **Issue**: Two "EVIA" entries in System Settings → Privacy & Security
- **Cause**: App was renamed from "EVIA Desktop" to "EVIA"
- **Solution**: Manual cleanup with `tccutil reset`

### 3. Backend Transcription Delays
- **Issue**: Occasional choppy transcription, delays in mic audio
- **Impact**: Minor UX degradation
- **Solution**: Backend optimization needed (not Desktop issue)

---

## 🔐 SECURITY

### Authentication
- **JWT** stored securely in macOS Keychain (via keytar)
- **Token** auto-included in all backend requests
- **Refresh** handled by EVIA-Frontend (browser login)

### IPC Security
- **contextBridge** allowlist pattern
- **No direct Node.js API** access from renderer
- **CSP** enforced on all windows

### Permissions
- **Microphone**: Required for speech input
- **Screen Recording**: Required for system audio
- **Accessibility**: Required for global shortcuts

---

## 📈 PERFORMANCE

**Metrics** (M1 MacBook Pro):
- **Memory**: ~150MB (main) + ~80MB per window
- **CPU**: <1% idle, ~5% during transcription
- **Startup**: ~2 seconds (cold start)
- **Audio Latency**: ~100ms
- **Transcript Latency**: ~200-500ms (Deepgram)

**Optimizations**:
- Lazy window creation (create on first show)
- Debounced state saves (300ms)
- AudioWorklet (separate thread for audio)
- React memoization (useCallback)

---

## 🛠️ DEVELOPMENT

### Available Scripts

```bash
npm run dev          # Start development (hot reload)
npm run build        # Production build
npm run rebuild      # Rebuild native modules
npm run clean        # Clean build artifacts
npm run lint         # Lint TypeScript/React
npm run test         # Run tests (not implemented)
```

### Adding a New Feature

1. **Read the architecture**: [EVIA-DESKTOP-ARCHITECTURE.md](./EVIA-DESKTOP-ARCHITECTURE.md)
2. **Check current state**: [EVIAContext.md](./EVIAContext.md)
3. **Find similar code**: Search for existing patterns
4. **Test thoroughly**: Manual testing checklist
5. **Document changes**: Update relevant docs

### Code Style

- **TypeScript** for all new files
- **Functional components** (React)
- **Async/await** (not callbacks)
- **Descriptive names** (no single-letter variables)
- **Comments** for non-obvious logic

---

## 🎯 CHANGELOG

### 2025-10-18 - v1.0 (Round 6)
- ✅ FIX #34: Ask button no longer opens Listen (critical fix)
- ✅ FIX #32: Ask window correct size on reopen
- ✅ FIX #31: Ask window auto-resize based on content
- ✅ FIX #33: Eliminated spacing above "Zusammenfassung"
- ✅ FIX #27-30: Improved button behaviors

### 2025-10-15 - v0.9 (Round 5)
- ✅ 26 foundation fixes
- ✅ Glass UI/UX parity achieved
- ✅ Production-ready build

---

## 📄 LICENSE

Proprietary - EVIA GmbH

---

## 🆘 SUPPORT

**Documentation**:
- [Architecture Guide](./EVIA-DESKTOP-ARCHITECTURE.md)
- [Current State](./EVIAContext.md)
- [Backend Docs](../EVIA-Backend/README.md)

**Debugging**:
```bash
# Enable verbose logging
export ELECTRON_ENABLE_LOGGING=1
npm run dev

# Check logs
~/Library/Logs/evia/main.log
```

**Issues**:
- Search existing issues first
- Provide: macOS version, steps to reproduce, logs
- Label: `bug`, `enhancement`, or `question`

---

**Built with ❤️ for productive workflows**

**Status**: Production Ready ✅ | **Version**: 1.0 | **Last Updated**: 2025-10-18
