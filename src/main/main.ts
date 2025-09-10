import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import path from 'path'
import { spawn } from 'child_process'

// Import process manager
// @ts-ignore
const processManager = require('./process-manager')

// Import audio test window manager
// @ts-ignore
const audioTestWindow = require('./audio-test-window')

// __dirname is available in CommonJS mode

let mainWindow: BrowserWindow | null = null
// Process manager handles the helper processes

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    movable: true,
    backgroundColor: '#00000000',
    // Prevent screenshots/screen recording from capturing the window contents
    contentProtection: true,
    webPreferences: {
      preload: process.env.NODE_ENV === 'development'
        ? path.join(process.cwd(), 'src/main/preload.cjs')
        : path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#ffffff',
      height: 24,
    },
  })

  // Keep the window truly on top of full-screen apps when desired
  try { mainWindow.setAlwaysOnTop(true, 'screen-saver') } catch {}

  // Check for diagnostic mode
  // Check for diagnostic or permissions mode
  const isDiagnostic = process.argv.includes('--diagnostic');
  const isPermissions = process.argv.includes('--permissions');
  
  let url;
  if (isDiagnostic) {
    // Load diagnostic page
    url = `file://${path.join(process.cwd(), 'src/renderer/audio-debug.html')}`
  } else if (isPermissions) {
    // Load permissions request page
    url = `file://${path.join(process.cwd(), 'src/renderer/permissions.html')}`
  } else {
    const useOverlay = process.env.EVIA_OVERLAY === '1'
    // Normal renderer
    if (process.env.NODE_ENV === 'development') {
      url = useOverlay ? 'http://localhost:5174/overlay.html' : 'http://localhost:5174'
    } else {
      url = useOverlay
        ? `file://${path.join(__dirname, '../renderer/overlay.html')}`
        : `file://${path.join(__dirname, '../renderer/index.html')}`
    }
  }

  mainWindow.loadURL(url)
  mainWindow.webContents.openDevTools()
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  createWindow()
  
  // Create application menu with audio test option and edit menu for copy/paste
  const menu = Menu.buildFromTemplate([
    {
      label: 'EVIA',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      role: 'editMenu'  // Add standard Edit menu with copy/paste functionality
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Audio Test',
          click: () => {
            audioTestWindow.createAudioTestWindow()
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ])
  
  Menu.setApplicationMenu(menu)
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Clean up processes before quitting
  processManager.cleanupAllProcesses();
  if (process.platform !== 'darwin') app.quit();
})

// Also clean up on app quit
app.on('quit', () => {
  processManager.cleanupAllProcesses();
})

// IPC: start/stop macOS system audio helper (Phase 1)
ipcMain.handle('system-audio:start', async () => {
  // Use process manager to start the helper
  const result = await processManager.startSystemAudioHelper();
  
  if (result.ok) {
    // Register handlers for stdout and stderr
    processManager.registerSystemAudioHandlers(
      // Stdout handler - sends data to renderer
      (line: string) => {
        mainWindow?.webContents.send('system-audio:data', line);
      },
      // Stderr handler - logs and forwards status messages
      (logLine: string) => {
        console.warn('[SystemAudioCapture][stderr]', logLine);
        
        try {
          // Try to parse as JSON to check for status messages
          const data = JSON.parse(logLine);
          if (data.status) {
            mainWindow?.webContents.send('system-audio:status', logLine);
          }
        } catch (e) {
          // Not JSON or couldn't parse, just a regular log line
        }
      }
    );
  }
  
  return result;
})

ipcMain.handle('system-audio:stop', async () => {
  // Use process manager to stop the helper
  return await processManager.stopSystemAudioHelper();
})

// Overlay behavior controls
ipcMain.on('overlay:setClickThrough', (_e, enabled: boolean) => {
  if (!mainWindow) return
  try { mainWindow.setIgnoreMouseEvents(Boolean(enabled), { forward: true }) } catch {}
})

// Handle launching main app from permissions page
ipcMain.handle('launch-main', () => {
  if (mainWindow) {
    const url = process.env.NODE_ENV === 'development'
      ? 'http://localhost:5174'
      : `file://${path.join(__dirname, '../renderer/index.html')}`
    mainWindow.loadURL(url)
    return { ok: true }
  }
  return { ok: false, error: 'No main window' }
})

// Handle launching audio test window
ipcMain.handle('launch-audio-test', () => {
  audioTestWindow.createAudioTestWindow()
  return { ok: true }
})

// Handle opening a script in Terminal
ipcMain.handle('open-terminal', async (_, scriptPath) => {
  try {
    const fullPath = path.join(process.cwd(), scriptPath)
    const terminalCommand = `open -a Terminal "${fullPath}"`
    spawn('bash', ['-c', terminalCommand], { stdio: 'ignore' })
    return { ok: true }
  } catch (error) {
    console.error('Failed to open Terminal:', error)
    return { ok: false, error: String(error) }
  }
})

