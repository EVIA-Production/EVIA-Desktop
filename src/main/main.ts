import { app, ipcMain, dialog, BrowserWindow } from "electron";

// --- IPC HANDLE REGISTRY INSTRUMENTATION (must occur before any imports that call ipcMain.handle) ---
const __registeredIpcHandles = new Set<string>();
const __originalHandle = ipcMain.handle.bind(ipcMain);
(ipcMain as any).handle = (channel: string, listener: any) => {
  __registeredIpcHandles.add(channel);
  return __originalHandle(channel, listener);
};

// Import transcription manager (side‑effect registers transcript:init). If this import throws we log & defer a dynamic retry.
let __tmImportError: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("./transcriptionManager");
} catch (e) {
  __tmImportError = e;
  console.error(
    "[main][DIAG] Initial import of transcriptionManager failed",
    e
  );
}
// Failsafe inline registration if handler still not present shortly after import
setTimeout(() => {
  const h = ipcMain.listenerCount("transcript:init");
  if (h === 0) {
    console.warn(
      "[main][FAILSAFE] transcript:init missing 50ms after import; registering fallback handler"
    );
    try {
      ipcMain.handle("transcript:init", async (_e, args: any) => {
        console.log(
          "[main][FAILSAFE] transcript:init invoked via fallback handler",
          args
        );
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mgr = require("./transcriptionManager").default;
          if (mgr?.ensure) await mgr.ensure(args.chatId, args.token);
        } catch (err) {
          console.error(
            "[main][FAILSAFE] Could not delegate to manager.ensure",
            err
          );
        }
        return { ok: true, fallback: true };
      });
      console.log(
        "[main][FAILSAFE] Fallback transcript:init handler registered successfully"
      );
    } catch (err) {
      console.error(
        "[main][FAILSAFE] Failed to register fallback transcript:init handler",
        err
      );
    }
  }
}, 50);
import { createHeaderWindow, getHeaderWindow } from "./overlay-windows";
import platformApi from "./platform";
import os from "os";
import { spawn } from "child_process";
import * as keytar from "keytar";

function getBackendHttpBase(): string {
  const env = process.env.EVIA_BACKEND_URL || process.env.API_BASE_URL;
  if (env && env.trim()) return String(env).replace(/\/$/, "");
  return "http://localhost:8000";
}

// Windows platform stub - Glass parity requirement
// if (process.platform === 'win32') {
//   app.whenReady().then(() => {
//     dialog.showMessageBox({
//       type: 'info',
//       title: 'Windows Support Coming Soon',
//       message: 'EVIA Desktop for Windows is coming soon!',
//       detail: 'The Windows version with full audio capture and overlay support is currently in development. Please check back soon or contact us for updates.',
//       buttons: ['OK']
//     }).then(() => {
//       app.quit();
//     });
//   });
// }
// System audio logic is now encapsulated in platformApi.registerAudioIpc (mac only)

const isDev = process.env.NODE_ENV === "development";
const platform = os.platform();

app.on("window-all-closed", () => {
  if (platform !== "darwin") app.quit();
});

app.on("activate", () => {
  // Re-create header if needed
  if (!getHeaderWindow()) createHeaderWindow();
});

// Cleanup now handled inside platform layer (mac only) when audio IPC registered

async function killExisting(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("pkill", ["-f", name], { stdio: "ignore" });
    child.on("close", () => resolve(true));
    child.on("error", () => resolve(false));
  });
}

// IPC handlers for system audio now registered per platform (mac only)

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

ipcMain.handle("auth:logout", async () => {
  try {
    await keytar.deletePassword("evia", "token");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle("app:quit", () => {
  console.log("[main] app:quit requested from renderer");
  app.quit();
  return { ok: true };
});

// Note: Window management handlers (capture:screenshot, header:toggle-visibility,
// header:nudge, header:open-ask) are registered in overlay-windows.ts to avoid duplicates

app.whenReady().then(() => {
  createHeaderWindow();
  const hw = getHeaderWindow();
  if (hw) {
    // Apply platform specific workspace tweaks (mac keeps on all workspaces, windows mostly no-op)
    try {
      platformApi.workspaceTweaks(hw as BrowserWindow);
    } catch (e) {
      console.warn("[platform] workspaceTweaks failed", e);
    }
    try {
      platformApi.registerAudioIpc(() => getHeaderWindow());
    } catch (e) {
      console.warn("[platform] registerAudioIpc failed", e);
    }
  }
  // Show tray icon (if implemented per platform)
  try {
    platformApi.showTray();
  } catch (e) {
    console.warn("[platform] showTray failed", e);
  }

  // If auth token & chat id already exist in keytar/localStorage (renderer will set), renderer can explicitly invoke transcript:init.
  // Here we just expose a readiness log.
  console.log(
    "[main] App ready, awaiting transcript:init IPC to start central sockets"
  );
  try {
    const hasTranscriptInit = __registeredIpcHandles.has("transcript:init");
    console.log(
      `[main] transcript:init registered (via instrumentation): ${hasTranscriptInit}`
    );
    if (!hasTranscriptInit && __tmImportError) {
      console.error(
        "[main][DIAG] transcriptionManager import failed earlier:",
        __tmImportError?.stack || __tmImportError
      );
    }
    console.log(
      "[main][DIAG] Registered ipcMain.handle channels:",
      Array.from(__registeredIpcHandles).join(", ") || "<none>"
    );
    // Lightweight self-test: invoke handler if present (no-op ensure will ignore duplicates)
    if (hasTranscriptInit) {
      try {
        ipcMain.emit("transcript:init", { sender: hw?.webContents } as any, {
          chatId: "_selftest_",
          token: "_selftest_",
        });
        console.log("[main][DIAG] transcript:init self-test emit dispatched");
      } catch (e) {
        console.warn("[main][DIAG] self-test emit failed", e);
      }
    }
  } catch (e) {
    console.warn("[main] Failed to inspect transcript:init handler", e);
  }

  // Proactive autostart: if renderer hasn't yet invoked init we can bootstrap once token & chat id exist in keytar/localStorage (not directly available).
  // We rely on an environment-provided token for now (optional) to reduce race conditions.
  const envToken = process.env.EVIA_AUTH_TOKEN;
  const envChat = process.env.EVIA_CHAT_ID;
  if (envToken && envChat) {
    console.log("[main] Autostarting transcription manager from env vars");
    ipcMain.emit("transcript:init", { sender: hw?.webContents } as any, {
      chatId: envChat,
      token: envToken,
    });
  }

  // Ensure debug visibility
  try {
    hw?.show();
  } catch {}
  try {
    hw?.focus();
  } catch {}
  // Note: Global shortcuts are registered in overlay-windows.ts
});
