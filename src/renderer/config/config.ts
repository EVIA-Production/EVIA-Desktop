// @ts-ignore - Vite's import.meta.env.PROD is set at build time
const IS_PRODUCTION = import.meta.env?.PROD ?? false;
const RUNTIME_WS_BASE_URL =
  typeof window !== 'undefined' && typeof window.Taylos_BACKEND_WS === 'string'
    ? window.Taylos_BACKEND_WS.trim()
    : '';
const ENV_WS_BASE_URL = import.meta.env?.VITE_BACKEND_WS_URL ?? '';

export const BACKEND_URL = IS_PRODUCTION
  ? 'https://api.taylos.ai'
  : 'http://localhost:8000';

export const FRONTEND_URL = IS_PRODUCTION
  ? 'https://app.taylos.ai'
  : 'http://localhost:5173';

export const WS_BASE_URL = IS_PRODUCTION
  ? (RUNTIME_WS_BASE_URL || ENV_WS_BASE_URL || 'wss://rt.taylos.ai')
  : (RUNTIME_WS_BASE_URL || ENV_WS_BASE_URL || 'ws://localhost:8000');

console.log('[Config] Environment:', IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT');
console.log('[Config] BACKEND_URL:', BACKEND_URL);
console.log('[Config] FRONTEND_URL:', FRONTEND_URL);
console.log('[Config] WS_BASE_URL:', WS_BASE_URL);
