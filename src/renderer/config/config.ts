// Production configuration using Vite's build-time env variable
// This is more reliable than runtime window checks
export const BACKEND_URL = import.meta.env.PROD
  ? 'https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io'
  : 'http://localhost:8000';

export const FRONTEND_URL = import.meta.env.PROD
  ? 'https://frontend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io'
  : 'http://localhost:5173';

export const WS_BASE_URL = import.meta.env.PROD
  ? 'wss://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io'
  : 'ws://localhost:8000';