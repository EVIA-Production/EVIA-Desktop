import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let systemProc: ReturnType<typeof spawn> | null = null

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
      preload: path.join(__dirname, 'preload.js'),
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

  const url = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5174'
    : `file://${path.join(__dirname, '../renderer/index.html')}`

  mainWindow.loadURL(url)
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
  const helperPath = path.join(process.resourcesPath, 'mac', 'SystemAudioCapture')
  const fallbackDevPath = path.join(__dirname, '../../native/mac/SystemAudioCapture/.build/debug/SystemAudioCapture')
  const cmd = process.env.EVIA_DEV === '1' ? fallbackDevPath : helperPath
  systemProc = spawn(cmd, [], { stdio: ['ignore', 'pipe', 'pipe'] })
  systemProc.stdout?.on('data', (chunk: Buffer) => {
    // Lines of JSON: { data: base64, mimeType: 'audio/pcm;rate=16000' }
    const lines = chunk.toString('utf8').split(/\n+/).filter(Boolean)
    for (const line of lines) {
      mainWindow?.webContents.send('system-audio:data', line)
    }
  })
  systemProc.stderr?.on('data', (d: Buffer) => {
    console.warn('[SystemAudioCapture][stderr]', d.toString('utf8'))
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

