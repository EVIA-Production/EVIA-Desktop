import { app, ipcMain, dialog, session, desktopCapturer, shell, systemPreferences, BrowserWindow } from 'electron'
import { createHeaderWindow, getHeaderWindow } from './overlay-windows'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import * as keytar from 'keytar'
import * as fs from 'fs'
import { systemAudioMacService } from './system-audio-mac-service';
import { systemAudioWindowsService } from './system-audio-windows-service';
import { headerController } from './header-controller';
import { startSubscriptionMonitor, stopSubscriptionMonitor } from './subscription-monitor';

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
          try {
            if (url.startsWith('evia://auth-callback')) {
              handleAuthCallback(url);
            } else if (url.startsWith('evia://launch')) {
              handleLaunchRequest(url);
            }
          } catch (err) {
            console.error('[Protocol] Handler failed:', err);
          }
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
  // Set AppUserModelId for Windows taskbar - must be before whenReady
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.evia.app');
  }
  
  await app.whenReady();

  // Start Desktop Bridge (HTTP/WS Server) EARLY
  // This ensures status detection works even if other subsystems hang
  try {
    console.log('[Main] 🌉 Starting Desktop Bridge...');
    desktopBridge.start();
  } catch (err) {
    console.error('[Main] ❌ Failed to start desktop bridge:', err);
  }

  // 🪟 Windows: Handle deep link on cold launch
  if (process.platform === "win32" && pendingDeepLink) {
    if (pendingDeepLink.startsWith('evia://auth-callback')) {
    handleAuthCallback(pendingDeepLink);
    } else if (pendingDeepLink.startsWith('evia://launch')) {
      handleLaunchRequest(pendingDeepLink);
    }
  }

  // WINDOWS FIX (2025-12-05): Removed Windows warning dialog per user request
  // The dialog was disruptive and unnecessary as Windows support is now stable

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
  
  // 💳 Start subscription monitor for periodic status checks
  startSubscriptionMonitor(headerController);
  console.log('[Main] 💳 Subscription monitor started');
  
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
  console.log('[Main] App quitting, cleaning up...')
  
  // 💳 Stop subscription monitor
  stopSubscriptionMonitor();
  
  // Clean up audio services
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

// WINDOWS FIX: Restart WASAPI helper without affecting WebSocket connections
// This is a lighter recovery than full stop/start which preserves transcript state
ipcMain.handle('system-audio-windows:restart', async () => {
  console.log('[Main] IPC: system-audio-windows:restart called (preserving state)')
  try {
    await systemAudioWindowsService.stop()
    // Brief pause before restart
    await new Promise(resolve => setTimeout(resolve, 500))
    const result = await systemAudioWindowsService.start()
    console.log('[Main] WASAPI restart completed:', result)
    return result
  } catch (err) {
    console.error('[Main] WASAPI restart failed:', err)
    return { success: false, error: String(err) }
  }
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

// 💳 Subscription refresh handler (Stripe Integration)
ipcMain.handle('subscription:refresh', async () => {
  console.log('[IPC] 💳 subscription:refresh called');
  
  try {
    // Trigger state re-evaluation in HeaderController
    // This will clear cache and re-fetch subscription status
    await headerController.reevaluateState();
    
    return { success: true };
  } catch (err) {
    console.error('[IPC] subscription:refresh error:', err);
    return { success: false, error: (err as Error).message };
  }
});

// 💳 Get subscription status handler (Stripe Integration)
ipcMain.handle('subscription:getStatus', async () => {
  console.log('[IPC] 💳 subscription:getStatus called');
  
  try {
    const { getCachedSubscriptionStatus } = await import('./subscription-service');
    const status = await getCachedSubscriptionStatus();
    return { success: true, status };
  } catch (err) {
    console.error('[IPC] subscription:getStatus error:', err);
    return { success: false, error: (err as Error).message };
  }
});

// 🌐 Shell API: Open external URLs/apps
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  try {
    // macOS behavior: if the browser is already open, some setups appear
    // to open the URL in the background. Force activation when possible.
    try {
      // Electron supports an options object with `activate` on macOS.
      // If this Electron version doesn't support it, we'll fall back below.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      await shell.openExternal(url, { activate: true });
    } catch {
      await shell.openExternal(url);
    }
    console.log('[Shell] ✅ Opened external URL (activated):', url);
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

// CLEAR SESSION: Reset UI in all windows
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

// ──────────────────────────────────────────────────────────────────────────────
// AUDIO DEBUG RECORDING IPC HANDLERS
// Saves raw PCM16 audio to WAV files for manual verification
// Enable: touch ~/Desktop/EVIA_DEBUG_AUDIO
// Disable: rm ~/Desktop/EVIA_DEBUG_AUDIO
// ──────────────────────────────────────────────────────────────────────────────

// Check if debug flag file exists (synchronous invoke)
ipcMain.handle('audio-debug:check-flag', async () => {
  try {
    const homeDir = os.homedir();
    const flagPath = path.join(homeDir, 'Desktop', 'EVIA_DEBUG_AUDIO');
    const enabled = fs.existsSync(flagPath);
    
    if (enabled) {
      console.log('[AudioDebug] 🎙️ Debug flag detected at:', flagPath);
    } else {
      console.log('[AudioDebug] ℹ️  No debug flag found at:', flagPath);
    }
    
    return enabled;
  } catch (error) {
    console.error('[AudioDebug] Failed to check flag:', error);
    return false;
  }
});

// Save audio file
ipcMain.on('audio-debug:save', (_event, { filename, buffer }: { filename: string, buffer: number[] }) => {
  try {
    // Create debug directory if it doesn't exist
    const homeDir = os.homedir();
    const debugDir = path.join(homeDir, 'Desktop', 'taylos-audio-debug');
    
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
      console.log('[AudioDebug] 📁 Created debug directory:', debugDir);
    }
    
    // Write WAV file
    const filepath = path.join(debugDir, filename);
    const uint8Array = new Uint8Array(buffer);
    fs.writeFileSync(filepath, uint8Array);
    
    const fileSizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    console.log(`[AudioDebug] ✅ Saved audio file: ${filename} (${fileSizeMB} MB)`);
  } catch (error) {
    console.error('[AudioDebug] ❌ Failed to save audio file:', error);
  }
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
  } else if (url.startsWith('evia://launch')) {
    handleLaunchRequest(url);
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

import { desktopBridge } from './desktop-bridge';

// Force focus helper - Glass-style: simple restore and focus
// The window's alwaysOnTop and visibleOnAllWorkspaces are set at creation
// Don't mess with them here - just restore and focus
function forceFocus(win: BrowserWindow) {
  console.log('[FOCUS-DEBUG] ========== forceFocus called ==========');
  console.log('[FOCUS-DEBUG] Window exists:', !!win);
  console.log('[FOCUS-DEBUG] Window destroyed:', win?.isDestroyed());
  
  if (!win || win.isDestroyed()) {
    console.log('[FOCUS-DEBUG] ❌ Window invalid, aborting');
    return;
  }
  
  console.log('[FOCUS-DEBUG] BEFORE:');
  console.log('[FOCUS-DEBUG]   isVisible:', win.isVisible());
  console.log('[FOCUS-DEBUG]   isMinimized:', win.isMinimized());
  console.log('[FOCUS-DEBUG]   isFocused:', win.isFocused());
  console.log('[FOCUS-DEBUG]   isAlwaysOnTop:', win.isAlwaysOnTop());
  console.log('[FOCUS-DEBUG]   bounds:', JSON.stringify(win.getBounds()));
  
  if (win.isMinimized()) {
    console.log('[FOCUS-DEBUG] 🔧 Restoring minimized window');
    win.restore();
  }
  
  console.log('[FOCUS-DEBUG] 🔧 Calling show()');
  win.show();
  
  console.log('[FOCUS-DEBUG] 🔧 Calling focus()');
  win.focus();
  
  // Try moveTop to ensure it's on top
  console.log('[FOCUS-DEBUG] 🔧 Calling moveTop()');
  win.moveTop();
  
  console.log('[FOCUS-DEBUG] AFTER:');
  console.log('[FOCUS-DEBUG]   isVisible:', win.isVisible());
  console.log('[FOCUS-DEBUG]   isMinimized:', win.isMinimized());
  console.log('[FOCUS-DEBUG]   isFocused:', win.isFocused());
  console.log('[FOCUS-DEBUG]   isAlwaysOnTop:', win.isAlwaysOnTop());
  console.log('[FOCUS-DEBUG] ========== forceFocus done ==========');
}

// Handle launch request from Frontend (Task 3: SSO)
async function handleLaunchRequest(url: string) {
  try {
    console.log('[Launch] ========== LAUNCH REQUEST ==========');
    console.log('[Launch] 🚀 URL:', url);
    console.log('[Launch] 📍 Platform:', process.platform);
    
    const urlObj = new URL(url);
    const token = urlObj.searchParams.get('token');
    
    // Check if Desktop is already authenticated
    // NOTE: Using 'token' key (not 'auth_token') to match rest of codebase
    const existingToken = await keytar.getPassword('evia', 'token');
    const isAlreadyAuthenticated = !!existingToken;
    console.log('[Launch] 🔐 Already authenticated:', isAlreadyAuthenticated);
    
    // Get ALL windows and log their state
    const allWindows = BrowserWindow.getAllWindows();
    console.log('[Launch] 🪟 Total windows:', allWindows.length);
    allWindows.forEach((win, i) => {
      console.log(`[Launch] Window[${i}]:`, {
        title: win.getTitle(),
        visible: win.isVisible(),
        minimized: win.isMinimized(),
        focused: win.isFocused(),
        alwaysOnTop: win.isAlwaysOnTop(),
        bounds: win.getBounds()
      });
    });
    
    if (token) {
      if (isAlreadyAuthenticated) {
        console.log('[Launch] ✅ Already authenticated, updating token silently and bringing to front');
        try {
          // NOTE: Using 'token' key (not 'auth_token') to match rest of codebase
          await keytar.setPassword('evia', 'token', token);
          console.log('[Launch] 🔑 Token updated in keytar');
        } catch (err) {
          console.error('[Launch] ⚠️ Failed to update token (non-fatal):', err);
        }
        
        // Bring app to front with force
        const headerWindow = getHeaderWindow();
        console.log('[Launch] 🎯 Header window found:', !!headerWindow);
        
        if (headerWindow && !headerWindow.isDestroyed()) {
          console.log('[Launch] 📊 Header window BEFORE focus:');
          console.log('[Launch]   - isVisible:', headerWindow.isVisible());
          console.log('[Launch]   - isAlwaysOnTop:', headerWindow.isAlwaysOnTop());
          console.log('[Launch]   - visibleOnAllWorkspaces:', headerWindow.isVisibleOnAllWorkspaces());
          
          forceFocus(headerWindow);
          
          console.log('[Launch] 📊 Header window AFTER focus:');
          console.log('[Launch]   - isVisible:', headerWindow.isVisible());
          console.log('[Launch]   - isAlwaysOnTop:', headerWindow.isAlwaysOnTop());
          console.log('[Launch] ✅ Brought authenticated app to front (forced)');
        } else {
          console.log('[Launch] ⚠️ Header window not found, app may need restart');
        }
      } else {
        console.log('[Launch] 🔑 Not authenticated yet, triggering full auth flow');
        await headerController.handleAuthCallback(token);
        // Ensure newly created windows are focused
        setTimeout(() => {
          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) forceFocus(wins[0]);
        }, 500);
      }
    } else {
      console.log('[Launch] 📱 No token, bringing app to front if running');
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        forceFocus(mainWindow);
      }
    }
    console.log('[Launch] ========== LAUNCH DONE ==========');
  } catch (err) {
    console.error('[Launch] ❌ Launch handling failed:', err);
  }
}

// IPC Handler for navigation (Tab Reuse)
ipcMain.handle('shell:navigate', async (_event, url: string) => {
  try {
    // Try to reuse existing tab via DesktopBridge WebSocket
    // Returns true if tab was reused, false if no connected tab found
    let tabReused = false;
    try {
      tabReused = await desktopBridge.navigateTo(url);
      console.log(`[Shell] Tab reuse result: ${tabReused ? 'SUCCESS' : 'NO_TAB'}`);
    } catch (err) {
      console.error('[Bridge] Navigation failed:', err);
      tabReused = false;
    }

    // Only open new tab if no existing tab was found
    // This prevents duplicate tabs when WS connection is active
    if (!tabReused) {
      console.log('[Shell] Opening new browser tab');
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      await shell.openExternal(url, { activate: true });
    } catch {
      await shell.openExternal(url);
      }
    }

    return { success: true };
  } catch (err) {
    console.error('[Shell] Navigate handler failed unexpectedly:', err);
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      await shell.openExternal(url, { activate: true });
    } catch {
      await shell.openExternal(url);
    }
    return { success: true };
  }
});

// Kick off boot
boot().catch((err) => {
  console.error('[Main] ❌ Boot failed:', err);
});

// A tiny invisible window kept open on Windows to avoid window-all-closed
// quitting during state transitions (e.g., closing permissions before header
// is created). Only created on Windows and cleaned up on app quit.
let windowsAnchorWindow: BrowserWindow | null = null;

function ensureWindowsAnchorWindow() {
  if (process.platform !== 'win32') return;
  if (windowsAnchorWindow && !windowsAnchorWindow.isDestroyed()) return;

  windowsAnchorWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false, // keep hidden
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: 'EVIA Anchor',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      devTools: false,
    },
  });
  try {
    // Load a blank page to initialize webContents; avoid external URLs.
    windowsAnchorWindow.loadURL('about:blank');
  } catch {}
}

// Create the anchor after app is ready
app.whenReady().then(() => {
  try {
    ensureWindowsAnchorWindow();
    console.log('[Main] 🪟 Windows anchor window initialized');
  } catch (e) {
    console.warn('[Main] ⚠️ Failed to initialize Windows anchor window:', e);
  }
});

// Clean up anchor on quit
app.on('quit', () => {
  try {
    if (windowsAnchorWindow && !windowsAnchorWindow.isDestroyed()) {
      windowsAnchorWindow.destroy();
      windowsAnchorWindow = null;
    }
  } catch {}
});
