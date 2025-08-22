import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let systemProc: ReturnType<typeof spawn> | null = null
let sysStdoutBuffer = ''

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
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
    // Normal renderer
    url = process.env.NODE_ENV === 'development'
      ? 'http://localhost:5174'
      : `file://${path.join(__dirname, '../renderer/index.html')}`
  }

  mainWindow.loadURL(url)
  mainWindow.webContents.openDevTools()
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// IPC: start/stop macOS system audio helper (Phase 1)
ipcMain.handle('system-audio:start', async () => {
  if (systemProc) return { ok: true }
  const helperPath = path.join(process.resourcesPath, 'mac', 'SystemAudioCapture.app', 'Contents', 'MacOS', 'SystemAudioCapture')
  const fallbackDevPath = path.join(__dirname, '../../native/mac/SystemAudioCapture/SystemAudioCapture.app/Contents/MacOS/SystemAudioCapture')
  const devCmd = fallbackDevPath
  const prodCmd = helperPath
  const cmd = process.env.EVIA_DEV === '1' ? devCmd : prodCmd
  systemProc = spawn(cmd, [], { stdio: ['ignore', 'pipe', 'pipe'] })
  systemProc.stdout?.on('data', (chunk: Buffer) => {
    // Robust line buffering: helper emits one JSON per line, but chunks may split lines
    sysStdoutBuffer += chunk.toString('utf8')
    let idx
    while ((idx = sysStdoutBuffer.indexOf('\n')) !== -1) {
      const line = sysStdoutBuffer.slice(0, idx).trim()
      sysStdoutBuffer = sysStdoutBuffer.slice(idx + 1)
      if (line.length > 0) {
        mainWindow?.webContents.send('system-audio:data', line)
      }
    }
  })
  systemProc.stderr?.on('data', (d: Buffer) => {
    const logLine = d.toString('utf8').trim()
    console.warn('[SystemAudioCapture][stderr]', logLine)
    
    try {
      // Try to parse as JSON to check for status messages
      const data = JSON.parse(logLine)
      if (data.status) {
        mainWindow?.webContents.send('system-audio:status', logLine)
      }
    } catch (e) {
      // Not JSON or couldn't parse, just a regular log line
    }
  })
  systemProc.on('exit', (code) => {
    systemProc = null
    mainWindow?.webContents.send('system-audio:stopped', code ?? 0)
  })
  return { ok: true }
})

ipcMain.handle('system-audio:stop', async () => {
  if (!systemProc) return { ok: true }
  try { systemProc.kill('SIGTERM') } catch {}
  systemProc = null
  return { ok: true }
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

