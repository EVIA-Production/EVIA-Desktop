import { shell } from "electron";
import http from "http";
import crypto from "crypto";
import keytar from "keytar";
import { setAuthTokenInMain, clearAuthTokenInMain } from "./overlay-windows";

// Lightweight PKCE OAuth helper for the Electron main process.
// Supports two redirect strategies: loopback (127.0.0.1 random port) and custom deep link (evia://auth-callback)
// Stores access + refresh tokens in OS keychain via keytar. Broadcasts access token to renderer windows using setAuthTokenInMain.

export type PkceConfig = {
  authBaseUrl: string; // e.g. https://idp.example.com
  authorizePath?: string; // e.g. /authorize (default)
  tokenPath?: string; // e.g. /oauth/token or /token (default /oauth/token)
  clientId: string; // Registered native/public client id
  scopes: string[]; // OIDC/OAuth scopes
  audience?: string; // Optional audience parameter
  redirectStrategy?: "loopback" | "deeplink";
  loopbackHost?: string; // default 127.0.0.1
  customScheme?: string; // default 'evia'
  extraAuthorizeParams?: Record<string, string>;
  extraTokenParams?: Record<string, string>;
};

export type TokenSet = {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch millis (with small safety margin)
  token_type?: string;
  raw?: any;
};

const SERVICE_NAME = "evia-desktop-auth";
const ACCESS_ACCOUNT = "access-token";
const REFRESH_ACCOUNT = "refresh-token";
const META_ACCOUNT = "meta";

function b64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function randomString(bytes = 32) {
  return b64url(crypto.randomBytes(bytes));
}

function sha256B64Url(verifier: string) {
  return b64url(crypto.createHash("sha256").update(verifier).digest());
}

class PkceAuth {
  private config: PkceConfig | null = null;
  private pendingState: string | null = null;
  private codeVerifier: string | null = null;
  private loopbackServer: http.Server | null = null;
  private currentTokens: TokenSet | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  init(config: PkceConfig) {
    this.config = {
      authorizePath: "/authorize",
      tokenPath: "/oauth/token",
      redirectStrategy: "deeplink",
      loopbackHost: "127.0.0.1",
      customScheme: "evia",
      ...config,
    };
  }

  // Backend (EVIA) login support: use FastAPI /login/ to get a JWT and store it.
  async loginWithBackend(
    baseUrl: string,
    username: string,
    password: string,
    loginPath: string = "/login/"
  ): Promise<{ ok: boolean; error?: string; token_type?: string }> {
    try {
      const base = (baseUrl || "").trim().replace(/\/+$/, "");
      const path = (loginPath || "/login/").startsWith("/")
        ? loginPath || "/login/"
        : `/${loginPath}`;
      const url = new URL(path, base);
      console.log("[backend-login] POST", url.toString(), "as user", username);
      // JSON-first (matches EVIA backend: UserAuthenticate {username,password})
      let resp = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ username, password }),
      });
      if (!resp.ok) {
        // If credentials are wrong, don't issue extra retries that just spam logs
        if (resp.status === 401 || resp.status === 400) {
          return {
            ok: false,
            error: `HTTP ${resp.status}: Invalid credentials`,
          };
        }
        const bodyTxt = await resp.text().catch(() => "");
        console.warn(
          "[backend-login] HTTP",
          resp.status,
          bodyTxt?.slice?.(0, 500)
        );
        // Fallback 1: try JSON with {email,password}
        try {
          console.log(
            "[backend-login] retrying with JSON body (email/password)"
          );
          resp = await fetch(url.toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ email: username, password }),
          });
          if (!resp.ok) {
            if (resp.status === 401 || resp.status === 400) {
              return {
                ok: false,
                error: `HTTP ${resp.status}: Invalid credentials`,
              };
            }
            const jtxt = await resp.text().catch(() => "");
            console.warn(
              "[backend-login] JSON(email) HTTP",
              resp.status,
              jtxt?.slice?.(0, 500)
            );
            // Fallback 2: try form-encoded (OAuth2PasswordRequestForm)
            const form = new URLSearchParams();
            form.set("username", username);
            form.set("password", password);
            form.set("grant_type", "password");
            form.set("scope", "");
            resp = await fetch(url.toString(), {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
              },
              body: form.toString(),
            });
          }
        } catch (e) {}
        if (!resp.ok) {
          const txt2 = await resp.text().catch(() => "");
          console.warn(
            "[backend-login] final retry HTTP",
            resp.status,
            txt2?.slice?.(0, 500)
          );
          const errMsg =
            resp.status === 422
              ? "HTTP 422: Invalid request payload (server expected JSON with username/password)"
              : `HTTP ${resp.status}`;
          return { ok: false, error: errMsg };
        }
      }
      const data = await resp.json().catch(() => ({} as any));
      const access = data?.access_token || data?.token || data?.jwt;
      const tokenType = data?.token_type || data?.type || "Bearer";
      if (!access) return { ok: false, error: "No access_token in response" };
      await this.setAccessTokenFromBackend(access, tokenType);
      return { ok: true, token_type: tokenType };
    } catch (e: any) {
      console.error("[backend-login] fetch error", e);
      return { ok: false, error: String(e?.message || e) };
    }
  }

  private decodeJwtExpMillis(jwtStr: string): number | null {
    try {
      const parts = jwtStr.split(".");
      if (parts.length < 2) return null;
      const payload = JSON.parse(
        Buffer.from(
          parts[1].replace(/-/g, "+").replace(/_/g, "/"),
          "base64"
        ).toString("utf8")
      );
      if (payload && typeof payload.exp === "number") {
        // Avoid 32-bit overflow and preserve full precision
        return Math.floor(payload.exp * 1000);
      }
      return null;
    } catch {
      return null;
    }
  }

  async setAccessTokenFromBackend(accessToken: string, tokenType?: string) {
    // Derive expiry from JWT exp if available; otherwise assume 15 minutes
    const expMs = this.decodeJwtExpMillis(accessToken);
    const expiresAt =
      typeof expMs === "number" && expMs > Date.now()
        ? expMs - 30_000
        : Date.now() + 15 * 60 * 1000;
    try {
      console.log("[auth] setAccessTokenFromBackend expiry", {
        expMs,
        expiresAt,
        now: Date.now(),
        deltaSec: Math.round((expiresAt - Date.now()) / 1000),
      });
    } catch {}
    const tokenSet: TokenSet = {
      access_token: accessToken,
      refresh_token: undefined,
      expires_at: expiresAt,
      token_type: tokenType || "Bearer",
    };
    this.currentTokens = tokenSet;
    try {
      await keytar.setPassword(
        SERVICE_NAME,
        ACCESS_ACCOUNT,
        tokenSet.access_token
      );
    } catch {}
    try {
      await keytar.deletePassword(SERVICE_NAME, REFRESH_ACCOUNT);
    } catch {}
    try {
      await keytar.setPassword(
        SERVICE_NAME,
        META_ACCOUNT,
        JSON.stringify({
          expires_at: tokenSet.expires_at,
          token_type: tokenSet.token_type,
        })
      );
    } catch {}
    setAuthTokenInMain(tokenSet.access_token, tokenSet.token_type);
  }

  async startInteractiveAuth(): Promise<{
    ok: boolean;
    url?: string;
    error?: string;
    method: string;
  }> {
    if (!this.config)
      return { ok: false, error: "Not initialized", method: "none" };
    if (this.pendingState)
      return { ok: false, error: "Auth already in progress", method: "none" };
    const state = randomString(16);
    const verifier = randomString(64);
    const challenge = sha256B64Url(verifier);
    this.pendingState = state;
    this.codeVerifier = verifier;
    let redirectUri: string;
    let method = this.config.redirectStrategy!;
    if (this.config.redirectStrategy === "loopback") {
      redirectUri = await this.startLoopbackServer();
    } else {
      const scheme = this.config.customScheme || "evia";
      redirectUri = `${scheme}://auth-callback`;
    }
    const authUrl = new URL(
      this.config.authorizePath!,
      this.config.authBaseUrl
    );
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", this.config.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", this.config.scopes.join(" "));
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    if (this.config.audience)
      authUrl.searchParams.set("audience", this.config.audience);
    for (const [k, v] of Object.entries(this.config.extraAuthorizeParams || {}))
      authUrl.searchParams.set(k, v);
    const urlStr = authUrl.toString();
    shell
      .openExternal(urlStr)
      .catch((e) => console.error("[pkce] openExternal failed", e));
    return { ok: true, url: urlStr, method };
  }

  private startLoopbackServer(): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        this.loopbackServer = http.createServer(async (req, res) => {
          try {
            const urlObj = new URL(req.url || "/", "http://127.0.0.1");
            if (urlObj.pathname === "/callback") {
              const code = urlObj.searchParams.get("code");
              const state = urlObj.searchParams.get("state");
              res.statusCode = 200;
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.end(
                "<html><body><h3>Authentication complete. You may close this window.</h3></body></html>"
              );
              if (code) {
                this.handleAuthCode(code, state || undefined).catch((e) =>
                  console.error("[pkce] code exchange error", e)
                );
              }
              setTimeout(() => this.stopLoopbackServer(), 1500);
            } else {
              res.statusCode = 404;
              res.end("Not Found");
            }
          } catch (e) {
            try {
              res.statusCode = 500;
              res.end("Error");
            } catch {}
          }
        });
        this.loopbackServer.listen(0, this.config!.loopbackHost!, () => {
          const a = this.loopbackServer!.address();
          if (typeof a === "object" && a) {
            const redirect = `http://${this.config!.loopbackHost}:${
              a.port
            }/callback`;
            resolve(redirect);
          } else {
            reject(new Error("Failed to bind loopback server address"));
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  private stopLoopbackServer() {
    try {
      this.loopbackServer?.close();
    } catch {}
    this.loopbackServer = null;
  }

  async handleAuthCode(code: string, state?: string) {
    if (!this.config) {
      console.warn("[pkce] handleAuthCode called before init");
      return;
    }
    if (!this.pendingState || !this.codeVerifier) {
      console.warn("[pkce] No pending state/verifier");
      return;
    }
    if (state && state !== this.pendingState) {
      console.warn("[pkce] State mismatch");
      return;
    }
    const verifier = this.codeVerifier;
    this.pendingState = null;
    this.codeVerifier = null;
    await this.exchangeCode(code, verifier);
  }

  private async exchangeCode(code: string, verifier: string) {
    if (!this.config) return;
    const tokenUrl = new URL(this.config.tokenPath!, this.config.authBaseUrl);
    const redirectUri =
      this.config.redirectStrategy === "loopback"
        ? this.loopbackServer &&
          this.loopbackServer.address() &&
          typeof this.loopbackServer.address() === "object"
          ? `http://${this.config.loopbackHost}:${
              (this.loopbackServer.address() as any).port
            }/callback`
          : `${this.config.customScheme || "evia"}://auth-callback`
        : `${this.config.customScheme || "evia"}://auth-callback`;
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("client_id", this.config.clientId);
    body.set("code", code);
    body.set("redirect_uri", redirectUri);
    body.set("code_verifier", verifier);
    for (const [k, v] of Object.entries(this.config.extraTokenParams || {}))
      body.set(k, v);
    let resp: any;
    try {
      resp = await fetch(tokenUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (e) {
      console.error("[pkce] token request failed", e);
      return;
    }
    if (!resp.ok) {
      const txt = await resp.text();
      console.error("[pkce] token response not ok", resp.status, txt);
      return;
    }
    const json = await resp.json();
    await this.storeTokenResponse(json);
  }

  private async storeTokenResponse(json: any) {
    if (!json?.access_token) {
      console.warn("[pkce] No access_token in response");
      return;
    }
    const expiresIn = Number(json.expires_in || 3600);
    const expiresAt = Date.now() + (expiresIn - 30) * 1000; // subtract 30s safety
    const tokenSet: TokenSet = {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: expiresAt,
      token_type: json.token_type || "Bearer",
      raw: json,
    };
    this.currentTokens = tokenSet;
    try {
      await keytar.setPassword(
        SERVICE_NAME,
        ACCESS_ACCOUNT,
        tokenSet.access_token
      );
    } catch {}
    if (tokenSet.refresh_token) {
      try {
        await keytar.setPassword(
          SERVICE_NAME,
          REFRESH_ACCOUNT,
          tokenSet.refresh_token
        );
      } catch {}
    }
    try {
      await keytar.setPassword(
        SERVICE_NAME,
        META_ACCOUNT,
        JSON.stringify({
          expires_at: tokenSet.expires_at,
          token_type: tokenSet.token_type,
        })
      );
    } catch {}
    // Broadcast access token into existing app token mechanism
    setAuthTokenInMain(tokenSet.access_token, tokenSet.token_type);
    console.log(
      "[pkce] Stored tokens (masked)",
      this.maskToken(tokenSet.access_token)
    );
  }

  private maskToken(t: string | undefined) {
    if (!t) return "null";
    if (t.length <= 10) return t;
    return `${t.slice(0, 6)}...${t.slice(-4)}`;
  }

  private async ensureLoadedFromKeychain() {
    if (this.currentTokens) return;
    try {
      const at = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT);
      const rt = await keytar.getPassword(SERVICE_NAME, REFRESH_ACCOUNT);
      const metaRaw = await keytar.getPassword(SERVICE_NAME, META_ACCOUNT);
      if (at && metaRaw) {
        const meta = JSON.parse(metaRaw);
        this.currentTokens = {
          access_token: at,
          refresh_token: rt || undefined,
          expires_at: meta.expires_at,
          token_type: meta.token_type,
        };
      }
    } catch {}
  }

  async getValidAccessToken(): Promise<string | null> {
    await this.ensureLoadedFromKeychain();
    if (!this.currentTokens) return null;
    if (Date.now() < this.currentTokens.expires_at - 5000)
      return this.currentTokens.access_token;
    return await this.refreshAccessToken();
  }

  async refreshAccessToken(): Promise<string | null> {
    if (!this.config) return null;
    await this.ensureLoadedFromKeychain();
    if (!this.currentTokens?.refresh_token) return null;
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      const tokenUrl = new URL(
        this.config!.tokenPath!,
        this.config!.authBaseUrl
      );
      const body = new URLSearchParams();
      body.set("grant_type", "refresh_token");
      body.set("refresh_token", this.currentTokens!.refresh_token!);
      body.set("client_id", this.config!.clientId);
      for (const [k, v] of Object.entries(this.config!.extraTokenParams || {}))
        body.set(k, v);
      let resp: any;
      try {
        resp = await fetch(tokenUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
      } catch (e) {
        console.error("[pkce] refresh failed", e);
        this.refreshInFlight = null;
        return null;
      }
      if (!resp.ok) {
        console.error("[pkce] refresh not ok", resp.status);
        this.refreshInFlight = null;
        return null;
      }
      const json = await resp.json();
      await this.storeTokenResponse(json);
      this.refreshInFlight = null;
      return this.currentTokens?.access_token || null;
    })();
    const result = await this.refreshInFlight;
    this.refreshInFlight = null;
    return result;
  }

  async logout() {
    this.pendingState = null;
    this.codeVerifier = null;
    this.currentTokens = null;
    try {
      await keytar.deletePassword(SERVICE_NAME, ACCESS_ACCOUNT);
    } catch {}
    try {
      await keytar.deletePassword(SERVICE_NAME, REFRESH_ACCOUNT);
    } catch {}
    try {
      await keytar.deletePassword(SERVICE_NAME, META_ACCOUNT);
    } catch {}
    clearAuthTokenInMain();
  }
}

export const pkceAuth = new PkceAuth();
