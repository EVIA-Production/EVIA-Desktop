import { app, ipcMain } from "electron";
import {
  createHeaderWindow,
  getHeaderWindow,
  setAuthTokenInMain,
} from "./overlay-windows";
import os from "os";
import { spawn } from "child_process";
import { pkceAuth } from "./auth-pkce";
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
const platform = os.platform();

// Handle custom protocol deep link for JWT handoff (supports 'evia' and legacy 'pickleglass')
const SUPPORTED_PROTOCOLS = ["evia", "pickleglass"] as const;
type SupportedProtocol = (typeof SUPPORTED_PROTOCOLS)[number];

function parseDeepLink(url: string): {
  token?: string;
  tokenType?: string;
  code?: string;
  state?: string;
} | null {
  try {
    // Expect format like: evia://auth-callback#access_token=...&token_type=Bearer
    const u = new URL(url);
    if (
      !SUPPORTED_PROTOCOLS.includes(
        u.protocol.replace(":", "") as SupportedProtocol
      )
    )
      return null;
    if (u.hostname !== "auth-callback") return null;
    // Support both fragment (implicit) and query (PKCE code)
    const frag = u.hash?.startsWith("#") ? u.hash.slice(1) : "";
    const fParams = new URLSearchParams(frag);
    const qParams = new URLSearchParams(u.search || "");
    const token = fParams.get("access_token") || undefined;
    const tokenType = fParams.get("token_type") || undefined;
    const code = qParams.get("code") || undefined;
    const state = qParams.get("state") || undefined;
    if (token) return { token, tokenType: tokenType || "Bearer" };
    if (code) return { code, state };
    return null;
  } catch {
    return null;
  }
}

function handleDeepLinkUrl(url: string) {
  const parsed = parseDeepLink(url);
  if (!parsed) {
    console.warn("[deep-link] Ignored URL (unrecognized):", url);
    return;
  }
  if (parsed.token) {
    const masked = `${parsed.token.slice(0, 6)}...${parsed.token.slice(
      Math.max(0, parsed.token.length - 4)
    )}`;
    console.log(
      `[deep-link] Received auth token (masked=${masked}) via ${
        url.split("://")[0]
      }://`
    );
    try {
      const v = (process.env.EVIA_DEBUG_FULL_TOKEN || "").toLowerCase();
      const fullLog = v === "1" || v === "true" || v === "yes";
      if (fullLog) {
        console.log("[deep-link][FULL] Raw token:", parsed.token);
      }
    } catch {}
    setAuthTokenInMain(parsed.token, parsed.tokenType);
    return;
  }
  if (parsed.code) {
    console.log(
      "[deep-link] Received authorization code (PKCE). Exchanging..."
    );
    pkceAuth
      .handleAuthCode(parsed.code, parsed.state)
      .catch((e) => console.error("[deep-link] code exchange failed", e));
    return;
  }
}

// Ensure single instance to route deep links to the running app
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    try {
      console.log("[protocol] second-instance invoked with argv:", argv);
    } catch {}
    // On Windows, protocol URL appears as a CLI arg
    const urlArg = argv.find((a) =>
      SUPPORTED_PROTOCOLS.some((p) => a.startsWith(`${p}://`))
    );
    if (!urlArg) {
      console.log("[protocol] second-instance: no protocol URL in argv");
    }
    if (urlArg) handleDeepLinkUrl(urlArg);
  });
}

app.on("window-all-closed", () => {
  if (platform !== "darwin") app.quit();
});

app.on("activate", () => {
  // Re-create header if needed
  if (!getHeaderWindow()) createHeaderWindow();
});

app.on("quit", () => {
  processManager.cleanupAllProcesses();
});

// Register protocol handler (packaged) and dev fallback
app.whenReady().then(() => {
  try {
    console.log("[main] app.whenReady fired");
  } catch {}
  // Initialize PKCE auth module from environment (if provided)
  try {
    const AUTH_BASE = process.env.EVIA_AUTH_BASE || process.env.OIDC_AUTH_BASE;
    const CLIENT_ID = process.env.EVIA_CLIENT_ID || process.env.OIDC_CLIENT_ID;
    if (AUTH_BASE && CLIENT_ID) {
      pkceAuth.init({
        authBaseUrl: AUTH_BASE,
        clientId: CLIENT_ID,
        scopes: (process.env.EVIA_OIDC_SCOPES || "openid profile email").split(
          /\s+/
        ),
        redirectStrategy: (process.env.EVIA_OIDC_REDIRECT || "deeplink") as any,
        audience: process.env.EVIA_OIDC_AUDIENCE,
        authorizePath: process.env.EVIA_AUTHORIZE_PATH || "/authorize",
        tokenPath: process.env.EVIA_TOKEN_PATH || "/oauth/token",
        customScheme: process.env.EVIA_CUSTOM_SCHEME || "evia",
      });
      console.log("[pkce] Initialized with base", AUTH_BASE);
    } else {
      console.log(
        "[pkce] Skipped init (missing AUTH_BASE or CLIENT_ID env vars)"
      );
    }
  } catch (e) {
    console.warn("[pkce] init error", e);
  }
  try {
    for (const scheme of SUPPORTED_PROTOCOLS) {
      if (isDev && process.platform === "win32") {
        // In dev, need to pass exe and arguments for Electron to handle protocol
        const ok = app.setAsDefaultProtocolClient(scheme, process.execPath, [
          process.argv[1],
        ]);
        console.log(`[protocol] dev register ${scheme}:// ->`, ok);
      } else {
        const ok = app.setAsDefaultProtocolClient(scheme);
        console.log(`[protocol] register ${scheme}:// ->`, ok);
      }
    }
  } catch (e) {
    console.warn("[protocol] Failed to register custom protocol", e);
  }

  // Process any deep link passed on first run (Windows)
  if (process.platform === "win32" && process.argv.length > 1) {
    try {
      console.log("[protocol] initial argv:", process.argv);
    } catch {}
    const urlArg = process.argv.find((a) =>
      SUPPORTED_PROTOCOLS.some((p) => a.startsWith(`${p}://`))
    );
    if (urlArg) handleDeepLinkUrl(urlArg);
  }
  try {
    console.log("[main] initialization complete");
  } catch {}
});

async function killExisting(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("pkill", ["-f", name], { stdio: "ignore" });
    child.on("close", () => resolve(true));
    child.on("error", () => resolve(false));
  });
}

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
        } catch (e) {}
      }
    );
  }
  return result;
});

ipcMain.handle("system-audio:stop", async () => {
  return await processManager.stopSystemAudioHelper();
});

// PKCE Auth IPC
ipcMain.handle("auth:pkce:start", async () => {
  try {
    console.log("[ipc] auth:pkce:start invoked");
    const res = await pkceAuth.startInteractiveAuth();
    return res;
  } catch (e) {
    return { ok: false, error: String(e), method: "unknown" };
  }
});
ipcMain.handle("auth:pkce:get-access-token", async () => {
  try {
    console.log("[ipc] auth:pkce:get-access-token invoked");
    const token = await pkceAuth.getValidAccessToken();
    if (token) return { ok: true, access_token: token };
    return { ok: false, error: "No token" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
ipcMain.handle("auth:pkce:logout", async () => {
  try {
    console.log("[ipc] auth:pkce:logout invoked");
    await pkceAuth.logout();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// Backend login IPC (FastAPI /login/)
ipcMain.handle(
  "auth:backend:login",
  async (
    _e,
    args: {
      baseUrl?: string;
      username: string;
      password: string;
      loginPath?: string;
    }
  ) => {
    try {
      const { baseUrl, username, password, loginPath } = args || ({} as any);
      console.log("[ipc] auth:backend:login invoked", {
        providedBaseUrl: !!baseUrl,
        providedLoginPath: !!loginPath,
        hasUsername: !!username,
        hasPassword: !!password,
      });
      if (!username || !password)
        return { ok: false, error: "Missing username/password" };

      const defaultBase =
        process.env.EVIA_BACKEND_BASE ||
        (process.env.API_BASE_URL as string) ||
        "http://localhost:8000";
      const defaultPath = process.env.EVIA_BACKEND_LOGIN_PATH || "/login/";

      const targetBase =
        baseUrl && baseUrl.trim().length ? baseUrl : defaultBase;
      const targetPath =
        loginPath && loginPath.trim().length ? loginPath : defaultPath;

      console.log("[ipc] auth:backend:login ->", {
        baseUrl: targetBase,
        username,
        loginPath: targetPath,
      });

      const res = await pkceAuth.loginWithBackend(
        targetBase,
        username,
        password,
        targetPath
      );
      return res;
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
);

// Add your other handlers here...

app.whenReady().then(() => {
  createHeaderWindow();
  const hw = getHeaderWindow();
  // Ensure debug visibility
  try {
    hw?.show();
  } catch {}
  try {
    hw?.focus();
  } catch {}
});
