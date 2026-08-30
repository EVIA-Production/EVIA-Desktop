const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');

const repoRoot = path.resolve(__dirname, '..');
const servicePath = path.join(repoRoot, 'src/renderer/services/insightsService.ts');

function loadInsightsService() {
  const source = fs.readFileSync(servicePath, 'utf8').replace(
    "import { BACKEND_URL } from '../config/config';",
    "const BACKEND_URL = 'https://api.test.invalid';",
  );
  const compiled = transformSync(source, {
    loader: 'ts',
    format: 'cjs',
    target: 'node20',
  }).code;
  const loaded = new Module(servicePath, module);
  loaded.filename = servicePath;
  loaded.paths = Module._nodeModulePaths(repoRoot);
  loaded._compile(compiled, servicePath);
  return loaded.exports;
}

function installNeverResolvingFetch() {
  const originalFetch = global.fetch;
  global.fetch = (_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
  return () => {
    global.fetch = originalFetch;
  };
}

const request = {
  chatId: 1,
  token: 'test-token',
  sessionState: 'during',
};

test('an external abort releases a hung insights request immediately', async () => {
  const restoreFetch = installNeverResolvingFetch();
  const { fetchInsights } = loadInsightsService();
  const controller = new AbortController();
  const startedAt = Date.now();

  try {
    const pending = fetchInsights({
      ...request,
      signal: controller.signal,
      requestTimeoutMs: 1_000,
    });
    controller.abort('post-call-insights-priority');

    assert.equal(await pending, null);
    assert.ok(Date.now() - startedAt < 250);
  } finally {
    restoreFetch();
  }
});

test('the request timeout releases a hung insights request without a parent signal', async () => {
  const restoreFetch = installNeverResolvingFetch();
  const { fetchInsights } = loadInsightsService();
  const startedAt = Date.now();

  try {
    assert.equal(await fetchInsights({
      ...request,
      requestTimeoutMs: 20,
    }), null);
    assert.ok(Date.now() - startedAt < 250);
  } finally {
    restoreFetch();
  }
});
