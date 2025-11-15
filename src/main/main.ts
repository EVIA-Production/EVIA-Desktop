import { app, ipcMain, dialog, session, desktopCapturer, shell, systemPreferences, BrowserWindow } from 'electron'
import { createHeaderWindow, getHeaderWindow } from './overlay-windows'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import * as keytar from 'keytar'
import { systemAudioMacService } from './system-audio-mac-service';
import { systemAudioWindowsService } from './system-audio-windows-service';
import { headerController } from './header-controller';

let pendingDeepLink: string | null = null;

if (process.platform === "win32") {
  // Capture possible deeplink in initial argv (may be quoted)
  try {
    const rawStartup = process.argv.find((a) => typeof a === "string" && a.includes("evia://"));
    if (rawStartup) {
      pendingDeepLink = String(rawStartup).trim().replace(/^"+|"+$/g, "");
      console.log("[Protocol] 🔗 Detected cold-start deep link (pending):", pendingDeepLink);
    }
  } catch (e) {
    console.warn('[Protocol] Failed to inspect process.argv for deep link:', e);
  }

  const gotLock = app.requestSingleInstanceLock();
  console.log('[Main] singleInstanceLock acquired:', gotLock);
  if (!gotLock) {
    console.log('[Main] secondary instance - exiting');
    try { app.quit(); } finally { try { process.exit(0); } catch {} }
  } else {
    app.on('second-instance', (_event, argv) => {
      console.log('[Protocol] second-instance argv:', argv);
      const raw = argv.find((a) => typeof a === 'string' && a.includes('evia://'));
      if (raw) {
        const url = String(raw).trim().replace(/^"+|"+$/g, '');
        console.log('[Protocol] second-instance found url:', url);
        // If app is ready, handle immediately, otherwise queue
        if (app.isReady()) {
          try { handleAuthCallback(url); } catch (err) { console.error('[Protocol] handleAuthCallback failed:', err); }
        } else {
          pendingDeepLink = url;
        }
      }

      // Focus primary window if exists
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        try { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } catch {}
      }
    });
  }
}

function getBackendHttpBase(): string {
  const env = process.env.EVIA_BACKEND_URL || process.env.API_BASE_URL;
  if (env && env.trim()) return String(env).replace(/\/$/, '');
  return 'http://localhost:8000';
}

// Windows platform warning + normal boot
async function boot() {
  await app.whenReady();

  // 🪟 Windows: Handle deep link on cold launch
  if (process.platform === "win32" && pendingDeepLink) {
    handleAuthCallback(pendingDeepLink);
  }

  // Show one-time informational message on Windows, then continue
  if (process.platform === 'win32') {
    try {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Windows Warning',
        message:
          'EVIA Desktop for Windows is not fully supported. Some functions might not be working correctly.',
        buttons: ['OK'],
        noLink: true,
      });
    } catch {}
  }

  // Set up display media request handler (system audio loopback)
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    console.log('[Main] 🎥 Display media requested, getting desktop sources...');
    desktopCapturer
      .getSources({ types: ['screen', 'window'] })
      .then((sources) => {
        console.log(`[Main] ✅ Found ${sources.length} desktop sources`);
        if (sources.length > 0) {
          console.log(
            `[Main] 🔊 Enabling audio loopback for source: "${sources[0].name}"`
          );
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          console.warn('[Main] ⚠️  No desktop sources available');
          callback({});
        }
      })
      .catch((error) => {
        console.error('[Main] ❌ Failed to get desktop sources:', error);
        callback({});
      });
  });

  // Initialize header flow
  await headerController.initialize();

  // Note: Global shortcuts are registered in overlay-windows.ts
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

app.on("activate", () => {
  // On macOS 'activate' may be emitted at launch; only create header here
  // if the user is already authenticated and (on macOS) has the required permissions.
  // We intentionally avoid calling validateAuthentication() here to use the
  // existing, already-implemented checks (keytar + systemPreferences).
  (async () => {
    try {
      const exists = !!getHeaderWindow();
      if (exists) return;

      // Check token presence via keytar
      let hasToken = false;
      try {
        const token = await keytar.getPassword("evia", "token");
        hasToken = !!token;
      } catch (e) {
        console.warn("[Main] activate: keytar read failed:", e);
      }

      if (!hasToken) {
        console.log("[Main] activate: no token present — not creating header");
        return;
      }

      // On macOS also ensure microphone and screen permissions are granted
      if (process.platform === "darwin") {
        try {
          const mic = systemPreferences.getMediaAccessStatus("microphone");
          const screen = systemPreferences.getMediaAccessStatus("screen");
          const micOk = mic === "granted";
          const screenOk = screen === "granted";
          if (!micOk || !screenOk) {
            console.log(
              "[Main] activate: token present but permissions missing — not creating header",
              { mic, screen }
            );
            return;
          }
        } catch (e) {
          console.warn("[Main] activate: permission check failed:", e);
          return;
        }
      }

      // If we reached here, token + (macOS) permissions are satisfied — create header
      createHeaderWindow();
    } catch (err) {
      console.error("[Main] activate handler failed:", err);
    }
  })();
});

app.on('quit', async () => {
  console.log('[Main] App quitting, cleaning up system audio...')
  await systemAudioMacService.stop()
  await systemAudioWindowsService.stop()
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
  const result = await systemAudioMacService.start()
  return result
})

ipcMain.handle('system-audio:stop', async () => {
  console.log('[Main] IPC: system-audio:stop called')
  const result = await systemAudioMacService.stop()
  return result
})

ipcMain.handle('system-audio:is-running', async () => {
  return systemAudioMacService.isSystemAudioRunning()
})

// 🪟 Windows system audio (WASAPI) IPC Handlers
ipcMain.handle('system-audio-windows:start', async () => {
  console.log('[Main] IPC: system-audio-windows:start called')
  const result = await systemAudioWindowsService.start()
  return result
})

ipcMain.handle('system-audio-windows:stop', async () => {
  console.log('[Main] IPC: system-audio-windows:stop called')
  const result = await systemAudioWindowsService.stop()
  return result
})

ipcMain.handle('system-audio-windows:is-running', async () => {
  return systemAudioWindowsService.isRunning()
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

// 🔧 NEW: Check if token is valid and not expired
ipcMain.handle('auth:checkTokenValidity', async () => {
  try {
    const token = await keytar.getPassword('evia', 'token');
    if (!token) {
      return { valid: false, reason: 'no_token' };
    }
    
    // Decode JWT to check expiry (JWT format: header.payload.signature)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, reason: 'invalid_format' };
    }
    
    try {
      // Decode base64url payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const exp = payload.exp; // Unix timestamp in seconds
      
      if (!exp || typeof exp !== 'number') {
        // No expiry claim - assume valid (some tokens don't expire)
        console.log('[Auth] ⚠️ Token has no exp claim - assuming valid');
        return { valid: true, reason: 'no_expiry' };
      }
      
      const now = Math.floor(Date.now() / 1000); // Current time in seconds
      const timeUntilExpiry = exp - now;
      
      if (timeUntilExpiry <= 0) {
        console.log('[Auth] ❌ Token expired', -timeUntilExpiry, 'seconds ago');
        return { valid: false, reason: 'expired', expiresIn: timeUntilExpiry };
      }
      
      if (timeUntilExpiry < 60) {
        console.log('[Auth] ⚠️ Token expires in', timeUntilExpiry, 'seconds - refresh recommended');
        return { valid: true, reason: 'expiring_soon', expiresIn: timeUntilExpiry };
      }
      
      console.log('[Auth] ✅ Token valid, expires in', Math.floor(timeUntilExpiry / 60), 'minutes');
      return { valid: true, reason: 'valid', expiresIn: timeUntilExpiry };
      
    } catch (decodeError) {
      console.error('[Auth] ❌ Failed to decode JWT:', decodeError);
      return { valid: false, reason: 'decode_error' };
    }
  } catch (err) {
    console.error('[Auth] ❌ Token validity check failed:', err);
    return { valid: false, reason: 'error' };
  }
});

// 🚪 Logout handler (Phase 4: HeaderController integration)
ipcMain.handle('auth:logout', async () => {
  try {
    await headerController.handleLogout();
    console.log('[Auth] ✅ Logged out via HeaderController');
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

// 👻 Invisibility: Toggle content protection (screen recording invisibility)
// Glass parity: Uses setContentProtection to make windows invisible to screenshots/screen recording
// while still allowing user interaction
ipcMain.handle('window:set-click-through', async (_event, enabled: boolean) => {
  try {
    const { getHeaderWindow, getAllChildWindows } = await import('./overlay-windows');
    const headerWin = getHeaderWindow();
    const childWins = getAllChildWindows();
    
    // Set content protection on header
    if (headerWin && !headerWin.isDestroyed()) {
      headerWin.setContentProtection(enabled);
    }
    
    // Set content protection on all child windows
    childWins.forEach(win => {
      if (win && !win.isDestroyed()) {
        win.setContentProtection(enabled);
      }
    });
    
    console.log('[Invisibility] ✅ Content protection', enabled ? 'enabled' : 'disabled', '(invisible to screen recording)');
    return { success: true };
  } catch (err: unknown) {
    console.error('[Invisibility] ❌ Failed to set content protection:', err);
    return { success: false, error: (err as Error).message };
  }
});

// 🚪 App quit handler
ipcMain.handle('app:quit', () => {
  console.log('[App] ✅ Quit requested via IPC');
  app.quit();
});

// 🎯 Session state broadcast handler (CRITICAL FIX for Demo)
// Receives session state from EviaBar (Header window) and broadcasts to all windows
// This ensures AskView always has the correct session state (before/during/after meeting)
ipcMain.on('session-state-changed', (_event, newState: string) => {
  console.log(`[Main] 📡 Broadcasting session state to all windows: ${newState}`);
  
  // Import BrowserWindow to get all windows
  const { BrowserWindow } = require('electron');
  const allWindows = BrowserWindow.getAllWindows();
  
  let broadcastCount = 0;
  allWindows.forEach((win: any) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('session-state-changed', newState);
      broadcastCount++;
    }
  });
  
  console.log(`[Main] ✅ Broadcast complete - sent to ${broadcastCount} window(s)`);
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
// Based on Glass permissionService.js
ipcMain.handle('permissions:open-system-preferences', async (_event, pane: string) => {
  try {
    console.log('[Permissions] 🔧 Opening System Preferences for:', pane);
    
    if (pane === 'screen-recording' || pane === 'screen') {
      // CRITICAL: Trigger screen capture request first to register app with macOS
      // This ensures EVIA appears in System Preferences > Screen Recording
      // Based on Glass: permissionService.js lines 48-57
      try {
        console.log('[Permissions] 📹 Triggering screen capture request to register app...');
        const { desktopCapturer } = require('electron');
        await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 }
        });
        console.log('[Permissions] ✅ App registered for screen recording');
      } catch (captureError) {
        console.log('[Permissions] ℹ️  Screen capture request triggered (expected to fail if not yet granted)');
      }
      
      // Note: Glass comments out opening System Preferences automatically
      // User should manually go to System Preferences > Security & Privacy > Screen Recording
      // Uncomment next line if you want to auto-open System Preferences:
      // await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      console.log('[Permissions] ℹ️  App registered. User should manually grant permission in System Preferences.');
    } else {
      // Fallback to main Security & Privacy pane
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security');
    }
    
    return { success: true };
  } catch (err: unknown) {
    console.error('[Permissions] ❌ Failed to open System Preferences:', err);
    return { success: false, error: (err as Error).message };
  }
});

// Mark permissions as complete (Phase 4: HeaderController integration)
ipcMain.handle('permissions:mark-complete', async () => {
  console.log('[Permissions] ✅ Marking permissions complete via HeaderController');
  try {
    await headerController.markPermissionsComplete();
    return { success: true };
  } catch (err: unknown) {
    console.error('[Permissions] ❌ Failed to mark complete:', err);
    return { success: false, error: (err as Error).message };
  }
});

// CLEAR SESSION: Resetea UI en todas las windows
ipcMain.on('clear-session', () => {
  console.log('[Main] 🧹 clear-session received — broadcasting to child windows');

  const { BrowserWindow } = require('electron');
  BrowserWindow.getAllWindows().forEach((win: BrowserWindow) => {
    if (!win.isDestroyed()) {
      win.webContents.send('clear-session');
    }
  });
});

ipcMain.on('abort-ask-stream', () => {
  console.log('[Main] 🛑 abort-ask-stream received — broadcasting to AskView');

  const { BrowserWindow } = require('electron');
  BrowserWindow.getAllWindows().forEach((win: BrowserWindow) => {
    if (!win.isDestroyed()) {
      win.webContents.send('abort-ask-stream');
    }
  });
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
if (process.env.NODE_ENV === 'development' && process.platform === 'win32') {
  app.setAsDefaultProtocolClient('evia', process.execPath, [path.resolve(process.argv[1])]);
  console.log('[Protocol] 🔧 Dev evia:// handler re-registered');
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

// 🎯 Handle auth callback from Frontend (Phase 4: HeaderController integration)
async function handleAuthCallback(url: string) {
  try {
    const urlObj = new URL(url);
    const token = urlObj.searchParams.get('token');
    const error = urlObj.searchParams.get('error');
    
    if (error) {
      console.error('[Auth] ❌ Callback error:', error);
      dialog.showErrorBox('Login Failed', error);
      await headerController.handleAuthError(error);
      return;
    }
    
    if (token) {
      console.log('[Auth] ✅ Received token, delegating to HeaderController');
      await headerController.handleAuthCallback(token);
    }
  } catch (err) {
    console.error('[Auth] ❌ Callback parsing failed:', err);
    dialog.showErrorBox('Auth Error', 'Failed to process login callback');
  }
}

// Kick off boot
boot().catch((err) => {
  console.error('[Main] ❌ Boot failed:', err);
});