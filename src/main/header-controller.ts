/**
 * HeaderController - State machine for auth, permissions, and header management
 * 
 * Orchestrates the complete user onboarding flow:
 * 1. Check auth token (keytar)
 * 2. Show welcome window if no token
 * 3. Handle login callback (taylos://auth-callback)
 * 4. Check permissions after login
 * 5. Show permission window if needed
 * 6. Show main header when ready
 * 
 * States: welcome → login → permissions → ready
 */

import { app, systemPreferences } from 'electron';
import * as keytar from 'keytar';
import { 
  createWelcomeWindow, 
  closeWelcomeWindow,
  createPermissionWindow,
  closePermissionWindow,
  createSubscriptionWindow,
  closeSubscriptionWindow,
  createHeaderWindow,
  getHeaderWindow,
} from './overlay-windows';
import path from 'path';
import fs from 'fs';
import { 
  hasActiveSubscription, 
  clearSubscriptionCache,
  getCachedSubscriptionStatus 
} from './subscription-service';

type AppState = 'welcome' | 'login' | 'permissions' | 'subscription_required' | 'ready';

interface StateData {
  hasToken: boolean;
  hasSubscription: boolean;
  micPermission: string;
  screenPermission: string;
  permissionsCompleted: boolean;
}

export class HeaderController {
  private currentState: AppState = 'welcome';
  private stateFilePath: string;
  private permissionsCompleted: boolean = false;

  constructor() {
    this.stateFilePath = path.join(app.getPath('userData'), 'auth-state.json');
    this.loadPersistedState();
    console.log('[HeaderController] Initialized, state file:', this.stateFilePath);
  }

  /**
   * Load persisted state from disk (permissions completed flag)
   */
  private loadPersistedState() {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = fs.readFileSync(this.stateFilePath, 'utf8');
        const state = JSON.parse(data);
        this.permissionsCompleted = state.permissionsCompleted || false;
        console.log('[HeaderController] Loaded persisted state:', state);
      }
    } catch (err) {
      console.warn('[HeaderController] Failed to load persisted state:', err);
    }
  }

  /**
   * Save permissions completed flag to disk
   */
  private savePersistedState() {
    try {
      const state = { permissionsCompleted: this.permissionsCompleted };
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8');
      console.log('[HeaderController] Saved persisted state:', state);
    } catch (err) {
      console.error('[HeaderController] Failed to save persisted state:', err);
    }
  }

  /**
   * Get current state data for decision making
   * 🔐 CRITICAL: Validates token exists AND is valid (not expired)
   * 💳 Also checks subscription status for feature gating
   */
  private async getStateData(): Promise<StateData> {
    const token = await keytar.getPassword('taylos', 'token');
    let hasToken = !!token;
    
    // FIX: Validate token is not expired
    if (hasToken && token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          const exp = payload.exp;
          
          if (exp && typeof exp === 'number') {
            const now = Math.floor(Date.now() / 1000);
            if (exp <= now) {
              console.log('[HeaderController] ⚠️ Token expired, removing and treating as no token');
              await keytar.deletePassword('taylos', 'token');
              hasToken = false; // Treat expired token as no token
            }
          }
        }
      } catch (err) {
        console.warn('[HeaderController] Failed to validate token, removing:', err);
        await keytar.deletePassword('taylos', 'token');
        hasToken = false; // Treat invalid token as no token
      }
    }
    
    // 💳 Check subscription status (only if authenticated)
    let hasSubscription = false;
    if (hasToken) {
      try {
        hasSubscription = await hasActiveSubscription();
        console.log('[HeaderController] 💳 Subscription check:', hasSubscription ? 'ACTIVE' : 'INACTIVE');
      } catch (err) {
        console.warn('[HeaderController] Failed to check subscription status:', err);
        // On error, we'll treat as no subscription for safety
        hasSubscription = false;
      }
    }
    
    let micPermission = 'unknown';
    let screenPermission = 'unknown';
    
    if (process.platform === 'darwin') {
      try {
        // FIX: Force fresh permission check (bypass macOS cache)
        micPermission = systemPreferences.getMediaAccessStatus('microphone');
        screenPermission = systemPreferences.getMediaAccessStatus('screen');
        
        console.log('[HeaderController] 🔍 Permission check - Mic:', micPermission, '| Screen:', screenPermission, '| Completed flag:', this.permissionsCompleted);
        
        // FIX: Only reset permissionsCompleted if NEITHER permission is granted
        // This prevents false resets when macOS cache is stale but permissions are actually granted
        // We trust the user clicked "Continue" in permission window, so only reset if both are lost
        if (this.permissionsCompleted) {
          const bothLost = micPermission !== 'granted' && screenPermission !== 'granted';
          const oneLost = micPermission !== 'granted' || screenPermission !== 'granted';
          
          if (bothLost) {
            // Both permissions lost - definitely reset
            console.log('[HeaderController] ⚠️ BOTH permissions lost after completion - resetting flag');
            this.permissionsCompleted = false;
            this.savePersistedState();
          } else if (oneLost) {
            // Only one lost - might be cache issue, don't reset yet
            console.log('[HeaderController] ⚠️ One permission appears lost, but might be cache issue');
            console.log('[HeaderController] Mic:', micPermission, '| Screen:', screenPermission);
            console.log('[HeaderController] Keeping permissionsCompleted=true, will show permission window if needed');
          }
        }
      } catch (err) {
        console.warn('[HeaderController] Failed to get permission status:', err);
      }
    }
    
    return {
      hasToken,
      hasSubscription,
      micPermission,
      screenPermission,
      permissionsCompleted: this.permissionsCompleted,
    };
  }

  /**
   * Determine next state based on current data
   * Order: auth → subscription → permissions → ready
   */
  private determineNextState(data: StateData): AppState {
    // UI IMPROVEMENT: ALWAYS check token, even in dev mode
    // If no token, show welcome (no flicker)
    if (!data.hasToken) {
      console.log('[HeaderController] 🔐 No token found - showing welcome screen');
      return 'welcome';
    }
    
    // 💳 SUBSCRIPTION CHECK: After auth, before permissions
    // User must have active subscription to use EVIA
    if (!data.hasSubscription) {
      console.log('[HeaderController] 💳 No active subscription - showing subscription required screen');
      return 'subscription_required';
    }
    
    // DEV MODE: Skip ONLY permission checks in development
    // Still validate token and subscription above
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      console.log('[HeaderController] 🔧 DEV MODE: Skipping permission checks, going to ready');
      return 'ready';
    }
    
    // Has token AND subscription, check permissions (production only)
    const micGranted = data.micPermission === 'granted';
    const screenGranted = data.screenPermission === 'granted';
    
    // WINDOWS FIX (2025-12-05): Skip permission window on Windows
    // Windows doesn't use macOS-style system permissions for microphone/screen
    // WASAPI and desktop capture work without prompting for permission
    if (process.platform === 'win32') {
      console.log('[HeaderController] 🪟 Windows detected - skipping permission checks');
      return 'ready';
    }
    
    // If permissions not completed or not granted, show permissions window (macOS only)
    if (!data.permissionsCompleted || !micGranted || !screenGranted) {
      return 'permissions';
    }
    
    // All good, show main header
    return 'ready';
  }

  /**
   * Transition to a new state
   */
  private async transitionTo(newState: AppState) {
    console.log(`[HeaderController] State transition: ${this.currentState} → ${newState}`);
    
    // Close all windows first (not all in Windows)
    if (process.platform == "darwin"){
      closeWelcomeWindow();
    }
    closePermissionWindow();
    closeSubscriptionWindow();
    
    // CRITICAL: Close header window if transitioning to welcome, permissions, or subscription_required
    if (newState === 'welcome' || newState === 'permissions' || newState === 'subscription_required') {
      const header = getHeaderWindow();
      if (header) {
        console.log('[HeaderController] Closing main header for state:', newState);
        header.close();
      }
    }
    
    this.currentState = newState;
    
    // Open appropriate window for new state
    switch (newState) {
      case 'welcome':
        createWelcomeWindow();
        break;
        
      case 'subscription_required':
        console.log('[HeaderController] 💳 Showing subscription required window');
        createSubscriptionWindow();
        break;
        
      case 'permissions':
        createPermissionWindow();
        break;
        
      case 'ready':
        // CRITICAL: Validate auth before showing header
        console.log('[HeaderController] 🔐 Validating auth before showing header...');
        const isValid = await this.validateAuthentication();
        
        if (!isValid) {
          console.log('[HeaderController] ❌ Auth validation failed - cannot show header');
          console.log('[HeaderController] ⚠️ Redirecting to welcome instead');
          // validateAuthentication already handles transition
          return;
        }
        
        console.log('[HeaderController] ✅ Auth valid - proceeding to show header');
        
        // Check if header already exists
        const existingHeader = getHeaderWindow();
        if (!existingHeader) {
          console.log('[HeaderController] 🔧 Creating header window...');
          createHeaderWindow();
          console.log('[HeaderController] ✅ createHeaderWindow() returned');
        } else {
          console.log('[HeaderController] ℹ️ Header already exists, not creating');
        }
        break;
        
      case 'login':
        // Login happens in browser, no window needed
        console.log('[HeaderController] Login state - waiting for callback');
        break;
    }
  }

  /**
   * Initialize on app launch - determine and show correct window
   */
  public async initialize() {
    console.log('[HeaderController] 🚀 Initializing...');
    
    const data = await this.getStateData();
    const nextState = this.determineNextState(data);
    
    console.log('[HeaderController] Initial state data:', data);
    console.log('[HeaderController] Determined state:', nextState);
    
    await this.transitionTo(nextState);
  }

  /**
   * Handle auth callback from web (taylos://auth-callback?token=...)
   * Called from main.ts when deep link received
   * Now also handles subscription state after authentication
   */
  public async handleAuthCallback(token: string) {
    console.log('[HeaderController] 🔑 Auth callback received, storing token');
    
    try {
      await keytar.setPassword('taylos', 'token', token);
      console.log('[HeaderController] ✅ Token stored in keytar');
      
      // 💳 Clear subscription cache to force fresh check with new token
      clearSubscriptionCache();
      console.log('[HeaderController] 💳 Subscription cache cleared');
      
      // Close welcome window if open (only on Mac)
      if (process.platform == "darwin"){
        closeWelcomeWindow();
      }
      
      // Re-evaluate state (should transition to subscription_required, permissions, or ready)
      const data = await this.getStateData();
      const nextState = this.determineNextState(data);
      
      console.log('[HeaderController] Next state after auth:', nextState);
      await this.transitionTo(nextState);
    } catch (err) {
      console.error('[HeaderController] ❌ Failed to store token:', err);
      throw err;
    }
  }

  /**
   * Handle auth error from web (taylos://auth-callback?error=...)
   * Called from main.ts when deep link has error
   */
  public async handleAuthError(error: string) {
    console.error('[HeaderController] ❌ Auth error received:', error);
    
    // Stay in welcome state
    await this.transitionTo('welcome');
  }

  /**
   * Handle logout - delete token and return to welcome
   */
  public async handleLogout() {
    console.log('[HeaderController] 🚪 Logging out...');
    
    try {
      await keytar.deletePassword('taylos', 'token');
      this.permissionsCompleted = false;
      this.savePersistedState();
      
      // 💳 Clear subscription cache on logout
      clearSubscriptionCache();
      console.log('[HeaderController] 💳 Subscription cache cleared');
      
      console.log('[HeaderController] ✅ Logged out, returning to welcome');
      
      // Close all windows and show welcome
      await this.transitionTo('welcome');
    } catch (err) {
      console.error('[HeaderController] ❌ Logout failed:', err);
      throw err;
    }
  }

  /**
   * Mark permissions as completed
   * Called when user clicks "Continue" in permission window
   */
  public async markPermissionsComplete() {
    console.log('[HeaderController] ✅ Permissions marked as complete');
    
    this.permissionsCompleted = true;
    this.savePersistedState();
    
    // Transition to ready state
    await this.transitionTo('ready');
  }

  /**
   * Check permissions and re-evaluate state
   * Called periodically or when app becomes active
   */
  public async checkPermissions() {
    const data = await this.getStateData();
    const nextState = this.determineNextState(data);
    
    // Only transition if state changed
    if (nextState !== this.currentState) {
      console.log('[HeaderController] Permission state changed, transitioning');
      await this.transitionTo(nextState);
    }
  }

  /**
   * 💳 Re-evaluates current state and transitions if needed
   * Called after subscription refresh or other state changes
   * Used by subscription:refresh IPC handler
   */
  public async reevaluateState(): Promise<void> {
    console.log('[HeaderController] 🔄 Re-evaluating state...');
    
    // Clear subscription cache to force fresh check
    clearSubscriptionCache();
    
    const data = await this.getStateData();
    const nextState = this.determineNextState(data);
    
    console.log('[HeaderController] Current state:', this.currentState, 'Next state:', nextState);
    
    if (nextState !== this.currentState) {
      console.log('[HeaderController] State changed, transitioning:', this.currentState, '→', nextState);
      await this.transitionTo(nextState);
    } else {
      console.log('[HeaderController] State unchanged, staying in:', this.currentState);
    }
  }

  /**
   * 🔧 UI IMPROVEMENT: Validate authentication status
   * Checks if token exists AND is not expired
   * If no token or expired, transitions to welcome state
   * Returns true if authenticated and valid, false if not
   */
  public async validateAuthentication(): Promise<boolean> {
    console.log('[HeaderController] 🔐 Validating authentication...');
    
    const token = await keytar.getPassword('taylos', 'token');
    
    if (!token) {
      console.log('[HeaderController] ❌ No token found');
      if (this.currentState === 'ready') {
        console.log('[HeaderController] ⚠️ Redirecting to welcome (no token)');
        await this.transitionTo('welcome');
      }
      return false;
    }
    
    // Check if JWT is expired (JWT format: header.payload.signature)
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        console.log('[HeaderController] ❌ Invalid token format');
        if (this.currentState === 'ready') {
          console.log('[HeaderController] ⚠️ Redirecting to welcome (invalid format)');
          await keytar.deletePassword('taylos', 'token'); // Remove invalid token
          await this.transitionTo('welcome');
        }
        return false;
      }
      
      // Decode base64url payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const exp = payload.exp; // Unix timestamp in seconds
      
      if (exp && typeof exp === 'number') {
        const now = Math.floor(Date.now() / 1000); // Current time in seconds
        const timeUntilExpiry = exp - now;
        
        if (timeUntilExpiry <= 0) {
          console.log('[HeaderController] ❌ Token expired', -timeUntilExpiry, 'seconds ago');
          if (this.currentState === 'ready') {
            console.log('[HeaderController] ⚠️ Redirecting to welcome (expired token)');
            await keytar.deletePassword('taylos', 'token'); // Remove expired token
            await this.transitionTo('welcome');
          }
          return false;
        }
        
        if (timeUntilExpiry < 60) {
          console.log('[HeaderController] ⚠️ Token expires in', timeUntilExpiry, 'seconds - refresh recommended');
        } else {
          console.log('[HeaderController] ✅ Token valid, expires in', Math.floor(timeUntilExpiry / 60), 'minutes');
        }
      } else {
        // No expiry claim - assume valid (some tokens don't expire)
        console.log('[HeaderController] ⚠️ Token has no exp claim - assuming valid');
      }
      
      console.log('[HeaderController] ✅ Authentication valid');
      return true;
      
    } catch (decodeError) {
      console.error('[HeaderController] ❌ Failed to decode JWT:', decodeError);
      if (this.currentState === 'ready') {
        console.log('[HeaderController] ⚠️ Redirecting to welcome (decode error)');
        await keytar.deletePassword('taylos', 'token'); // Remove corrupted token
        await this.transitionTo('welcome');
      }
      return false;
    }
  }

  /**
   * 🔥 FIX: Force re-check permissions AND auth when app activated
   * Handles macOS permission cache issue after relaunch
   * Also validates JWT to prevent showing header with invalid token
   * Uses aggressive polling to detect cache updates (up to 5 seconds)
   */
  public async onAppActivated() {
    console.log('[HeaderController] 🔄 App activated, validating auth and permissions...');
    
    // CRITICAL: Validate auth first (before permission checks)
    if (this.currentState === 'ready') {
      console.log('[HeaderController] 🔐 Checking if JWT is still valid...');
      const isValid = await this.validateAuthentication();
      
      if (!isValid) {
        console.log('[HeaderController] ❌ JWT invalid or expired - header will be closed');
        console.log('[HeaderController] ⚠️ User will see welcome/login screen');
        // validateAuthentication already handles transition
        return;
      }
      
      console.log('[HeaderController] ✅ JWT valid - continuing with permission check');
    }
    
    // Get initial permission status
    const initialMic = systemPreferences.getMediaAccessStatus('microphone');
    const initialScreen = systemPreferences.getMediaAccessStatus('screen');
    
    console.log('[HeaderController] 📸 Initial permissions - Mic:', initialMic, 'Screen:', initialScreen);
    
    // If both already granted, no need to poll
    if (initialMic === 'granted' && initialScreen === 'granted') {
      console.log('[HeaderController] ✅ Both permissions already granted, skipping poll');
      await this.checkPermissions();
      return;
    }
    
    // AGGRESSIVE POLLING: Check every 500ms for up to 5 seconds
    // macOS cache can take 1-3 seconds to refresh after relaunch
    // Wait for STABLE state (same value 2x in a row) to avoid transient cache issues
    console.log('[HeaderController] 🔄 Starting aggressive permission polling (every 500ms, max 5s)...');
    console.log('[HeaderController] ℹ️  Waiting for STABLE cache state (same value 2x in a row)');
    
    const maxAttempts = 10; // 10 attempts × 500ms = 5 seconds max
    let attempt = 0;
    let cacheRefreshed = false;
    let lastMic = initialMic;
    let lastScreen = initialScreen;
    let stableCount = 0; // Count consecutive stable reads
    
    while (attempt < maxAttempts) {
      attempt++;
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const currentMic = systemPreferences.getMediaAccessStatus('microphone');
      const currentScreen = systemPreferences.getMediaAccessStatus('screen');
      
      console.log(`[HeaderController] 🔍 Poll attempt ${attempt}/${maxAttempts} - Mic: ${currentMic}, Screen: ${currentScreen}`);
      
      // Check if values are stable (same as last check)
      if (currentMic === lastMic && currentScreen === lastScreen) {
        stableCount++;
        console.log(`[HeaderController] ✅ Stable state (${stableCount}/2) - Mic: ${currentMic}, Screen: ${currentScreen}`);
        
        // If stable for 2 consecutive checks AND changed from initial, we're done
        if (stableCount >= 2 && (currentMic !== initialMic || currentScreen !== initialScreen)) {
          console.log('[HeaderController] ✅ STABLE PERMISSION CHANGE DETECTED!');
          console.log(`[HeaderController]    Mic: ${initialMic} → ${currentMic}`);
          console.log(`[HeaderController]    Screen: ${initialScreen} → ${currentScreen}`);
          cacheRefreshed = true;
          break;
        }
        
        // If stable AND both granted, we're done
        if (stableCount >= 2 && currentMic === 'granted' && currentScreen === 'granted') {
          console.log('[HeaderController] ✅ Both permissions granted (stable)!');
          cacheRefreshed = true;
          break;
        }
      } else {
        // Values changed, reset stable count
        stableCount = 0;
        console.log(`[HeaderController] 🔄 Cache still changing - Mic: ${lastMic}→${currentMic}, Screen: ${lastScreen}→${currentScreen}`);
      }
      
      lastMic = currentMic;
      lastScreen = currentScreen;
    }
    
    if (!cacheRefreshed) {
      console.log('[HeaderController] ⚠️ No permission changes detected after 5 seconds');
      console.log('[HeaderController] ⚠️ macOS cache might not have refreshed yet');
      console.log('[HeaderController] ℹ️  Permission window will continue polling every 200ms');
    } else {
      console.log('[HeaderController] 🎉 Cache refresh successful!');
    }
    
    // Final permission check
    await this.checkPermissions();
  }

  /**
   * 🔥 FIX: Force show permission window (for debugging/review)
   * Allows users to re-check permissions even after they're granted
   */
  public async showPermissionWindow() {
    console.log('[HeaderController] 🔐 Force showing permission window');
    
    // Close all windows first
    closeWelcomeWindow();
    const header = getHeaderWindow();
    if (header) {
      console.log('[HeaderController] Closing main header to show permissions');
      header.close();
    }
    
    // Open permission window (even if permissionsCompleted=true)
    await this.transitionTo('permissions');
  }

  /**
   * Get current state (for debugging/logging)
   */
  public getCurrentState(): AppState {
    return this.currentState;
  }

  /**
   * Reset all state (for testing/debugging)
   */
  public async reset() {
    console.log('[HeaderController] 🔄 Resetting all state...');
    
    try {
      await keytar.deletePassword('taylos', 'token');
      this.permissionsCompleted = false;
      this.savePersistedState();
      
      // 💳 Clear subscription cache
      clearSubscriptionCache();
      
      await this.initialize();
    } catch (err) {
      console.error('[HeaderController] ❌ Reset failed:', err);
    }
  }
}

// Singleton instance
export const headerController = new HeaderController();

