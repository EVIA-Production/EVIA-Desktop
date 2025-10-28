// Production configuration for EVIA Desktop
// These values are used when NODE_ENV === 'production'

export const PRODUCTION_CONFIG = {
  BACKEND_URL: 'https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io',
  FRONTEND_URL: 'https://frontend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io',
  WS_URL: 'wss://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io',
} as const;

export const DEVELOPMENT_CONFIG = {
  BACKEND_URL: 'http://localhost:8000',
  FRONTEND_URL: 'http://localhost:5173',
  WS_URL: 'ws://localhost:8000',
} as const;

// Auto-select based on environment
export const CONFIG = import.meta.env.PROD
  ? PRODUCTION_CONFIG
  : DEVELOPMENT_CONFIG;

export default CONFIG;

