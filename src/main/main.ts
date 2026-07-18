import './demo-bootstrap'
import { app, ipcMain, dialog, session, desktopCapturer, shell, systemPreferences, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createHeaderWindow, createWelcomeMaterialComparison, getHeaderWindow } from './overlay-windows'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import * as keytar from 'keytar'
import * as fs from 'fs'
import { systemAudioMacService } from './system-audio-mac-service';
import { systemAudioWindowsService } from './system-audio-windows-service';
import { headerController } from './header-controller';
import { startSubscriptionMonitor, stopSubscriptionMonitor } from './subscription-monitor';
import {
  captureSessionController,
  CaptureSessionSnapshot,
  CaptureTransitionReason,
} from './capture-session-controller';

let pendingDeepLink: string | null = null;
let deepLinkHandlingReady = false;
const PRIMARY_DEEP_LINK_SCHEME = 'taylos';
const LEGACY_DEEP_LINK_SCHEME = 'evia';
const isDemoMode = !app.isPackaged && process.env.TAYLOS_DEMO_MODE === '1';
const IS_ISOLATED_HARNESS =
  isDemoMode ||
  process.env.TAYLOS_E2E === '1' ||
  (process.env.NODE_ENV === 'development' && process.env.TAYLOS_GLASS_COMPARE === '1');

function extractDeepLinkFromArgList(args: string[]): string | null {
  const raw = args.find(
    (arg) =>
      typeof arg === 'string' &&
      (arg.includes(`${PRIMARY_DEEP_LINK_SCHEME}://`) || arg.includes(`${LEGACY_DEEP_LINK_SCHEME}://`)),
  );

  return raw ? String(raw).trim().replace(/^"+|"+$/g, '') : null;
}

function normalizeDeepLink(url: string): string {
  if (url.startsWith(`${LEGACY_DEEP_LINK_SCHEME}://`)) {
    return `${PRIMARY_DEEP_LINK_SCHEME}://${url.slice(`${LEGACY_DEEP_LINK_SCHEME}://`.length)}`;
  }

  return url;
}

function isAuthCallbackDeepLink(url: string): boolean {
  return normalizeDeepLink(url).startsWith(`${PRIMARY_DEEP_LINK_SCHEME}://auth-callback`);
}

function isLaunchDeepLink(url: string): boolean {
  return normalizeDeepLink(url).startsWith(`${PRIMARY_DEEP_LINK_SCHEME}://launch`);
}

function registerProtocolClient(scheme: string): boolean {
  // A development Electron bundle has the generic Electron identity on macOS.
  // Registering it replaces the signed Taylos handler and later launches a bare
  // Electron window without the repository argument. Only the packaged app may
  // own production deep links on macOS.
  if (process.platform === 'darwin' && !app.isPackaged) {
    console.log(`[Protocol] Skipping ${scheme}:// registration for unpackaged macOS app`);
    return false;
  }

  if (process.defaultApp && process.argv.length >= 2) {
    return app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1])]);
  }

  return app.setAsDefaultProtocolClient(scheme);
}

function describeDeepLink(url: string): string {
  try {
    const parsed = new URL(normalizeDeepLink(url));
    const query = parsed.searchParams.has('token') ? '?token=<redacted>' : parsed.search;
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${query}`;
  } catch {
    return '<invalid-deep-link>';
  }
}

function routeDeepLink(url: string): void {
  const normalizedUrl = normalizeDeepLink(url);
  if (!deepLinkHandlingReady) {
    pendingDeepLink = normalizedUrl;
    console.log('[Protocol] Queued deep link until desktop initialization:', describeDeepLink(normalizedUrl));
    return;
  }

  if (isAuthCallbackDeepLink(normalizedUrl)) {
    void handleAuthCallback(normalizedUrl);
  } else if (isLaunchDeepLink(normalizedUrl)) {
    void handleLaunchRequest(normalizedUrl);
  }
}

if (process.platform !== 'darwin') {
  // Windows and Linux deliver cold-start deep links through argv. macOS uses
  // open-url and may emit it before app.whenReady().
  try {
    const rawStartup = extractDeepLinkFromArgList(process.argv);
    if (rawStartup) {
      pendingDeepLink = normalizeDeepLink(rawStartup);
      console.log('[Protocol] Detected cold-start deep link:', describeDeepLink(pendingDeepLink));
    }
  } catch (e) {
    console.warn('[Protocol] Failed to inspect process.argv for deep link:', e);
  }

}

// A fixed localhost bridge and capture helpers require exactly one normal
// desktop process on every platform. Isolated harnesses skip product services
// and therefore may coexist with the installed app.
const gotSingleInstanceLock = IS_ISOLATED_HARNESS || app.requestSingleInstanceLock();
console.log('[Main] singleInstanceLock acquired:', gotSingleInstanceLock, { isolatedHarness: IS_ISOLATED_HARNESS });
if (!gotSingleInstanceLock) {
  console.log('[Main] secondary instance - focusing primary and exiting');
  app.quit();
} else if (!IS_ISOLATED_HARNESS) {
  app.on('second-instance', (_event, argv) => {
    console.log('[Protocol] second-instance argv:', argv);
    const raw = extractDeepLinkFromArgList(argv);
    if (raw) {
      const url = normalizeDeepLink(raw);
      console.log('[Protocol] second-instance found url:', describeDeepLink(url));
      routeDeepLink(url);
    }

    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      try {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      } catch {}
    }
  });
}

function getBackendHttpBase(): string {
  const env =
    process.env.TAYLOS_BACKEND_URL ||
    process.env.Taylos_BACKEND_URL ||
    process.env.EVIA_BACKEND_URL ||
    process.env.API_BASE_URL;
  if (env && env.trim()) return String(env).replace(/\/$/, '');
  return String(process.env.TAYLOS_SERVICE_TARGET || '').toLowerCase() === 'local'
    ? 'http://localhost:8000'
    : 'https://api.taylos.ai';
}

type UpdaterAuditState = {
  lastLaunchedVersion?: string
  pendingInstallVersion?: string
  pendingInstallRecordedAt?: string
  lastAppliedVersion?: string
  lastAppliedFromVersion?: string
  lastAppliedAt?: string
}

function getUpdaterAuditPath(): string {
  return path.join(app.getPath('userData'), 'updater-audit.json')
}

function readUpdaterAudit(): UpdaterAuditState {
  try {
    const raw = fs.readFileSync(getUpdaterAuditPath(), 'utf8')
    return JSON.parse(raw) as UpdaterAuditState
  } catch {
    return {}
  }
}

function writeUpdaterAudit(patch: Partial<UpdaterAuditState>): UpdaterAuditState {
  const nextState: UpdaterAuditState = { ...readUpdaterAudit(), ...patch }
  fs.writeFileSync(getUpdaterAuditPath(), JSON.stringify(nextState, null, 2))
  return nextState
}

function finalizeAppliedUpdateOnLaunch() {
  const currentVersion = app.getVersion()
  const audit = readUpdaterAudit()
  const previousVersion = audit.lastLaunchedVersion
  const pendingVersion = audit.pendingInstallVersion

  const appliedPendingUpdate = pendingVersion === currentVersion && previousVersion !== currentVersion

  if (appliedPendingUpdate) {
    const fromVersion = previousVersion && previousVersion !== currentVersion
      ? previousVersion
      : audit.lastAppliedVersion
    writeUpdaterAudit({
      lastLaunchedVersion: currentVersion,
      lastAppliedVersion: currentVersion,
      lastAppliedFromVersion: fromVersion,
      lastAppliedAt: new Date().toISOString(),
      pendingInstallVersion: undefined,
      pendingInstallRecordedAt: undefined,
    })
    console.log(`[Updater] ✅ Update applied successfully: ${fromVersion ?? 'unknown'} -> ${currentVersion}`)
    return
  }

  if (pendingVersion) {
    console.log(`[Updater] ℹ️ Pending downloaded update state detected for ${pendingVersion}; current app version is ${currentVersion}`)
  }

  if (previousVersion !== currentVersion) {
    console.log(`[Updater] Launching app version ${currentVersion} (previous launch: ${previousVersion ?? 'none'})`)
  }

  writeUpdaterAudit({
    lastLaunchedVersion: currentVersion,
  })
}

// Windows platform warning + normal boot
async function boot() {
  // Set AppUserModelId for Windows taskbar - must be before whenReady
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.taylos.app');
  }
  
  await app.whenReady();

  // The material comparison is an isolated visual harness. It must run before
  // updater, bridge, capture, auth, and subscription services so it can coexist
  // with a normal Taylos instance without binding production ports or mutating
  // product state.
  if (process.env.NODE_ENV === 'development' && process.env.TAYLOS_GLASS_COMPARE === '1') {
    createWelcomeMaterialComparison()
    console.log('[Main] Material comparison mode active; normal product flow is paused')
    return
  }

  if (!isDemoMode) {
    finalizeAppliedUpdateOnLaunch();
    registerAutoUpdater();
  } else {
    console.log('[DemoMode] Updater disabled for isolated local demo');
  }

  // Start Desktop Bridge (HTTP/WS Server) EARLY
  // This ensures status detection works even if other subsystems hang
  if (!IS_ISOLATED_HARNESS) {
    try {
      console.log('[Main] 🌉 Starting Desktop Bridge...');
      desktopBridge.start();
    } catch (err) {
      console.error('[Main] ❌ Failed to start desktop bridge:', err);
    }
  } else {
    console.log('[Main] Isolated harness: desktop bridge disabled');
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

  deepLinkHandlingReady = true;
  if (pendingDeepLink) {
    const startupDeepLink = pendingDeepLink;
    pendingDeepLink = null;
    routeDeepLink(startupDeepLink);
  }
  
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

function registerAutoUpdater() {
  if (isDev) {
    console.log('[Updater] Skipping auto-updater in development');
    return;
  }

  // Download updates in the background to remove manual "Download" friction.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('[Updater] ❌', err);
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available, downloading automatically:', info.version);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
    writeUpdaterAudit({
      pendingInstallVersion: info.version,
      pendingInstallRecordedAt: new Date().toISOString(),
    });
    const isGerman = app.getLocale().toLowerCase().startsWith('de')
    dialog.showMessageBox({
      type: 'info',
      title: 'Taylos',
      message: isGerman ? 'Ein neues Update ist bereit.' : 'A new update is ready.',
      detail: isGerman ? 'Taylos öffnet sich danach automatisch wieder.' : 'Taylos will reopen automatically.',
      buttons: isGerman ? ['Neu starten', 'Später'] : ['Restart', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then((res) => {
      if (res.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[Updater] Initial check failed:', err);
    });
  }, 12000);

  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[Updater] Periodic check failed:', err);
    });
  }, 5 * 60 * 1000);
}

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
        const token = await keytar.getPassword("taylos", "token");
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
  desktopBridge.stop()
  
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

ipcMain.handle('system-audio:restart', async () => {
  console.log('[Main] IPC: system-audio:restart called')
  const result = await systemAudioMacService.restart()
  return result
})

ipcMain.handle('system-audio:is-running', async () => {
  return systemAudioMacService.isSystemAudioRunning()
})

// Windows system audio (WASAPI) IPC Handlers
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
    await keytar.setPassword('taylos', 'token', data.access_token);
    broadcastAuthTokenChanged(data.access_token);
    return {success: true};
  } catch (err: unknown) {
    return {success: false, error: (err as Error).message};
  }
});

ipcMain.handle('auth:getToken', async () => {
  return await keytar.getPassword('taylos', 'token');
});

ipcMain.handle('presets:list', async () => {
  try {
    const token = await keytar.getPassword('taylos', 'token');
    if (!token) return { ok: false, status: 401, error: 'not_authenticated' };

    const response = await fetch(`${getBackendHttpBase()}/prompts`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: 'preset_list_failed' };
    }

    const prompts: unknown = await response.json();
    if (!Array.isArray(prompts)) {
      return { ok: false, status: 502, error: 'invalid_preset_response' };
    }

    return { ok: true, status: response.status, prompts };
  } catch (error) {
    console.error('[Presets] Failed to load presets:', (error as Error).message);
    return { ok: false, status: 503, error: 'preset_service_unavailable' };
  }
});

ipcMain.handle('presets:activate', async (_event, presetId: unknown) => {
  try {
    const normalizedId = String(presetId ?? '').trim();
    if (!/^\d+$/.test(normalizedId)) {
      return { ok: false, status: 400, error: 'invalid_preset_id' };
    }

    const token = await keytar.getPassword('taylos', 'token');
    if (!token) return { ok: false, status: 401, error: 'not_authenticated' };

    const response = await fetch(`${getBackendHttpBase()}/prompts/${normalizedId}/activate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: 'preset_activation_failed' };
    }

    const activation: unknown = await response.json();
    return { ok: true, status: response.status, activation };
  } catch (error) {
    console.error('[Presets] Failed to activate preset:', (error as Error).message);
    return { ok: false, status: 503, error: 'preset_service_unavailable' };
  }
});

// NEW: Check if token is valid and not expired
ipcMain.handle('auth:checkTokenValidity', async () => {
  try {
    const token = await keytar.getPassword('taylos', 'token');
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

// Logout handler (Phase 4: HeaderController integration)
ipcMain.handle('auth:logout', async () => {
  try {
    await stopPhysicalCapture('logout');
    captureSessionController.reset('logout');
    await headerController.handleLogout();
    broadcastAuthTokenChanged(null);
    console.log('[Auth] ✅ Logged out via HeaderController');
    return { success: true };
  } catch (err: unknown) {
    console.error('[Auth] ❌ Logout failed:', err);
    return { success: false, error: (err as Error).message };
  }
});

app.on('will-quit', () => {
  captureSessionController.reconcileNoCapture('app_shutdown');
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

ipcMain.handle('updater:check-now', async () => {
  if (isDev) {
    return { success: false, reason: 'disabled_in_dev' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('updater:get-status', async () => {
  return {
    success: true,
    currentVersion: app.getVersion(),
    audit: readUpdaterAudit(),
  };
});

// Shell API: Open external URLs/apps
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

// Invisibility: Toggle content protection (screen recording invisibility)
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

// App quit handler
ipcMain.handle('app:quit', () => {
  console.log('[App] ✅ Quit requested via IPC');
  app.quit();
});

function toLegacySessionState(snapshot: CaptureSessionSnapshot): 'before' | 'during' | 'after' {
  if (snapshot.state === 'recording' || snapshot.state === 'stopping') return 'during';
  if (snapshot.state === 'review') return 'after';
  return 'before';
}

function broadcastCaptureSession(snapshot: CaptureSessionSnapshot, previous?: CaptureSessionSnapshot) {
  const legacyState = toLegacySessionState(snapshot);
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());

  console.log('[CaptureSession]', JSON.stringify({
    from: previous?.state ?? null,
    to: snapshot.state,
    generation: snapshot.generation,
    reason: snapshot.reason,
    errorCode: snapshot.errorCode,
    windowCount: windows.length,
  }));

  windows.forEach((win) => {
    win.webContents.send('capture-session:state', snapshot);
    // Existing Ask/Listen components consume the legacy semantic state. This
    // is now an output of capture truth, never an independent input.
    win.webContents.send('session-state-changed', legacyState);
  });
}

let captureStopRequestSequence = 0;
const pendingCaptureStopRequests = new Map<
  string,
  { webContentsId: number; resolve: () => void; timeout: NodeJS.Timeout }
>();

async function requestHeaderCaptureStop(
  reason: CaptureTransitionReason,
  generation: number,
): Promise<void> {
  const header = getHeaderWindow();
  if (!header || header.isDestroyed() || header.webContents.isDestroyed()) return;

  const requestId = `${Date.now()}-${++captureStopRequestSequence}`;
  await new Promise<void>((resolve) => {
    const finish = () => {
      const pending = pendingCaptureStopRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingCaptureStopRequests.delete(requestId);
      }
      resolve();
    };
    const timeout = setTimeout(() => {
      console.warn('[CaptureSession] Renderer force-stop acknowledgement timed out', {
        reason,
        generation,
      });
      finish();
    }, 2_000);

    pendingCaptureStopRequests.set(requestId, {
      webContentsId: header.webContents.id,
      resolve: finish,
      timeout,
    });
    header.webContents.send('capture-session:force-stop', {
      requestId,
      reason,
      generation,
    });
  });
}

async function stopPhysicalCapture(reason: CaptureTransitionReason): Promise<void> {
  const snapshot = captureSessionController.getSnapshot();
  if (snapshot.state === 'idle') return;

  // The header renderer owns microphone streams, audio contexts, and capture
  // sockets. Native helpers can outlive that renderer, so stop both ownership
  // layers before the controller is allowed to publish idle.
  const [, macResult, windowsResult] = await Promise.all([
    requestHeaderCaptureStop(reason, snapshot.generation),
    systemAudioMacService.stop(),
    systemAudioWindowsService.stop(),
  ]);
  const failures = [
    macResult.success ? null : `macOS: ${macResult.error ?? 'unknown error'}`,
    windowsResult.success ? null : `Windows: ${windowsResult.error ?? 'unknown error'}`,
  ].filter(Boolean);

  if (failures.length > 0) {
    throw new Error(`Could not stop native capture (${failures.join('; ')})`);
  }
}

async function reconcileNoPhysicalCapture(
  reason: CaptureTransitionReason = 'capture_context_lost',
) {
  await stopPhysicalCapture(reason);
  return captureSessionController.reconcileNoCapture(reason);
}

captureSessionController.subscribe((current, previous) => {
  broadcastCaptureSession(current, previous);
});

ipcMain.handle('capture-session:get', () => captureSessionController.getSnapshot());
ipcMain.handle('capture-session:begin-start', () => captureSessionController.beginStart());
ipcMain.handle('capture-session:confirm-started', (_event, generation: number) =>
  captureSessionController.confirmStarted(generation));
ipcMain.handle('capture-session:fail-start', (_event, generation: number, errorCode?: string) =>
  captureSessionController.failStart(generation, errorCode));
ipcMain.handle('capture-session:begin-stop', () => captureSessionController.beginStop());
ipcMain.handle('capture-session:confirm-stopped', (_event, generation: number) =>
  captureSessionController.confirmStopped(generation));
ipcMain.handle('capture-session:fail-stop', (_event, generation: number, errorCode?: string) =>
  captureSessionController.failStop(generation, errorCode));
ipcMain.handle('capture-session:complete', (_event, generation: number) =>
  captureSessionController.complete(generation));
ipcMain.handle('capture-session:force-stop-complete', (event, requestId: string) => {
  const pending = pendingCaptureStopRequests.get(requestId);
  if (!pending || pending.webContentsId !== event.sender.id) {
    return { accepted: false };
  }
  pending.resolve();
  return { accepted: true };
});
ipcMain.handle('capture-session:reconcile-no-capture', (_event, reason?: CaptureTransitionReason) =>
  reconcileNoPhysicalCapture(reason));

// Reject the former renderer-owned lifecycle channel. Keeping the listener
// makes outdated renderers observable without allowing them to recreate split
// brain state.
ipcMain.on('session-state-changed', (_event, attemptedState: string) => {
  console.warn('[CaptureSession] Ignored legacy renderer state mutation:', attemptedState);
  broadcastCaptureSession(captureSessionController.getSnapshot());
});

// Permission handlers (Phase 3: Permission window)
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
      // This ensures Taylos appears in System Preferences > Screen Recording
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
// Enable: touch ~/Desktop/Taylos_DEBUG_AUDIO
// Disable: rm ~/Desktop/Taylos_DEBUG_AUDIO
// ──────────────────────────────────────────────────────────────────────────────

// Check if debug flag file exists (synchronous invoke)
ipcMain.handle('audio-debug:check-flag', async () => {
  try {
    const homeDir = os.homedir();
    const flagPath = path.join(homeDir, 'Desktop', 'Taylos_DEBUG_AUDIO');
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

ipcMain.handle('audio-debug:get-config', async () => {
  const desktopDir = path.join(os.homedir(), 'Desktop');
  return {
    saveAudio: fs.existsSync(path.join(desktopDir, 'Taylos_DEBUG_AUDIO')),
    disableCustomAec: fs.existsSync(path.join(desktopDir, 'Taylos_DISABLE_CUSTOM_AEC')),
    disableBrowserProcessing: fs.existsSync(path.join(desktopDir, 'Taylos_DISABLE_BROWSER_AUDIO_PROCESSING')),
  };
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

// Register taylos:// protocol for deep linking (auth callback from web)
const primaryProtocolRegistered = registerProtocolClient(PRIMARY_DEEP_LINK_SCHEME);
const legacyProtocolRegistered = registerProtocolClient(LEGACY_DEEP_LINK_SCHEME);
console.log(`[Protocol] ✅ Registered ${PRIMARY_DEEP_LINK_SCHEME}:// protocol:`, primaryProtocolRegistered);
console.log(`[Protocol] ✅ Registered ${LEGACY_DEEP_LINK_SCHEME}:// compatibility alias:`, legacyProtocolRegistered);

// macOS: Handle taylos:// URLs when app is already running
app.on('open-url', (event, url) => {
  event.preventDefault();
  console.log('[Protocol] macOS open-url:', describeDeepLink(url));

  const normalizedUrl = normalizeDeepLink(url);
  if (normalizedUrl !== url) {
    console.log('[Protocol] 🔄 Normalized legacy deep link:', normalizedUrl);
  }

  routeDeepLink(normalizedUrl);
});

function broadcastAuthTokenChanged(token: string | null) {
  const payload = { token, authenticated: !!token };

  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win || win.isDestroyed()) return;

    try {
      win.webContents.send('auth-token-changed', payload);
    } catch (error) {
      console.warn('[Auth] Failed to broadcast auth-token-changed to window:', error);
    }
  });
}

function focusPrimaryDesktopWindow() {
  const headerWindow = getHeaderWindow();
  if (headerWindow && !headerWindow.isDestroyed()) {
    forceFocus(headerWindow);
    return;
  }

  const fallbackWindow = BrowserWindow.getAllWindows().find(
    (win) => !win.isDestroyed() && win.getTitle() !== 'Taylos Anchor',
  );
  if (fallbackWindow) {
    forceFocus(fallbackWindow);
  }
}

// Handle auth callback from Frontend (Phase 4: HeaderController integration)
async function handleAuthCallback(url: string) {
  try {
    const normalizedUrl = normalizeDeepLink(url);
    const urlObj = new URL(normalizedUrl);
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
      broadcastAuthTokenChanged(token);
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
    const normalizedUrl = normalizeDeepLink(url);
    console.log('[Launch] ========== LAUNCH REQUEST ==========');
    console.log('[Launch] URL:', describeDeepLink(normalizedUrl));
    console.log('[Launch] 📍 Platform:', process.platform);
    
    const urlObj = new URL(normalizedUrl);
    const token = urlObj.searchParams.get('token');
    
    // Check if Desktop is already authenticated
    // NOTE: Using 'token' key (not 'auth_token') to match rest of codebase
    const existingToken = await keytar.getPassword('taylos', 'token');
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
      console.log(
        isAlreadyAuthenticated
          ? '[Launch] ✅ Already authenticated, refreshing token and restoring desktop windows'
          : '[Launch] 🔑 Not authenticated yet, triggering full auth flow',
      );

      await headerController.handleAuthCallback(token);
      broadcastAuthTokenChanged(token);

      // Ensure newly created or restored windows are focused
      setTimeout(() => {
        focusPrimaryDesktopWindow();
      }, 500);
    } else {
      console.log('[Launch] 📱 No token, bringing app to front if running');
      focusPrimaryDesktopWindow();
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

// Only the lock owner may initialize product services. Calling app.quit() is
// asynchronous, so a secondary instance must not fall through into boot().
if (gotSingleInstanceLock) {
  boot().catch((err) => {
    console.error('[Main] ❌ Boot failed:', err);
  });
}

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
    title: 'Taylos Anchor',
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
if (gotSingleInstanceLock) app.whenReady().then(() => {
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
