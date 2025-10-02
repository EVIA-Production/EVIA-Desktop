import { app, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron'
import fs from 'fs'
import path from 'path'

export type FeatureName = 'listen' | 'ask' | 'settings' | 'shortcuts'

type WindowVisibility = Partial<Record<FeatureName, boolean>>

let headerWindow: BrowserWindow | null = null
const childWindows: Map<FeatureName, BrowserWindow> = new Map()

const HEADER_SIZE = { width: 353, height: 47 }
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
    width: 384,
    height: 420,
    html: 'overlay.html?view=ask',
    zIndex: 1,
  },
  settings: {
    width: 328,
    height: 420,
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

try {
  if (fs.existsSync(persistFile)) {
    const data = fs.readFileSync(persistFile, 'utf8')
    persistedState = JSON.parse(data) as PersistedState
  }
} catch (error) {
  console.warn('[overlay] Failed to load persisted state', error)
}

function saveState(partial: Partial<PersistedState>) {
  persistedState = { ...persistedState, ...partial }
  try {
    fs.mkdirSync(path.dirname(persistFile), { recursive: true })
    fs.writeFileSync(persistFile, JSON.stringify(persistedState, null, 2), 'utf8')
  } catch (error) {
    console.warn('[overlay] Failed to persist state', error)
  }
}

function getOrCreateHeaderWindow(): BrowserWindow {
  if (headerWindow && !headerWindow.isDestroyed()) return headerWindow

  headerWindow = new BrowserWindow({
    width: HEADER_SIZE.width,
    height: HEADER_SIZE.height,
    minWidth: HEADER_SIZE.width,
    minHeight: HEADER_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    roundedCorners: true,
    useContentSize: true, // Glass parity: Prevent grey frame by matching window to content size
    hasShadow: false,
    backgroundColor: '#00000000', // Fully transparent
    title: 'EVIA Glass Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: process.env.NODE_ENV === 'development',
      backgroundThrottling: false, // Glass parity: Keep rendering smooth
    },
  })

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

  // Load overlay.html with ?view=header query param for routing
  headerWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'), {
    query: { view: 'header' },
  })

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
    roundedCorners: true,
    useContentSize: true, // Glass parity: Prevent grey frame
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: process.env.NODE_ENV === 'development',
    },
  })

  win.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  
  // Glass parity: Only Listen window is click-through, Ask/Settings/Shortcuts are interactive
  if (name === 'listen') {
    win.setIgnoreMouseEvents(true, { forward: true })
  } else {
    win.setIgnoreMouseEvents(false)
  }

  // All windows load overlay.html with different ?view= query params for routing
  win.loadFile(path.join(__dirname, '../renderer/overlay.html'), {
    query: { view: name },
  })

  win.on('closed', () => {
    childWindows.delete(name)
  })

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
  const maxX = work.x + work.width - bounds.width
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

  const askVis = visible.ask
  const listenVis = visible.listen

  if (!askVis && !listenVis) return

  const PAD_LOCAL = PAD
  const screenWidth = work.width
  const screenHeight = work.height
  const headerCenterXRel = hb.x - work.x + hb.width / 2
  const relativeY = (hb.y - work.y) / screenHeight

  // Determine if windows should be above or below header (Glass: determineLayoutStrategy)
  const isAbovePreferred = relativeY > 0.5

  const askWin = askVis ? createChildWindow('ask') : null
  const listenWin = listenVis ? createChildWindow('listen') : null

  const askW = askVis && askWin ? WINDOW_DATA.ask.width : 0
  const askH = askVis && askWin ? WINDOW_DATA.ask.height : 0
  const listenW = listenVis && listenWin ? WINDOW_DATA.listen.width : 0
  const listenH = listenVis && listenWin ? WINDOW_DATA.listen.height : 0

  const layout: Record<string, { x: number; y: number; width: number; height: number }> = {}

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
      const yAbs = hb.y + hb.height + PAD_LOCAL
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
      yPos = hb.y - work.y + hb.height + PAD_LOCAL
    }

    layout[winName] = { x: Math.round(xRel + work.x), y: Math.round(yPos + work.y), width: winW, height: winH }
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
  // Glass parity: Only Listen is click-through, Ask/Settings/Shortcuts are interactive
  const isClickThrough = name === 'listen'
  
  if (shouldShow) {
    win.setIgnoreMouseEvents(isClickThrough, isClickThrough ? { forward: true } : undefined)
    animateShow(win)
  } else {
    animateHide(win, () => {
      win.setIgnoreMouseEvents(isClickThrough, isClickThrough ? { forward: true } : undefined)
    })
  }
}

function updateWindows(visibility: WindowVisibility) {
  layoutChildWindows(visibility)
  saveState({ visible: visibility })

  // Sort windows by z-index (ascending) so higher z-index windows are moved to top last
  const sortedEntries = (Object.entries(visibility) as [FeatureName, boolean][])
    .sort((a, b) => WINDOW_DATA[a[0]].zIndex - WINDOW_DATA[b[0]].zIndex)

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
  return { ...(persistedState.visible ?? {}) }
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

function handleHeaderToggle() {
  const headerVisible = headerWindow && !headerWindow.isDestroyed() && headerWindow.isVisible()
  
  if (headerVisible) {
    // Hide everything: child windows + header
    hideAllChildWindows()
    headerWindow?.hide()
  } else {
    // Show header only (child windows appear on demand)
    headerWindow = getOrCreateHeaderWindow()
    // Set properties BEFORE showing to ensure they take effect
    headerWindow.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
    headerWindow.setIgnoreMouseEvents(false)
    headerWindow.setAlwaysOnTop(true, 'screen-saver')
    headerWindow.showInactive()
  }
}

function nudgeHeader(dx: number, dy: number) {
  const header = getOrCreateHeaderWindow()
  const bounds = header.getBounds()
  const next = clampBounds({ ...bounds, x: bounds.x + dx, y: bounds.y + dy })
  header.setBounds(next)
  for (const [name, win] of childWindows) {
    if (persistedState.visible?.[name]) {
      const b = win.getBounds()
      win.setBounds({ ...b, x: b.x + dx, y: b.y + dy })
    }
  }
  saveState({ headerBounds: next })
}

function openAskWindow() {
  const vis = getVisibility()
  const updated = { ...vis, ask: true }
  updateWindows(updated)
}

function registerShortcuts() {
  // All callbacks must be paramless - Electron doesn't pass event objects to globalShortcut handlers
  const step = 12
  
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
  const vis = getVisibility()
  const next = { ...vis, [name]: true }
  updateWindows(next)
  return { ok: true }
})

ipcMain.handle('win:hide', (_event, name: FeatureName) => {
  const vis = getVisibility()
  const next = { ...vis }
  delete next[name]
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

ipcMain.handle('capture:screenshot', async () => {
  const { desktopCapturer } = require('electron')
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
    if (!sources.length) return { ok: false, error: 'No sources' }
    const source = sources[0]
    const buffer = source.thumbnail.toPNG()
    const filePath = path.join(app.getPath('temp'), `evia-${Date.now()}.png`)
    await fs.promises.writeFile(filePath, buffer)
    const base64 = buffer.toString('base64')
    return { ok: true, base64, width: source.thumbnail.getSize().width, height: source.thumbnail.getSize().height, path: filePath }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
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
  if (settingsHideTimer) {
    clearTimeout(settingsHideTimer)
    settingsHideTimer = null
  }
  const vis = getVisibility()
  const newVis = { ...vis, settings: true }
  updateWindows(newVis)
})

ipcMain.on('hide-settings-window', () => {
  if (settingsHideTimer) {
    clearTimeout(settingsHideTimer)
  }
  settingsHideTimer = setTimeout(() => {
    const vis = getVisibility()
    const newVis = { ...vis, settings: false }
    updateWindows(newVis)
    settingsHideTimer = null
  }, 200) // Glass parity: 200ms delay
})

ipcMain.on('cancel-hide-settings-window', () => {
  if (settingsHideTimer) {
    clearTimeout(settingsHideTimer)
    settingsHideTimer = null
  }
})

function getHeaderWindow(): BrowserWindow | null {
  return headerWindow && !headerWindow.isDestroyed() ? headerWindow : null
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


