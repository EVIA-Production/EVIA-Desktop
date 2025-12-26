/**
 * Subscription Monitor
 * 
 * Monitors subscription status periodically and triggers state re-evaluation
 * when status changes. This handles:
 * - Subscription expiring while app is running
 * - User subscribing in another window and wanting to refresh
 * 
 * Part of Stripe Integration - Agent 3: Desktop App Subscription Gating
 */

import { getCachedSubscriptionStatus, clearSubscriptionCache } from './subscription-service';
import type { HeaderController } from './header-controller';

let monitorInterval: NodeJS.Timeout | null = null;
let lastStatus: string | null = null;

// Check every 5 minutes (same as cache TTL)
const CHECK_INTERVAL = 5 * 60 * 1000;

/**
 * Start the subscription monitor
 * Checks subscription status periodically and triggers state changes
 * 
 * @param headerController - The HeaderController instance for state management
 */
export function startSubscriptionMonitor(headerController: HeaderController): void {
  // Don't start multiple monitors
  if (monitorInterval) {
    console.log('[SubscriptionMonitor] Already running, skipping start');
    return;
  }
  
  console.log('[SubscriptionMonitor] 🚀 Starting, checking every', CHECK_INTERVAL / 1000, 'seconds');
  
  monitorInterval = setInterval(async () => {
    try {
      // Force refresh subscription status
      clearSubscriptionCache();
      const status = await getCachedSubscriptionStatus(true);
      
      if (!status) {
        console.log('[SubscriptionMonitor] ⚠️ Could not fetch subscription status');
        return;
      }
      
      // Check if status changed from last known value
      if (lastStatus !== null && lastStatus !== status.status) {
        console.log('[SubscriptionMonitor] 🔄 Status changed:', lastStatus, '→', status.status);
        console.log('[SubscriptionMonitor] 🔄 is_active:', status.is_active);
        
        // Trigger state re-evaluation
        await headerController.reevaluateState();
      } else {
        console.log('[SubscriptionMonitor] ✅ Status unchanged:', status.status);
      }
      
      lastStatus = status.status;
    } catch (err) {
      console.error('[SubscriptionMonitor] ❌ Check failed:', err);
    }
  }, CHECK_INTERVAL);
  
  // Initial check after a short delay (give app time to initialize)
  setTimeout(async () => {
    try {
      const status = await getCachedSubscriptionStatus();
      if (status) {
        lastStatus = status.status;
        console.log('[SubscriptionMonitor] 📊 Initial status:', status.status, 'is_active:', status.is_active);
      }
    } catch (err) {
      console.warn('[SubscriptionMonitor] Initial check failed:', err);
    }
  }, 5000);
}

/**
 * Stop the subscription monitor
 * Call this when the app is quitting
 */
export function stopSubscriptionMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    lastStatus = null;
    console.log('[SubscriptionMonitor] 🛑 Stopped');
  }
}

/**
 * Force an immediate subscription check
 * Useful when user clicks "refresh" button
 * 
 * @param headerController - The HeaderController instance for state management
 */
export async function forceSubscriptionCheck(headerController: HeaderController): Promise<void> {
  console.log('[SubscriptionMonitor] 🔄 Forcing immediate check...');
  
  try {
    clearSubscriptionCache();
    const status = await getCachedSubscriptionStatus(true);
    
    if (!status) {
      console.log('[SubscriptionMonitor] ⚠️ Could not fetch subscription status');
      return;
    }
    
    console.log('[SubscriptionMonitor] 📊 Forced check result:', status.status, 'is_active:', status.is_active);
    
    // Update last known status
    lastStatus = status.status;
    
    // Trigger state re-evaluation
    await headerController.reevaluateState();
  } catch (err) {
    console.error('[SubscriptionMonitor] ❌ Forced check failed:', err);
  }
}

/**
 * Check if the monitor is currently running
 */
export function isMonitorRunning(): boolean {
  return monitorInterval !== null;
}

/**
 * Get the last known subscription status
 */
export function getLastKnownStatus(): string | null {
  return lastStatus;
}

