// Get environment variables
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
export const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT;

// Debug logs
console.log('Environment Variables:', {
  BACKEND_URL,
  BACKEND_PORT,
  'import.meta.env': import.meta.env
});

// Safely construct API URL with defensive checks
export const API_BASE_URL = BACKEND_URL?.startsWith('https://') 
  ? BACKEND_URL 
  : `${BACKEND_URL}${BACKEND_PORT ? `:${BACKEND_PORT}` : ''}`;

// Debug log for final URL
console.log('Constructed API_BASE_URL:', API_BASE_URL);

// Safely construct WebSocket URL
export const WS_BASE_URL = (() => {
  if (!BACKEND_URL) {
    throw new Error('VITE_BACKEND_URL environment variable is required');
  }

  // Default to ws:// protocol
  let protocol = 'ws://';
  let host = BACKEND_URL;
  
  // Remove http:// or https:// if present
  if (host.startsWith('https://')) {
    protocol = 'wss://';  // Use secure WebSocket for HTTPS
    host = host.replace('https://', '');
  } else if (host.startsWith('http://')) {
    host = host.replace('http://', '');
  }
  
  // Construct the full WebSocket URL
  return `${protocol}${host}${BACKEND_PORT ? `:${BACKEND_PORT}` : ''}`;
})();

// Log the WebSocket URL for debugging
console.log('Constructed WS_BASE_URL:', WS_BASE_URL);
