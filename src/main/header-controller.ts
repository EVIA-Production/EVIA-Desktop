/**
 * HeaderController - State machine for auth, permissions, and header management
 * 
 * Orchestrates the complete user onboarding flow:
 * 1. Check auth token (keytar)
 * 2. Show welcome window if no token
 * 3. Handle login callback (evia://auth-callback)
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
  createHeaderWindow,
  getHeaderWindow,
} from './overlay-windows';
import path from 'path';
import fs from 'fs';

type AppState = 'welcome' | 'login' | 'permissions' | 'ready';

interface StateData {
  hasToken: boolean;
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
   */
  private async getStateData(): Promise<StateData> {
    const token = await keytar.getPassword('evia', 'token');
    const hasToken = !!token;
    
    let micPermission = 'unknown';
    let screenPermission = 'unknown';
    
    if (process.platform === 'darwin') {
      try {
        micPermission = systemPreferences.getMediaAccessStatus('microphone');
        screenPermission = systemPreferences.getMediaAccessStatus('screen');
      } catch (err) {
        console.warn('[HeaderController] Failed to get permission status:', err);
      }
    }
    
    return {
      hasToken,
      micPermission,
      screenPermission,
      permissionsCompleted: this.permissionsCompleted,
    };
  }

  /**
   * Determine next state based on current data
   */
  private determineNextState(data: StateData): AppState {
    // If no token, show welcome
    if (!data.hasToken) {
      return 'welcome';
    }
    
    // Has token, check permissions
    const micGranted = data.micPermission === 'granted';
    const screenGranted = data.screenPermission === 'granted';
    
    // If permissions not completed or not granted, show permissions window
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
    
    // Close all windows first
    closeWelcomeWindow();
    closePermissionWindow();
    
    this.currentState = newState;
    
    // Open appropriate window for new state
    switch (newState) {
      case 'welcome':
        createWelcomeWindow();
        break;
        
      case 'permissions':
        createPermissionWindow();
        break;
        
      case 'ready':
        // Check if header already exists
        const existingHeader = getHeaderWindow();
        if (!existingHeader) {
          createHeaderWindow();
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
   * Handle auth callback from web (evia://auth-callback?token=...)
   * Called from main.ts when deep link received
   */
  public async handleAuthCallback(token: string) {
    console.log('[HeaderController] 🔑 Auth callback received, storing token');
    
    try {
      await keytar.setPassword('evia', 'token', token);
      console.log('[HeaderController] ✅ Token stored in keytar');
      
      // Close welcome window if open
      closeWelcomeWindow();
      
      // Re-evaluate state (should transition to permissions or ready)
      const data = await this.getStateData();
      const nextState = this.determineNextState(data);
      
      await this.transitionTo(nextState);
    } catch (err) {
      console.error('[HeaderController] ❌ Failed to store token:', err);
      throw err;
    }
  }

  /**
   * Handle auth error from web (evia://auth-callback?error=...)
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
      await keytar.deletePassword('evia', 'token');
      this.permissionsCompleted = false;
      this.savePersistedState();
      
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
      await keytar.deletePassword('evia', 'token');
      this.permissionsCompleted = false;
      this.savePersistedState();
      
      await this.initialize();
    } catch (err) {
      console.error('[HeaderController] ❌ Reset failed:', err);
    }
  }
}

// Singleton instance
export const headerController = new HeaderController();

