import { app, ipcMain } from 'electron'
import { createHeaderWindow, getHeaderWindow } from './overlay-windows'
import os from 'os'
import { spawn } from 'child_process'
import * as keytar from 'keytar';
import { getBackendHttpBase } from '../renderer/services/websocketService';
// process-manager.js exports a singleton instance via CommonJS `module.exports = new ProcessManager()`
// Use require() to import it as a value
// eslint-disable-next-line @typescript-eslint/no-var-requires
const processManager = require('./process-manager') as {
  startSystemAudioHelper: () => Promise<{ ok: boolean; pid?: number; error?: string }>
  stopSystemAudioHelper: () => Promise<{ ok: boolean; error?: string }>
  registerSystemAudioHandlers: (
    stdoutHandler: (line: string) => void,
    stderrHandler?: (line: string) => void,
  ) => boolean
  cleanupAllProcesses: () => void
}

const isDev = process.env.NODE_ENV === 'development'
const platform = os.platform()

app.on('window-all-closed', () => {
  if (platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  // Re-create header if needed
  if (!getHeaderWindow()) createHeaderWindow()
})

app.on('quit', () => {
  processManager.cleanupAllProcesses()
})

async function killExisting(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('pkill', ['-f', name], { stdio: 'ignore' })
    child.on('close', () => resolve(true))
    child.on('error', () => resolve(false))
  })
}

ipcMain.handle('system-audio:start', async () => {
  const result = await processManager.startSystemAudioHelper()
  if (result.ok) {
    processManager.registerSystemAudioHandlers(
      (line: string) => {
        const hw = getHeaderWindow()
        if (hw && !hw.isDestroyed()) {
          hw.webContents.send('system-audio:data', line)
        }
      },
      (logLine: string) => {
        console.warn('[SystemAudioCapture][stderr]', logLine)
        try {
          const data = JSON.parse(logLine)
          const hw = getHeaderWindow()
          if (data.status && hw && !hw.isDestroyed()) {
            hw.webContents.send('system-audio:status', logLine)
          }
        } catch (e) {}
      }
    )
  }
  return result
})

ipcMain.handle('system-audio:stop', async () => {
  return await processManager.stopSystemAudioHelper()
})

ipcMain.handle('auth:login', async (_event, {username, password}) => {
  try {
    const backend = getBackendHttpBase(); // assume function exists or hardcode
    const res = await fetch(`${backend}/login/`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username, password})
    });
    if (!res.ok) throw new Error('Login failed');
    const data = await res.json();
    await keytar.setPassword('evia', 'token', data.access_token);
    return {success: true};
  } catch (err: unknown) {
    return {success: false, error: (err as Error).message};
  }
});

ipcMain.handle('auth:getToken', async () => {
  return await keytar.getPassword('evia', 'token');
});

// Add your other handlers here...

app.whenReady().then(() => {
  createHeaderWindow()
  const hw = getHeaderWindow()
  // Ensure debug visibility
  try { hw?.show() } catch {}
  try { hw?.focus() } catch {}
})