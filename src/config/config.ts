
// Get environment variables with fallback to your backend URL
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io';
export const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT;

// Debug logs
console.log('Environment Variables:', {
  BACKEND_URL,
  BACKEND_PORT,
  'import.meta.env': import.meta.env
});

// Safely construct API URL with defensive checks
export const API_BASE_URL = (() => {
  // If URL already has a protocol, use it as is
  if (BACKEND_URL?.startsWith('https://') || BACKEND_URL?.startsWith('http://')) {
    // Check if URL already contains a port
    if (BACKEND_URL.includes(':') && BACKEND_URL.split(':').length > 2) {
      return BACKEND_URL; // URL already has port, use as is
    }
    // URL has protocol but no port, add port if specified
    return `${BACKEND_URL}${BACKEND_PORT ? `:${BACKEND_PORT}` : ''}`;
  }
  
  // No protocol, assume http:// and add port if specified
  return `http://${BACKEND_URL}${BACKEND_PORT ? `:${BACKEND_PORT}` : ''}`;
})();

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
  let port = BACKEND_PORT ? `:${BACKEND_PORT}` : '';
  
  // Remove http:// or https:// if present
  if (host.startsWith('https://')) {
    protocol = 'wss://';  // Use secure WebSocket for HTTPS
    host = host.replace('https://', '');
  } else if (host.startsWith('http://')) {
    host = host.replace('http://', '');
  }
  
  // Check if host already includes a port (e.g., localhost:8000)
  if (host.includes(':')) {
    // If it has a port, don't append another
    port = '';
  }
  
  // Add default port for localhost if no port is set
  if (!port && (host === 'localhost' || host.startsWith('127.0.0.1') || host.startsWith('0.0.0.0'))) {
    port = ':8000';
  }
  
  // Construct the full WebSocket URL
  return `${protocol}${host}${port}`;
})();

// Log the WebSocket URL for debugging
console.log('Constructed WS_BASE_URL:', WS_BASE_URL);
