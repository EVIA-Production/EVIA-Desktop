import { app, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron'
import fs from 'fs'
import path from 'path'

// 🔧 Dev mode detection for Vite dev server
const isDev = process.env.NODE_ENV === 'development'
const VITE_DEV_SERVER_URL = 'http://localhost:5174'

export type FeatureName = 'listen' | 'ask' | 'settings' | 'shortcuts'

type WindowVisibility = Partial<Record<FeatureName, boolean>>

let headerWindow: BrowserWindow | null = null
const childWindows: Map<FeatureName, BrowserWindow> = new Map()

// TEMPORARY FIX: Increased to 900px (user reported 700px still cuts off)
// TODO: Implement dynamic width calculation based on button content (see DYNAMIC_HEADER_WIDTH.md)
// Math: German "Anzeigen/Ausblenden" ~185px + other buttons ~300px + padding/gaps ~150px = ~635px
// Adding 40% buffer for safety: 635 * 1.4 = 900px
// Height: 49px to accommodate 47px content + 2px for glass border (1px top + 1px bottom)
const HEADER_SIZE = { width: 900, height: 49 }
const PAD = 8
const ANIM_DURATION = 180
let settingsHideTimer: NodeJS.Timeout | null = null

// Note: All windows load overlay.html with ?view=X query params for React routing.
// The 'html' field is kept for documentation but not used in loadFile() calls.
const WINDOW_DATA = {
  listen: {
    width: 400,
    height: 420,
    html: 'overlay.html?view=listen', // Documentation only - actual load uses query param
    zIndex: 3,
  },
  ask: {
    width: 640,  // Increased from 600 to fit form + padding
    height: 61,  // Glass parity: starts at 61px, grows with content
    html: 'overlay.html?view=ask',
    zIndex: 1,
  },
  settings: {
    width: 240, // Glass parity: windowManager.js:527
    height: 400, // Glass uses maxHeight: 400, we use fixed height
    html: 'overlay.html?view=settings',
    zIndex: 2,
  },
  shortcuts: {
    width: 320,
    height: 360,
    html: 'overlay.html?view=shortcuts',
    zIndex: 0,
  },
} satisfies Record<FeatureName, { width: number; height: number; html: string; zIndex: number }>

const WORKSPACES_OPTS = { visibleOnFullScreen: true }

const persistFile = path.join(app.getPath('userData'), 'overlay-prefs.json')
type PersistedState = {
  headerBounds?: Electron.Rectangle
  visible?: WindowVisibility
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

  headerWindow = new BrowserWindow({
    width: HEADER_SIZE.width,
    height: HEADER_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    backgroundColor: '#00000000', // Fully transparent
    title: 'EVIA Glass Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      enableWebSQL: false,
      devTools: process.env.NODE_ENV === 'development',
      backgroundThrottling: false, // Glass parity: Keep rendering smooth
    },
  })

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
  headerWindow.setAlwaysOnTop(true, 'screen-saver')
  headerWindow.setContentProtection(true)
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
  })

  headerWindow.on('closed', () => {
    headerWindow = null
  })

  headerWindow.once('ready-to-show', () => {
    headerWindow?.showInactive()
  })

  // Listen for content width requests from renderer (for dynamic sizing)
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
      const newWidth = Math.max(contentWidth + 20, 400) // Add padding, min 400px
      
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
      saveState({ headerBounds: headerWindow.getBounds() })
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
  const needsFocus = name === 'ask' || name === 'settings' || name === 'shortcuts'
  
  const win = new BrowserWindow({
    parent,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: needsFocus, // Ask/Settings/Shortcuts can receive focus
    skipTaskbar: true,
    alwaysOnTop: true,
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
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  
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
            // CRITICAL FIX: Only hide settings window, DON'T call updateWindows (which would re-open listen/ask)
            if (win && !win.isDestroyed()) {
              win.setAlwaysOnTop(false, 'screen-saver')
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

function clampBounds(bounds: Electron.Rectangle): Electron.Rectangle {
  const work = getWorkAreaBounds()
  // Allow header to reach the right edge (remove invisible wall)
  // Account for any rendering differences by allowing exact fit
  const maxX = work.x + work.width - bounds.width + 10 // +10px buffer for right edge
  const maxY = work.y + work.height - bounds.height
  return {
    x: Math.max(work.x, Math.min(bounds.x, maxX)),
    y: Math.max(work.y, Math.min(bounds.y, maxY)),
    width: bounds.width,
    height: bounds.height,
  }
}

// Glass parity: Port windowLayoutManager.js:132-220 horizontal stack algorithm
function layoutChildWindows(visible: WindowVisibility) {
  const header = getOrCreateHeaderWindow()
  const hb = header.getBounds()
  const work = getWorkAreaBounds()

  const PAD_LOCAL = PAD
  const screenWidth = work.width
  const screenHeight = work.height
  const headerCenterXRel = hb.x - work.x + hb.width / 2
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
    const askH = askVis && askWin ? WINDOW_DATA.ask.height : 0
    const listenW = listenVis && listenWin ? WINDOW_DATA.listen.width : 0
    const listenH = listenVis && listenWin ? WINDOW_DATA.listen.height : 0

    if (askVis && listenVis) {
      // Both windows: horizontal stack (listen left, ask center-aligned)
      let askXRel = headerCenterXRel - askW / 2
      let listenXRel = askXRel - listenW - PAD_LOCAL

      // Clamp to screen bounds
      if (listenXRel < PAD_LOCAL) {
        listenXRel = PAD_LOCAL
        askXRel = listenXRel + listenW + PAD_LOCAL
      }
      if (askXRel + askW > screenWidth - PAD_LOCAL) {
        askXRel = screenWidth - PAD_LOCAL - askW
        listenXRel = askXRel - listenW - PAD_LOCAL
      }

      if (isAbovePreferred) {
        const windowBottomAbs = hb.y - PAD_LOCAL
        layout.ask = { x: Math.round(askXRel + work.x), y: Math.round(windowBottomAbs - askH), width: askW, height: askH }
        layout.listen = { x: Math.round(listenXRel + work.x), y: Math.round(windowBottomAbs - listenH), width: listenW, height: listenH }
      } else {
        // MUP FIX: Ask window closer to header for Glass parity (4px gap instead of 8px)
        const askGap = 4
        const yAbs = hb.y + hb.height + askGap
        layout.ask = { x: Math.round(askXRel + work.x), y: Math.round(yAbs), width: askW, height: askH }
        layout.listen = { x: Math.round(listenXRel + work.x), y: Math.round(yAbs), width: listenW, height: listenH }
      }
    } else {
      // Single window: center under header
      const winName = askVis ? 'ask' : 'listen'
      const winW = askVis ? askW : listenW
      const winH = askVis ? askH : listenH

      let xRel = headerCenterXRel - winW / 2
      xRel = Math.max(PAD_LOCAL, Math.min(screenWidth - winW - PAD_LOCAL, xRel))

      let yPos: number
      if (isAbovePreferred) {
        yPos = hb.y - work.y - PAD_LOCAL - winH
      } else {
        // MUP FIX: Ask window closer to header for Glass parity (4px gap)
        const gap = (winName === 'ask') ? 4 : PAD_LOCAL
        yPos = hb.y - work.y + hb.height + gap
      }

      layout[winName] = { x: Math.round(xRel + work.x), y: Math.round(yPos + work.y), width: winW, height: winH }
    }
  }

  // Handle Settings window (Glass: calculateSettingsWindowPosition)
  // Positioned aligned with settings button (170px from right edge)
  if (visible.settings) {
    const settingsWin = createChildWindow('settings')
    const settingsW = WINDOW_DATA.settings.width
    const settingsH = WINDOW_DATA.settings.height
    const buttonPadding = 170 // Distance from right edge to align with settings button
    
    let x = hb.x + hb.width - settingsW + buttonPadding
    const y = hb.y + hb.height + 5 // PAD=5 from Glass
    
    // Clamp to screen
    x = Math.max(work.x, Math.min(x, work.x + work.width - settingsW))
    
    layout.settings = { x: Math.round(x), y: Math.round(y), width: settingsW, height: settingsH }
  }

  // Handle Shortcuts window (Glass: calculateShortcutSettingsWindowPosition)
  // Centered horizontally at header Y position
  if (visible.shortcuts) {
    const shortcutsWin = createChildWindow('shortcuts')
    const shortcutsW = WINDOW_DATA.shortcuts.width
    const shortcutsH = WINDOW_DATA.shortcuts.height
    
    let x = hb.x + (hb.width / 2) - (shortcutsW / 2)
    const y = hb.y
    
    // Clamp to screen
    x = Math.max(work.x, Math.min(x, work.x + work.width - shortcutsW))
    
    layout.shortcuts = { x: Math.round(x), y: Math.round(y), width: shortcutsW, height: shortcutsH }
  }

  // Apply layout
  for (const [name, bounds] of Object.entries(layout)) {
    const win = createChildWindow(name as FeatureName)
    win.setBounds(clampBounds(bounds as Electron.Rectangle))
  }
}

function animateShow(win: BrowserWindow) {
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

async function handleHeaderToggle() {
  // CRITICAL AUTH CHECK: Only allow toggle if user is authenticated and has permissions
  const { headerController } = await import('./header-controller')
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
    
    // Glass parity: Restore ONLY previously visible windows (windowManager.js:245-249)
    // Don't restore from persisted state - only from lastVisibleWindows Set
    const vis: WindowVisibility = {}
    for (const name of lastVisibleWindows) {
      vis[name] = true
    }
    if (Object.keys(vis).length > 0) {
      updateWindows(vis)
    }
  }
}

let isAnimating = false
let animationTarget: Electron.Rectangle = { x: 0, y: 0, width: 0, height: 0 }
let animationTimer: NodeJS.Timeout | null = null

function nudgeHeader(dx: number, dy: number) {
  // Glass parity: windowManager.js:133-154, smoothMovementManager.js:1-32
  // Animate header movement smoothly over 300ms (Glass animation duration)
  const header = getOrCreateHeaderWindow()
  const bounds = header.getBounds()
  
  // If already animating, update target instead of starting new animation
  if (isAnimating) {
    const newTarget = clampBounds({ ...bounds, x: bounds.x + dx, y: bounds.y + dy })
    animationTarget = newTarget
    return
  }
  
  const target = clampBounds({ ...bounds, x: bounds.x + dx, y: bounds.y + dy })
  animationTarget = target
  
  // Smooth animation over 300ms
  const duration = 300
  const startTime = Date.now()
  const startX = bounds.x
  const startY = bounds.y
  isAnimating = true
  
  const animate = () => {
    const elapsed = Date.now() - startTime
    const progress = Math.min(elapsed / duration, 1)
    
    // Ease-out cubic for smooth deceleration
    const eased = 1 - Math.pow(1 - progress, 3)
    
    const currentX = startX + (animationTarget.x - startX) * eased
    const currentY = startY + (animationTarget.y - startY) * eased
    
    header.setPosition(Math.round(currentX), Math.round(currentY))
    
    if (progress < 1) {
      animationTimer = setTimeout(animate, 16) // ~60fps
    } else {
      // Animation complete
      isAnimating = false
      animationTimer = null
      
      // Recalculate child layout and save state
      const vis = getVisibility()
      layoutChildWindows(vis)
      saveState({ headerBounds: animationTarget })
    }
  }
  
  animate()
}

function openAskWindow() {
  const vis = getVisibility()
  const updated = { ...vis, ask: true }
  updateWindows(updated)
}

function registerShortcuts() {
  // All callbacks must be paramless - Electron doesn't pass event objects to globalShortcut handlers
  const step = 80 // Glass parity: windowLayoutManager.js:243 uses 80px
  
  // Wrap in paramless functions to avoid 'conversion from X' errors
  const nudgeUp = () => nudgeHeader(0, -step)
  const nudgeDown = () => nudgeHeader(0, step)
  const nudgeLeft = () => nudgeHeader(-step, 0)
  const nudgeRight = () => nudgeHeader(step, 0)
  
  globalShortcut.register('CommandOrControl+\\', handleHeaderToggle)
  globalShortcut.register('CommandOrControl+Enter', openAskWindow)
  // Note: Glass uses 'Cmd+Up' not plain 'Up'; adjust if needed for parity
  globalShortcut.register('CommandOrControl+Up', nudgeUp)
  globalShortcut.register('CommandOrControl+Down', nudgeDown)
  globalShortcut.register('CommandOrControl+Left', nudgeLeft)
  globalShortcut.register('CommandOrControl+Right', nudgeRight)
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

app.on('ready', () => {
  app.dock?.hide?.()
  registerShortcuts()
  getOrCreateHeaderWindow()
  // Don't restore persisted windows at startup - only show header
  // Child windows appear on demand (Listen button, Ask command, etc.)
})

app.on('will-quit', () => {
  unregisterShortcuts()
})

ipcMain.handle('win:show', (_event, name: FeatureName) => {
  const next = toggleWindow(name)
  return { ok: true, toggled: next ? 'shown' : 'hidden' }
})

ipcMain.handle('win:ensureShown', (_event, name: FeatureName) => {
  console.log(`[overlay-windows] win:ensureShown called for ${name}`)
  // CRITICAL FIX: Only show the requested window, don't call updateWindows (which opens ALL windows in state)
  let win = childWindows.get(name)
  if (!win || win.isDestroyed()) {
    win = createChildWindow(name)
  }
  
  if (win && !win.isDestroyed()) {
    // Position and show window
    const header = getOrCreateHeaderWindow()
    const hb = header.getBounds()
    const def = WINDOW_DATA[name]
    if (def) {
      // Center to header
      win.setBounds({
        x: hb.x + (hb.width - def.width) / 2,
        y: hb.y + hb.height + PAD,
        width: def.width,
        height: def.height,
      })
      win.show()
      win.moveTop()
      win.setAlwaysOnTop(true, 'screen-saver')
    }
  }
  
  // Update state
  const vis = getVisibility()
  saveState({ visible: { ...vis, [name]: true } })
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
  const bounds = clampBounds({ ...header.getBounds(), x, y })
  header.setBounds(bounds)
  saveState({ headerBounds: bounds })
    return { ok: true }
  })

ipcMain.handle('win:resizeHeader', (_event, width: number, height: number) => {
  const header = getOrCreateHeaderWindow()
  const bounds = header.getBounds()
  const newBounds = clampBounds({ ...bounds, width, height })
  header.setBounds(newBounds)
  saveState({ headerBounds: newBounds })
    return { ok: true }
  })

ipcMain.handle('adjust-window-height', (_event, { winName, height }: { winName: FeatureName; height: number }) => {
  const win = createChildWindow(winName)
  win.setBounds({ ...win.getBounds(), height })
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

// Settings hover handlers (Glass parity: show/hide with delay)
ipcMain.on('show-settings-window', () => {
  console.log('[overlay-windows] show-settings-window: Showing settings ONLY (not affecting other windows)')
  if (settingsHideTimer) {
    console.log('[overlay-windows] Clearing existing hide timer')
    clearTimeout(settingsHideTimer)
    settingsHideTimer = null
  }
  
  // CRITICAL FIX: Only create/show settings, NEVER touch listen/ask windows
  let settingsWin = childWindows.get('settings')
  if (!settingsWin || settingsWin.isDestroyed()) {
    settingsWin = createChildWindow('settings')
  }
  
  if (settingsWin && !settingsWin.isDestroyed()) {
    const header = getOrCreateHeaderWindow()
    const hb = header.getBounds()
    // Position settings below header, right-aligned
    settingsWin.setBounds({
      x: hb.x + hb.width - WINDOW_DATA.settings.width,
      y: hb.y + hb.height + PAD,
      width: WINDOW_DATA.settings.width,
      height: WINDOW_DATA.settings.height,
    })
    settingsWin.show()
    settingsWin.moveTop()
    settingsWin.setAlwaysOnTop(true, 'screen-saver')
  }
  
  // Update state but don't call updateWindows (which would relayout all windows)
  const vis = getVisibility()
  saveState({ visible: { ...vis, settings: true } })
  console.log('[overlay-windows] Settings shown')
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
    // FIX: Only hide settings, don't affect other windows
    const settingsWin = childWindows.get('settings')
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.setAlwaysOnTop(false, 'screen-saver')
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

// 🔧 CRITICAL FIX: IPC relay for cross-window communication (Header → Listen)
// Glass parity: Forward prompt from Listen/Insights to Ask window
ipcMain.on('ask:set-prompt', (_event, prompt: string) => {
  console.log('[overlay-windows] 🎯 Relaying prompt to Ask window:', prompt.substring(0, 50))
  const askWin = childWindows.get('ask')
  if (askWin && !askWin.isDestroyed()) {
    askWin.webContents.send('ask:set-prompt', prompt)
  } else {
    console.warn('[overlay-windows] Ask window not available for prompt relay')
  }
})

// IPC relay: Forward transcript messages from Header window to Listen window
// This is REQUIRED because Header captures audio and receives transcripts,
// while Listen window displays them. They are separate BrowserWindows.
ipcMain.on('transcript-message', (_event, message: any) => {
  const listenWin = childWindows.get('listen')
  if (listenWin && !listenWin.isDestroyed() && listenWin.isVisible()) {
    listenWin.webContents.send('transcript-message', message)
  }
})

function getHeaderWindow(): BrowserWindow | null {
  return headerWindow && !headerWindow.isDestroyed() ? headerWindow : null
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
    height: 340,
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
      devTools: process.env.NODE_ENV === 'development',
    },
  })

  // Hide window buttons on macOS
  if (process.platform === 'darwin') {
    welcomeWindow.setWindowButtonVisibility(false)
  }

  // Center on screen
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.round(workArea.x + (workArea.width - 400) / 2)
  const y = Math.round(workArea.y + (workArea.height - 340) / 2)
  welcomeWindow.setBounds({ x, y, width: 400, height: 340 })

  welcomeWindow.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
  welcomeWindow.setAlwaysOnTop(true, 'screen-saver')

  // Load welcome.html (separate entry point from overlay.html)
  if (isDev) {
    welcomeWindow.loadURL(`${VITE_DEV_SERVER_URL}/welcome.html`)
    console.log('[overlay-windows] 🔧 Welcome loading from Vite:', `${VITE_DEV_SERVER_URL}/welcome.html`)
  } else {
    welcomeWindow.loadFile(path.join(__dirname, '../renderer/welcome.html'))
  }

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
    width: 285,
    height: 220,
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
    title: 'EVIA Permissions',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      enableWebSQL: false,
      devTools: process.env.NODE_ENV === 'development',
    },
  })

  // Hide window buttons on macOS
  if (process.platform === 'darwin') {
    permissionWindow.setWindowButtonVisibility(false)
  }

  // Center on screen
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.round(workArea.x + (workArea.width - 285) / 2)
  const y = Math.round(workArea.y + (workArea.height - 220) / 2)
  permissionWindow.setBounds({ x, y, width: 285, height: 220 })

  permissionWindow.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
  permissionWindow.setAlwaysOnTop(true, 'screen-saver')

  // Load permission.html (separate entry point from overlay.html)
  if (isDev) {
    permissionWindow.loadURL(`${VITE_DEV_SERVER_URL}/permission.html`)
    console.log('[overlay-windows] 🔧 Permission loading from Vite:', `${VITE_DEV_SERVER_URL}/permission.html`)
  } else {
    permissionWindow.loadFile(path.join(__dirname, '../renderer/permission.html'))
  }

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
  createChildWindow,
  updateWindows,
  toggleWindow,
  hideAllChildWindows,
  nudgeHeader,
  openAskWindow,
}


