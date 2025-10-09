import { app, ipcMain, dialog, session, desktopCapturer, shell, systemPreferences } from 'electron'
import { createHeaderWindow, getHeaderWindow } from './overlay-windows'
import os from 'os'
import { spawn } from 'child_process'
import * as keytar from 'keytar'
import { systemAudioService } from './system-audio-service';

function getBackendHttpBase(): string {
  const env = process.env.EVIA_BACKEND_URL || process.env.API_BASE_URL;
  if (env && env.trim()) return String(env).replace(/\/$/, '');
  return 'http://localhost:8000';
}

// Windows platform stub - Glass parity requirement
if (process.platform === 'win32') {
  app.whenReady().then(() => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Windows Support Coming Soon',
      message: 'EVIA Desktop for Windows is coming soon!',
      detail: 'The Windows version with full audio capture and overlay support is currently in development. Please check back soon or contact us for updates.',
      buttons: ['OK']
    }).then(() => {
      app.quit();
    });
  });
}
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

app.on('quit', async () => {
  console.log('[Main] App quitting, cleaning up system audio...')
  await systemAudioService.stop()
  processManager.cleanupAllProcesses()
})

async function killExisting(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('pkill', ['-f', name], { stdio: 'ignore' })
    child.on('close', () => resolve(true))
    child.on('error', () => resolve(false))
  })
}

// System Audio IPC Handlers - Using SystemAudioService (Glass binary approach)
ipcMain.handle('system-audio:start', async () => {
  console.log('[Main] IPC: system-audio:start called')
  const result = await systemAudioService.start()
  return result
})

ipcMain.handle('system-audio:stop', async () => {
  console.log('[Main] IPC: system-audio:stop called')
  const result = await systemAudioService.stop()
  return result
})

ipcMain.handle('system-audio:is-running', async () => {
  return systemAudioService.isSystemAudioRunning()
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

// 🚪 Logout handler
ipcMain.handle('auth:logout', async () => {
  try {
    await keytar.deletePassword('evia', 'token');
    console.log('[Auth] ✅ Logged out, token deleted');
    // TODO: Transition to welcome window
    return { success: true };
  } catch (err: unknown) {
    console.error('[Auth] ❌ Logout failed:', err);
    return { success: false, error: (err as Error).message };
  }
});

// 🌐 Shell API: Open external URLs/apps
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  try {
    await shell.openExternal(url);
    console.log('[Shell] ✅ Opened external URL:', url);
    return { success: true };
  } catch (err: unknown) {
    console.error('[Shell] ❌ Failed to open URL:', err);
    return { success: false, error: (err as Error).message };
  }
});

// 🚪 App quit handler
ipcMain.handle('app:quit', () => {
  console.log('[App] ✅ Quit requested via IPC');
  app.quit();
});

// 🔐 Permission handlers (Phase 3: Permission window)
// Check microphone and screen recording permissions
ipcMain.handle('permissions:check', async () => {
  try {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    
    console.log('[Permissions] ✅ Check result - Mic:', micStatus, 'Screen:', screenStatus);
    
    return {
      microphone: micStatus,
      screen: screenStatus,
    };
  } catch (err: unknown) {
    console.error('[Permissions] ❌ Check failed:', err);
    return {
      microphone: 'unknown',
      screen: 'unknown',
    };
  }
});

// Request microphone permission
ipcMain.handle('permissions:request-microphone', async () => {
  try {
    console.log('[Permissions] 📢 Requesting microphone permission...');
    const granted = await systemPreferences.askForMediaAccess('microphone');
    const status = granted ? 'granted' : 'denied';
    
    console.log('[Permissions] ✅ Microphone permission result:', status);
    return { status };
  } catch (err: unknown) {
    console.error('[Permissions] ❌ Microphone request failed:', err);
    return { status: 'unknown', error: (err as Error).message };
  }
});

// Open System Preferences for screen recording permission
// (Screen recording cannot be requested programmatically on macOS)
ipcMain.handle('permissions:open-system-preferences', async (_event, pane: string) => {
  try {
    console.log('[Permissions] 🔧 Opening System Preferences for:', pane);
    
    if (pane === 'screen') {
      // Open Screen Recording pane
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    } else {
      // Fallback to main Security & Privacy pane
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security');
    }
    
    console.log('[Permissions] ✅ System Preferences opened');
    return { success: true };
  } catch (err: unknown) {
    console.error('[Permissions] ❌ Failed to open System Preferences:', err);
    return { success: false, error: (err as Error).message };
  }
});

// Mark permissions as complete (optional, for state tracking)
ipcMain.handle('permissions:mark-complete', async () => {
  console.log('[Permissions] ✅ Permissions marked as complete');
  // TODO: Phase 4 - HeaderController will use this to transition to main header
  return { success: true };
});

// Note: Window management handlers (capture:screenshot, header:toggle-visibility, 
// header:nudge, header:open-ask) are registered in overlay-windows.ts to avoid duplicates

// 🔐 Register evia:// protocol for deep linking (auth callback from web)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('evia', process.execPath, [process.argv[1]]);
  }
} else {
  app.setAsDefaultProtocolClient('evia');
}
console.log('[Protocol] ✅ Registered evia:// protocol');

// 🍎 macOS: Handle evia:// URLs when app is already running
app.on('open-url', (event, url) => {
  event.preventDefault();
  console.log('[Protocol] 🔗 macOS open-url:', url);
  
  if (url.startsWith('evia://auth-callback')) {
    handleAuthCallback(url);
  }
});

// 🪟 Windows/Linux: Handle evia:// URLs from second instance
app.on('second-instance', (event, commandLine, workingDirectory) => {
  console.log('[Protocol] 🔗 Second instance:', commandLine);
  
  const protocolUrl = commandLine.find(arg => arg.startsWith('evia://'));
  if (protocolUrl && protocolUrl.startsWith('evia://auth-callback')) {
    handleAuthCallback(protocolUrl);
  }
  
  // Focus main window if exists
  const headerWin = getHeaderWindow();
  if (headerWin) {
    if (headerWin.isMinimized()) headerWin.restore();
    headerWin.focus();
  }
});

// 🎯 Handle auth callback from Frontend
async function handleAuthCallback(url: string) {
  try {
    const urlObj = new URL(url);
    const token = urlObj.searchParams.get('token');
    const error = urlObj.searchParams.get('error');
    
    if (error) {
      console.error('[Auth] ❌ Callback error:', error);
      dialog.showErrorBox('Login Failed', error);
      return;
    }
    
    if (token) {
      console.log('[Auth] ✅ Received token, storing...');
      await keytar.setPassword('evia', 'token', token);
      
      // TODO: Transition to permission window (Phase 4)
      console.log('[Auth] → Next: Show permission window');
    }
  } catch (err) {
    console.error('[Auth] ❌ Callback parsing failed:', err);
    dialog.showErrorBox('Auth Error', 'Failed to process login callback');
  }
}

app.whenReady().then(() => {
  // 🔧 ELECTRON 38+: Enable system audio loopback via Chromium's built-in support
  // This replaces the need for external binaries (SystemAudioDump) or getDisplayMedia hacks
  // Docs: https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler
  console.log('[Main] 🎤 Setting up display media request handler with audio loopback support')
  
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    console.log('[Main] 🎥 Display media requested, getting desktop sources...')
    
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      console.log(`[Main] ✅ Found ${sources.length} desktop sources`)
      
      if (sources.length > 0) {
        // Use first screen source and enable audio loopback
        // 'loopback' is the key that enables system audio capture in Chromium 31+
        console.log(`[Main] 🔊 Enabling audio loopback for source: "${sources[0].name}"`)
        callback({ 
          video: sources[0],
          audio: 'loopback'  // ← Magic keyword for system audio in Electron 31+
        })
      } else {
        console.warn('[Main] ⚠️  No desktop sources available')
        callback({})
      }
    }).catch((error) => {
      console.error('[Main] ❌ Failed to get desktop sources:', error)
      callback({})
    })
  })
  
  createHeaderWindow()
  const hw = getHeaderWindow()
  // Ensure debug visibility
  try { hw?.show() } catch {}
  try { hw?.focus() } catch {}
  // Note: Global shortcuts are registered in overlay-windows.ts
})