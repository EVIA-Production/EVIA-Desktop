/**
 * Subscription Service
 * 
 * Handles checking subscription status from the Taylos backend.
 * Used to gate features based on subscription state.
 * 
 * Part of Stripe Integration - Agent 3: Desktop App Subscription Gating
 */

import * as keytar from 'keytar';

// Get backend URL from environment or use production default
function getBackendUrl(): string {
  const env = process.env.EVIA_BACKEND_URL || process.env.API_BASE_URL;
  if (env && env.trim()) return String(env).replace(/\/$/, '');
  
  // Default to production backend
  return process.env.NODE_ENV === 'development' 
    ? 'http://localhost:8000'
    : 'https://api.taylos.ai';
}

/**
 * Subscription status returned from backend
 */
export interface SubscriptionStatus {
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
  is_active: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  plan_type: 'monthly' | 'annual' | null;
}

/**
 * Cache for subscription status to avoid repeated API calls
 */
let cachedStatus: SubscriptionStatus | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches subscription status from backend
 * @returns SubscriptionStatus or null if request fails
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus | null> {
  const BACKEND_URL = getBackendUrl();
  
  try {
    // Get stored auth token - using 'token' key to match existing codebase
    const token = await keytar.getPassword('taylos', 'token');
    
    if (!token) {
      console.log('[SubscriptionService] No auth token found');
      return null;
    }
    
    console.log('[SubscriptionService] Fetching subscription status from:', `${BACKEND_URL}/stripe/subscription-status`);
    
    const response = await fetch(`${BACKEND_URL}/stripe/subscription-status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.error('[SubscriptionService] API error:', response.status, response.statusText);
      
      // If 401/403, token might be invalid - treat as no subscription
      if (response.status === 401 || response.status === 403) {
        console.log('[SubscriptionService] Auth error - returning no subscription');
        return {
          status: 'none',
          is_active: false,
          trial_ends_at: null,
          current_period_end: null,
          cancel_at_period_end: false,
          plan_type: null
        };
      }
      
      // For 404, the endpoint might not exist yet (backend not deployed)
      if (response.status === 404) {
        console.warn('[SubscriptionService] Endpoint not found - backend may need deployment');
        // Return mock active subscription for development
        if (process.env.NODE_ENV === 'development') {
          console.log('[SubscriptionService] DEV MODE: Returning mock active subscription');
          return {
            status: 'active',
            is_active: true,
            trial_ends_at: null,
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            cancel_at_period_end: false,
            plan_type: 'monthly'
          };
        }
        // In production, treat 404 as no subscription for safety
        return null;
      }
      
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json() as SubscriptionStatus;
    console.log('[SubscriptionService] Subscription status:', data.status, 'is_active:', data.is_active);
    
    return data;
  } catch (err) {
    console.error('[SubscriptionService] Failed to fetch subscription status:', err);
    
    // Network error handling - in development, return mock for easier testing
    if (process.env.NODE_ENV === 'development') {
      console.log('[SubscriptionService] DEV MODE (network error): Returning mock active subscription');
      return {
        status: 'active',
        is_active: true,
        trial_ends_at: null,
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        cancel_at_period_end: false,
        plan_type: 'monthly'
      };
    }
    
    return null;
  }
}

/**
 * Checks if user has active subscription access
 * Active = trialing OR active status
 */
export async function hasActiveSubscription(): Promise<boolean> {
  const status = await getCachedSubscriptionStatus();
  return status?.is_active ?? false;
}

/**
 * Get cached subscription status to avoid repeated API calls
 * Refresh every 5 minutes or on demand
 */
export async function getCachedSubscriptionStatus(forceRefresh = false): Promise<SubscriptionStatus | null> {
  const now = Date.now();
  
  if (!forceRefresh && cachedStatus && (now - cacheTimestamp) < CACHE_TTL) {
    console.log('[SubscriptionService] Using cached subscription status');
    return cachedStatus;
  }
  
  console.log('[SubscriptionService] Fetching fresh subscription status');
  cachedStatus = await getSubscriptionStatus();
  cacheTimestamp = now;
  
  return cachedStatus;
}

/**
 * Clear subscription cache
 * Call this when auth state changes (login/logout)
 */
export function clearSubscriptionCache(): void {
  console.log('[SubscriptionService] Clearing subscription cache');
  cachedStatus = null;
  cacheTimestamp = 0;
}

/**
 * Get human-readable subscription status message
 */
export function getSubscriptionStatusMessage(status: SubscriptionStatus | null): string {
  if (!status) {
    return 'Unable to verify subscription';
  }
  
  switch (status.status) {
    case 'trialing':
      if (status.trial_ends_at) {
        const trialEnd = new Date(status.trial_ends_at);
        const daysLeft = Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return `Trial: ${daysLeft} days remaining`;
      }
      return 'Trial active';
    case 'active':
      return 'Subscription active';
    case 'past_due':
      return 'Payment past due';
    case 'canceled':
      return 'Subscription canceled';
    case 'unpaid':
      return 'Payment required';
    case 'none':
    default:
      return 'No active subscription';
  }
}

