import { app, Menu, nativeImage, Tray, BrowserWindow, ipcMain } from "electron";
// Mac-specific system audio capture integration encapsulated here.
// We reuse the existing process-manager (CommonJS) to avoid duplication.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const processManager = require("../process-manager") as {
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

let tray: Tray | null = null;

export const api = {
  showTray(): void {
    if (tray) return;
    // Placeholder transparent icon (better to replace with a real PNG in assets)
    const image = nativeImage.createEmpty();
    tray = new Tray(image);
    const menu = Menu.buildFromTemplate([
      {
        label: "Show Overlay",
        click: () => BrowserWindow.getAllWindows().forEach((w) => w.show()),
      },
      { type: "separator" },
      { label: "Quit EVIA", role: "quit" },
    ]);
    tray.setToolTip("EVIA Desktop");
    tray.setContextMenu(menu);
  },
  workspaceTweaks(mainWindow: BrowserWindow) {
    try {
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {}
  },
  registerAudioIpc(getHeaderWindow: () => BrowserWindow | null) {
    // Only register once
    if ((api as any)._audioRegistered) return;
    (api as any)._audioRegistered = true;

    ipcMain.handle("system-audio:start", async () => {
      const result = await processManager.startSystemAudioHelper();
      if (result.ok) {
        processManager.registerSystemAudioHandlers(
          (line: string) => {
            const hw = getHeaderWindow();
            if (hw && !hw.isDestroyed()) {
              hw.webContents.send("system-audio:data", line);
            }
          },
          (logLine: string) => {
            console.warn("[SystemAudioCapture][stderr]", logLine);
            try {
              const data = JSON.parse(logLine);
              const hw = getHeaderWindow();
              if (data.status && hw && !hw.isDestroyed()) {
                hw.webContents.send("system-audio:status", logLine);
              }
            } catch {}
          }
        );
      }
      return result;
    });

    ipcMain.handle("system-audio:stop", async () => {
      return await processManager.stopSystemAudioHelper();
    });

    app.on("quit", () => {
      try {
        processManager.cleanupAllProcesses();
      } catch {}
    });
  },
  deepLinkScheme: "evia",
};
