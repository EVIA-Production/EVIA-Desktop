// Central helper to retrieve the current auth token from keytar via IPC.
// Falls back to legacy localStorage copy only if IPC returns null.
// Optionally memoized to avoid excessive IPC chatter.

let cachedToken: string | null = null;
let cacheTime = 0;
const TTL_MS = 5000; // 5s cache to reduce IPC frequency; adjust as needed

export async function getAuthToken(forceFresh = false): Promise<string | null> {
  const now = Date.now();
  if (!forceFresh && cachedToken && now - cacheTime < TTL_MS) {
    return cachedToken;
  }
  try {
    const token = await (window as any).evia?.auth?.getToken?.();
    if (token) {
      cachedToken = token;
      cacheTime = now;
      return token;
    }
  } catch (e) {
    // Swallow; we'll attempt localStorage fallback
  }
  // Legacy fallback
  try {
    const legacy = localStorage.getItem("auth_token");
    if (legacy) {
      cachedToken = legacy;
      cacheTime = now;
      return legacy;
    }
  } catch {}
  return null;
}

export async function clearAuthTokenCache() {
  cachedToken = null;
  cacheTime = 0;
}
