export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
export const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT;

// Only append port if the URL is not HTTPS (for local development)
export const API_BASE_URL = BACKEND_URL?.startsWith('https://') 
  ? BACKEND_URL 
  : `${BACKEND_URL}:${BACKEND_PORT}`;

// For WebSocket, use wss:// for HTTPS URLs
export const WS_BASE_URL = BACKEND_URL?.startsWith('https://')
  ? `wss://${BACKEND_URL.replace('https://', '')}`
  : `ws://${BACKEND_URL.replace('http://', '')}:${BACKEND_PORT}`; 