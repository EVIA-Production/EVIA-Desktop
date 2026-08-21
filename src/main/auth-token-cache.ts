/**
 * In-memory read cache for the auth token.
 *
 * Its own module so that every writer - login, refresh, and the four logout
 * paths in header-controller - can invalidate it without importing main.ts and
 * creating a cycle. Keychain stays the only store; nothing is persisted here.
 *
 * The cache exists because every suggestion click read the Keychain through an
 * IPC round trip, on the DURING path where latency is the product. The
 * invalidation exists because a cached token that survives logout is a security
 * bug, not a performance win.
 */

let token: string | null = null;
let loaded = false;

export function getCachedAuthToken(): { token: string | null; loaded: boolean } {
  return { token, loaded };
}

/** Record a freshly written token. */
export function setCachedAuthToken(next: string | null): void {
  token = next;
  loaded = true;
}

/** Forget it. Call on EVERY delete, and whenever validity is in doubt. */
export function clearCachedAuthToken(): void {
  token = null;
  loaded = false;
}
