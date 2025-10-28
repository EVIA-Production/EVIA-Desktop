// @ts-ignore - Vite's import.meta.env.PROD is set at build time
const IS_PRODUCTION = import.meta.env?.PROD ?? false;

export const BACKEND_URL = IS_PRODUCTION
  ? 'https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io'
  : 'http://localhost:8000';

export const FRONTEND_URL = IS_PRODUCTION
  ? 'https://frontend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io'
  : 'http://localhost:5173';

export const WS_BASE_URL = IS_PRODUCTION
  ? 'wss://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io'
  : 'ws://localhost:8000';

console.log('[Config] Environment:', IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT');
console.log('[Config] BACKEND_URL:', BACKEND_URL);
console.log('[Config] FRONTEND_URL:', FRONTEND_URL);