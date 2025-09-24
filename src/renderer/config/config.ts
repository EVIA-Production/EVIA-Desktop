// Use local WS during development; fall back to production URL otherwise
const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
export const WS_BASE_URL = isLocal
  ? 'ws://localhost:8000'
  : 'wss://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io';