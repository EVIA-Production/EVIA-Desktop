# EVIA-DESKTOP ARCHITECTURE & DEVELOPMENT GUIDE

**Version**: 1.0 (Round 6 Complete)  
**Last Updated**: 2025-10-18  
**Status**: 34 Issues Resolved, Production Ready  

---

## TABLE OF CONTENTS

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Key Files & Responsibilities](#key-files--responsibilities)
4. [Design Patterns](#design-patterns)
5. [Glass Parity](#glass-parity)
6. [All Implemented Fixes](#all-implemented-fixes)
7. [Development Guide](#development-guide)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)

---

## OVERVIEW

### What is EVIA-Desktop?

EVIA-Desktop is an **Electron-based overlay application** that provides always-on-top AI assistance for desktop users. It captures audio (mic + system), transcribes speech in real-time, generates insights, and answers questions.

**Key Features**:
- **Always-on-top overlay** windows (header + child windows)
- **Dual audio capture** (microphone + system audio via ScreenCaptureKit)
- **Real-time transcription** via Deepgram (WebSocket)
- **AI insights** via Groq/LLaMA (summaries, topics, actions)
- **Ask functionality** with streaming responses
- **German language** default (i18n support)
- **Glass parity** (pixel-perfect recreation of Glass UI/UX)

### Technology Stack

**Main Process** (Node.js):
- **Electron 38.2.1** - Desktop app framework
- **TypeScript** - Type-safe JavaScript
- **Native modules** - SystemAudioCapture (Swift), keytar (auth)

**Renderer Process** (Browser):
- **React 18** - UI framework
- **TypeScript** - Type-safe components
- **Vite** - Build tool & dev server
- **marked.js** - Markdown rendering
- **highlight.js** - Syntax highlighting
- **AudioWorklet** - Real-time audio processing

**Backend Integration**:
- **EVIA-Backend** (FastAPI) - REST API + WebSocket
- **JWT Authentication** - Secure API access
- **Deepgram** - Speech-to-text
- **Groq/LLaMA** - LLM for insights & ask

---

## ARCHITECTURE

### Process Structure

```
┌─────────────────────────────────────────┐
│         ELECTRON MAIN PROCESS           │
│  (Node.js, src/main/)                   │
├─────────────────────────────────────────┤
│  main.ts                                │
│  - App lifecycle                        │
│  - Menu bar integration                 │
│  - Global shortcuts (Cmd+K, etc.)       │
│                                         │
│  overlay-windows.ts [1455 lines]       │
│  - Window management (header + 4 child)│
│  - Layout calculations                  │
│  - IPC handlers (show/hide/toggle)      │
│  - State persistence (disk)             │
│                                         │
│  header-controller.ts                   │
│  - State machine (welcome → main)       │
│  - Permission checks                    │
│  - Auth integration                     │
│                                         │
│  preload.js                             │
│  - IPC bridge (contextBridge)           │
│  - Security boundary                    │
└─────────────────────────────────────────┘
              ↕ IPC
┌─────────────────────────────────────────┐
│      ELECTRON RENDERER PROCESSES        │
│  (Browser/React, src/renderer/)         │
├─────────────────────────────────────────┤
│  HEADER WINDOW                          │
│  - EviaBar.tsx (main control bar)       │
│  - Buttons: Listen, Ask, Show/Hide, ⋯   │
│  - Draggable header                     │
│                                         │
│  LISTEN WINDOW                          │
│  - ListenView.tsx (1085 lines)          │
│  - Transcript tab (live transcription)  │
│  - Erkenntnisse tab (insights)          │
│  - WebSocket connection to backend      │
│                                         │
│  ASK WINDOW                             │
│  - AskView.tsx (673 lines)              │
│  - Input field + streaming response     │
│  - Auto-resize based on content         │
│  - Markdown rendering                   │
│                                         │
│  SETTINGS WINDOW                        │
│  - SettingsView.tsx                     │
│  - API keys, models, preferences        │
│                                         │
│  SHORTCUTS WINDOW                       │
│  - ShortCutSettingsView.tsx             │
│  - Keyboard shortcut editor             │
└─────────────────────────────────────────┘
              ↕ WebSocket/HTTP
┌─────────────────────────────────────────┐
│         EVIA BACKEND (FastAPI)          │
│  http://localhost:8000                  │
├─────────────────────────────────────────┤
│  /ws/transcribe - Real-time STT         │
│  /ask - Streaming LLM responses         │
│  /insights - Session summaries          │
│  /chats - Chat management               │
└─────────────────────────────────────────┘
```

### Window Management System

**Window Hierarchy**:
```
HeaderWindow (BrowserWindow)
  ├─ ListenWindow (child)
  ├─ AskWindow (child)
  ├─ SettingsWindow (child)
  └─ ShortcutsWindow (child)
```

**Window Data** (`WINDOW_DATA` in overlay-windows.ts):
```typescript
{
  listen: { width: 400, height: 600, zIndex: 1 },
  ask: { width: 400, height: 58, zIndex: 2 },      // Compact ask bar
  settings: { width: 240, height: 320, zIndex: 3 },
  shortcuts: { width: 300, height: 400, zIndex: 4 },
}
```

**Layout Strategy**:
- **Single window**: Centered below header
- **Ask + Listen**: Horizontal stack (Listen left, Ask center-aligned)
- **Settings**: Right-aligned below 3-dot button
- **Above/Below**: Determined by header Y position (< 50% = below, > 50% = above)

**State Persistence**:
- **Location**: `~/Library/Application Support/evia/overlay-state.json`
- **Contents**: Window visibility, header bounds
- **Debounced**: 300ms delay to prevent disk thrashing
- **Critical**: FIX #34 ensures persisted state doesn't leak across sessions

---

## KEY FILES & RESPONSIBILITIES

### Main Process

#### `src/main/main.ts` (289 lines)
**Purpose**: Application entry point, lifecycle management

**Key Responsibilities**:
- Menu bar icon & menu setup
- Global keyboard shortcuts (Cmd+K for Listen, Cmd+Shift+Return for Ask)
- App initialization & cleanup
- Dock icon management (hide on macOS)

**Critical Code**:
```typescript
// Global shortcuts
globalShortcut.register('Command+K', () => {
  headerWindow?.webContents.send('trigger-listen-shortcut')
})
```

#### `src/main/overlay-windows.ts` (1455 lines) ⭐
**Purpose**: Core window management, layout, and IPC

**Key Responsibilities**:
- Create and manage 5 BrowserWindows (header + 4 children)
- Calculate window positions (center-aligned, screen bounds checking)
- Handle show/hide/toggle operations
- Persist window state to disk
- IPC handlers for renderer communication

**Critical Functions**:
- `createChildWindow(name)` - Create window with Glass-like properties
- `layoutChildWindows(visibility)` - Calculate positions for visible windows
- `updateWindows(visibility)` - Show/hide windows, enforce z-order
- `toggleWindow(name)` - FIX #34: Toggle window using CURRENT state, not persisted
- `ensureVisibility(name, shown)` - Animate show/hide with opacity

**State Management**:
```typescript
interface WindowVisibility {
  listen?: boolean
  ask?: boolean
  settings?: boolean
  shortcuts?: boolean
}

let persistedState: PersistedState = {
  headerBounds?: Rectangle
  visible?: WindowVisibility
}
```

#### `src/main/header-controller.ts` (184 lines)
**Purpose**: Header state machine, permission flow

**States**:
- `welcome` - Initial onboarding screen
- `permission` - Permission request UI
- `ready` - Main header with controls

**Key Logic**:
```typescript
async function checkAuth() {
  const token = await keytar.getPassword('evia', 'jwt-token')
  if (!token) return 'welcome'
  return 'ready'
}
```

#### `src/main/preload.js` (500+ lines)
**Purpose**: Security boundary between main and renderer

**Exposed APIs** (via `contextBridge`):
```typescript
window.evia = {
  auth: { login, logout, getToken },
  windows: { show, hide, toggle, adjustAskHeight },
  audio: { startCapture, stopCapture },
  ipc: { send, on, off, invoke },
}
```

---

### Renderer Process

#### `src/renderer/overlay/EviaBar.tsx` (435 lines)
**Purpose**: Main header bar with controls

**UI Elements**:
- **Fertig button** (gray when inactive, red when recording)
- **Fragen button** (toggles Ask window)
- **Anzeigen/Ausblenden** (show/hide all windows)
- **3-dot menu** (settings, hover-triggered)

**Key State**:
```typescript
const [listenStatus, setListenStatus] = useState<'before' | 'during' | 'after'>('before')
const [isListenActive, setIsListenActive] = useState(false)
const [isAskActive, setIsAskActive] = useState(false)
```

**Critical Fixes**:
- **FIX #3**: Drag logic checks for button clicks BEFORE `preventDefault()`
- **FIX #27**: "Fertig" hides both Listen and Ask, broadcasts `session:closed`

#### `src/renderer/overlay/ListenView.tsx` (1085 lines) ⭐
**Purpose**: Transcription display and insights

**Tabs**:
1. **Transkript** - Live transcription (scrolling text)
2. **Erkenntnisse** - Insights (summary, topics, actions)

**WebSocket Integration**:
```typescript
useEffect(() => {
  const ws = new WebSocket(`ws://localhost:8000/ws/transcribe?chat_id=${chatId}&token=${token}&source=mic`)
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.type === 'transcript') {
      setTranscriptText(prev => prev + data.text)
    }
  }
}, [chatId, token])
```

**Insights Display**:
- **Zusammenfassung** (Summary) - Clickable bullet points
- **Hauptthema** (Topics) - Clickable bullets
- **Aktionen** (Actions) - Clickable action cards

**Critical Fixes**:
- **FIX #16**: Tight spacing (no gaps between clickable items)
- **FIX #20**: Text size 12px (increased from 11px)
- **FIX #28**: Zero top margin on "Zusammenfassung" title
- **FIX #33**: `marginTop: '0px'` to eliminate browser default spacing

#### `src/renderer/overlay/AskView.tsx` (673 lines) ⭐
**Purpose**: Question input and AI response

**Key Features**:
- **Input field** with placeholder
- **Streaming response** (markdown-rendered)
- **Auto-resize** based on content height
- **Content persistence** across window hide/show

**Auto-Resize Logic** (FIX #31/#32):
```typescript
// Calculate ideal height from DOM
const headerHeight = headerEl?.offsetHeight || 0
const responseHeight = responseEl?.scrollHeight || 0
const inputHeight = inputEl?.offsetHeight || 0

const idealHeight = headerHeight + responseHeight + inputHeight + 20  // 20px buffer
const targetHeight = Math.min(700, idealHeight)  // Cap at 700px

// Use requestAnimationFrame to wait for DOM update
requestAnimationFrame(() => {
  requestWindowResize(targetHeight)
})
```

**Visibility Detection** (FIX #32):
```typescript
// Listen for window becoming visible (reopen with content)
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && response) {
      setTimeout(calculateAndResize, 50)  // Recalculate on show
    }
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)
}, [response])
```

**Critical Fixes**:
- **FIX #15**: Initial height 58px (compact ask bar)
- **FIX #17**: Auto-expand when Groq outputs response
- **FIX #21**: Auto-detract (shrink) when appropriate
- **FIX #23**: Symmetric spacing (no content = 58px)
- **FIX #31**: requestAnimationFrame for accurate scrollHeight
- **FIX #32**: Visibility API to resize on window reopen

---

### Audio Processing

#### `src/renderer/audio-processor.js` (800+ lines)
**Purpose**: Dual audio capture (mic + system)

**Architecture**:
```
AudioWorklet (audio-processor.js)
  ├─ Microphone AudioContext
  │   └─ AudioWorkletNode → PCM16 chunks → WebSocket
  └─ System AudioContext (ScreenCaptureKit)
      └─ AudioWorkletNode → PCM16 chunks → WebSocket
```

**Key Features**:
- **Echo cancellation** (AEC) between mic and system audio
- **Chunk size**: 4800 bytes (100ms at 48kHz, 16-bit mono)
- **Sample rate**: 48000 Hz
- **Format**: PCM16 (16-bit signed integer, little-endian)

**WebSocket Protocol**:
```typescript
// Connect
ws://localhost:8000/ws/transcribe?chat_id=<id>&token=<jwt>&source=mic

// Send audio
ws.send(pcm16Chunk)  // Binary data

// Receive transcript
{
  "type": "transcript",
  "text": "Hello world",
  "is_final": true,
  "source": "mic"
}
```

---

## DESIGN PATTERNS

### 1. Window Lifecycle

```typescript
// PATTERN: Always check if window exists and is not destroyed
function getChildWindow(name: FeatureName): BrowserWindow | null {
  const win = childWindows.get(name)
  if (!win || win.isDestroyed()) return null
  return win
}

// PATTERN: Create on-demand, cache in Map
function createChildWindow(name: FeatureName): BrowserWindow {
  const existing = childWindows.get(name)
  if (existing && !existing.isDestroyed()) return existing
  
  const win = new BrowserWindow({ ... })
  childWindows.set(name, win)
  return win
}
```

### 2. IPC Communication

```typescript
// RENDERER → MAIN (invoke/handle pattern)
// Renderer:
const result = await window.evia.windows.show('ask')

// Main:
ipcMain.handle('win:show', (_event, name) => {
  toggleWindow(name)
  return { ok: true }
})

// MAIN → RENDERER (send/on pattern)
// Main:
askWin.webContents.send('ask:send-and-submit', prompt)

// Renderer:
window.evia.ipc.on('ask:send-and-submit', (prompt) => {
  setPrompt(prompt)
  handleSubmit()
})
```

### 3. State Persistence

```typescript
// PATTERN: Debounced disk writes (300ms)
function saveState(partial: PersistedState) {
  persistedState = { ...persistedState, ...partial }
  
  if (saveStateTimer) clearTimeout(saveStateTimer)
  
  saveStateTimer = setTimeout(() => {
    fs.writeFileSync(persistFile, JSON.stringify(persistedState))
  }, 300)
}

// PATTERN: Load on startup
let persistedState: PersistedState = {}
try {
  if (fs.existsSync(persistFile)) {
    persistedState = JSON.parse(fs.readFileSync(persistFile, 'utf8'))
  }
} catch (error) {
  console.warn('Failed to load persisted state', error)
}
```

### 4. React State Management

```typescript
// PATTERN: Persistent state across window hide/show
const [response, setResponse] = useState<string>('')  // Persists!

// When window is hidden, component stays mounted
// When window is shown again, state is intact
```

### 5. Visibility-Based Effects

```typescript
// PATTERN: Trigger effects when window becomes visible
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      // Window is now visible, do something
      recalculateLayout()
    }
  }
  
  document.addEventListener('visibilitychange', handleVisibilityChange)
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
}, [dependencies])
```

---

## GLASS PARITY

### What is Glass?

**Glass** is the reference implementation (Pickle Glass) that EVIA-Desktop is based on. Located in `/glass/` directory.

**Key Differences**:
| Feature | Glass | EVIA-Desktop |
|---------|-------|--------------|
| Auth | Firebase | EVIA JWT |
| Backend | Local (Ollama/Whisper) | EVIA-Backend (Deepgram/Groq) |
| Language | English | German (default) |
| UI Framework | LitElement | React |
| State | SQLite (local) | Backend API |

### Glass Files Used for Reference

**Critical references**:
- `glass/src/ui/app/MainHeader.js` → `EviaBar.tsx`
- `glass/src/ui/listen/ListenView.js` → `ListenView.tsx`
- `glass/src/ui/ask/AskView.js` → `AskView.tsx`
- `glass/src/main.js` → `main.ts`
- `glass/src/windowManager.js` → `overlay-windows.ts`

**CSS Parity**:
- Glass effect: `backdrop-filter: blur(60px) saturate(180%)`
- Border radius: `12px`
- Shadows: Multiple layers for depth
- Animations: `ANIM_DURATION = 180ms` (now 0ms for instant)

### Parity Status

✅ **Complete**:
- Window layout and positioning
- Always-on-top behavior
- Header dragging
- Show/Hide/Toggle logic
- Settings hover behavior
- Ask window auto-resize
- Listen tabs (Transcript/Erkenntnisse)
- Insights clickability
- Visual design (Glass effect, shadows, colors)

⚠️ **Deviations** (intentional):
- **Auth**: JWT instead of Firebase
- **Language**: German default (Glass is English)
- **Backend**: Remote API instead of local AI
- **Animation speed**: 0ms (instant) instead of 180ms

---

## ALL IMPLEMENTED FIXES

### Round 1-5: Foundation (26 Fixes)

**Critical Infrastructure**:
1. Electron app initialization
2. Menu bar integration
3. Window creation and management
4. IPC bridge setup
5. Audio capture (mic + system)
6. WebSocket connection to backend
7. JWT authentication integration
8. Permission handling (mic, screen, accessibility)
9. Header dragging
10. Show/Hide/Toggle windows
11. Settings hover behavior
12. Listen window (transcript tab)
13. Listen window (insights tab)
14. Ask window basic functionality
15. Keyboard shortcuts (Cmd+K, Cmd+Shift+Return)
16. German i18n
17. Glass CSS parity
18. Build configuration (electron-builder)
19. Icon setup (1024x1024)
20. State persistence (disk)
21. Window state restoration on startup
22. Markdown rendering (marked.js)
23. Syntax highlighting (highlight.js)
24. Error handling
25. Logging
26. Production build fixes

### Round 6: Polish & Critical Fixes (8 Fixes)

#### FIX #27: "Fertig" Button Behavior
**Problem**: Pressing "Stopp" cleared Ask window content  
**Solution**: Only clear on "Fertig", broadcast `session:closed` event  
**Files**: `EviaBar.tsx`, `AskView.tsx`, `overlay-windows.ts`

#### FIX #28: "Zusammenfassung" Spacing
**Problem**: Too much vertical space above title  
**Solution**: Reduced top padding from 4px to 2px  
**Files**: `ListenView.tsx`

#### FIX #29: "Fragen" Opens Multiple Windows
**Problem**: Pressing "Fragen" opened Ask, Listen, and Settings  
**Solution**: Modified toggle to only affect Ask window  
**Files**: `overlay-windows.ts`

#### FIX #30: "Fragen" Leaves Listen Open
**Problem**: Closing Ask left Listen open unexpectedly  
**Solution**: Explicitly close only Ask and Settings, preserve Listen  
**Files**: `overlay-windows.ts`

#### FIX #31: Ask Window Auto-Resize
**Problem**: Window not auto-expanding/detracting based on Groq output  
**Solution**: Used `requestAnimationFrame` to measure `scrollHeight` after DOM update  
**Files**: `AskView.tsx`

#### FIX #32: Ask Window Reopen Size
**Problem**: Reopening Ask with content showed tiny 58px window  
**Solution**: Added `visibilitychange` event listener to recalculate size on window show  
**Files**: `AskView.tsx`

#### FIX #33: "Zusammenfassung" Top Spacing
**Problem**: Browser default margin created large gap  
**Solution**: Added explicit `marginTop: '0px'` to h3 element  
**Files**: `ListenView.tsx`

#### FIX #34: Ask Button Opens Listen Window ⭐ CRITICAL
**Problem**: Pressing "Fragen" opened Listen from previous session (persisted state leak)  
**Solution**: Check actual window visibility (`win.isVisible()`) instead of persisted state  
**Files**: `overlay-windows.ts` (lines 663-699)

**Root Cause**:
```typescript
// BUGGY (spread includes stale persisted state):
const vis = getVisibility()  // { listen: true } from disk
const newVis = { ...vis, ask: true }  // Opens both!

// FIXED (explicit current state check):
const newVis = { ask: true, settings: false }
if (listenWin?.isVisible()) {  // Only if ACTUALLY visible
  newVis.listen = true
}
```

---

## DEVELOPMENT GUIDE

### Prerequisites

**System Requirements**:
- macOS 12+ (Apple Silicon or Intel)
- Node.js 20+
- npm 10+

**Backend Running**:
```bash
cd EVIA-Backend
docker-compose up
# Backend at http://localhost:8000
```

### Setup

```bash
cd EVIA-Desktop

# Install dependencies
npm install

# Build native modules (keytar, etc.)
npm run rebuild

# Start development
npm run dev

# Build production app
npm run build
# Output: dist/mac-arm64/EVIA.app
```

### Project Structure

```
EVIA-Desktop/
├── src/
│   ├── main/               # Main process (Electron)
│   │   ├── main.ts        # Entry point
│   │   ├── overlay-windows.ts  # Window management ⭐
│   │   ├── header-controller.ts
│   │   └── preload.js     # IPC bridge
│   ├── renderer/           # Renderer process (React)
│   │   ├── overlay/       # Overlay UI components
│   │   │   ├── EviaBar.tsx       # Header
│   │   │   ├── ListenView.tsx    # Transcription/Insights ⭐
│   │   │   ├── AskView.tsx       # Questions/Answers ⭐
│   │   │   ├── SettingsView.tsx
│   │   │   └── ShortCutSettingsView.tsx
│   │   ├── audio-processor.js    # Audio capture
│   │   ├── overlay-entry.tsx     # Renderer entry
│   │   └── i18n/          # Translations (de.json, en.json)
│   └── assets/            # Images, icons, styles
├── native/                # Native modules (Swift)
│   └── mac/SystemAudioCapture/
├── electron-builder.yml   # Build config
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### Adding a New Window

**Step 1**: Add to `WINDOW_DATA` (overlay-windows.ts):
```typescript
const WINDOW_DATA: Record<FeatureName, WindowSpec> = {
  // ... existing windows
  myWindow: {
    width: 400,
    height: 300,
    zIndex: 5,  // Higher than existing windows
  }
}
```

**Step 2**: Update types:
```typescript
type FeatureName = 'listen' | 'ask' | 'settings' | 'shortcuts' | 'myWindow'
```

**Step 3**: Add to `layoutChildWindows()`:
```typescript
if (visible.myWindow) {
  const win = createChildWindow('myWindow')
  // Calculate position...
  layout.myWindow = { x, y, width, height }
}
```

**Step 4**: Create React component:
```typescript
// src/renderer/overlay/MyWindowView.tsx
export function MyWindowView() {
  return <div>My Window Content</div>
}
```

**Step 5**: Add route (overlay-entry.tsx):
```typescript
<Route path="/my-window" element={<MyWindowView />} />
```

**Step 6**: Add button (EviaBar.tsx):
```typescript
const handleMyWindowClick = async () => {
  const shown = await toggleWindow('myWindow')
  setIsMyWindowActive(shown)
}
```

### Debugging

**Main Process**:
```bash
# Enable DevTools in main process
export ELECTRON_ENABLE_LOGGING=1
npm run dev
```

**Renderer Process**:
- Right-click any window → "Inspect Element"
- Console logs visible in DevTools
- React DevTools extension supported

**Logs**:
```bash
# Main process logs
~/Library/Logs/evia/main.log

# Renderer process logs (in DevTools Console)

# Backend logs
docker-compose logs -f backend
```

---

## TESTING

### Manual Testing Checklist

**Window Management**:
- [ ] Header drag (smooth, no sticking)
- [ ] Press "Fragen" (only Ask opens)
- [ ] Press "Fragen" again (Ask closes)
- [ ] Press "Listen" (Listen opens)
- [ ] Press "Listen" + "Fragen" (both visible)
- [ ] Close "Fragen" (Listen stays open)
- [ ] Press "Anzeigen/Ausblenden" (all windows toggle)
- [ ] Hover 3-dot button (Settings appears after 50ms)
- [ ] Move mouse away (Settings disappears after 200ms)

**Audio & Transcription**:
- [ ] Press "Listen" (microphone permission requested if needed)
- [ ] Speak into microphone (transcript appears in real-time)
- [ ] Play system audio (transcript appears)
- [ ] Press "Stopp" (recording stops, insights generate)
- [ ] Switch to "Erkenntnisse" tab (insights visible)
- [ ] Click insight summary point (Ask window opens with prompt)

**Ask Window**:
- [ ] Fresh start, press "Fragen" (compact 58px ask bar)
- [ ] Type question, press Enter (Groq response streams)
- [ ] Window auto-expands to fit response
- [ ] Close Ask window
- [ ] Reopen Ask window (previous response visible at correct size)
- [ ] Press "Fertig" (Ask clears)
- [ ] Press "Fragen" again (empty ask bar)

**Edge Cases**:
- [ ] Reopen app (header position restored)
- [ ] Reopen app (persisted Listen state does NOT leak into Ask)
- [ ] Multiple monitor setup (windows stay on correct screen)
- [ ] Fast toggle spam (no crashes, smooth animations)
- [ ] Long Groq response (window caps at 700px, scrollable)

### Automated Testing

**Unit Tests** (not yet implemented):
```bash
npm run test
```

**E2E Tests** (not yet implemented):
```bash
npm run test:e2e
```

---

## TROUBLESHOOTING

### Common Issues

#### 1. "Module not found" errors
**Cause**: Missing dependencies  
**Solution**:
```bash
rm -rf node_modules package-lock.json
npm install
```

#### 2. Native module compilation failures
**Cause**: Missing Xcode Command Line Tools  
**Solution**:
```bash
xcode-select --install
npm run rebuild
```

#### 3. Windows don't appear
**Cause**: Persisted state corruption or window off-screen  
**Solution**:
```bash
rm ~/Library/Application\ Support/evia/overlay-state.json
open dist/mac-arm64/EVIA.app
```

#### 4. Listen window opens unexpectedly when pressing "Fragen"
**Cause**: FIX #34 not applied (persisted state leak)  
**Solution**: Ensure `toggleWindow()` uses `win.isVisible()` check, not spread operator

#### 5. Ask window wrong size when reopened
**Cause**: FIX #32 not applied (visibility event listener missing)  
**Solution**: Ensure `visibilitychange` event listener is registered in `AskView.tsx`

#### 6. Audio not capturing
**Cause**: Permissions not granted  
**Solution**:
```bash
# Reset permissions
tccutil reset Microphone com.evia.app
tccutil reset ScreenCapture com.evia.app

# Restart app, grant permissions when prompted
```

#### 7. Backend connection refused
**Cause**: Backend not running  
**Solution**:
```bash
cd EVIA-Backend
docker-compose up
# Wait for "Application startup complete"
```

#### 8. JWT token expired
**Cause**: Token stored in keychain is old  
**Solution**:
- Click "Open Browser to Log in" in welcome screen
- Log in via EVIA-Frontend
- Desktop will auto-receive new token

---

## ARCHITECTURE DECISIONS

### Why Electron?

**Pros**:
- ✅ Cross-platform (macOS, Windows, Linux)
- ✅ Always-on-top windows (BrowserWindow)
- ✅ Native menu bar integration
- ✅ System-level audio capture (ScreenCaptureKit)
- ✅ Global keyboard shortcuts
- ✅ Secure keychain integration (keytar)

**Cons**:
- ❌ Large bundle size (~150MB)
- ❌ Memory overhead (~100-200MB)
- ❌ Native module complexity (Swift → Node.js bridge)

**Alternatives Considered**:
- **Tauri** (Rust + WebView): Smaller, but immature audio APIs
- **Native Swift**: Best performance, but macOS-only
- **PWA**: No always-on-top, no system audio

### Why React over LitElement (Glass)?

**Reasons**:
1. **Team Familiarity**: React is more widely known
2. **TypeScript Support**: First-class TS support
3. **Ecosystem**: Larger ecosystem (libraries, tools)
4. **DevTools**: Excellent debugging experience

**Trade-offs**:
- Glass uses LitElement (smaller bundle, faster)
- Porting required more work (Glass → React conversion)

### Why Separate Windows Instead of Tabs?

**Benefits**:
1. **Flexibility**: Independent positioning, sizing
2. **Performance**: Only visible windows consume resources
3. **Glass Parity**: Matches reference implementation
4. **UX**: Windows feel native, not web-like

**Trade-offs**:
- More complex window management logic
- IPC overhead for communication
- State management across windows

---

## PERFORMANCE CONSIDERATIONS

### Window Creation

**Optimization**: Lazy creation
```typescript
// Create on first show, cache in Map
function createChildWindow(name: FeatureName): BrowserWindow {
  const existing = childWindows.get(name)
  if (existing && !existing.isDestroyed()) return existing  // Reuse!
  
  const win = new BrowserWindow({ show: false })  // Hidden initially
  childWindows.set(name, win)
  return win
}
```

**Impact**: First show is slower (~100ms), subsequent shows are instant

### State Persistence

**Optimization**: Debounced writes
```typescript
// Write to disk only after 300ms of inactivity
if (saveStateTimer) clearTimeout(saveStateTimer)
saveStateTimer = setTimeout(() => {
  fs.writeFileSync(persistFile, JSON.stringify(persistedState))
}, 300)
```

**Impact**: Reduces disk I/O from ~100/sec (during drag) to ~3/sec

### Audio Processing

**Optimization**: AudioWorklet (separate thread)
```typescript
// Audio processing runs in AudioWorklet (off main thread)
const audioContext = new AudioContext()
await audioContext.audioWorklet.addModule('audio-processor.js')
```

**Impact**: No audio glitches, UI stays responsive

### React Rendering

**Optimization**: Memoization
```typescript
// Expensive calculations cached
const calculateAndResize = useCallback(() => {
  // ... complex DOM measurements
}, [response])

// Component only re-renders when response changes
useEffect(() => {
  calculateAndResize()
}, [calculateAndResize])
```

**Impact**: Smooth scrolling, instant UI updates

---

## SECURITY

### IPC Security

**Principle**: Never expose Node.js APIs directly to renderer

**Implementation**:
```typescript
// preload.js - Allowlist pattern
contextBridge.exposeInMainWorld('evia', {
  windows: {
    show: (name) => ipcRenderer.invoke('win:show', name),  // Validated
    // NOT exposed: arbitrary IPC send/invoke
  }
})
```

### Authentication

**JWT Storage**: macOS Keychain (via keytar)
```typescript
// Secure storage
await keytar.setPassword('evia', 'jwt-token', token)

// Retrieval
const token = await keytar.getPassword('evia', 'jwt-token')
```

**Token Lifecycle**:
1. User logs in via EVIA-Frontend (browser)
2. Backend returns JWT
3. Frontend sends token to Desktop via custom URL scheme
4. Desktop stores in Keychain
5. Desktop includes token in API requests (`Authorization: Bearer <token>`)

### Content Security Policy

**Header Windows**: Restricted CSP
```typescript
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self'; 
               style-src 'self' 'unsafe-inline'; 
               connect-src 'self' ws://localhost:8000 http://localhost:8000">
```

---

## FUTURE IMPROVEMENTS

### High Priority

1. **Automated Tests**
   - Unit tests for critical functions (layoutChildWindows, toggleWindow)
   - E2E tests for common workflows (Listen → Insights → Ask)

2. **Error Boundaries**
   - React error boundaries to prevent full app crashes
   - Graceful degradation when backend is unreachable

3. **Offline Mode**
   - Cache last session transcripts
   - Queue questions when offline, send when online

### Medium Priority

4. **Multi-Language Support**
   - English as secondary language
   - User-selectable language preference

5. **Custom Shortcuts**
   - User-configurable keyboard shortcuts
   - Shortcut conflict detection

6. **Session History**
   - Browse past sessions
   - Search transcripts
   - Export to file

### Low Priority

7. **Themes**
   - Light mode (currently dark only)
   - Custom color schemes

8. **Window Snapping**
   - Snap to screen edges
   - Magnetic alignment between windows

9. **Performance Monitoring**
   - Track audio latency, transcript delay
   - Alert on performance degradation

---

## CHANGELOG

### Version 1.0 (2025-10-18) - Round 6 Complete

**New Features**:
- ✅ Ask window auto-resize based on content (FIX #31)
- ✅ Ask window reopen size preservation (FIX #32)
- ✅ "Fertig" button clears Ask window (FIX #27)

**Bug Fixes**:
- ✅ FIX #34: Ask button no longer opens Listen from previous session
- ✅ FIX #33: Removed extra spacing above "Zusammenfassung"
- ✅ FIX #29/#30: "Fragen" button only affects Ask window
- ✅ FIX #28: Reduced spacing above "Zusammenfassung" title

**Known Issues**:
- ⚠️ Groq rate limits (100k tokens/day) - need Dev Tier upgrade
- ⚠️ Dual EVIA permissions (old + new) - manual `tccutil reset` required

### Previous Versions

**Version 0.9 (2025-10-15) - Round 5**
- Implemented all Round 1-5 fixes (26 issues)
- Achieved Glass parity
- Production-ready build

---

## GLOSSARY

**Electron**: Framework for building desktop apps with web technologies  
**IPC**: Inter-Process Communication (main ↔ renderer)  
**BrowserWindow**: Electron's window class  
**AudioWorklet**: Web Audio API for real-time audio processing  
**ScreenCaptureKit**: macOS API for capturing system audio  
**Glass**: Reference implementation (Pickle Glass) for EVIA-Desktop  
**Groq**: LLM provider (LLaMA models)  
**Deepgram**: Speech-to-text provider  
**Keytar**: Node.js module for secure credential storage  
**Vite**: Build tool for fast development  

---

## SUPPORT & CONTRIBUTION

### Getting Help

**Documentation**:
- This file (EVIA-DESKTOP-ARCHITECTURE.md)
- EVIAContext.md (historical context)
- README.md (quick start)

**Code Review**:
- All critical functions are commented with FIX numbers
- Search for "FIX #" to find specific bug fixes

**Debugging**:
- Enable verbose logging: `export ELECTRON_ENABLE_LOGGING=1`
- Check main.log: `~/Library/Logs/evia/main.log`
- Use DevTools: Right-click any window → Inspect

### Contributing

**Code Style**:
- TypeScript for new files
- Functional components (React)
- Async/await (not callbacks)
- Descriptive variable names
- Comments for non-obvious logic

**Testing**:
- Test all window interactions
- Test audio capture with real data
- Test edge cases (fast clicks, multiple monitors)

**Pull Requests**:
- Describe the problem (link to issue)
- Explain the solution
- Include before/after behavior
- Add tests if possible

---

**Last Updated**: 2025-10-18  
**Total Issues Resolved**: 34  
**Status**: Production Ready ✅

