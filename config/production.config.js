/**
 * Production Configuration for EVIA Desktop
 * These values are injected into the app at build time
 */

module.exports = {
  // Backend API (HTTPS - Azure Container Apps)
  EVIA_BACKEND_URL: 'https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io',
  
  // Frontend (HTTPS - Azure Container Apps)
  VITE_FRONTEND_URL: 'https://frontend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io',
  
  // WebSocket (WSS - Azure Container Apps)
  EVIA_WS_URL: 'wss://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io',
  
  // Environment
  NODE_ENV: 'production',
};

