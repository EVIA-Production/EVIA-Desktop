import { app, BrowserWindow, ipcMain, screen, globalShortcut, dialog, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { headerController } from './header-controller'

// 🔧 Dev mode detection for Vite dev server
const isDev = process.env.NODE_ENV === 'development'
const VITE_DEV_SERVER_URL = 'http://localhost:5174'

export type FeatureName = 'listen' | 'ask' | 'settings' | 'shortcuts'

type WindowVisibility = Partial<Record<FeatureName, boolean>>

let headerWindow: BrowserWindow | null = null
const childWindows: Map<FeatureName, BrowserWindow> = new Map()

// ✅ DYNAMIC WIDTH: Header automatically resizes to fit content (EviaBar.tsx:192-222)
// - Measures content width using getBoundingClientRect() on mount + language change
// - IPC: header:set-window-width sends width to main process (lines 213-239)
// - Main re-centers header and persists bounds (Glass parity)
// Initial size: 900x49px (used for createHeaderWindow, then dynamically adjusted)
// Height: 49px to accommodate 47px content + 2px for glass border (1px top + 1px bottom)
const HEADER_SIZE = { width: 900, height: 49 }
// WINDOWS FIX (2025-12-05): Use PAD=8 exactly like Glass (windowLayoutManager.js line 159)
// This is the gap between header and child windows
const PAD = 8
const ANIM_DURATION = 0 // INSTANT show/hide 
let settingsHideTimer: NodeJS.Timeout | null = null

// Note: All windows load overlay.html with ?view=X query params for React routing.
// The 'html' field is kept for documentation but not used in loadFile() calls.
const WINDOW_DATA = {
  listen: {
    width: 400,
    height: 420,
    html: 'overlay.html?view=listen', // Documentation only - actual load uses query param
    zIndex: 1,
  },
  ask: {
    width: 640,  // Increased from 600 to fit form + padding
    height: 58,   // 🔧 FIX #23: Symmetric compact size (input container: 12+12+34=58px, no extra chrome)
    html: 'overlay.html?view=ask',
    zIndex: 2,
  },
  settings: {
    width: 240, // Glass parity: windowManager.js:527
    height: 400, // Glass uses maxHeight: 400, we use fixed height
    html: 'overlay.html?view=settings',
    zIndex: 10, // 🔧 FIX (2025-12-10): Settings ALWAYS on top of other windows
  },
  shortcuts: {
    width: 353, // Glass parity: windowManager.js:562
    height: 580, // Calculated: 12 shortcuts + header + buttons + padding (was 720, reduced to fit tighter)
    html: 'overlay.html?view=shortcuts',
    zIndex: 11, // 🔧 FIX: Shortcuts above settings when both open
  },
} satisfies Record<FeatureName, { width: number; height: number; html: string; zIndex: number }>

const WORKSPACES_OPTS = { visibleOnFullScreen: true }

const persistFile = path.join(app.getPath('userData'), 'overlay-prefs.json')
type ShortcutConfig = {
  [key: string]: string  // action -> accelerator mapping
}

type PersistedState = {
  headerBounds?: Electron.Rectangle
  visible?: WindowVisibility
  autoUpdate?: boolean  // User preference for automatic updates
  shortcuts?: ShortcutConfig  // User-customized keyboard shortcuts
}
let persistedState: PersistedState = {}

// Glass parity: Track visibility before hide (windowManager.js:227-233)
let lastVisibleWindows = new Set<FeatureName>()

try {
  if (fs.existsSync(persistFile)) {
    const data = fs.readFileSync(persistFile, 'utf8')
    persistedState = JSON.parse(data) as PersistedState
  }
} catch (error) {
  console.warn('[overlay] Failed to load persisted state', error)
}

// Debounce timer for saveState (prevents disk thrashing during drag/movement)
let saveStateTimer: NodeJS.Timeout | null = null

function saveState(partial: Partial<PersistedState>) {
  const before = JSON.stringify(persistedState)
  const newState = { ...persistedState, ...partial }
  const after = JSON.stringify(newState)
  
  // PERFORMANCE FIX: Skip save if nothing changed (prevents disk thrashing)
  if (before === after) {
    return // No change, don't write to disk
  }
  
  persistedState = newState
  
  // MUP FIX #4: Debounce disk writes to reduce I/O during rapid events (drag, arrow keys)
  if (saveStateTimer) {
    clearTimeout(saveStateTimer)
  }
  
  saveStateTimer = setTimeout(() => {
    console.log(`[overlay-windows] saveState (debounced): ${JSON.stringify(persistedState.visible)} (writing to disk)`)
    try {
      fs.mkdirSync(path.dirname(persistFile), { recursive: true })
      fs.writeFileSync(persistFile, JSON.stringify(persistedState, null, 2), 'utf8')
    } catch (error) {
      console.warn('[overlay] Failed to persist state', error)
    }
    saveStateTimer = null
  }, 300) // 300ms debounce - balances responsiveness with performance
}

function getOrCreateHeaderWindow(): BrowserWindow {
  if (headerWindow && !headerWindow.isDestroyed()) return headerWindow

  // WINDOWS FIX (2025-12-05): Use different window type on Windows for better always-on-top behavior
  // On Windows: 'toolbar' type provides more reliable always-on-top than 'panel'
  // On macOS: Keep 'panel' type for proper fullscreen floating behavior
  const isWindows = process.platform === 'win32'

  headerWindow = new BrowserWindow({
    width: HEADER_SIZE.width,
    height: HEADER_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    type: process.platform === 'darwin' ? 'panel' : undefined, // macOS: panel, Windows: normal window for taskbar
    alwaysOnTop: true,
    skipTaskbar: false, // Show in taskbar so users can see EVIA is running
    icon: path.join(__dirname, '..', '..', 'src', 'main', 'assets', 'icon.ico'),
    hiddenInMissionControl: true, // Glass parity: Hide from Mission Control
    focusable: true,
    hasShadow: false,
    backgroundColor: '#00000000', // Fully transparent
    title: 'EVIA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      enableWebSQL: false,
      devTools: true, // 🔥 ENABLE in production for debugging session/complete
      backgroundThrottling: false, // Glass parity: Keep rendering smooth
    },
  })

  // Only open DevTools automatically in development
  if (process.env.NODE_ENV === 'development') {
    headerWindow.webContents.openDevTools({ mode: 'detach' });
  }
  
  // 🔥 PRODUCTION DEVTOOLS: Add keyboard shortcuts to toggle DevTools (Cmd+Shift+I / Ctrl+Shift+I)
  const headerWebContents = headerWindow.webContents;
  headerWebContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.shift && (input.meta || input.control) && input.key.toLowerCase() === 'i') {
      if (headerWebContents.isDevToolsOpened()) {
        headerWebContents.closeDevTools()
      } else {
        headerWebContents.openDevTools({ mode: 'detach' })
      }
    }
  });

  // Glass parity: Hide window buttons on macOS (windowManager.js:467)
  if (process.platform === 'darwin') {
    headerWindow.setWindowButtonVisibility(false)
  }

  const restoreBounds = persistedState.headerBounds
  if (restoreBounds) {
    headerWindow.setBounds(restoreBounds)
  } else {
    const { workArea } = screen.getPrimaryDisplay()
    const x = Math.round(workArea.x + (workArea.width - HEADER_SIZE.width) / 2)
    const y = Math.round(workArea.y + 40)
    headerWindow.setBounds({ x, y, width: HEADER_SIZE.width, height: HEADER_SIZE.height })
  }

  headerWindow.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
  // WINDOWS FIX (2025-12-10): Use 'screen-saver' level on ALL platforms for highest priority
  // This is the highest always-on-top level and prevents EVIA from going behind other windows
  // Previous approach with 'floating' + blur listeners caused visual flicker
  headerWindow.setAlwaysOnTop(true, 'screen-saver');
  
  if (process.platform === 'win32') {
    // WINDOWS FIX (2025-12-10): On blur, just call moveTop() without toggling alwaysOnTop
    // This prevents the visual flicker that occurred when toggling the state
    headerWindow.on('blur', () => {
      if (headerWindow && !headerWindow.isDestroyed() && headerWindow.isVisible()) {
        setTimeout(() => {
          if (headerWindow && !headerWindow.isDestroyed() && headerWindow.isVisible()) {
            // Just move windows to top, don't toggle alwaysOnTop (causes flicker)
            for (const [_, win] of childWindows) {
              if (win && !win.isDestroyed() && win.isVisible()) {
                win.moveTop();
              }
            }
            headerWindow?.moveTop();
          }
        }, 100);
      }
    });
  }
  headerWindow.setContentProtection(false) // Glass parity: OFF by default, user toggles via Settings
  headerWindow.setIgnoreMouseEvents(false)

  // 🔧 Load from Vite dev server in development, built files in production
  if (isDev) {
    headerWindow.loadURL(`${VITE_DEV_SERVER_URL}/overlay.html?view=header`)
    console.log('[overlay-windows] 🔧 Header loading from Vite dev server:', `${VITE_DEV_SERVER_URL}/overlay.html?view=header`)
  } else {
    headerWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'), {
      query: { view: 'header' },
    })
  }

  headerWindow.on('moved', () => {
    const b = headerWindow?.getBounds()
    if (b) saveState({ headerBounds: b })
    // Ensure child windows track header movement even if the move wasn't initiated
    // via our custom drag IPC (win:moveHeaderTo). This keeps Ask/Listen aligned
    // across platforms where native move events can differ.
    try {
      const vis = getVisibility()
      layoutChildWindows(vis)
    } catch (e) {
      console.warn('[overlay-windows] Failed to re-layout after header moved:', e)
    }
  })

  // 🔥 LIVE FOLLOW: Continuously re-layout overlays while dragging/resizing the header
  // Throttle to ~60fps to avoid jank; do NOT persist to disk in this fast path.
  let liveLayoutScheduled = false
  const requestLiveLayout = () => {
    if (liveLayoutScheduled) return
    liveLayoutScheduled = true
    setTimeout(() => {
      liveLayoutScheduled = false
      try {
        const vis = getVisibility()
        layoutChildWindows(vis)
      } catch (e) {
        console.warn('[overlay-windows] Live layout update failed:', e)
      }
    }, 16)
  }

  // Fires repeatedly during native drag/move on Windows/Linux and also on macOS
  headerWindow.on('move', requestLiveLayout)
  // Keep overlays aligned if header width changes mid-drag or due to content
  headerWindow.on('resize', requestLiveLayout)

  headerWindow.on('closed', () => {
    headerWindow = null
  })

  headerWindow.once('ready-to-show', () => {
    console.log('[overlay-windows] 🎯 HEADER ready-to-show event - calling showInactive()')
    headerWindow?.showInactive()
    console.log('[overlay-windows] ✅ HEADER showInactive() called - header should be visible now')
    
    // 🔧 DIAGNOSTIC: Log header state after showing
    setTimeout(() => {
      if (headerWindow && !headerWindow.isDestroyed()) {
        console.log('[overlay-windows] 🔍 HEADER state check (100ms after show):')
        console.log('  - isVisible:', headerWindow.isVisible())
        console.log('  - isMinimized:', headerWindow.isMinimized())
        console.log('  - isFocused:', headerWindow.isFocused())
        const bounds = headerWindow.getBounds()
        console.log('  - bounds:', bounds)
      } else {
        console.log('[overlay-windows] ❌ HEADER DESTROYED within 100ms of showing!')
      }
    }, 100)
  })

  // Listen for content width requests from renderer (for dynamic sizing)
  // 🔴 CRITICAL FIX: Prevent dragging header off-screen
  // This handler fires BEFORE the window moves, allowing us to clamp the position
  headerWindow.on('will-move', (event, newBounds) => {
    const clamped = clampBounds(newBounds)
    if (clamped.x !== newBounds.x || clamped.y !== newBounds.y) {
      event.preventDefault()
      if (headerWindow && !headerWindow.isDestroyed()) {
        headerWindow.setBounds(clamped)
        // Also reposition child windows
        const vis = getVisibility()
        layoutChildWindows(vis)
      }
    }
  })

  ipcMain.removeHandler('header:get-content-width')
  ipcMain.handle('header:get-content-width', async () => {
    if (!headerWindow || headerWindow.isDestroyed()) return null
    try {
      const width = await headerWindow.webContents.executeJavaScript(`
        (() => {
          const header = document.querySelector('.evia-main-header');
          if (!header) return null;
          // Get actual rendered width including all buttons
          const rect = header.getBoundingClientRect();
          return Math.ceil(rect.width);
        })()
      `)
      return width
    } catch (error) {
      console.warn('[overlay-windows] Failed to get content width:', error)
      return null
    }
  })

  // Listen for resize requests from renderer
  ipcMain.removeHandler('header:set-window-width')
  ipcMain.handle('header:set-window-width', async (_event, contentWidth: number) => {
    if (!headerWindow || headerWindow.isDestroyed()) return false
    try {
      const bounds = headerWindow.getBounds()
      const newWidth = contentWidth // 🔴 FIX: Use exact content width, no minimum or padding
      
      console.log(`[overlay-windows] Resizing header: ${bounds.width}px → ${newWidth}px (content: ${contentWidth}px)`)
      
      // GLASS PARITY FIX: Re-center header horizontally when width changes
      const { workArea } = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
      const newX = Math.round(workArea.x + (workArea.width - newWidth) / 2)
      
      headerWindow.setBounds({
        x: newX,
        y: bounds.y,
        width: newWidth,
        height: bounds.height
      })
      
      // Update persisted bounds
      const newBounds = headerWindow.getBounds()
      saveState({ headerBounds: newBounds })

      // NEW: Immediately re-layout child windows so Ask/Listen track the header
      // after a width change (e.g., language toggle). Previously this could wait
      // until the next toggle/move on some platforms.
      try {
        const vis = getVisibility()
        layoutChildWindows(vis)
      } catch (e) {
        console.warn('[overlay-windows] Failed to re-layout after header resize:', e)
      }
      return true
    } catch (error) {
      console.warn('[overlay-windows] Failed to resize window:', error)
      return false
    }
  })

  return headerWindow
}

function createChildWindow(name: FeatureName): BrowserWindow {
  const existing = childWindows.get(name)
  if (existing && !existing.isDestroyed()) return existing

  const def = WINDOW_DATA[name]
  const parent = getOrCreateHeaderWindow()
  
  // Glass parity: Ask/Settings/Shortcuts need to be focusable for input
  const needsFocus = name === 'ask' || name === 'settings' || name === 'shortcuts' || name === 'listen'
  
  // Glass parity: Shortcuts window is independent (no parent) and movable (windowManager.js:560-568)
  const isShortcuts = name === 'shortcuts'
  
  // WINDOWS FIX (2025-12-05): Use different window type on Windows for better always-on-top behavior
  const isWindows = process.platform === 'win32'
  
  const win = new BrowserWindow({
    parent: isShortcuts ? undefined : parent, // Shortcuts has no parent so it can be moved
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: isShortcuts, // Only shortcuts window is movable
    minimizable: false,
    maximizable: false,
    focusable: needsFocus, // Ask/Settings/Shortcuts can receive focus
    type: isWindows ? 'toolbar' : 'panel', // WINDOWS FIX: Use 'toolbar' on Windows for reliable always-on-top
    skipTaskbar: true,
    alwaysOnTop: true,
    modal: false,
    width: def.width,
    height: def.height,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      enableWebSQL: false,
      devTools: true, // Glass parity: Always enable DevTools, will only open in dev mode
    },
  })

  // Glass parity: Hide window buttons on macOS (windowManager.js:467)
  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(false)
  }

  win.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
  // WINDOWS FIX (2025-12-10): Use 'screen-saver' level on ALL platforms
  // This is the highest always-on-top level - prevents windows from going behind others
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(false) // Glass parity: OFF by default, user toggles via Settings
  
  // Glass parity: All windows are interactive by default (windowManager.js:287)
  win.setIgnoreMouseEvents(false)

  // 🔧 Load from Vite dev server in development, built files in production
  if (isDev) {
    const url = `${VITE_DEV_SERVER_URL}/overlay.html?view=${name}`
    win.loadURL(url)
    console.log(`[overlay-windows] 🔧 ${name} window loading from Vite dev server:`, url)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/overlay.html'), {
      query: { view: name },
    })
  }

  win.on('closed', () => {
    childWindows.delete(name)
  })
  
  // Glass parity: Open DevTools for all child windows in development (windowManager.js:726-728, 553-555)
  if (!app.isPackaged) {
    console.log(`[overlay-windows] Opening DevTools for ${name} window`)
    win.webContents.openDevTools({ mode: 'detach' })
  }

  // 🔥 PRODUCTION DEVTOOLS: Add keyboard shortcuts to toggle DevTools in production
  // Cmd+Option+I (macOS) or F12 (all platforms)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      // Cmd+Option+I on macOS
      if (process.platform === 'darwin' && input.meta && input.alt && input.key.toLowerCase() === 'i') {
        event.preventDefault()
        if (win.webContents.isDevToolsOpened()) {
          win.webContents.closeDevTools()
        } else {
          win.webContents.openDevTools({ mode: 'detach' })
        }
      }
      // F12 on all platforms
      if (input.key === 'F12') {
        event.preventDefault()
        if (win.webContents.isDevToolsOpened()) {
          win.webContents.closeDevTools()
        } else {
          win.webContents.openDevTools({ mode: 'detach' })
        }
      }
    }
  })

  // 🔴 CRITICAL FIX: Prevent dragging windows off-screen
  // Only shortcuts window is movable, but we enforce boundaries for all windows
  if (isShortcuts) {
    win.on('will-move', (event, newBounds) => {
      const clamped = clampBounds(newBounds)
      if (clamped.x !== newBounds.x || clamped.y !== newBounds.y) {
        event.preventDefault()
        win.setBounds(clamped)
      }
    })
  }

  // Glass parity: Settings window cursor tracking
  // Since Electron doesn't have window hover events, we poll cursor position
  if (name === 'settings') {
    let cursorPollInterval: NodeJS.Timeout | null = null
    let wasInsideSettings = false
    
    // Start polling when window is shown
    win.on('show', () => {
      console.log('[overlay-windows] Settings shown - starting cursor poll')
      wasInsideSettings = false
      
      cursorPollInterval = setInterval(() => {
        if (win.isDestroyed() || !win.isVisible()) {
          if (cursorPollInterval) clearInterval(cursorPollInterval)
          return
        }
        
        const cursorPos = screen.getCursorScreenPoint()
        const bounds = win.getBounds()
        
        // Check if cursor is inside settings window bounds
        const isInside = cursorPos.x >= bounds.x && 
                        cursorPos.x <= bounds.x + bounds.width &&
                        cursorPos.y >= bounds.y && 
                        cursorPos.y <= bounds.y + bounds.height
        
        // Track enter/leave transitions
        if (isInside && !wasInsideSettings) {
          console.log('[overlay-windows] Cursor entered settings bounds')
          wasInsideSettings = true
          // 🔧 FIX: Bring settings to front when hovered (above other windows)
          try { win.moveTop() } catch {}
          // Cancel hide timer
          if (settingsHideTimer) {
            console.log('[overlay-windows] Canceling hide timer - cursor inside')
            clearTimeout(settingsHideTimer)
            settingsHideTimer = null
          }
        } else if (!isInside && wasInsideSettings) {
          console.log('[overlay-windows] Cursor left settings bounds')
          wasInsideSettings = false
          // Start hide timer
          if (settingsHideTimer) clearTimeout(settingsHideTimer)
          settingsHideTimer = setTimeout(() => {
            console.log('[overlay-windows] Hiding settings after cursor left')
            // CRITICAL FIX: Only hide settings window, DON'T call updateWindows
            // 🔧 FIX (2025-12-10): Don't change alwaysOnTop before hiding - just hide
            if (win && !win.isDestroyed()) {
              win.hide()
            }
            const vis = getVisibility()
            saveState({ visible: { ...vis, settings: false } })
            settingsHideTimer = null
          }, 200)
        }
      }, 50) // Poll every 50ms (20fps, smooth enough)
    })
    
    // Stop polling when window is hidden
    win.on('hide', () => {
      console.log('[overlay-windows] Settings hidden - stopping cursor poll')
      if (cursorPollInterval) {
        clearInterval(cursorPollInterval)
        cursorPollInterval = null
      }
      wasInsideSettings = false
    })
  }

  childWindows.set(name, win)
  return win
}

function getWorkAreaBounds() {
  const header = getOrCreateHeaderWindow()
  const hb = header.getBounds()
  const display = screen.getDisplayNearestPoint({ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 })
  return display.workArea
}

function clampBounds(bounds: Electron.Rectangle, skipPadding = false): Electron.Rectangle {
  // Use bounds center point to find display (avoid circular dependency with header)
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const display = screen.getDisplayNearestPoint({ x: centerX, y: centerY })
  
  const screenBounds = display.bounds  // Full screen (for X axis - reach actual edge)
  const workArea = display.workArea    // Work area (for Y axis - avoid menu bar)
  
  // 🔴 USER FIX: Use screenBounds for X (reach actual right edge, not dock edge)
  // Use workArea for Y (avoid menu bar at top)
  const padding = skipPadding ? 0 : 0  // No padding for any window
  
  const minX = screenBounds.x + padding
  const maxX = screenBounds.x + screenBounds.width - bounds.width - padding
  
  const minY = workArea.y + padding
  const maxY = workArea.y + workArea.height - bounds.height - padding
  
  console.log(`[clampBounds] 📥 Input: (${bounds.x}, ${bounds.y}), size: ${bounds.width}x${bounds.height}`)
  console.log(`[clampBounds] 📏 Screen: ${screenBounds.width}x${screenBounds.height}, WorkArea: ${workArea.width}x${workArea.height}`)
  console.log(`[clampBounds] 📏 Boundaries: minX=${minX}, maxX=${maxX}, minY=${minY}, maxY=${maxY}, padding=${padding}`)
  console.log(`[clampBounds] 📏 Right edge gap: ${screenBounds.x + screenBounds.width - (bounds.x + bounds.width)}px (should be ${padding}px after clamping)`)
  
  const clamped = {
    x: Math.max(minX, Math.min(bounds.x, maxX)),
    y: Math.max(minY, Math.min(bounds.y, maxY)),
    width: bounds.width,
    height: bounds.height,
  }
  
  console.log(`[clampBounds] 📤 Output: (${clamped.x}, ${clamped.y}), clamped: x=${bounds.x !== clamped.x}, y=${bounds.y !== clamped.y}`)
  console.log(`[clampBounds] 📏 Final right edge gap: ${screenBounds.x + screenBounds.width - (clamped.x + clamped.width)}px`)
  
  // 🔍 DIAGNOSTIC: Validate output is not NaN
  if (isNaN(clamped.x) || isNaN(clamped.y)) {
    console.error(`[clampBounds] ❌ Invalid clamped bounds:`, clamped, 'from input:', bounds)
    // Return original bounds if clamping failed
    return bounds
  }
  
  return clamped
}

// Glass parity: Port windowLayoutManager.js:132-220 horizontal stack algorithm
function layoutChildWindows(visible: WindowVisibility) {
  const header = getOrCreateHeaderWindow()
  const hb = header.getBounds()
  const work = getWorkAreaBounds()
  
  // 🔴 CRITICAL FIX: Get screen bounds for horizontal calculations (match clampBounds behavior)
  const centerX = hb.x + hb.width / 2
  const centerY = hb.y + hb.height / 2
  const display = screen.getDisplayNearestPoint({ x: centerX, y: centerY })
  const screenBounds = display.bounds  // Full screen width (for X axis - reach actual edge)

  const PAD_LOCAL = PAD
  const screenWidth = screenBounds.width  // 🔴 Use SCREEN width (not workArea) for X axis
  const screenHeight = work.height        // Use workArea height for Y axis (avoid menu bar)
  
  // 🔧 FIX #9: Calculate header center more explicitly for perfect alignment
  // Use absolute positioning first, then convert to relative coordinates
  const headerCenterX = hb.x + (hb.width / 2)  // Absolute center X of header
  const headerCenterXRel = headerCenterX - screenBounds.x  // 🔴 Relative to SCREEN (not workArea)
  
  const relativeY = (hb.y - work.y) / screenHeight

  // Determine if windows should be above or below header (Glass: determineLayoutStrategy)
  const isAbovePreferred = relativeY > 0.5

  const layout: Record<string, { x: number; y: number; width: number; height: number }> = {}

  // Handle Ask and Listen windows (horizontal stack)
  const askVis = visible.ask
  const listenVis = visible.listen

  if (askVis || listenVis) {
    const askWin = askVis ? createChildWindow('ask') : null
    const listenWin = listenVis ? createChildWindow('listen') : null

    const askW = askVis && askWin ? WINDOW_DATA.ask.width : 0
    
    // 🔧 CRITICAL FIX: Preserve Ask window's current height when it has content
    // This prevents the "zap" when moving with arrow keys
    // Only use default height (58px) if window is newly created or very small
    let askH = 0
    if (askVis && askWin) {
      const currentBounds = askWin.getBounds()
      const currentHeight = currentBounds.height
      // If window has content (height > default), preserve it during movement
      // Otherwise use default height for empty/new window
      askH = currentHeight > WINDOW_DATA.ask.height ? currentHeight : WINDOW_DATA.ask.height
    }
    
    const listenW = listenVis && listenWin ? WINDOW_DATA.listen.width : 0
    const listenH = listenVis && listenWin ? WINDOW_DATA.listen.height : 0

    if (askVis && listenVis) {
      // Both windows: horizontal stack (listen left, ask right)
      // 🔧 FIX: Center the ENTIRE group (listen + gap + ask) under header
      const totalWidth = listenW + PAD_LOCAL + askW
      const groupCenterXRel = headerCenterXRel - totalWidth / 2
      
      let listenXRel = groupCenterXRel
      let askXRel = listenXRel + listenW + PAD_LOCAL

      // 🔴 FIX: Use 0 padding (same as header) to ensure identical boundaries
      // Child windows should reach exact screen edges like header does
      if (listenXRel < 0) {
        listenXRel = 0
        askXRel = listenXRel + listenW + PAD_LOCAL
      }
      if (askXRel + askW > screenWidth) {
        askXRel = screenWidth - askW
        listenXRel = askXRel - listenW - PAD_LOCAL
      }

      if (isAbovePreferred) {
        const windowBottomAbs = hb.y - PAD_LOCAL
        layout.ask = { x: Math.round(askXRel + screenBounds.x), y: Math.round(windowBottomAbs - askH), width: askW, height: askH }
        layout.listen = { x: Math.round(listenXRel + screenBounds.x), y: Math.round(windowBottomAbs - listenH), width: listenW, height: listenH }
      } else {
        // WINDOWS FIX (2025-12-05): Use PAD=8 exactly like Glass (windowLayoutManager.js line 200)
        const yAbs = hb.y + hb.height + PAD_LOCAL
        layout.ask = { x: Math.round(askXRel + screenBounds.x), y: Math.round(yAbs), width: askW, height: askH }
        layout.listen = { x: Math.round(listenXRel + screenBounds.x), y: Math.round(yAbs), width: listenW, height: listenH }
        
        // 🔧 DIAGNOSTIC: Log positioning to verify consistent layout
        console.log('[layoutChildWindows] Both windows positioned:');
        console.log('  Ask:', layout.ask);
        console.log('  Listen:', layout.listen);
        console.log('  Gap:', layout.ask.x - (layout.listen.x + layout.listen.width), 'px (expected:', PAD_LOCAL, 'px)');
      }
    } else {
      // Single window: center under header
      const winName = askVis ? 'ask' : 'listen'
      const winW = askVis ? askW : listenW
      const winH = askVis ? askH : listenH

      let xRel = headerCenterXRel - winW / 2
      // 🔴 FIX: Use 0 padding (same as header) to ensure identical boundaries
      xRel = Math.max(0, Math.min(screenWidth - winW, xRel))

      let yPos: number
      if (isAbovePreferred) {
        yPos = hb.y - work.y - PAD_LOCAL - winH
      } else {
        // WINDOWS FIX (2025-12-05): Use PAD=8 for all windows like Glass (windowLayoutManager.js line 214)
        yPos = hb.y - work.y + hb.height + PAD_LOCAL
      }

      layout[winName] = { x: Math.round(xRel + screenBounds.x), y: Math.round(yPos + work.y), width: winW, height: winH }
    }
  }

  // Handle Settings window
  // 🔴 GLASS PARITY: Position settings window (windowLayoutManager.js:71-94)
  // Align settings' RIGHT edge with header's right edge (+ button padding 170px)
  if (visible.settings) {
    const settingsWin = createChildWindow('settings')
    const settingsW = WINDOW_DATA.settings.width  // 240px
    const settingsH = WINDOW_DATA.settings.height // 388px
    
    const PAD = 5  // Glass uses 5px gap
    const buttonPadding = 170  // Glass positions settings relative to button (170px from right)
    
    // Glass formula: x = headerBounds.x + headerBounds.width - settingsBounds.width + buttonPadding
    const x = hb.x + hb.width - settingsW + buttonPadding
    const y = hb.y + hb.height + PAD
    
    // Clamp to screen (Glass uses 10px margin)
    const clampedX = Math.max(work.x + 10, Math.min(work.x + work.width - settingsW - 10, x))
    const clampedY = Math.max(work.y + 10, Math.min(work.y + work.height - settingsH - 10, y))
    
    layout.settings = { x: Math.round(clampedX), y: Math.round(clampedY), width: settingsW, height: settingsH }
    console.log(`[layoutChildWindows] 📐 Settings (Glass parity): x=${Math.round(clampedX)}, y=${Math.round(clampedY)}, buttonPadding=${buttonPadding}`)
  }

  // Handle Shortcuts window (Glass: calculateShortcutSettingsWindowPosition)
  // Position to the right of settings if settings is visible, otherwise center at header
  if (visible.shortcuts) {
    const shortcutsWin = createChildWindow('shortcuts')
    const shortcutsW = WINDOW_DATA.shortcuts.width
    const shortcutsH = WINDOW_DATA.shortcuts.height
    
    let x, y
    if (visible.settings && layout.settings) {
      // 🔧 FIX: Position to the right of settings window (Glass parity)
      x = layout.settings.x + layout.settings.width + PAD
      y = layout.settings.y
    } else {
      // Fallback: Center horizontally at header Y position
      x = hb.x + (hb.width / 2) - (shortcutsW / 2)
      y = hb.y
    }
    
    // Clamp to screen
    x = Math.max(work.x, Math.min(x, work.x + work.width - shortcutsW))
    
    layout.shortcuts = { x: Math.round(x), y: Math.round(y), width: shortcutsW, height: shortcutsH }
  }

  // Apply layout
  // 🔧 UI IMPROVEMENT: Set bounds BEFORE any animation/showing to prevent overlap flash
  for (const [name, bounds] of Object.entries(layout)) {
    const win = createChildWindow(name as FeatureName)
    const clampedBounds = clampBounds(bounds as Electron.Rectangle)
    win.setBounds(clampedBounds)
    console.log(`[layoutChildWindows] 📐 ${name} bounds:`, clampedBounds)
  }
}

function animateShow(win: BrowserWindow) {
  // 🔧 FIX BUG-1: Skip animation entirely if ANIM_DURATION = 0 (instant show)
  if (ANIM_DURATION === 0) {
    win.setOpacity(1)
    win.showInactive()
    return
  }
  
  try {
    win.setOpacity(0)
    win.showInactive()
    const [x, y] = win.getPosition()
    const targetY = y
    win.setPosition(x, y - 10)
    const start = Date.now()
  const tick = () => {
      if (win.isDestroyed()) return
      const progress = Math.min(1, (Date.now() - start) / ANIM_DURATION)
      const eased = 1 - Math.pow(1 - progress, 3)
      win.setPosition(x, targetY - Math.round((1 - eased) * 10))
      win.setOpacity(eased)
      if (progress < 1) setTimeout(tick, 16)
    }
    tick()
  } catch (error) {
    console.warn('[overlay] animateShow failed', error)
    win.showInactive()
  }
}

function animateHide(win: BrowserWindow, onComplete: () => void) {
  // 🔧 FIX BUG-1: Skip animation entirely if ANIM_DURATION = 0 (instant hide)
  if (ANIM_DURATION === 0) {
    win.hide()
    win.setOpacity(1)
    onComplete()
    return
  }
  
  const [x, y] = win.getPosition()
  const startOpacity = win.getOpacity()
  const start = Date.now()
  const tick = () => {
    if (win.isDestroyed()) return
    const progress = Math.min(1, (Date.now() - start) / ANIM_DURATION)
    const eased = 1 - Math.pow(progress, 3)
    win.setOpacity(startOpacity * eased)
    win.setPosition(x, y - Math.round(progress * 10))
    if (progress < 1) {
      setTimeout(tick, 16)
    } else {
      win.hide()
      win.setOpacity(1)
      win.setPosition(x, y)
      onComplete()
    }
  }
  tick()
}

function ensureVisibility(name: FeatureName, shouldShow: boolean) {
  const win = createChildWindow(name)
  // Glass parity: ALL windows are interactive (windowManager.js:287)
  // Only disable mouse events when specifically needed (not by default)
  
  const isCurrentlyVisible = win.isVisible()
  
  if (shouldShow) {
    win.setIgnoreMouseEvents(false) // All windows interactive
    // Glass parity: Settings shows INSTANTLY with no animation (windowManager.js:302)
    // Other windows animate ONLY if not already visible
    if (name === 'settings') {
      win.show() // Instant show for settings
      win.moveTop()
      win.setAlwaysOnTop(true, 'screen-saver')
    } else {
      if (!isCurrentlyVisible) {
        animateShow(win) // Only animate if window was hidden
      }
      // If already visible, don't animate (prevents re-animation bug)
    }
  } else {
  if (name === 'settings') {
      // Settings hides instantly too
      win.setAlwaysOnTop(false, 'screen-saver')
      win.hide()
    } else {
      if (isCurrentlyVisible) {
        animateHide(win, () => {
          win.setIgnoreMouseEvents(false)
        })
      }
      // If already hidden, don't animate
    }
  }
}

function updateWindows(visibility: WindowVisibility) {
  layoutChildWindows(visibility)
  saveState({ visible: visibility })

  // Glass parity: Process ALL windows, not just visible ones (windowManager.js:260-400)
  // This ensures windows get hidden when removed from visibility object
  const allWindows: [FeatureName, boolean][] = [
    ['listen', visibility.listen ?? false],
    ['ask', visibility.ask ?? false],
    ['settings', visibility.settings ?? false],
    ['shortcuts', visibility.shortcuts ?? false],
  ]
  
  // Sort by z-index (ascending) so higher z-index windows are moved to top last
  const sortedEntries = allWindows.sort((a, b) => WINDOW_DATA[a[0]].zIndex - WINDOW_DATA[b[0]].zIndex)

  for (const [name, shown] of sortedEntries) {
    const win = childWindows.get(name)
    if (!win || win.isDestroyed()) continue
    ensureVisibility(name, shown)
    try { win.setAlwaysOnTop(true, 'screen-saver') } catch {}
    try { win.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS) } catch {}
    // Glass parity: Enforce z-order by moving to top in sorted order
    if (shown) {
      try { win.moveTop() } catch {}
    }
  }

  try {
    headerWindow?.setAlwaysOnTop(true, 'screen-saver')
    headerWindow?.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
    headerWindow?.moveTop() // Header always on top
  } catch {}
}

function getVisibility(): WindowVisibility {
  const result = { ...(persistedState.visible ?? {}) }
  console.log(`[overlay-windows] getVisibility() returning:`, result)
  return result
}

function toggleWindow(name: FeatureName) {
  const vis = getVisibility()
  const current = !!vis[name]
  
  // 🔧 FIX #34: CRITICAL - Only toggle the requested window, don't spread persisted state
  // Problem: getVisibility() returns persisted state from disk (e.g. listen:true from previous session)
  // Solution: Explicitly build newVis with ONLY currently active windows + the toggled window
  
  if (name === 'ask') {
    // 🔧 FIX: When toggling Ask, preserve Listen if it's currently visible (not persisted state)
    // Check actual current visibility to avoid state leak from disk
    const listenWin = childWindows.get('listen')
    const isListenCurrentlyVisible = listenWin && !listenWin.isDestroyed() && listenWin.isVisible()
    
    const newVis: WindowVisibility = {
      ask: !current,
      settings: false,  // Always close settings
      listen: isListenCurrentlyVisible,  // Preserve Listen if visible
      shortcuts: false, // Always close shortcuts
    }
    
    console.log(`[overlay-windows] toggleWindow('ask'): ask=${!current}, preserving listen=${isListenCurrentlyVisible}`)
    updateWindows(newVis)
    
    // 🔧 CONSERVATIVE FIX: Focus Ask window when showing
    if (!current) {  // If we're showing the Ask window (toggled from hidden to shown)
      const askWin = childWindows.get('ask')
      if (askWin && !askWin.isDestroyed()) {
        askWin.focus()
        console.log(`[overlay-windows] ✅ Ask window focused after toggle`)
      }
    }
    
    return newVis.ask
  }
  
  // For other windows (listen, settings, shortcuts), use spread to preserve ask state
  const newVis = { ...vis, [name]: !current }
  updateWindows(newVis)
  return newVis[name]
}

function hideAllChildWindows() {
  const vis = getVisibility()
  const newVis: WindowVisibility = {}
  updateWindows(newVis)
  return vis
}

function handleHeaderToggle() {
  // 🔧 FIX #2: Remove async/await and dynamic import to eliminate button delay
  // CRITICAL AUTH CHECK: Only allow toggle if user is authenticated and has permissions
  const currentState = headerController.getCurrentState()
  
  if (currentState !== 'ready') {
    console.log('[overlay-windows] ⛔ Header toggle blocked - user not ready (state:', currentState, ')')
    return // Don't allow toggle if not authenticated + permissions granted
  }
  
  const headerVisible = headerWindow && !headerWindow.isDestroyed() && headerWindow.isVisible()
  
  if (headerVisible) {
    // Glass parity: Save visible windows BEFORE hiding (windowManager.js:227-240)
    lastVisibleWindows.clear()
    for (const [name, win] of childWindows) {
      if (win && !win.isDestroyed() && win.isVisible()) {
        lastVisibleWindows.add(name)
      }
    }
    
    // Hide all child windows
    for (const name of lastVisibleWindows) {
      const win = childWindows.get(name)
      if (win && !win.isDestroyed()) {
        win.hide()
      }
    }
    
    // Hide header last
    headerWindow?.hide()
    } else {
    // Show header
    headerWindow = getOrCreateHeaderWindow()
    headerWindow.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
    headerWindow.setIgnoreMouseEvents(false)
    headerWindow.setAlwaysOnTop(true, 'screen-saver')
    headerWindow.showInactive()
    
    // 🔧 FIX #6: Restore ONLY previously visible windows (windowManager.js:245-249)
    // Don't restore from persisted state - only from lastVisibleWindows Set
    console.log('[overlay-windows] 🔄 Restoring windows:', Array.from(lastVisibleWindows))
    const vis: WindowVisibility = {}
    for (const name of lastVisibleWindows) {
      vis[name] = true
    }
    if (Object.keys(vis).length > 0) {
      updateWindows(vis)
      // Ensure restored windows are on top and visible
      for (const name of lastVisibleWindows) {
        const win = childWindows.get(name)
        if (win && !win.isDestroyed()) {
          win.setAlwaysOnTop(true, 'screen-saver')
          win.moveTop()
        }
      }
    }
  }
}

let isAnimating = false
let animationTarget: Electron.Rectangle = { x: 0, y: 0, width: 0, height: 0 }
let animationStartPos: { x: number, y: number } = { x: 0, y: 0 }
let animationStartTime = 0
let animationTimer: NodeJS.Timeout | null = null

function nudgeHeader(dx: number, dy: number) {
  // 🔴 CRITICAL FIX #3: Smooth movement even with rapid/held key presses
  const header = getOrCreateHeaderWindow()
  
  // 🔴 FIX 3a: If already animating, restart animation from current position to new target
  // User requirement: "press twice = move for 600ms" (extend duration)
  if (isAnimating) {
    // Stop current animation
    if (animationTimer) {
      clearTimeout(animationTimer)
      animationTimer = null
    }
    
    // Calculate new target from CURRENT target (not current position)
    const newTarget = clampBounds({ 
      ...animationTarget,
      x: animationTarget.x + dx, 
      y: animationTarget.y + dy 
    })
    
    // Restart animation from CURRENT position to new target
    const currentBounds = header.getBounds()
    animationTarget = newTarget
    animationStartPos = { x: currentBounds.x, y: currentBounds.y }
    animationStartTime = Date.now()
    
    console.log(`[nudgeHeader] ⚡ Restarted animation: (${currentBounds.x}, ${currentBounds.y}) → (${newTarget.x}, ${newTarget.y})`)
    
    // Continue animating with new parameters (fall through to animate())
  } else {
    // Start new animation
    const bounds = header.getBounds()
    const target = clampBounds({ ...bounds, x: bounds.x + dx, y: bounds.y + dy })
    animationTarget = target
    animationStartPos = { x: bounds.x, y: bounds.y }
    animationStartTime = Date.now()
  }
  
  // Smooth animation over 300ms (Glass parity)
  const duration = 300
  isAnimating = true
  
  const animate = () => {
    // 🔴 CRITICAL FIX: Validate header still exists
    if (!header || header.isDestroyed()) {
      console.error('[nudgeHeader] ❌ Header destroyed during animation')
      isAnimating = false
      if (animationTimer) clearTimeout(animationTimer)
      animationTimer = null
      return
    }
    
    const elapsed = Date.now() - animationStartTime
    const progress = Math.min(elapsed / duration, 1)
    
    // Ease-out cubic for smooth deceleration
    const eased = 1 - Math.pow(1 - progress, 3)
    
    const currentX = animationStartPos.x + (animationTarget.x - animationStartPos.x) * eased
    const currentY = animationStartPos.y + (animationTarget.y - animationStartPos.y) * eased
    
    // 🔴 CRITICAL FIX: Validate coordinates are valid numbers
    if (isNaN(currentX) || isNaN(currentY)) {
      console.error('[nudgeHeader] ❌ Invalid coordinates:', { currentX, currentY, animationStartPos, animationTarget })
      isAnimating = false
      if (animationTimer) clearTimeout(animationTimer)
      animationTimer = null
      return
    }
    
    header.setPosition(Math.round(currentX), Math.round(currentY))
    
    // 🔴 CRITICAL FIX: Reposition child windows DURING animation (not just at end)
    // This prevents windows from "appearing in borders" until arrow key is pressed
    const vis = getVisibility()
    layoutChildWindows(vis)
    
    if (progress < 1) {
      animationTimer = setTimeout(animate, 16) // ~60fps
    } else {
      // Animation complete
      isAnimating = false
      animationTimer = null
      
      // Final layout and save state
      layoutChildWindows(vis)
      saveState({ headerBounds: animationTarget })
    }
  }
  
  animate()
}

function openAskWindow() {
  console.log('[overlay-windows] 🚨 openAskWindow() CALLED - STACK TRACE:')
  console.trace()
  
  // 🔧 FIX #42: Make Cmd+Enter TOGGLE Ask window (not just open)
  // 🔧 FIX: When closing Ask, don't close Listen (preserve Listen's state)
  const vis = getVisibility()
  const askVisible = !!vis.ask
  
  if (askVisible) {
    // Ask is open, close it WITHOUT affecting Listen
    const newVis = { ...vis, ask: false }
    console.log('[overlay-windows] Cmd+Enter: Closing Ask only, preserving Listen:', vis.listen)
    updateWindows(newVis)
  } else {
    // Ask is closed, open it (this will close other windows as per normal behavior)
    console.log('[overlay-windows] 🚨 Opening Ask window via toggleWindow')
    toggleWindow('ask')
  }
}

// 🔥 GLASS PARITY: Default shortcuts (Glass: shortcutsService.js:59-75)
function getDefaultShortcuts(): ShortcutConfig {
  const isMac = process.platform === 'darwin'
  const mod = isMac ? 'Cmd' : 'Ctrl'
  
  return {
    toggleVisibility: `${mod}+\\`,
    nextStep: `${mod}+Enter`,
    moveUp: `${mod}+Up`,
    moveDown: `${mod}+Down`,
    moveLeft: `${mod}+Left`,
    moveRight: `${mod}+Right`,
    scrollUp: `${mod}+Shift+Up`,
    scrollDown: `${mod}+Shift+Down`,
    toggleClickThrough: `${mod}+M`,
    manualScreenshot: `${mod}+Shift+S`,
    previousResponse: `${mod}+[`,
    nextResponse: `${mod}+]`,
  }
}

// 🔥 GLASS PARITY: Load shortcuts from persisted state or use defaults
function loadShortcuts(): ShortcutConfig {
  if (persistedState.shortcuts) {
    // Merge saved shortcuts with defaults (in case new shortcuts added)
    const defaults = getDefaultShortcuts()
    return { ...defaults, ...persistedState.shortcuts }
  }
  return getDefaultShortcuts()
}

// 🔥 GLASS PARITY: Dynamic shortcut registration (Glass: shortcutsService.js:138-287)
function registerShortcuts() {
  // Unregister all first (Glass does this)
  globalShortcut.unregisterAll()
  
  const shortcuts = loadShortcuts()
  const step = 80 // Glass parity: windowLayoutManager.js:243 uses 80px
  
  // All callbacks must be paramless - Electron doesn't pass event objects to globalShortcut handlers
  const nudgeUp = () => nudgeHeader(0, -step)
  const nudgeDown = () => nudgeHeader(0, step)
  const nudgeLeft = () => nudgeHeader(-step, 0)
  const nudgeRight = () => nudgeHeader(step, 0)
  
  // WINDOWS FIX (2025-12-05): Validate accelerator format before registering
  // Electron requires valid accelerator strings like "Ctrl+S" or "Cmd+Shift+Enter"
  // Invalid formats like "Ctrl+SS" will throw: "Error processing argument at index 0"
  const isValidAccelerator = (accelerator: string): boolean => {
    if (!accelerator) return false
    
    // Electron valid modifiers
    const validModifiers = ['Cmd', 'Command', 'Ctrl', 'Control', 'Alt', 'Option', 'Shift', 'Meta', 'Super']
    
    // Electron valid keys (non-exhaustive but covers common cases)
    const validKeys = [
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
      'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
      'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
      'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F22', 'F23', 'F24',
      'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter', 'Escape', 'Esc',
      'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown',
      'Plus', 'Minus', 'nummult', 'numdiv', 'numadd', 'numsub', 'numdec',
      '[', ']', '\\', ';', "'", ',', '.', '/', '`', '-', '='
    ]
    
    const parts = accelerator.split('+')
    if (parts.length < 2) return false // Need at least modifier + key
    
    const lastKey = parts[parts.length - 1]
    const modifiers = parts.slice(0, -1)
    
    // Validate all modifiers
    for (const mod of modifiers) {
      if (!validModifiers.includes(mod)) return false
    }
    
    // Validate final key (single character or known special key)
    if (lastKey.length === 1) return true // Single char keys are valid
    if (validKeys.includes(lastKey)) return true
    
    return false
  }
  
  // WINDOWS FIX (2025-12-05): Convert Cmd to Ctrl on Windows
  // Shortcuts are stored with "Cmd" prefix for Mac compatibility
  // On Windows, we need to convert to "Ctrl" for registration
  const convertAcceleratorForPlatform = (accelerator: string): string => {
    if (process.platform === 'win32') {
      // Replace Cmd with Ctrl on Windows
      return accelerator
        .replace(/\bCmd\b/g, 'Ctrl')
        .replace(/\bCommand\b/g, 'Ctrl')
    }
    return accelerator
  }
  
  // Register each shortcut with its handler
  const registerSafe = (accelerator: string | undefined, handler: () => void) => {
    if (!accelerator) return
    
    // Convert Cmd to Ctrl on Windows
    const platformAccelerator = convertAcceleratorForPlatform(accelerator)
    
    // WINDOWS FIX: Validate before attempting registration
    if (!isValidAccelerator(platformAccelerator)) {
      console.warn(`[Shortcuts] Invalid accelerator format: "${platformAccelerator}" (from "${accelerator}") - skipping registration`)
      console.warn('[Shortcuts] 💡 Valid format: "Ctrl+S", "Cmd+Shift+Enter", etc. (modifier+single_key)')
      return
    }
    
    try {
      const success = globalShortcut.register(platformAccelerator, handler)
      if (!success) {
        console.warn(`[Shortcuts] Failed to register: ${platformAccelerator}`)
      } else {
        console.log(`[Shortcuts] ✅ Registered: ${platformAccelerator}`)
      }
    } catch (error) {
      console.error(`[Shortcuts] Error registering ${platformAccelerator}:`, error)
    }
  }
  
  registerSafe(shortcuts.toggleVisibility, handleHeaderToggle)
  registerSafe(shortcuts.nextStep, openAskWindow)
  registerSafe(shortcuts.moveUp, nudgeUp)
  registerSafe(shortcuts.moveDown, nudgeDown)
  registerSafe(shortcuts.moveLeft, nudgeLeft)
  registerSafe(shortcuts.moveRight, nudgeRight)
  
  // NOTE: scroll/toggleClickThrough/screenshot/response handlers will be added in Phase 2
  // Current implementation covers core navigation shortcuts (6/12 implemented)
  
  console.log('[Shortcuts] Registered shortcuts:', Object.keys(shortcuts).length)
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll()
}

app.on('browser-window-focus', () => {
  headerWindow?.setAlwaysOnTop(true, 'screen-saver')
  for (const win of childWindows.values()) {
    win.setAlwaysOnTop(true, 'screen-saver')
  }
})

// WINDOWS FIX (2025-12-10): Improved always-on-top without flicker
// Previous approach toggled setAlwaysOnTop(false) then true, causing visual flicker
// New approach: Just call moveTop() without touching the alwaysOnTop state
// The windows are created with alwaysOnTop=true and 'screen-saver' level which is permanent
let alwaysOnTopInterval: NodeJS.Timeout | null = null;

function startAlwaysOnTopRefresh() {
  if (process.platform !== 'win32') return;
  if (alwaysOnTopInterval) return; // Already running
  
  // 🔧 FIX: Use longer interval (60s) and only use moveTop() - no flicker
  alwaysOnTopInterval = setInterval(() => {
    // Only refresh if header window exists and is visible
    if (!headerWindow || headerWindow.isDestroyed() || !headerWindow.isVisible()) return;
    
    try {
      // 🔧 FIX: Don't toggle alwaysOnTop - just bring windows to front
      // This prevents the visual flicker caused by toggling the state
      
      // Move visible child windows to front first
      for (const [_, win] of childWindows) {
        if (win && !win.isDestroyed() && win.isVisible()) {
          win.moveTop();
        }
      }
      
      // Move header to top last (ensures it's above children)
      headerWindow.moveTop();
      
      console.log('[overlay-windows] 🔄 Windows always-on-top refreshed');
    } catch (err) {
      console.warn('[overlay-windows] ⚠️ Failed to refresh always-on-top:', err);
    }
  }, 60000); // Every 60 seconds (increased from 30s since we're not toggling)
  
  console.log('[overlay-windows] ✅ Started Windows always-on-top refresh (60s interval)');
}

function stopAlwaysOnTopRefresh() {
  if (alwaysOnTopInterval) {
    clearInterval(alwaysOnTopInterval);
    alwaysOnTopInterval = null;
    console.log('[overlay-windows] 🛑 Stopped Windows always-on-top refresh');
  }
}

app.on('ready', () => {
  // Explicitly show and set Dock icon
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show()
    const { nativeImage } = require('electron')
    const path = require('path')
    // In production, icons are in resources folder; in dev, they're in src/main/assets
    const isDev = !app.isPackaged
    const iconPath = isDev
      ? path.join(__dirname, 'assets', 'icon.png')
      : path.join(process.resourcesPath, 'icon.png')
    console.log('[DOCK] Icon path:', iconPath, '(isDev:', isDev, ')')
    try {
      const icon = nativeImage.createFromPath(iconPath)
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon)
        console.log('[DOCK] ✅ Dock icon set successfully')
      } else {
        console.warn('[DOCK] ⚠️ Icon file is empty or invalid at:', iconPath)
        // Fallback: try alternative paths
        const altPaths = [
          path.join(__dirname, '..', 'assets', 'icon.png'),
          path.join(__dirname, '..', '..', 'src', 'main', 'assets', 'icon.png'),
          path.join(app.getAppPath(), 'src', 'main', 'assets', 'icon.png')
        ]
        for (const altPath of altPaths) {
          const altIcon = nativeImage.createFromPath(altPath)
          if (!altIcon.isEmpty()) {
            app.dock.setIcon(altIcon)
            console.log('[DOCK] ✅ Dock icon set from fallback:', altPath)
            break
          }
        }
      }
    } catch (err) {
      console.error('[DOCK] ❌ Failed to set Dock icon:', err)
    }
  }
  
  registerShortcuts()
  
  // WINDOWS FIX (2025-12-05): Start the always-on-top refresh interval on Windows
  startAlwaysOnTopRefresh();
  
  // DON'T create header automatically - let header-controller manage the flow
  // header-controller.initialize() will show Welcome → Permissions → Header
  // Child windows appear on demand (Listen button, Ask command, etc.)
})

app.on('will-quit', () => {
  unregisterShortcuts()
  stopAlwaysOnTopRefresh() // WINDOWS FIX: Stop the always-on-top refresh
})

ipcMain.handle('win:show', (_event, name: FeatureName) => {
  const next = toggleWindow(name)
  return { ok: true, toggled: next ? 'shown' : 'hidden' }
})

ipcMain.handle('win:ensureShown', (_event, name: FeatureName) => {
  console.log(`[overlay-windows] 🚨 win:ensureShown called for ${name}`)
  
  // checks isOtherWinVisible by calling win.isVisible()
  const otherName = name === 'listen' ? 'ask' : (name === 'ask' ? 'listen' : null)
  
  // Build visibility based on ACTUAL state, not saved state
  const actualVis: WindowVisibility = {
    listen: false,
    ask: false,
    settings: false,
    shortcuts: false,
  }
  
  // Set the window we're showing
  actualVis[name] = true
  
  // Check if the OTHER window (ask/listen) is ACTUALLY visible
  if (otherName) {
    const otherWin = childWindows.get(otherName)
    const isOtherActuallyVisible = otherWin && !otherWin.isDestroyed() && otherWin.isVisible()
    console.log(`[overlay-windows] 🔍 Checking ${otherName}: exists=${!!otherWin}, destroyed=${otherWin?.isDestroyed()}, visible=${otherWin?.isVisible()} → actuallyVisible=${isOtherActuallyVisible}`)
    if (isOtherActuallyVisible) {
      actualVis[otherName] = true
    }
  }
  
  console.log(`[overlay-windows] 📊 ACTUAL visibility for layout:`, actualVis)
  
  // Create window if needed
  let win = childWindows.get(name)
  if (!win || win.isDestroyed()) {
    win = createChildWindow(name)
  }
  
  // Layout based on ACTUAL visibility
  layoutChildWindows(actualVis)
  
  if (win && !win.isDestroyed()) {
    win.show()
    win.setAlwaysOnTop(true, 'screen-saver')
    
    if (name === 'ask') {
      win.focus()
      console.log(`[overlay-windows] ✅ Ask window focused for input auto-focus`)
    }
  }
  
  // Due to parent-child relationship, must call moveTop() in correct order:
  // 1. Child window first (so it's on top of other windows)
  // 2. Header second (so it's above its children)
  const header = getOrCreateHeaderWindow()
  if (header && !header.isDestroyed()) {
    header.setAlwaysOnTop(true, 'screen-saver')
    if (!header.isVisible()) {
      header.show()
      console.log(`[overlay-windows] 📺 Header was hidden, showing it`)
    }
    
    // Move child window to top first, then header above it
    if (win && !win.isDestroyed()) {
      win.moveTop()
      console.log(`[overlay-windows] 📊 Child ${name} moved to top`)
    }
    header.moveTop()
    console.log(`[overlay-windows] ✅ Header moved to top after showing ${name} (header above child)`)
  }
  
  // Save the ACTUAL visibility state
  saveState({ visible: actualVis })
  console.log(`[overlay-windows] ensureShown complete for ${name}`)
  return { ok: true }
})

ipcMain.handle('win:hide', (_event, name: FeatureName) => {
  console.log(`[overlay-windows] win:hide called for ${name}`)
  const vis = getVisibility()
  console.log('[overlay-windows] Current visibility:', vis)
  const next = { ...vis }
  delete next[name]
  console.log('[overlay-windows] New visibility (after delete):', next)
  updateWindows(next)
  return { ok: true }
  })

  ipcMain.handle('win:getHeaderPosition', () => {
  const header = getOrCreateHeaderWindow()
  return header.getBounds()
})

ipcMain.handle('win:moveHeaderTo', (_event, x: number, y: number) => {
  const header = getOrCreateHeaderWindow()
  const currentBounds = header.getBounds()
  
  // 🔴 DIAGNOSTIC: Log every step to find why clamping fails
  console.log(`[win:moveHeaderTo] 📥 Input: (${x}, ${y})`)
  console.log(`[win:moveHeaderTo] 📊 Current header bounds:`, currentBounds)
  
  // Get display info
  const display = screen.getDisplayNearestPoint({ x, y })
  console.log(`[win:moveHeaderTo] 🖥️ Display bounds:`, display.bounds)
  console.log(`[win:moveHeaderTo] 🖥️ Display workArea:`, display.workArea)
  
  // Create requested bounds
  const requestedBounds = { ...currentBounds, x, y }
  console.log(`[win:moveHeaderTo] 📐 Requested bounds:`, requestedBounds)
  
  // Clamp bounds
  const clampedBounds = clampBounds(requestedBounds)
  console.log(`[win:moveHeaderTo] 🔒 Clamped bounds:`, clampedBounds)
  console.log(`[win:moveHeaderTo] 📏 Clamping applied: x=${x !== clampedBounds.x}, y=${y !== clampedBounds.y}`)
  
  // Set bounds
  header.setBounds(clampedBounds)
  
  // Verify actual bounds after setting
  const actualBounds = header.getBounds()
  console.log(`[win:moveHeaderTo] ✅ Actual bounds after setBounds:`, actualBounds)
  
  // Check if setBounds actually worked
  if (actualBounds.x !== clampedBounds.x || actualBounds.y !== clampedBounds.y) {
    console.error(`[win:moveHeaderTo] ❌ setBounds FAILED! Expected (${clampedBounds.x}, ${clampedBounds.y}), got (${actualBounds.x}, ${actualBounds.y})`)
  }
  
  saveState({ headerBounds: clampedBounds })
  
  // 🔴 CRITICAL: Reposition child windows CONTINUOUSLY during drag
  const vis = getVisibility()
  layoutChildWindows(vis)
  
  return { ok: true }
})

ipcMain.handle('win:resizeHeader', (event, width: number, height: number) => {
  try {
    // Prefer to resize the BrowserWindow that sent this IPC (works for Welcome window and header)
    const senderWebContents = event?.sender
    let targetWin: BrowserWindow | null = null

    if (senderWebContents) {
      targetWin = BrowserWindow.fromWebContents(senderWebContents) as BrowserWindow | null
    }

    // If we couldn't find sender's window, fallback to the header window
    if (!targetWin) {
      targetWin = getOrCreateHeaderWindow()
    }

    const bounds = targetWin.getBounds()
    const requested = { ...bounds, width: Math.round(width), height: Math.round(height) }
    const newBounds = clampBounds(requested)

    targetWin.setBounds(newBounds)

    // Persist header bounds only when the target is the header window
    const header = getHeaderWindow()
    if (header && targetWin === header) {
      saveState({ headerBounds: newBounds })
    }

    console.log(`[overlay-windows] win:resizeHeader applied to ${targetWin.getTitle() || 'window'}:`, newBounds)
    return { ok: true }
  } catch (err) {
    console.warn('[overlay-windows] win:resizeHeader failed:', err)
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('adjust-window-height', (_event, { winName, height }: { winName: FeatureName; height: number }) => {
  // 🔧 FIX #42: Ensure window exists and bounds are updated correctly
  const win = createChildWindow(winName)
  if (!win || win.isDestroyed()) {
    console.error(`[IPC] ❌ adjust-window-height: Window '${winName}' not available`)
    return { ok: false, error: 'window_not_available' }
  }
  
  const currentBounds = win.getBounds()
  const newBounds = { ...currentBounds, height: Math.round(height) }
  
  console.log(`[IPC] 📏 adjust-window-height: ${winName} ${currentBounds.height}px → ${newBounds.height}px`)
  win.setBounds(newBounds)
  
  return { ok: true }
})

ipcMain.handle('header:toggle-visibility', () => {
  handleHeaderToggle()
    return { ok: true }
  })

ipcMain.handle('header:nudge', (_event, { dx, dy }: { dx: number; dy: number }) => {
  nudgeHeader(dx, dy)
  return { ok: true }
})

ipcMain.handle('header:open-ask', () => {
  openAskWindow()
  return { ok: true }
})

// 🔧 UI IMPROVEMENT: Auth validation IPC handler
ipcMain.handle('auth:validate', async () => {
  const { headerController } = await import('./header-controller');
  const isAuthenticated = await headerController.validateAuthentication();
  
  let user = null;
  if (isAuthenticated) {
    try {
      const keytar = require('keytar');
      const token = await keytar.getPassword('evia', 'token');
      if (token) {
        // Decode JWT to get user info (JWT format: header.payload.signature)
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          user = {
            username: payload.sub || payload.username || 'User',
            email: payload.email || null
          };
          console.log('[Auth] ✅ Decoded user from token:', user.username);
        }
      }
    } catch (error) {
      console.error('[Auth] ❌ Failed to decode token:', error);
    }
  }
  
  return { ok: true, authenticated: isAuthenticated, user };
})

// 🔧 FIX ISSUE #2: Auto-update toggle persistence
ipcMain.handle('settings:get-auto-update', () => {
  const enabled = persistedState.autoUpdate !== undefined ? persistedState.autoUpdate : true;
  console.log('[Settings] 📡 get-auto-update:', enabled);
  return { ok: true, enabled };
})

ipcMain.handle('settings:set-auto-update', (_event, enabled: boolean) => {
  console.log('[Settings] 💾 set-auto-update:', enabled);
  saveState({ autoUpdate: enabled });
  return { ok: true };
})

// 🔥 GLASS PARITY: Shortcuts persistence (Glass: shortcutsService.js:77-121)
ipcMain.handle('shortcuts:get', () => {
  const shortcuts = loadShortcuts();
  console.log('[Shortcuts] 📡 get-shortcuts:', shortcuts);
  return { ok: true, shortcuts };
})

ipcMain.handle('shortcuts:set', (_event, shortcuts: ShortcutConfig) => {
  console.log('[Shortcuts] 💾 set-shortcuts:', shortcuts);
  saveState({ shortcuts });
  // Re-register shortcuts with new values (Glass does this)
  registerShortcuts();
  
  // WINDOWS FIX (2025-12-05): Broadcast to all windows so UI updates (like Glass MainHeader.js line 490-494)
  const allWindows = [headerWindow, ...childWindows.values()];
  for (const win of allWindows) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('shortcuts-updated', shortcuts);
    }
  }
  console.log('[Shortcuts] 📡 Broadcast shortcuts-updated to all windows');
  
  return { ok: true };
})

ipcMain.handle('shortcuts:reset', () => {
  console.log('[Shortcuts] 🔄 reset-shortcuts');
  const defaults = getDefaultShortcuts();
  saveState({ shortcuts: defaults });
  registerShortcuts();
  return { ok: true, shortcuts: defaults };
})

// 🔧 GLASS PARITY FIX: Single-step IPC relay for insight click → Ask window (atomic send+submit)
ipcMain.on('ask:send-and-submit', (_event, payload: string | { text: string; sessionState?: string }) => {
  // 🔧 FIX: Handle both old format (string) and new format (object with sessionState)
  const promptText = typeof payload === 'string' ? payload : payload.text;
  console.log('[Main] 📨 ask:send-and-submit received:', promptText.substring(0, 50));
  if (typeof payload === 'object' && payload.sessionState) {
    console.log('[Main] 🎯 Session state from Insights:', payload.sessionState);
  }
  
  // Use original payload for relay (preserves sessionState if present)
  const prompt = payload;
  
  // 🎯 CRITICAL FIX: Ensure Ask window exists and is visible BEFORE sending prompt
  let askWin = childWindows.get('ask');
  if (!askWin || askWin.isDestroyed()) {
    console.log('[Main] 🔧 Ask window not found, creating...');
    askWin = createChildWindow('ask');
  }
  
  if (askWin && !askWin.isDestroyed()) {
    // 🔧 FIX #25: Explicitly close settings when opening Ask (prevent unwanted settings popup)
    const vis = getVisibility();
    if (!vis.ask || vis.settings) {
      console.log('[Main] 🔧 Opening Ask window, closing settings');
      updateWindows({ ...vis, ask: true, settings: false });
    }
    
    // 🔧 FIX #24: Wait for window to be FULLY ready before sending prompt
    // Use did-finish-load event to ensure IPC handlers are registered
    const sendPrompt = () => {
      if (askWin && !askWin.isDestroyed()) {
        askWin.webContents.send('ask:send-and-submit', prompt);
        console.log('[Main] ✅ Prompt relayed to Ask window with auto-submit');
      }
    };
    
    // If window just loaded, wait for ready. Otherwise send immediately.
    if (askWin.webContents.isLoading()) {
      console.log('[Main] ⏳ Ask window still loading, waiting for did-finish-load...');
      askWin.webContents.once('did-finish-load', () => {
        // Extra 100ms buffer for React to mount and register IPC handlers
        setTimeout(sendPrompt, 100);
      });
    } else {
      // Window already loaded, send with short delay for safety
      setTimeout(sendPrompt, 50);
    }
  } else {
    console.error('[Main] ❌ Failed to create/show Ask window for send-and-submit');
  }
});

// 🔧 FIX: Expose desktopCapturer.getSources for system audio capture
ipcMain.handle('desktop-capturer:getSources', async (_event, options: Electron.SourcesOptions) => {
  const { desktopCapturer, systemPreferences } = require('electron')
  try {
    console.log('[Main] 🎥 desktopCapturer.getSources called')
    console.log('[Main] Options:', JSON.stringify(options))
    
    // Check screen recording permission on macOS
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen')
      console.log('[Main] macOS Screen Recording permission status:', status)
      
      if (status === 'denied') {
        console.warn('[Main] ⚠️  Screen Recording permission currently DENIED')
        console.warn('[Main] desktopCapturer will attempt to request permission from macOS...')
        // DON'T throw error - let desktopCapturer.getSources() trigger macOS permission prompt
      } else if (status === 'not-determined') {
        console.log('[Main] ⚠️  Screen Recording permission not yet determined - will prompt user')
      } else if (status === 'granted') {
        console.log('[Main] ✅ Screen Recording permission already granted')
      }
    }
    
    console.log('[Main] Calling desktopCapturer.getSources()...')
    const sources = await desktopCapturer.getSources(options)
    console.log('[Main] ✅ Found', sources.length, 'desktop sources:')
    sources.forEach((source: any, index: number) => {
      console.log(`[Main]   ${index + 1}. "${source.name}" (id: ${source.id})`)
    })
    
    return sources
  } catch (error: any) {
    console.error('[Main] ❌ desktopCapturer.getSources ERROR:', error)
    console.error('[Main] Error message:', error.message)
    console.error('[Main] Error stack:', error.stack)
    
    // 🔧 CRITICAL FIX: Don't throw - return empty array so renderer can continue with mic-only
    // If we throw here, it crashes the entire startCapture() in renderer, breaking BOTH mic AND system audio
    console.warn('[Main] ⚠️ Returning empty sources array - system audio will be unavailable')
    console.warn('[Main] User should grant Screen Recording permission in System Settings')
    return []
  }
})

// 🎯 TASK 3: Enhanced Mac screenshot with ScreenCaptureKit (via desktopCapturer)
ipcMain.handle('capture:screenshot', async () => {
  const { desktopCapturer, systemPreferences, screen } = require('electron')
  
  try {
    // 🔒 TASK 3: Check screen recording permission on macOS (SCK requirement)
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen')
      console.log('[Screenshot] macOS Screen Recording permission status:', status)
      
      if (status === 'denied') {
        console.error('[Screenshot] ⛔ Screen Recording permission DENIED')
        return { 
          ok: false, 
          error: 'Screen Recording permission denied. Please grant in System Preferences > Privacy & Security > Screen Recording.',
          needsPermission: true 
        }
      } else if (status === 'not-determined') {
        console.log('[Screenshot] ⚠️  Screen Recording permission not determined - will prompt user')
        // desktopCapturer.getSources will trigger permission prompt
      }
    }
    
    // 🎯 TASK 3: Get primary display dimensions for full-resolution capture
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.size
    const scaleFactor = primaryDisplay.scaleFactor || 1
    
    // Use actual display size with scale factor for Retina displays
    const thumbnailWidth = Math.min(width * scaleFactor, 3840) // Cap at 4K width
    const thumbnailHeight = Math.min(height * scaleFactor, 2160) // Cap at 4K height
    
    console.log('[Screenshot] 📸 Capturing at', thumbnailWidth, 'x', thumbnailHeight, '(scale:', scaleFactor, ')')
    
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight } 
    })
    
    if (!sources.length) {
      return { ok: false, error: 'No display sources found', needsPermission: false }
    }
    
    const source = sources[0]
    const thumbnail = source.thumbnail
    const buffer = thumbnail.toPNG()
    const size = thumbnail.getSize()
    
    // 🎯 TASK 3: Base64 encode for /ask API
    const base64 = buffer.toString('base64')
    
    // Optional: Save to temp for debugging (can be removed in production)
    const filePath = path.join(app.getPath('temp'), `evia-screenshot-${Date.now()}.png`)
    await fs.promises.writeFile(filePath, buffer)
    
    console.log('[Screenshot] ✅ Captured', size.width, 'x', size.height, 'Base64 length:', base64.length)
    
    return { 
      ok: true, 
      base64, 
      width: size.width, 
      height: size.height, 
      path: filePath 
    }
  } catch (error: any) {
    console.error('[Screenshot] ❌ Capture failed:', error)
    
    // Check if error is permission-related
    const isPermissionError = error.message?.includes('denied') || error.message?.includes('permission')
    
    return { 
      ok: false, 
      error: error.message || 'Screenshot capture failed',
      needsPermission: isPermissionError
    }
  }
})

  ipcMain.handle('prefs:get', () => {
  return { ok: true, data: persistedState }
})

ipcMain.handle('prefs:set', (_event, data: Partial<PersistedState>) => {
  saveState(data)
        return { ok: true }
})

ipcMain.handle('close-window', (_event, name: FeatureName) => {
  const vis = getVisibility()
  const newVis = { ...vis, [name]: false }
  updateWindows(newVis)
  return { ok: true }
})

// NOTE: shell:openExternal and shell:navigate are already registered in main.ts
// Do NOT add duplicate handlers here!

// Settings hover handlers (Glass parity: show/hide with delay)
ipcMain.on('show-settings-window', (_event, buttonX?: number) => {
  console.log('[overlay-windows] show-settings-window: START')
  console.log('[overlay-windows] 📍 Button position from renderer:', buttonX)
  
  if (settingsHideTimer) {
    console.log('[overlay-windows] Clearing existing hide timer')
    clearTimeout(settingsHideTimer)
    settingsHideTimer = null
  }
  
  // 🔴 ATOMIC FIX STEP 2: Use layoutChildWindows() for correct positioning
  // Old hardcoded logic was wrong - always placed below, never flipped, wrong alignment
  
  // Get current visibility and add settings
  const vis = getVisibility()
  const newVis = { ...vis, settings: true }
  
  // Calculate correct position using space-aware, flip-aware, alignment-aware logic
  console.log('[overlay-windows] 🔄 Calling layoutChildWindows for settings positioning')
  layoutChildWindows(newVis)
  
  // Now show the window (position was set by layoutChildWindows)
  let settingsWin = childWindows.get('settings')
  if (!settingsWin || settingsWin.isDestroyed()) {
    settingsWin = createChildWindow('settings')
  }
  
  if (settingsWin && !settingsWin.isDestroyed()) {
    const actualBounds = settingsWin.getBounds()
    console.log('[overlay-windows] 📍 Settings bounds BEFORE show:', actualBounds)
    
    settingsWin.show()
    settingsWin.moveTop()
    settingsWin.setAlwaysOnTop(true, 'screen-saver')
    
    // Verify position after show
    const finalBounds = settingsWin.getBounds()
    console.log('[overlay-windows] 📍 Settings bounds AFTER show:', finalBounds)
    
    // Double-check header position for debugging
    const header = getOrCreateHeaderWindow()
    const hb = header.getBounds()
    console.log('[overlay-windows] 📍 Header bounds:', hb)
    console.log('[overlay-windows] 📐 Settings relative to header: x_offset=${finalBounds.x - hb.x}, y_offset=${finalBounds.y - hb.y}')
  }
  
  // Update state
  saveState({ visible: newVis })
  console.log('[overlay-windows] show-settings-window: COMPLETE')
})

ipcMain.on('hide-settings-window', () => {
  // Check if cursor is currently inside settings window before hiding
  const settingsWin = childWindows.get('settings')
  if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) {
    const cursorPos = screen.getCursorScreenPoint()
    const bounds = settingsWin.getBounds()
    const isInside = cursorPos.x >= bounds.x && 
                    cursorPos.x <= bounds.x + bounds.width &&
                    cursorPos.y >= bounds.y && 
                    cursorPos.y <= bounds.y + bounds.height
    
    if (isInside) {
      console.log('[overlay-windows] hide-settings-window: IGNORED - cursor inside settings')
      return // Don't hide if cursor is inside!
    }
  }
  
  console.log('[overlay-windows] hide-settings-window: Starting 200ms timer')
  if (settingsHideTimer) {
    clearTimeout(settingsHideTimer)
  }
  settingsHideTimer = setTimeout(() => {
    console.log('[overlay-windows] 200ms timer expired - hiding settings')
    // 🔧 FIX (2025-12-10): Only hide settings, don't change alwaysOnTop
    const settingsWin = childWindows.get('settings')
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.hide()
    }
    const vis = getVisibility()
    const newVis = { ...vis, settings: false }
    saveState({ visible: newVis })
    settingsHideTimer = null
  }, 200) // Glass parity: 200ms delay
})

ipcMain.on('cancel-hide-settings-window', () => {
  console.log('[overlay-windows] cancel-hide-settings-window: Canceling hide')
  if (settingsHideTimer) {
    clearTimeout(settingsHideTimer)
    settingsHideTimer = null
  }
})

// 🔧 FIX #7: Blink header red twice on error
ipcMain.on('blink-header-error', () => {
  console.log('[overlay-windows] ⚠️ Blinking header red for error indication')
  const header = getOrCreateHeaderWindow()
  if (header && !header.isDestroyed()) {
    // Send message to header renderer to trigger CSS animation
    header.webContents.send('trigger-error-blink')
  }
})

// 🔧 DIAGNOSTIC: Log Ask errors to main process terminal for visibility
ipcMain.on('ask:error-diagnostic', (_event, data: { error: string; canRetry: boolean }) => {
  console.error('[Ask] ❌ ERROR:', data.error, '(canRetry:', data.canRetry, ')')
})

// 🔧 DIAGNOSTIC: Forward debug logs from renderer to main process terminal
// This allows us to see AudioCapture logs from the Header window
ipcMain.on('debug-log', (_event, message: string) => {
  console.log('[Renderer]', message)
})

// 🔧 CRITICAL FIX: IPC relay for cross-window communication (Header → Listen)
// Glass parity: Forward prompt from Listen/Insights to Ask window
// 🧹 REMOVED: Old ask:set-prompt handler (replaced by single-step ask:send-and-submit at line ~901)

// IPC relay: Forward transcript messages from Header window to Listen window
// This is REQUIRED because Header captures audio and receives transcripts,
// while Listen window displays them. They are separate BrowserWindows.
ipcMain.on('transcript-message', (_event, message: any) => {
  try {
    const listenWin = childWindows.get('listen')
    const msgType = (message && message.type) ? message.type : typeof message
    console.log('[Main] 📨 transcript-message RECEIVED from renderer:', msgType)
    console.log('[Main] 🧐 listenWin status -> exists:', !!listenWin,
      'destroyed:', listenWin ? listenWin.isDestroyed() : 'n/a',
      'visible:', listenWin ? listenWin.isVisible() : 'n/a')

    if (listenWin && !listenWin.isDestroyed()) {
      try {
        // Forward to listen window regardless of its visibility state — log outcome
        listenWin.webContents.send('transcript-message', message)
        console.log('[Main] ✅ forwarded transcript-message to Listen window (visible:', listenWin.isVisible(), ')')
      } catch (err) {
        console.error('[Main] ❌ Failed to forward transcript-message to Listen window:', err)
      }
    } else {
      console.warn('[Main] ⚠️ Listen window not available to receive transcript-message')
    }
  } catch (err) {
    console.error('[Main] ❌ Error in transcript-message relay handler:', err)
  }
})

// 🔧 FIX #27: Relay session:closed from Header to Ask window (Fertig button pressed)
ipcMain.on('session:closed', () => {
  const askWin = childWindows.get('ask')
  if (askWin && !askWin.isDestroyed()) {
    console.log('[overlay-windows] 📤 Broadcasting session:closed to Ask window')
    askWin.webContents.send('session:closed')
  }
})

// 🔧 REACTIVE I18N: Broadcast language changes to ALL windows
ipcMain.on('language-changed', (_event, newLanguage: string) => {
  console.log('[Main] 🌐 Broadcasting language change to all windows:', newLanguage)
  
  // Broadcast to header window
  if (headerWindow && !headerWindow.isDestroyed()) {
    headerWindow.webContents.send('language-changed', newLanguage)
  }
  
  // Broadcast to all child windows
  childWindows.forEach((win, name) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('language-changed', newLanguage)
      console.log(`[Main] ✅ Sent language-changed to ${name} window`)
    }
  })
})

function getHeaderWindow(): BrowserWindow | null {
  return headerWindow && !headerWindow.isDestroyed() ? headerWindow : null
}

function getAllChildWindows(): BrowserWindow[] {
  return Array.from(childWindows.values()).filter(win => win && !win.isDestroyed())
}

// 🔐 Welcome Window (Phase 2: Auth Flow)
// Shown when user is not logged in (no token in keytar)
let welcomeWindow: BrowserWindow | null = null

export function createWelcomeWindow(): BrowserWindow {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.show()
    return welcomeWindow
  }

  welcomeWindow = new BrowserWindow({
    width: 400,
    height: 380, // Increased from 340 to prevent button overlap
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Welcome to EVIA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      enableWebSQL: false,
      devTools: true, // 🔥 ENABLE in production for debugging
    },
  })

  // Hide window buttons on macOS
  if (process.platform === 'darwin') {
    welcomeWindow.setWindowButtonVisibility(false)
  }

  // Center on screen
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.round(workArea.x + (workArea.width - 400) / 2)
  const y = Math.round(workArea.y + (workArea.height - 380) / 2)
  welcomeWindow.setBounds({ x, y, width: 400, height: 380 })

  welcomeWindow.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
  welcomeWindow.setAlwaysOnTop(true, 'screen-saver')

  // Load welcome.html (separate entry point from overlay.html)
  if (isDev) {
    welcomeWindow.loadURL(`${VITE_DEV_SERVER_URL}/welcome.html`)
    console.log('[overlay-windows] 🔧 Welcome loading from Vite:', `${VITE_DEV_SERVER_URL}/welcome.html`)
  } else {
    welcomeWindow.loadFile(path.join(__dirname, '../renderer/welcome.html'))
  }

  // 🔥 PRODUCTION DEVTOOLS: Add keyboard shortcuts
  welcomeWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (process.platform === 'darwin' && input.meta && input.alt && input.key.toLowerCase() === 'i') {
        event.preventDefault()
        if (welcomeWindow && !welcomeWindow.isDestroyed()) {
          if (welcomeWindow.webContents.isDevToolsOpened()) {
            welcomeWindow.webContents.closeDevTools()
          } else {
            welcomeWindow.webContents.openDevTools({ mode: 'detach' })
          }
        }
      }
      if (input.key === 'F12') {
        event.preventDefault()
        if (welcomeWindow && !welcomeWindow.isDestroyed()) {
          if (welcomeWindow.webContents.isDevToolsOpened()) {
            welcomeWindow.webContents.closeDevTools()
          } else {
            welcomeWindow.webContents.openDevTools({ mode: 'detach' })
          }
        }
      }
    }
  })

  // 🔴 CRITICAL FIX: Prevent dragging welcome window off-screen
  welcomeWindow.on('will-move', (event, newBounds) => {
    const display = screen.getDisplayNearestPoint({ x: newBounds.x, y: newBounds.y })
    const work = display.workArea
    const minX = work.x
    const maxX = work.x + work.width - newBounds.width
    const minY = work.y
    const maxY = work.y + work.height - newBounds.height
    
    const clamped = {
      x: Math.max(minX, Math.min(newBounds.x, maxX)),
      y: Math.max(minY, Math.min(newBounds.y, maxY)),
      width: newBounds.width,
      height: newBounds.height,
    }
    
    if (clamped.x !== newBounds.x || clamped.y !== newBounds.y) {
      event.preventDefault()
      welcomeWindow?.setBounds(clamped)
    }
  })

  welcomeWindow.on('closed', () => {
    welcomeWindow = null
  })

  welcomeWindow.once('ready-to-show', () => {
    welcomeWindow?.show()
    console.log('[overlay-windows] ✅ Welcome window shown')
  })

  return welcomeWindow
}

export function closeWelcomeWindow() {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.close()
    welcomeWindow = null
    console.log('[overlay-windows] ✅ Welcome window closed')
  }
}

// 🔐 Permission Window (Phase 3: Permission Flow)
// Shown after successful login, before main header appears
let permissionWindow: BrowserWindow | null = null

export function createPermissionWindow(): BrowserWindow {
  if (permissionWindow && !permissionWindow.isDestroyed()) {
    permissionWindow.show()
    return permissionWindow
  }

  permissionWindow = new BrowserWindow({
    width: 305,
    height: 235,
    minWidth: 305, // Allow resizing wider if needed
    minHeight: 235, // Keep original compact height
    show: false,
    frame: false,
    transparent: true,
    resizable: true,  // 🔧 FIX: Allow resizing for DevTools console access
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'EVIA Permissions',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      enableWebSQL: false,
      devTools: true, // 🔥 ENABLE in production for debugging
    },
  })

  // Hide window buttons on macOS
  if (process.platform === 'darwin') {
    permissionWindow.setWindowButtonVisibility(false)
  }

  // Center on screen
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.round(workArea.x + (workArea.width - 305) / 2)
  const y = Math.round(workArea.y + (workArea.height - 235) / 2)
  permissionWindow.setBounds({ x, y, width: 305, height: 235 })

  permissionWindow.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
  permissionWindow.setAlwaysOnTop(true, 'screen-saver')

  // Load permission.html (separate entry point from overlay.html)
  if (isDev) {
    permissionWindow.loadURL(`${VITE_DEV_SERVER_URL}/permission.html`)
    console.log('[overlay-windows] 🔧 Permission loading from Vite:', `${VITE_DEV_SERVER_URL}/permission.html`)
  } else {
    permissionWindow.loadFile(path.join(__dirname, '../renderer/permission.html'))
  }

  // 🔥 PRODUCTION DEVTOOLS: Add keyboard shortcuts
  permissionWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (process.platform === 'darwin' && input.meta && input.alt && input.key.toLowerCase() === 'i') {
        event.preventDefault()
        if (permissionWindow && !permissionWindow.isDestroyed()) {
          if (permissionWindow.webContents.isDevToolsOpened()) {
            permissionWindow.webContents.closeDevTools()
          } else {
            // 🔧 FIX: Open DevTools in detached mode with console activated
            permissionWindow.webContents.openDevTools({ mode: 'detach', activate: true })
            
            // 🔧 FIX: Switch to Console tab after opening
            // DevTools needs a moment to initialize before we can switch tabs
            setTimeout(() => {
              if (permissionWindow && !permissionWindow.isDestroyed()) {
                const devTools = permissionWindow.webContents.devToolsWebContents;
                if (devTools) {
                  devTools.executeJavaScript(`
                    // Switch to Console panel in DevTools
                    UI.inspectorView.showPanel('console');
                  `).catch(() => {
                    // Fallback: If the above doesn't work, try DevTools API
                    devTools.executeJavaScript(`
                      DevToolsAPI?.showPanel?.('console');
                    `).catch(() => {
                      console.log('[DevTools] Could not auto-switch to console tab');
                    });
                  });
                }
              }
            }, 500);
          }
        }
      }
      if (input.key === 'F12') {
        event.preventDefault()
        if (permissionWindow && !permissionWindow.isDestroyed()) {
          if (permissionWindow.webContents.isDevToolsOpened()) {
            permissionWindow.webContents.closeDevTools()
          } else {
            // 🔧 FIX: Open DevTools in detached mode with console activated
            permissionWindow.webContents.openDevTools({ mode: 'detach', activate: true })
            
            // 🔧 FIX: Switch to Console tab after opening
            // DevTools needs a moment to initialize before we can switch tabs
            setTimeout(() => {
              if (permissionWindow && !permissionWindow.isDestroyed()) {
                const devTools = permissionWindow.webContents.devToolsWebContents;
                if (devTools) {
                  devTools.executeJavaScript(`
                    // Switch to Console panel in DevTools
                    UI.inspectorView.showPanel('console');
                  `).catch(() => {
                    // Fallback: If the above doesn't work, try DevTools API
                    devTools.executeJavaScript(`
                      DevToolsAPI?.showPanel?.('console');
                    `).catch(() => {
                      console.log('[DevTools] Could not auto-switch to console tab');
                    });
                  });
                }
              }
            }, 500);
          }
        }
      }
    }
  })

  permissionWindow.on('closed', () => {
    permissionWindow = null
  })

  permissionWindow.once('ready-to-show', () => {
    permissionWindow?.show()
    console.log('[overlay-windows] ✅ Permission window shown')
  })

  return permissionWindow
}

export function closePermissionWindow() {
  if (permissionWindow && !permissionWindow.isDestroyed()) {
    permissionWindow.close()
    permissionWindow = null
    console.log('[overlay-windows] ✅ Permission window closed')
  }
}

export function getPermissionWindow(): BrowserWindow | null {
  return permissionWindow && !permissionWindow.isDestroyed() ? permissionWindow : null
}

export {
  getOrCreateHeaderWindow as createHeaderWindow,
  getOrCreateHeaderWindow,
  getHeaderWindow,
  getAllChildWindows,
  createChildWindow,
  updateWindows,
  toggleWindow,
  hideAllChildWindows,
  nudgeHeader,
  openAskWindow,
}