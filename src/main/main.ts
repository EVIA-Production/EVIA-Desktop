import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  desktopCapturer,
  session,
} from "electron";
import path from "path";
import { spawn } from "child_process";
import { createHeaderWindow, getHeaderWindow } from "./overlay-windows";
// Import process manager
// @ts-ignore
const processManager = require("./process-manager");

// Import audio test window manager
// @ts-ignore
const audioTestWindow = require("./audio-test-window");

// __dirname is available in CommonJS mode

let mainWindow: BrowserWindow | null = null;
// Process manager handles the helper processes

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 640,
    height: 620,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    movable: true,
    backgroundColor: "#00000000",
    // Content protection will be enabled via API after creation
    useContentSize: true,
    fullscreenable: false,
    skipTaskbar: true,
    // On macOS, hint panel-like behavior for resilience over fullscreen apps
    // @ts-ignore
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      preload:
        process.env.NODE_ENV === "development"
          ? path.join(process.cwd(), "src/main/preload.cjs")
          : path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
      backgroundThrottling: false,
    },
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#00000000",
      symbolColor: "#ffffff",
      height: 24,
    },
  });

  // Enable content protection (prevents screenshots/screen recording)
  try {
    mainWindow.setContentProtection(true);
  } catch {}

  // Keep the window truly on top of full-screen apps when desired
  try {
    mainWindow.setAlwaysOnTop(true, "screen-saver");
  } catch {}
  try {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {}
  // Hide macOS traffic light buttons entirely
  try {
    mainWindow.setWindowButtonVisibility(false);
  } catch {}

  // Check for diagnostic mode
  // Check for diagnostic or permissions mode
  const isDiagnostic = process.argv.includes("--diagnostic");
  const isPermissions = process.argv.includes("--permissions");

  let url;
  if (isDiagnostic) {
    // Load diagnostic page
    url = `file://${path.join(process.cwd(), "src/renderer/audio-debug.html")}`;
  } else if (isPermissions) {
    // Load permissions request page
    url = `file://${path.join(process.cwd(), "src/renderer/permissions.html")}`;
  } else {
    const useOverlay = process.env.EVIA_OVERLAY === "1";
    // Normal renderer
    if (process.env.NODE_ENV === "development") {
      url = useOverlay
        ? "http://localhost:5174/overlay.html"
        : "http://localhost:5174";
    } else {
      url = useOverlay
        ? `file://${path.join(__dirname, "../renderer/overlay.html")}`
        : `file://${path.join(__dirname, "../renderer/index.html")}`;
    }
  }

  mainWindow.loadURL(url);
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Ensure capture permissions (Windows/Electron sometimes needs explicit allow)
  try {
    const ses = session.defaultSession;
    ses.setPermissionCheckHandler((_wc, permission) => {
      return [
        "display-capture",
        "audioCapture",
        "videoCapture",
        "media",
        "microphone",
        "camera",
      ].includes(permission);
    });
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      if (
        [
          "display-capture",
          "audioCapture",
          "videoCapture",
          "media",
          "microphone",
          "camera",
        ].includes(permission)
      ) {
        return callback(true);
      }
      callback(false);
    });
  } catch (e) {
    console.warn("[perm] failed to install permission handlers", e);
  }
  if (process.env.EVIA_OVERLAY === "1") {
    createHeaderWindow();
  } else {
    createWindow();
  }

  // Create application menu with audio test option and edit menu for copy/paste
  const menu = Menu.buildFromTemplate([
    {
      label: "EVIA",
      submenu: [{ role: "quit" }],
    },
    {
      role: "editMenu", // Add standard Edit menu with copy/paste functionality
    },
    {
      label: "Tools",
      submenu: [
        {
          label: "Audio Test",
          click: () => {
            audioTestWindow.createAudioTestWindow();
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Clean up processes before quitting
  processManager.cleanupAllProcesses();
  if (process.platform !== "darwin") app.quit();
});

// Also clean up on app quit
app.on("quit", () => {
  processManager.cleanupAllProcesses();
});

// IPC: start/stop system audio (mac uses helper, win uses desktopCapturer)
ipcMain.handle(
  "system-audio:start",
  async (_e, opts?: { sourceId?: string }) => {
    if (process.platform === "darwin") {
      const result = await processManager.startSystemAudioHelper();
      if (result.ok) {
        processManager.registerSystemAudioHandlers(
          (line: string) => {
            mainWindow?.webContents.send("system-audio:data", line);
          },
          (logLine: string) => {
            console.warn("[SystemAudioCapture][stderr]", logLine);
            try {
              const data = JSON.parse(logLine);
              if (data.status)
                mainWindow?.webContents.send("system-audio:status", logLine);
            } catch {}
          }
        );
      }
      return result;
    }
    // Windows: just acknowledge; actual capture performed in renderer via sourceId
    if (process.platform === "win32") {
      // If no sourceId provided user will call get-sources first
      return { ok: true };
    }
    return { ok: false, error: "Unsupported platform for system audio" };
  }
);

ipcMain.handle("system-audio:get-sources", async () => {
  if (process.platform !== "win32") return { ok: false, error: "windows-only" };
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      fetchWindowIcons: false,
    });
    return {
      ok: true,
      sources: sources.map((s) => ({ id: s.id, name: s.name })),
    };
  } catch (e: any) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle("system-audio:stop", async () => {
  // Use process manager to stop the helper
  return await processManager.stopSystemAudioHelper();
});

// Overlay behavior controls
ipcMain.on("overlay:setClickThrough", (_e, enabled: boolean) => {
  const target =
    process.env.EVIA_OVERLAY === "1" ? getHeaderWindow() : mainWindow;
  if (!target) return;
  try {
    target.setIgnoreMouseEvents(Boolean(enabled), { forward: true });
  } catch {}
});

// Handle launching main app from permissions page
ipcMain.handle("launch-main", () => {
  const target =
    process.env.EVIA_OVERLAY === "1" ? getHeaderWindow() : mainWindow;
  if (target) {
    const url =
      process.env.NODE_ENV === "development"
        ? "http://localhost:5174"
        : `file://${path.join(__dirname, "../renderer/index.html")}`;
    target.loadURL(url);
    return { ok: true };
  }
  return { ok: false, error: "No main window" };
});

// Handle launching audio test window
ipcMain.handle("launch-audio-test", () => {
  audioTestWindow.createAudioTestWindow();
  return { ok: true };
});

// Handle opening a script in Terminal
ipcMain.handle("open-terminal", async (_, scriptPath) => {
  try {
    const fullPath = path.join(process.cwd(), scriptPath);
    const terminalCommand = `open -a Terminal "${fullPath}"`;
    spawn("bash", ["-c", terminalCommand], { stdio: "ignore" });
    return { ok: true };
  } catch (error) {
    console.error("Failed to open Terminal:", error);
    return { ok: false, error: String(error) };
  }
});
