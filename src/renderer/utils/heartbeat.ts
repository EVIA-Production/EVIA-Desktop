/**
 * Desktop Heartbeat Utility
 * 
 * Writes a heartbeat timestamp to localStorage every 2 seconds
 * to let the web frontend know that Desktop is running.
 * 
 * This enables the "EVIA Desktop Open" status in the web UI.
 */

export function startDesktopHeartbeat() {
  // Write initial heartbeat
  updateHeartbeat();

  // Update every 2 seconds
  const interval = setInterval(() => {
    updateHeartbeat();
  }, 2000);

  console.log('[Heartbeat] ✅ Started Desktop heartbeat');

  // Return cleanup function
  return () => {
    clearInterval(interval);
    console.log('[Heartbeat] ⏹️ Stopped Desktop heartbeat');
  };
}

function updateHeartbeat() {
  try {
    localStorage.setItem('evia_desktop_heartbeat', Date.now().toString());
  } catch (error) {
    console.error('[Heartbeat] ❌ Failed to update heartbeat:', error);
  }
}

