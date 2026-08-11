// @ts-ignore - Vite's import.meta.env.PROD is set at build time
const IS_PRODUCTION = import.meta.env?.PROD ?? false;
// Browser-origin CORS applies to the Vite renderer during development. Route
// production API requests through Vite while preserving direct packaged calls.
const DEV_PRODUCTION_API_PROXY = 'http://localhost:5174/__taylos_api';
const SERVICE_TARGET = String(import.meta.env?.VITE_SERVICE_TARGET || 'production').trim().toLowerCase();
const USE_LOCAL_SERVICES = SERVICE_TARGET === 'local';
const ENV_BACKEND_URL = String(import.meta.env?.VITE_BACKEND_URL || '').trim();
const ENV_FRONTEND_URL = String(import.meta.env?.VITE_FRONTEND_URL || '').trim();
const RUNTIME_WS_BASE_URL =
  typeof window !== 'undefined' && typeof window.Taylos_BACKEND_WS === 'string'
    ? window.Taylos_BACKEND_WS.trim()
    : '';
const ENV_WS_BASE_URL = import.meta.env?.VITE_BACKEND_WS_URL ?? '';

export const BACKEND_URL = ENV_BACKEND_URL || (USE_LOCAL_SERVICES
  ? 'http://localhost:8000'
  : IS_PRODUCTION
    ? 'https://api.taylos.ai'
    : DEV_PRODUCTION_API_PROXY);

export const FRONTEND_URL = ENV_FRONTEND_URL || (USE_LOCAL_SERVICES
  ? 'http://localhost:5173'
  : 'https://app.taylos.ai');

export const WS_BASE_URL = RUNTIME_WS_BASE_URL || ENV_WS_BASE_URL || (USE_LOCAL_SERVICES
  ? 'ws://localhost:8000'
  : 'wss://backend-rt.livelydesert-1db1c46d.westeurope.azurecontainerapps.io');

console.log('[Config] Environment:', IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT');
console.log('[Config] Service target:', USE_LOCAL_SERVICES ? 'LOCAL' : 'PRODUCTION');
console.log('[Config] BACKEND_URL:', BACKEND_URL);
console.log('[Config] FRONTEND_URL:', FRONTEND_URL);
console.log('[Config] WS_BASE_URL:', WS_BASE_URL);
