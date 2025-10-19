import {
  app,
  ipcMain,
  dialog,
  session,
  desktopCapturer,
  shell,
  systemPreferences,
} from "electron";
import * as path from "path";
import { createHeaderWindow, getHeaderWindow } from "./overlay-windows";
import { PLATFORM, IS_WINDOWS } from "./platform";
import { spawn } from "child_process";
import * as keytar from "keytar";
import { systemAudioService } from "./system-audio-service";
import { headerController } from "./header-controller";

function getBackendHttpBase(): string {
  const env = process.env.EVIA_BACKEND_URL || process.env.API_BASE_URL;
  if (env && env.trim()) return String(env).replace(/\/$/, "");
  return "http://localhost:8000";
}

// Windows platform warning + normal boot
async function boot() {
  await app.whenReady();

  if (process.platform === "win32") {
    try {
      await dialog.showMessageBox({
        type: "info",
        title: "Windows Warning",
        message:
          "EVIA Desktop for Windows is not fully supported. Some functions might not be working correctly.",
        buttons: ["OK"],
        noLink: true,
      });
    } catch {}
  }

  // Permissions: allow media (getUserMedia) and display-capture (getDisplayMedia)
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    // Allow standard getUserMedia permissions
    if (permission === "media") {
      console.log("[Main] ✅ Allowing permission:", permission);
      callback(true);
      return;
    }
    // Some Electron typings don't include 'display-capture' in Permission union.
    // Handle it loosely so getDisplayMedia works when prompted by Chromium.
    const permStr = permission as unknown as string;
    if (permStr === "display-capture") {
      console.log("[Main] ✅ Allowing permission:", permStr);
      callback(true);
      return;
    }
    callback(false);
  });

  ses.setPermissionCheckHandler((_wc, permission) => {
    if (permission === "media") return true;
    const permStr = permission as unknown as string;
    if (permStr === "display-capture") return true;
    return false;
  });

  // Display media request handler:
  // - On macOS, auto-select a source and enable loopback audio (Glass parity)
  // - On Windows, do NOT override so Chromium shows the native picker (with "Share system audio")
  if (PLATFORM === "darwin") {
    ses.setDisplayMediaRequestHandler((request, callback) => {
      console.log("[Main] Display media requested, getting desktop sources...");
      desktopCapturer
        .getSources({ types: ["screen", "window"] })
        .then((sources) => {
          console.log(`[Main] Found ${sources.length} desktop sources`);
          if (sources.length > 0) {
            console.log(
              `[Main] 🔊 Enabling audio loopback for source: "${sources[0].name}"`
            );
            callback({ video: sources[0], audio: "loopback" });
          } else {
            console.warn("[Main] ⚠️  No desktop sources available");
            callback({});
          }
        })
        .catch((error) => {
          console.error("[Main] ❌ Failed to get desktop sources:", error);
          callback({});
        });
    });
  }

  // Initialize header flow
  await headerController.initialize();
}

// process-manager.js exports a singleton instance via CommonJS `module.exports = new ProcessManager()`
// Use require() to import it as a value
// eslint-disable-next-line @typescript-eslint/no-var-requires
const processManager = require("./process-manager") as {
  startSystemAudioHelper: () => Promise<{
    ok: boolean;
    pid?: number;
    error?: string;
  }>;
  stopSystemAudioHelper: () => Promise<{ ok: boolean; error?: string }>;
  registerSystemAudioHandlers: (
    stdoutHandler: (line: string) => void,
    stderrHandler?: (line: string) => void
  ) => boolean;
  cleanupAllProcesses: () => void;
};

const isDev = process.env.NODE_ENV === "development";

app.on("window-all-closed", () => {
  if (PLATFORM !== "darwin") app.quit();
});

app.on("activate", () => {
  // Re-create header if needed
  if (!getHeaderWindow()) createHeaderWindow();
});

app.on("quit", async () => {
  console.log("[Main] App quitting, cleaning up system audio...");
  await systemAudioService.stop();
  processManager.cleanupAllProcesses();
});

// System Audio IPC Handlers - Using SystemAudioService (Glass binary approach)
ipcMain.handle("system-audio:start", async () => {
  console.log("[Main] IPC: system-audio:start called");
  const result = await systemAudioService.start();
  return result;
});

ipcMain.handle("system-audio:stop", async () => {
  console.log("[Main] IPC: system-audio:stop called");
  const result = await systemAudioService.stop();
  return result;
});

ipcMain.handle("system-audio:is-running", async () => {
  return systemAudioService.isSystemAudioRunning();
});

ipcMain.handle("auth:login", async (_event, { username, password }) => {
  try {
    const backend = getBackendHttpBase(); // assume function exists or hardcode
    const res = await fetch(`${backend}/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error("Login failed");
    const data = await res.json();
    await keytar.setPassword("evia", "token", data.access_token);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle("auth:getToken", async () => {
  return await keytar.getPassword("evia", "token");
});

// 🚪 Logout handler (Phase 4: HeaderController integration)
ipcMain.handle("auth:logout", async () => {
  try {
    await headerController.handleLogout();
    console.log("[Auth] ✅ Logged out via HeaderController");
    return { success: true };
  } catch (err: unknown) {
    console.error("[Auth] ❌ Logout failed:", err);
    return { success: false, error: (err as Error).message };
  }
});

// Shell API: Open external URLs/apps
ipcMain.handle("shell:openExternal", async (_event, url: string) => {
  try {
    await shell.openExternal(url);
    console.log("[Shell] ✅ Opened external URL:", url);
    return { success: true };
  } catch (err: unknown) {
    console.error("[Shell] ❌ Failed to open URL:", err);
    return { success: false, error: (err as Error).message };
  }
});

// 🚪 App quit handler
ipcMain.handle("app:quit", () => {
  console.log("[App] ✅ Quit requested via IPC");
  app.quit();
});

// 🔐 Permission handlers (Phase 3: Permission window)
// Check microphone and screen recording permissions
ipcMain.handle("permissions:check", async () => {
  try {
    const micStatus = systemPreferences.getMediaAccessStatus("microphone");
    const screenStatus = systemPreferences.getMediaAccessStatus("screen");

    console.log(
      "[Permissions] ✅ Check result - Mic:",
      micStatus,
      "Screen:",
      screenStatus
    );

    return {
      microphone: micStatus,
      screen: screenStatus,
    };
  } catch (err: unknown) {
    console.error("[Permissions] ❌ Check failed:", err);
    return {
      microphone: "unknown",
      screen: "unknown",
    };
  }
});

// Request microphone permission
ipcMain.handle("permissions:request-microphone", async () => {
  try {
    console.log("[Permissions] 📢 Requesting microphone permission...");
    const granted = await systemPreferences.askForMediaAccess("microphone");
    const status = granted ? "granted" : "denied";

    console.log("[Permissions] ✅ Microphone permission result:", status);
    return { status };
  } catch (err: unknown) {
    console.error("[Permissions] ❌ Microphone request failed:", err);
    return { status: "unknown", error: (err as Error).message };
  }
});

// Open System Preferences for screen recording permission
// (Screen recording cannot be requested programmatically on macOS)
// Based on Glass permissionService.js
ipcMain.handle(
  "permissions:open-system-preferences",
  async (_event, pane: string) => {
    try {
      console.log("[Permissions] 🔧 Opening System Preferences for:", pane);

      if (pane === "screen-recording" || pane === "screen") {
        // CRITICAL: Trigger screen capture request first to register app with macOS
        // This ensures EVIA appears in System Preferences > Screen Recording
        // Based on Glass: permissionService.js lines 48-57
        try {
          console.log(
            "[Permissions] 📹 Triggering screen capture request to register app..."
          );
          const { desktopCapturer } = require("electron");
          await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: 1, height: 1 },
          });
          console.log("[Permissions] ✅ App registered for screen recording");
        } catch (captureError) {
          console.log(
            "[Permissions] ℹ️  Screen capture request triggered (expected to fail if not yet granted)"
          );
        }

        // Note: Glass comments out opening System Preferences automatically
        // User should manually go to System Preferences > Security & Privacy > Screen Recording
        // Uncomment next line if you want to auto-open System Preferences:
        // await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        console.log(
          "[Permissions] ℹ️  App registered. User should manually grant permission in System Preferences."
        );
      } else {
        // Fallback to main Security & Privacy pane
        await shell.openExternal(
          "x-apple.systempreferences:com.apple.preference.security"
        );
      }

      return { success: true };
    } catch (err: unknown) {
      console.error("[Permissions] ❌ Failed to open System Preferences:", err);
      return { success: false, error: (err as Error).message };
    }
  }
);

// Mark permissions as complete (Phase 4: HeaderController integration)
ipcMain.handle("permissions:mark-complete", async () => {
  console.log(
    "[Permissions] ✅ Marking permissions complete via HeaderController"
  );
  try {
    await headerController.markPermissionsComplete();
    return { success: true };
  } catch (err: unknown) {
    console.error("[Permissions] ❌ Failed to mark complete:", err);
    return { success: false, error: (err as Error).message };
  }
});

// Note: Window management handlers (capture:screenshot, header:toggle-visibility,
// header:nudge, header:open-ask) are registered in overlay-windows.ts to avoid duplicates

// 🔐 Register evia:// protocol for deep linking (auth callback from web)
if (IS_WINDOWS) {
  // On Windows during development (electron .), pass an absolute app path so Windows doesn't launch from C:\\Windows\\System32
  try {
    let registered = false;
    if (process.defaultApp) {
      const appArg = path.resolve(process.argv[1] || ".");
      registered = app.setAsDefaultProtocolClient("evia", process.execPath, [
        appArg,
      ]);
      console.log("[Protocol] Dev registration (Windows):", {
        execPath: process.execPath,
        appArg,
        registered,
      });
    } else {
      registered = app.setAsDefaultProtocolClient("evia");
    }
    console.log(
      "[Protocol] ✅ Registered evia:// protocol (registered=",
      registered,
      ")"
    );
  } catch (e) {
    console.warn(
      "[Protocol] ⚠️ Failed to register evia:// protocol (Windows):",
      e
    );
  }
} else {
  // Keep original behavior for macOS/Linux
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("evia", process.execPath, [
        process.argv[1],
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient("evia");
  }
  console.log("[Protocol] ✅ Registered evia:// protocol");
}

// 🍎 macOS: Handle evia:// URLs when app is already running
app.on("open-url", (event, url) => {
  event.preventDefault();
  console.log("[Protocol] 🔗 macOS open-url:", url);

  if (url.startsWith("evia://auth-callback")) {
    handleAuthCallback(url);
  }
});

// 🪟 Windows/Linux: Handle evia:// URLs from second instance
app.on("second-instance", (event, commandLine, workingDirectory) => {
  console.log("[Protocol] 🔗 Second instance:", commandLine);

  const protocolUrl = commandLine.find((arg) => arg.startsWith("evia://"));
  if (protocolUrl && protocolUrl.startsWith("evia://auth-callback")) {
    handleAuthCallback(protocolUrl);
  }

  // Focus main window if exists
  const headerWin = getHeaderWindow();
  if (headerWin) {
    if (headerWin.isMinimized()) headerWin.restore();
    headerWin.focus();
  }
});

// 🪟 Windows: If app is launched for the first time via evia://, capture the URL from process.argv
let pendingDeepLink: string | null = null;
if (IS_WINDOWS) {
  const initialUrl = process.argv.find((arg) => arg.startsWith("evia://"));
  if (initialUrl) {
    pendingDeepLink = initialUrl;
    console.log(
      "[Protocol] 🔗 First-instance deep link detected:",
      pendingDeepLink
    );
  }
}

// 🎯 Handle auth callback from Frontend (Phase 4: HeaderController integration)
async function handleAuthCallback(url: string) {
  try {
    const urlObj = new URL(url);
    const token = urlObj.searchParams.get("token");
    const error = urlObj.searchParams.get("error");

    if (error) {
      console.error("[Auth] ❌ Callback error:", error);
      dialog.showErrorBox("Login Failed", error);
      await headerController.handleAuthError(error);
      return;
    }

    if (token) {
      console.log("[Auth] ✅ Received token, delegating to HeaderController");
      await headerController.handleAuthCallback(token);
    }
  } catch (err) {
    console.error("[Auth] ❌ Callback parsing failed:", err);
    dialog.showErrorBox("Auth Error", "Failed to process login callback");
  }
}

// Kick off boot
boot().catch((err) => {
  console.error("[Main] Boot failed:", err);
});
