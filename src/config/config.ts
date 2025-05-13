export const BACKEND_URL = process.env.VITE_BACKEND_URL;
export const BACKEND_PORT = process.env.VITE_BACKEND_PORT;

// Debug logs
console.log('Environment Variables:', {
  BACKEND_URL,
  BACKEND_PORT,
  'import.meta.env': import.meta.env
});

// Only append port if the URL is not HTTPS (for local development)
export const API_BASE_URL = BACKEND_URL?.startsWith('https://') 
  ? BACKEND_URL 
  : `${BACKEND_URL}:${BACKEND_PORT}`;

// Debug log for final URL
console.log('Constructed API_BASE_URL:', API_BASE_URL);

// For WebSocket, use wss:// for HTTPS URLs
export const WS_BASE_URL = BACKEND_URL?.startsWith('https://')
  ? `wss://${BACKEND_URL.replace('https://', '')}`
  : `ws://${BACKEND_URL.replace('http://', '')}:${BACKEND_PORT}`; 