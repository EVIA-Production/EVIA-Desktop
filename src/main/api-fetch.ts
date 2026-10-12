type ApiFailure = {
  error_type: 'api_error';
  error_message: string;
  error_code?: string;
  endpoint: string;
  method: string;
  status_code: number;
  latency_ms: number;
  error_stack: string;
  source: 'desktop';
  process: 'main';
};

// Chromium uses the OS proxy, certificate store and resolver. Node's fetch
// does not: the same user's web requests can work while main IPC says "fetch failed".
export function createApiFetch(
  networkFetch: typeof fetch,
  fallbackFetch: typeof fetch,
  backendUrl: string,
  report: (failure: ApiFailure) => void,
): typeof fetch {
  const origin = new URL(backendUrl).origin;
  return async (input, init) => {
    let url: URL;
    try { url = new URL(input instanceof Request ? input.url : String(input)); }
    catch { return fallbackFetch(input, init); }
    if (url.origin !== origin) return fallbackFetch(input, init);
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const started = Date.now();
    const callerStack = (new Error('Taylos API request').stack || '').slice(0, 4000)
      .replace(/(\/Users\/|\/home\/|\\Users\\)[^/\\\s]+/g, '$1~');
    const reporting = !url.pathname.startsWith('/telemetry/') && !url.pathname.startsWith('/client/telemetry');
    const fail = (status: number, code?: string) => {
      if (!reporting) return;
      try {
        report({
          error_type: 'api_error',
          error_message: status ? `HTTP ${status} ${method} ${url.pathname}` : 'Could not connect to the Taylos server',
          error_code: code?.slice(0, 80), endpoint: url.pathname, method,
          status_code: status, latency_ms: Date.now() - started,
          error_stack: callerStack,
          source: 'desktop', process: 'main',
        });
      } catch { /* Never replace the original outcome with a reporting failure. */ }
    };
    try {
      const response = await networkFetch(input, init);
      if (!response.ok) fail(response.status);
      return response;
    } catch (error) {
      const failure = error as { name?: string; cause?: { code?: string }; code?: string };
      if (failure?.name !== 'AbortError') {
        const networkCode = error instanceof Error ? error.message.match(/net::ERR_[A-Z_]+/)?.[0] : undefined;
        fail(0, failure?.cause?.code || failure?.code || networkCode || failure?.name);
      }
      throw error;
    }
  };
}
