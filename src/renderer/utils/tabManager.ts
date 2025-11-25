/**
 * Tab Management Utility
 * 
 * Reuses existing EVIA web tabs instead of opening new ones.
 * 
 * Strategy:
 * 1. Write navigation request to localStorage with timestamp
 * 2. Wait 300ms for existing tab to respond (by clearing the flag)
 * 3. If no response, open new tab
 * 
 * Frontend must implement storage event listener to handle requests.
 */

const NAV_REQUEST_KEY = 'evia_nav_request';
const NAV_RESPONSE_KEY = 'evia_nav_response';

interface NavigationRequest {
  url: string;
  timestamp: number;
  id: string;
}

/**
 * Opens URL in existing tab if possible, otherwise opens new tab
 */
export async function openInExistingOrNewTab(url: string): Promise<void> {
  const requestId = Date.now().toString();
  
  console.log('[TabManager] 📋 Requesting navigation to:', url);
  
  // Write navigation request to localStorage
  const request: NavigationRequest = {
    url,
    timestamp: Date.now(),
    id: requestId,
  };
  
  try {
    localStorage.setItem(NAV_REQUEST_KEY, JSON.stringify(request));
    console.log('[TabManager] ✅ Navigation request written to localStorage');
    
    // Wait 300ms for existing tab to respond
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Check if tab responded
    const response = localStorage.getItem(NAV_RESPONSE_KEY);
    if (response) {
      const responseData = JSON.parse(response);
      if (responseData.requestId === requestId) {
        console.log('[TabManager] ✅ Existing tab navigated successfully');
        // Clear response
        localStorage.removeItem(NAV_RESPONSE_KEY);
        return;
      }
    }
    
    // No response, open new tab
    console.log('[TabManager] 📂 No existing tab found, opening new one');
    const eviaWindows = (window as any).evia?.windows;
    if (eviaWindows?.openExternal) {
      eviaWindows.openExternal(url);
    }
  } catch (error) {
    console.error('[TabManager] ❌ Error managing tab:', error);
    // Fallback: just open new tab
    const eviaWindows = (window as any).evia?.windows;
    if (eviaWindows?.openExternal) {
      eviaWindows.openExternal(url);
    }
  } finally {
    // Clean up request
    try {
      localStorage.removeItem(NAV_REQUEST_KEY);
    } catch {}
  }
}

