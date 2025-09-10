import { app, BrowserWindow, ipcMain, screen } from 'electron'
import path from 'path'

export type FeatureName = 'listen' | 'ask' | 'settings' | 'shortcuts'

let headerWindow: BrowserWindow | null = null
const childWindows: Map<FeatureName, BrowserWindow> = new Map()

const PAD = 8

function getHeaderBounds() {
  if (!headerWindow || headerWindow.isDestroyed()) return null
  return headerWindow.getBounds()
}

function getWorkAreaForHeader() {
  if (!headerWindow || headerWindow.isDestroyed()) return screen.getPrimaryDisplay().workArea
  const b = headerWindow.getBounds()
  const display = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
  return display.workArea
}

function calculateFeatureLayout(visible: Partial<Record<FeatureName, boolean>>) {
  const headerBounds = getHeaderBounds()
  if (!headerBounds) return {}
  const work = getWorkAreaForHeader()
  const screenWidth = work.width
  const workAreaX = work.x
  const workAreaY = work.y

  const ask = childWindows.get('ask')
  const listen = childWindows.get('listen')
  const askVis = !!visible.ask && !!ask && !ask.isDestroyed()
  const listenVis = !!visible.listen && !!listen && !listen.isDestroyed()
  if (!askVis && !listenVis) return {}

  const askB = askVis ? ask!.getBounds() : null
  const listenB = listenVis ? listen!.getBounds() : null

  const headerCenterXRel = headerBounds.x - workAreaX + headerBounds.width / 2
  const placeAbove = false // minimal: default below

  const layout: any = {}
  if (askVis && listenVis && askB && listenB) {
    let askXRel = headerCenterXRel - askB.width / 2
    let listenXRel = askXRel - listenB.width - PAD
    if (listenXRel < PAD) {
      listenXRel = PAD
      askXRel = listenXRel + listenB.width + PAD
    }
    if (askXRel + askB.width > screenWidth - PAD) {
      askXRel = screenWidth - PAD - askB.width
      listenXRel = askXRel - listenB.width - PAD
    }
    if (placeAbove) {
      const yAbs = headerBounds.y - PAD
      layout.ask = { x: Math.round(askXRel + workAreaX), y: Math.round(yAbs - askB.height), width: askB.width, height: askB.height }
      layout.listen = { x: Math.round(listenXRel + workAreaX), y: Math.round(yAbs - listenB.height), width: listenB.width, height: listenB.height }
    } else {
      const yAbs = headerBounds.y + headerBounds.height + PAD
      layout.ask = { x: Math.round(askXRel + workAreaX), y: Math.round(yAbs), width: askB.width, height: askB.height }
      layout.listen = { x: Math.round(listenXRel + workAreaX), y: Math.round(yAbs), width: listenB.width, height: listenB.height }
    }
  } else {
    const name = askVis ? 'ask' : 'listen'
    const winB = askVis ? askB! : listenB!
    let xRel = headerCenterXRel - winB.width / 2
    xRel = Math.max(PAD, Math.min(screenWidth - winB.width - PAD, xRel))
    let yPos
    if (placeAbove) {
      yPos = (headerBounds.y - workAreaY) - PAD - winB.height
    } else {
      yPos = (headerBounds.y - workAreaY) + headerBounds.height + PAD
    }
    layout[name] = { x: Math.round(xRel + workAreaX), y: Math.round(yPos + workAreaY), width: winB.width, height: winB.height }
  }
  return layout
}

function updateChildLayouts() {
  const vis: Partial<Record<FeatureName, boolean>> = {}
  for (const [name, win] of childWindows) {
    if (!win.isDestroyed() && win.isVisible()) vis[name] = true
  }
  if (!Object.keys(vis).length) return
  const layout = calculateFeatureLayout(vis)
  for (const name of Object.keys(layout) as FeatureName[]) {
    const bounds = (layout as any)[name]
    const win = childWindows.get(name)
    if (win && !win.isDestroyed()) {
      try { win.setBounds(bounds) } catch {}
    }
  }
}

function childCommonOptions(parent?: BrowserWindow) {
  return {
    parent,
    show: false,
    frame: false,
    transparent: true,
    vibrancy: false,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hiddenInMissionControl: true,
    webPreferences: {
      preload: process.env.NODE_ENV === 'development'
        ? path.join(process.cwd(), 'src/main/preload.cjs')
        : path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  } as const
}

function ensureChildWindow(name: FeatureName) {
  if (childWindows.has(name)) return childWindows.get(name)!
  const parent = headerWindow || undefined
  let win: BrowserWindow
  const common = childCommonOptions(parent)
  if (name === 'listen') {
    win = new BrowserWindow({ ...common, width: 400, minWidth: 400, maxWidth: 900, maxHeight: 900 })
  } else if (name === 'ask') {
    win = new BrowserWindow({ ...common, width: 600 })
  } else if (name === 'settings') {
    win = new BrowserWindow({ ...common, width: 240, maxHeight: 400, parent: undefined })
  } else {
    win = new BrowserWindow({ ...common, width: 353, height: 720, parent: undefined })
  }
  try { win.setContentProtection(true) } catch {}
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) } catch {}
  if (process.platform === 'darwin') {
    try { win.setWindowButtonVisibility(false) } catch {}
  }
  const dev = process.env.NODE_ENV === 'development'
  const base = dev ? 'http://localhost:5174' : `file://${path.join(__dirname, '../renderer')}`
  const file = dev ? `${base}/overlay.html?view=${name}` : `${base}/overlay.html?view=${name}`
  try { win.loadURL(file) } catch {}
  if (dev) { try { win.webContents.openDevTools({ mode: 'detach' }) } catch {} }
  childWindows.set(name, win)
  return win
}

function setExclusiveClicks(active?: BrowserWindow) {
  for (const [, w] of childWindows) {
    if (w.isDestroyed()) continue
    if (active && w.id === active.id) {
      try { w.setIgnoreMouseEvents(false) } catch {}
    } else {
      try { w.setIgnoreMouseEvents(true, { forward: true }) } catch {}
    }
  }
}

export function getHeaderWindow() {
  return headerWindow
}

export function createHeaderWindow() {
  headerWindow = new BrowserWindow({
    width: 640,
    height: 100,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: process.env.NODE_ENV === 'development'
        ? path.join(process.cwd(), 'src/main/preload.cjs')
        : path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
      backgroundThrottling: false,
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 24 },
  })

  try { headerWindow.setContentProtection(true) } catch {}
  try { headerWindow.setAlwaysOnTop(true, 'screen-saver') } catch {}
  try { headerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) } catch {}
  if (process.platform === 'darwin') { try { headerWindow.setWindowButtonVisibility(false) } catch {} }

  const dev = process.env.NODE_ENV === 'development'
  const url = dev ? 'http://localhost:5174/overlay.html?view=header' : `file://${path.join(__dirname, '../renderer/overlay.html')}?view=header`
  try { headerWindow.loadURL(url) } catch {}
  if (dev) { try { headerWindow.webContents.openDevTools({ mode: 'detach' }) } catch {} }

  headerWindow.on('moved', () => { updateChildLayouts() })
  headerWindow.on('resize', () => { updateChildLayouts() })
  headerWindow.on('closed', () => {
    headerWindow = null
    for (const [, w] of childWindows) { try { if (!w.isDestroyed()) w.destroy() } catch {} }
    childWindows.clear()
  })

  registerIpc()
}

function registerIpc() {
  // Window control IPC
  ipcMain.handle('win:show', (_e, name: FeatureName) => {
    const win = ensureChildWindow(name)
    setExclusiveClicks(win)
    try { if (process.platform === 'darwin') win.setAlwaysOnTop(true, 'screen-saver'); else win.setAlwaysOnTop(true) } catch {}
    const vis: Partial<Record<FeatureName, boolean>> = {}
    vis[name] = true
    const layout = calculateFeatureLayout(vis)
    const b = (layout as any)[name]
    if (b) { try { win.setBounds(b) } catch {} }
    try { win.show() } catch {}
    return { ok: true }
  })

  ipcMain.handle('win:hide', (_e, name: FeatureName) => {
    const win = childWindows.get(name)
    if (!win) return { ok: false }
    try {
      if (process.platform === 'darwin') win.setAlwaysOnTop(false, 'screen-saver'); else win.setAlwaysOnTop(false)
      win.hide()
    } catch {}
    setExclusiveClicks(undefined)
    return { ok: true }
  })

  ipcMain.handle('win:getHeaderPosition', () => {
    const b = getHeaderBounds()
    return b || { x: 0, y: 0, width: 0, height: 0 }
  })

  ipcMain.handle('win:moveHeaderTo', (_e, x: number, y: number) => {
    if (!headerWindow) return { ok: false }
    const work = getWorkAreaForHeader()
    const b = headerWindow.getBounds()
    const clampedX = Math.max(work.x, Math.min(x, work.x + work.width - b.width))
    const clampedY = Math.max(work.y, Math.min(y, work.y + work.height - b.height))
    try { headerWindow.setPosition(clampedX, clampedY) } catch {}
    updateChildLayouts()
    return { ok: true }
  })

  ipcMain.handle('win:resizeHeader', (_e, width: number, height: number) => {
    if (!headerWindow) return { ok: false }
    const b = headerWindow.getBounds()
    const centerX = b.x + b.width / 2
    const newX = Math.round(centerX - width / 2)
    const work = getWorkAreaForHeader()
    const clampedX = Math.max(work.x, Math.min(work.x + work.width - width, newX))
    const wasResizable = headerWindow.isResizable()
    if (!wasResizable) try { headerWindow.setResizable(true) } catch {}
    try { headerWindow.setBounds({ x: clampedX, y: b.y, width, height }) } catch {}
    if (!wasResizable) try { headerWindow.setResizable(false) } catch {}
    updateChildLayouts()
    return { ok: true }
  })
}


