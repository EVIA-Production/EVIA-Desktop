/** Credential redaction and content-free replay network metadata. */

const REDACTED = '[REDACTED_CREDENTIAL]';
const SECRET_KEYS = new Set([
  'authorization', 'cookie', 'setcookie', 'password', 'passwd', 'passcode',
  'accesstoken', 'refreshtoken', 'authtoken', 'oauthtoken', 'desktoptoken',
  'idtoken', 'apikey', 'privatekey', 'clientsecret', 'webhooksecret',
  'webhooksignature',
]);

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SECRET_KEYS.has(normalized)
    || normalized.endsWith('password')
    || normalized.endsWith('accesstoken')
    || normalized.endsWith('refreshtoken')
    || normalized.endsWith('apikey')
    || normalized.endsWith('privatekey')
    || normalized.endsWith('clientsecret');
}

function redactPatterns(value: string): string {
  return value
    .replace(/([?&](?:access_token|refresh_token|auth_token|oauth_token|desktop_token|api_key|client_secret|password)=)[^&#\s]+/gi, `$1${REDACTED}`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\x2F-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/\b(?:sk|phx|dg)_[A-Za-z0-9_-]{16,}\b/g, REDACTED);
}

export function redactTelemetrySecrets(value: unknown, parentKey = ''): unknown {
  if (parentKey && isSecretKey(parentKey)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactTelemetrySecrets(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, redactTelemetrySecrets(item, key)]));
  }
  return typeof value === 'string' ? redactPatterns(value) : value;
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, window.location.origin);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSecretKey(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString();
  } catch {
    return redactPatterns(rawUrl);
  }
}

export function sanitizeCapturedNetworkRequest<T extends Record<string, unknown>>(request: T): T {
  const output: Record<string, unknown> = { ...request };
  if (typeof output.url === 'string') {
    try {
      const safeUrl = new URL(sanitizeUrl(output.url));
      safeUrl.search = '';
      safeUrl.hash = '';
      output.url = safeUrl.toString();
    } catch { output.url = '[REDACTED_URL]'; }
  }
  for (const field of ['requestHeaders', 'responseHeaders', 'headers', 'requestBody', 'responseBody', 'body']) delete output[field];
  return output as T;
}
