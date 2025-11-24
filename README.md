# EVIA Desktop 

- Transparent overlay window (frameless, always-on-top)
- Dual WebSocket connections to backend `/ws/transcribe?source=mic|system`
- Preload isolation; no Node in renderer
- Later: Keychain storage for JWT via `keytar`, ScreenCaptureKit helper

## Dev

MAC

```sh
cd EVIA-Desktop
npm i
# terminal A (renderer)
npm run dev:renderer
# terminal B (Electron)
EVIA_DEV=1 npm run dev:main
```

WINDOWS

```sh
cd EVIA-Desktop
npm i

# Terminal A - Start renderer process
npm run dev:renderer

# Terminal B - Start Electron main process with dev flag
$env:EVIA_DEV = "1"
npm run dev:main
```

Set backend URL, chat_id, and token in the Electron window fields, then click Connect.

### PKCE / OIDC Desktop Login (New)

The desktop app can now perform its own OAuth2 / OIDC Authorization Code + PKCE login flow (instead of pasting a JWT):

1. Two redirect strategies are supported:
   - Deep link (default): `evia://auth-callback` (and legacy `pickleglass://auth-callback` still parsed for implicit tokens)
   - Loopback: `http://127.0.0.1:{randomPort}/callback`
2. Environment variables (set before launching Electron) configure the IdP:

   | Variable                             | Meaning                             | Example                    |
   | ------------------------------------ | ----------------------------------- | -------------------------- |
   | `EVIA_AUTH_BASE` or `OIDC_AUTH_BASE` | Base URL of IdP (no trailing slash) | `https://auth.example.com` |
   | `EVIA_CLIENT_ID` or `OIDC_CLIENT_ID` | Native/public application client id | `desktop-app`              |
   | `EVIA_OIDC_SCOPES`                   | Space separated scopes              | `openid profile email`     |
   | `EVIA_OIDC_AUDIENCE`                 | Optional audience parameter         | `https://api.example.com`  |
   | `EVIA_OIDC_REDIRECT`                 | `deeplink` (default) or `loopback`  | `loopback`                 |

3. Renderer initiates login via the preload bridge:
   ```ts
   await window.evia.auth.startPkce();
   ```
   This opens the system browser (not an embedded webview) to the IdP `/authorize` URL with PKCE parameters.
4. User authenticates; IdP redirects to either the deep link or the loopback mini HTTP server. The main process detects:
   - `evia://auth-callback?code=...&state=...` (PKCE)
   - (Legacy implicit) `evia://auth-callback#access_token=...` (still supported for backward compatibility)
5. Main exchanges the authorization code for tokens (`/oauth/token` by default) and stores them securely using the OS keychain via `keytar` (never in localStorage):
   - Access token (rotated on refresh)
   - Refresh token (if provided)
   - Expiry metadata
6. Access token is broadcast to all renderer windows through the existing `auth:apply` channel; renderers only ever see the short‑lived access token.
7. Renderer can request a fresh (possibly refreshed) access token any time:
   ```ts
   const { ok, access_token } = await window.evia.auth.getAccessToken();
   ```
8. Logout clears keychain entries and broadcasts token removal:
   ```ts
   await window.evia.auth.logout();
   ```

Security notes:

- Refresh tokens never leave the main process / keychain.
- Access tokens are masked in logs unless `EVIA_DEBUG_FULL_TOKEN=1`.
- Deep link scheme is registered at runtime in dev (Windows) or by installer in production.
- Loopback mode automatically spins up a one‑shot HTTP server on `127.0.0.1` with a random free port.

Backend alignment:

- The backend issues stateless JWT access tokens (see `EVIA-backend/backend/api/routes/authentication.py`). The desktop simply supplies the `Authorization: Bearer <access_token>` header to existing API/WebSocket calls. No server‑side session storage is introduced.

Migration guidance (from manual pasting):

- Existing manual token field can remain as a fallback.
- Prefer calling `window.evia.auth.startPkce()`; on success the UI can automatically connect using the broadcast access token.

Development tips:

```powershell
# Windows PowerShell example (deep link strategy)
$env:EVIA_AUTH_BASE = 'https://auth.example.com'
$env:EVIA_CLIENT_ID = 'desktop-app'
$env:EVIA_OIDC_SCOPES = 'openid profile email'
$env:EVIA_OIDC_REDIRECT = 'deeplink'
npm run dev:main
```

```powershell
# Loopback strategy
$env:EVIA_AUTH_BASE = 'https://auth.example.com'
$env:EVIA_CLIENT_ID = 'desktop-app'
$env:EVIA_OIDC_REDIRECT = 'loopback'
npm run dev:main
```

Renderer usage snippet:

```ts
async function login() {
  const res = await window.evia.auth.startPkce();
  if (!res.ok) {
    console.error("Failed to start login", res.error);
    return;
  }
  console.log("Opened browser for auth method", res.method);
}
```

Fetching a valid token before an API call:

```ts
async function authorizedFetch(path: string, init: RequestInit = {}) {
  const tkRes = await window.evia.auth.getAccessToken();
  if (!tkRes.ok) throw new Error("No access token");
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${tkRes.access_token}`);
  return fetch(path, { ...init, headers });
}
```

### macOS helper (Phase 1)

- Build the CLI helper once (requires Xcode CLT):

```sh
cd native/mac/SystemAudioCapture
swift build -c debug
```

- Electron (dev) will spawn the debug binary from `.build/debug/SystemAudioCapture` when `EVIA_DEV=1`.
- Production build will bundle the helper into `Resources/mac/SystemAudioCapture` via electron-builder extraResources.

## Build

```sh
npm run build
```

## Deep-link token handoff

The desktop app can receive a JWT from the web login via a custom URL:

- Primary: `evia://auth-callback#access_token=...&token_type=Bearer`
- Legacy (still supported): `pickleglass://auth-callback#...`

In development on Windows, `main.ts` registers the protocol for the running Electron process.
In packaged builds, the installer registers both schemes via `electron-builder.yml`.

How to test:

- In the frontend login flow, add `?desktop=true` to the URL to enable the deep-link redirect.
- After login, the browser navigates to `evia://...` and the OS opens EVIA Desktop, which persists the token and broadcasts it to all windows.
- Check the Electron DevTools console for messages prefixed with `[deep-link]` and `[auth]`.

## Notes

- Binary audio frames must be PCM16 mono at 16kHz; send 100–200ms frames.
- See `EVIA-backend/backend/api/routes/websocket.py` and `EVIA-backend/desktop-migration/WS_PROTOCOL.md` for protocol details.
