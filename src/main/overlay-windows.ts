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

const WINDOW_DATA = {
  listen: {
    width: 400,
    height: 420,
    html: 'overlay/listen.html',
    zIndex: 3,
  },
  ask: {
    width: 384,
    height: 420,
    html: 'overlay/ask.html',
    zIndex: 1,
  },
  settings: {
    width: 328,
    height: 420,
    html: 'overlay/settings.html',
    zIndex: 2,
  },
  shortcuts: {
    width: 320,
    height: 360,
    html: 'overlay/shortcuts.html',
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
    title: 'EVIA Glass Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: process.env.NODE_ENV === 'development',
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

  headerWindow.loadFile(path.join(__dirname, '../renderer/overlay/header.html'))

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
  const win = new BrowserWindow({
    parent,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    width: def.width,
    height: def.height,
    roundedCorners: true,
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
  win.setIgnoreMouseEvents(true, { forward: true })

  const filePath = path.join(__dirname, '../renderer', def.html)
  win.loadFile(filePath)

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

function layoutChildWindows(visible: WindowVisibility) {
  const header = getOrCreateHeaderWindow()
  const hb = header.getBounds()
  const work = getWorkAreaBounds()

  const visEntries = Object.entries(visible).filter(([, shown]) => !!shown) as [FeatureName, true][]
  if (!visEntries.length) return

  const isAbovePreferred = hb.y > work.y + work.height / 2
  const baseY = isAbovePreferred ? hb.y - PAD : hb.y + hb.height + PAD

  let nextX = hb.x + hb.width + PAD
  for (const [name] of visEntries) {
    const win = createChildWindow(name)
    const { width, height } = WINDOW_DATA[name]
    const pos: Electron.Rectangle = {
      width,
      height,
      x: Math.round(nextX - width - PAD),
      y: Math.round(isAbovePreferred ? baseY - height : baseY),
    }
    const clamped = clampBounds(pos)
    win.setBounds(clamped)
    nextX = clamped.x
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
  if (shouldShow) {
    win.setIgnoreMouseEvents(false)
    animateShow(win)
  } else {
    animateHide(win, () => {
      win.setIgnoreMouseEvents(true, { forward: true })
    })
  }
}

function updateWindows(visibility: WindowVisibility) {
  layoutChildWindows(visibility)
  saveState({ visible: visibility })

  for (const [name, shown] of Object.entries(visibility) as [FeatureName, boolean][]) {
    const win = childWindows.get(name)
    if (!win || win.isDestroyed()) continue
    ensureVisibility(name, shown)
    try { win.setAlwaysOnTop(true, 'screen-saver') } catch {}
    try { win.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS) } catch {}
  }

  try {
    headerWindow?.setAlwaysOnTop(true, 'screen-saver')
    headerWindow?.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
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
  const vis = getVisibility()
  const anyVisible = Object.values(vis).some(Boolean)
  if (anyVisible) {
    hideAllChildWindows()
    headerWindow?.hide()
    headerWindow?.setIgnoreMouseEvents(true, { forward: true })
    headerWindow?.setVisibleOnAllWorkspaces(false)
  } else {
    headerWindow = getOrCreateHeaderWindow()
    headerWindow.showInactive()
    headerWindow.setIgnoreMouseEvents(false)
    headerWindow.setVisibleOnAllWorkspaces(true, WORKSPACES_OPTS)
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
  if (persistedState.visible) {
    updateWindows(persistedState.visible)
  }
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
  const win = childWindows.get(name)
  if (win && !win.isDestroyed()) win.close()
  const vis = getVisibility()
  delete vis[name]
  saveState({ visible: vis })
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


