/**
 * PermissionHeader - Permission setup screen for microphone and system audio
 * 
 * Shows after successful login, before main header appears.
 * Guides user through granting macOS permissions:
 * 1. Microphone access (for user audio)
 * 2. Screen Recording access (for system audio capture)
 * 
 * Based on: Glass/src/ui/app/PermissionHeader.js
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './overlay-glass.css';

interface PermissionHeaderProps {
  onContinue: () => void;
  onClose: () => void;
}

interface PermissionStatus {
  microphone: 'granted' | 'denied' | 'not-determined' | 'unknown';
  screen: 'granted' | 'denied' | 'not-determined' | 'unknown';
}

const PermissionHeader: React.FC<PermissionHeaderProps> = ({ onContinue, onClose }) => {
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: 'unknown',
    screen: 'unknown',
  });
  const [isChecking, setIsChecking] = useState(false);
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const [isRequestingScreen, setIsRequestingScreen] = useState(false); // 🔄 Match mic button animation
  const checkingRef = useRef(false);

  /**
   * Check permission status
   */
  const checkPermissions = useCallback(async () => {
  if (!(window as any).evia?.permissions || checkingRef.current) return;
    
    checkingRef.current = true;
    setIsChecking(true);
    
    try {
  const result = await (window as any).evia.permissions.check();
      console.log('[Permissions] ✅ Check result - Mic:', result.microphone, 'Screen:', result.screen);
      
      setPermissions({
        microphone: result.microphone as any,
        screen: result.screen as any,
      });

      // Auto-continue if all permissions granted (INSTANT - no delay)
      if (result.microphone === 'granted' && result.screen === 'granted') {
        console.log('[PermissionHeader] ✅ All permissions granted, auto-continuing INSTANTLY...');
        // Instant transition - no window, no button, no countdown
        setTimeout(() => {
          onContinue();
        }, 200); // Minimal delay for visual feedback
      }
    } catch (error) {
      console.error('[PermissionHeader] ❌ Error checking permissions:', error);
    } finally {
      setIsChecking(false);
      checkingRef.current = false;
    }
  }, [onContinue]);

  /**
   * Request microphone permission (Glass pattern)
   */
  const handleMicrophoneClick = async () => {
  if (!(window as any).evia?.permissions || permissions.microphone === 'granted' || isRequestingMic) return;
    
    console.log('[PermissionHeader] 🎤 Checking microphone permission...');
    setIsRequestingMic(true);
    
    try {
      // First, check current status (Glass pattern)
  const result = await (window as any).evia.permissions.check();
      console.log('[PermissionHeader] Current permission status:', result.microphone);
      
      if (result.microphone === 'granted') {
        setPermissions(prev => ({ ...prev, microphone: 'granted' }));
        console.log('[PermissionHeader] ✅ Microphone already granted');
        return;
      }
      
      // Only request if not determined/denied/unknown/restricted
      if (['not-determined', 'denied', 'unknown', 'restricted'].includes(result.microphone)) {
        console.log('[PermissionHeader] 📢 Requesting microphone permission...');
  const res = await (window as any).evia.permissions.requestMicrophone();
        
        if (res.status === 'granted') {
          setPermissions(prev => ({ ...prev, microphone: 'granted' }));
          console.log('[PermissionHeader] ✅ Microphone permission granted');
        }
      }
      
      // Re-check permissions after delay
      setTimeout(() => checkPermissions(), 500);
    } catch (error) {
      console.error('[PermissionHeader] ❌ Error requesting microphone permission:', error);
    } finally {
      setIsRequestingMic(false);
    }
  };

  /**
   * Open System Preferences for screen recording permission
   */
  const handleScreenClick = async () => {
  if (!(window as any).evia?.permissions || permissions.screen === 'granted' || isRequestingScreen) return;
    
    console.log('[PermissionHeader] 🖥️  Opening System Preferences for screen recording...');
    setIsRequestingScreen(true); // 🔄 Match mic button animation
    
    try {
  await (window as any).evia.permissions.openSystemPreferences('screen-recording');
      console.log('[PermissionHeader] ✅ System Preferences opened');
    } catch (error) {
      console.error('[PermissionHeader] ❌ Error opening System Preferences:', error);
    } finally {
      // Keep loading state briefly, then let polling detect the change
      setTimeout(() => setIsRequestingScreen(false), 1000);
    }
  };

  // Note: handleContinue removed - auto-continue happens in checkPermissions

  // 🔥 v1.0.0 LOGIC: Check permissions immediately and poll every 1 second
  // This is the PROVEN working logic from the release that works
  useEffect(() => {
    console.log('[PermissionHeader] 🚀 Component mounted, starting permission checks');
    
    // Check immediately on mount (v1.0.0 pattern)
    checkPermissions();
    
    // Then check every 1 second (v1.0.0 pattern - proven to work)
    const interval = setInterval(() => {
      checkPermissions();
    }, 1000);

    return () => {
      console.log('[PermissionHeader] 🛑 Component unmounting, clearing interval');
      clearInterval(interval);
    };
  }, [checkPermissions]);

  const allGranted = permissions.microphone === 'granted' && permissions.screen === 'granted';

  return (
    <div className={`permission-container ${allGranted ? 'success' : ''}`}>
      {!allGranted && (
        <>
          {/* Glass border effect */}
          <div className="border-overlay" />

          {/* Close button */}
          <button className="close-button" onClick={onClose} title="Close application">
            ×
          </button>
          
          {/* Title */}
          <h1 className="permission-title">Permission Setup Required</h1>
        </>
      )}

      {/* Content */}
      <div className={`permission-form ${allGranted ? 'all-granted' : ''}`}>
        {!allGranted ? (
          <>
            <div className="permission-subtitle">
              Grant access to microphone and screen recording to continue
            </div>
            
            {/* Permission Status Icons */}
            <div className="permission-status">
              {/* Microphone */}
              <div className={`permission-item ${permissions.microphone === 'granted' ? 'granted' : ''}`}>
                {permissions.microphone === 'granted' ? (
                  <>
                    <svg className="check-icon" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Microphone ✓</span>
                  </>
                ) : (
                  <>
                    <svg className="permission-icon" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                    </svg>
                    <span>Microphone</span>
                  </>
                )}
              </div>
              
              {/* Screen Recording */}
              <div className={`permission-item ${permissions.screen === 'granted' ? 'granted' : ''}`}>
                {permissions.screen === 'granted' ? (
                  <>
                    <svg className="check-icon" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Screen ✓</span>
                  </>
                ) : (
                  <>
                    <svg className="permission-icon" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" />
                    </svg>
                    <span>Screen Recording</span>
                  </>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <button 
              className={`permission-action-button ${permissions.microphone === 'granted' ? 'disabled' : ''} ${isRequestingMic ? 'requesting' : ''}`}
              onClick={handleMicrophoneClick}
              disabled={permissions.microphone === 'granted' || isRequestingMic}
            >
              <div className="button-border-overlay" />
              <span>
                {isRequestingMic 
                  ? 'Check system dialog...' 
                  : permissions.microphone === 'granted' 
                    ? 'Microphone Access Granted' 
                    : 'Grant Microphone Access'}
              </span>
            </button>

            <button 
              className={`permission-action-button ${permissions.screen === 'granted' ? 'disabled' : ''} ${isRequestingScreen ? 'requesting' : ''}`}
              onClick={handleScreenClick}
              disabled={permissions.screen === 'granted' || isRequestingScreen}
            >
              <div className="button-border-overlay" />
              <span>
                {isRequestingScreen 
                  ? 'Opening System Settings...' 
                  : permissions.screen === 'granted' 
                    ? 'Screen Recording Granted' 
                    : 'Grant Screen Recording Access'}
              </span>
            </button>
          </>
        ) : (
          // All permissions granted - show big green checkmark filling entire window
          <svg 
            width="80" 
            height="80" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="rgba(52, 199, 89, 1)" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
            className="success-check"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        )}
      </div>
    </div>
  );
};

export default PermissionHeader;
