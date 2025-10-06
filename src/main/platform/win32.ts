import {
  app,
  Menu,
  Tray,
  nativeImage,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
} from "electron";
import { Readable } from "stream";

// Simple in-process Windows system audio capture using Electron's desktopCapturer.
// NOTE: This is a best-effort placeholder: proper loopback capture on Windows typically
// requires WASAPI loopback via a native module. For parity with mac IPC we emulate the
// same JSON line events (mimeType + base64 PCM float payload) so the renderer stays uniform.

type LoopbackState = {
  capturing: boolean;
  interval?: NodeJS.Timeout;
};

let loopback: LoopbackState = { capturing: false };

let tray: Tray | null = null;

export const api = {
  showTray(): void {
    if (tray) return;
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
  workspaceTweaks(_mainWindow: BrowserWindow) {
    // Windows typically doesn't need special workspace tweaks for always-on-top overlay.
  },
  registerAudioIpc(getHeaderWindow: () => BrowserWindow | null) {
    if ((api as any)._audioRegistered) return;
    (api as any)._audioRegistered = true;

    ipcMain.handle("system-audio:start", async () => {
      if (loopback.capturing) return { ok: true };
      try {
        // Attempt to select the primary screen's audio stream
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          fetchWindowIcons: false,
        });
        const primary = sources[0];
        if (!primary)
          return { ok: false, error: "No screen source for loopback" };
        // We cannot directly get raw audio frames from desktopCapturer in main; renderer media capture is richer.
        // As a placeholder we emit synthetic silence JSON lines so downstream pipeline is exercised uniformly.
        loopback.capturing = true;
        loopback.interval = setInterval(() => {
          if (!loopback.capturing) return;
          const hw = getHeaderWindow();
          const sampleRate = 48000;
          // 100ms of silence float32 -> base64
          const samples = new Float32Array(sampleRate / 10);
          const bytes = new Uint8Array(samples.buffer);
          let bin = "";
          for (let i = 0; i < bytes.length; i++)
            bin += String.fromCharCode(bytes[i]);
          const b64 = Buffer.from(bin, "binary").toString("base64");
          const line = JSON.stringify({
            mimeType: `audio/pcm;rate=${sampleRate};channels=1;format=float32`,
            data: b64,
            ts: Date.now(),
          });
          hw?.webContents.send("system-audio:data", line);
          // Periodic status heartbeat (mimic mac helper JSON)
          hw?.webContents.send(
            "system-audio:status",
            JSON.stringify({ status: "ok", dg_open: true })
          );
        }, 100);
        return { ok: true };
      } catch (e) {
        loopback.capturing = false;
        return { ok: false, error: (e as Error).message };
      }
    });

    ipcMain.handle("system-audio:stop", async () => {
      loopback.capturing = false;
      if (loopback.interval) {
        clearInterval(loopback.interval);
        loopback.interval = undefined;
      }
      return { ok: true };
    });

    app.on("quit", () => {
      loopback.capturing = false;
      if (loopback.interval) clearInterval(loopback.interval);
    });
  },
  deepLinkScheme: "evia",
};
