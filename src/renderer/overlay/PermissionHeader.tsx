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

import React, { useState, useEffect, useCallback } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';

interface PermissionHeaderProps {
  onContinue: () => void;
  onClose: () => void;
}

type PermissionStatus = 'granted' | 'denied' | 'not-determined' | 'unknown';

interface PermissionState {
  microphone: PermissionStatus;
  screen: PermissionStatus;
}

const PermissionHeader: React.FC<PermissionHeaderProps> = ({ onContinue, onClose }) => {
  const [permissions, setPermissions] = useState<PermissionState>({
    microphone: 'unknown',
    screen: 'unknown',
  });
  const [isChecking, setIsChecking] = useState(false);

  /**
   * Check current permission status
   */
  const checkPermissions = useCallback(async () => {
    if (!window.evia?.permissions || isChecking) return;
    
    setIsChecking(true);
    
    try {
      const result = await window.evia.permissions.check();
      console.log('[PermissionHeader] Permission check result:', result);
      
      setPermissions({
        microphone: result.microphone,
        screen: result.screen,
      });

      // Auto-continue if all permissions granted
      if (result.microphone === 'granted' && result.screen === 'granted') {
        console.log('[PermissionHeader] All permissions granted, auto-continuing in 500ms...');
        setTimeout(() => onContinue(), 500);
      }
    } catch (error) {
      console.error('[PermissionHeader] Error checking permissions:', error);
    } finally {
      setIsChecking(false);
    }
  }, [isChecking, onContinue]);

  /**
   * Request microphone permission
   */
  const handleMicrophoneClick = async () => {
    if (!window.evia?.permissions || permissions.microphone === 'granted') return;
    
    console.log('[PermissionHeader] Requesting microphone permission...');
    
    try {
      const result = await window.evia.permissions.requestMicrophone();
      console.log('[PermissionHeader] Microphone permission result:', result);
      
      if (result.status === 'granted') {
        setPermissions((prev) => ({ ...prev, microphone: 'granted' }));
        await checkPermissions(); // Recheck to ensure consistency
      }
    } catch (error) {
      console.error('[PermissionHeader] Error requesting microphone permission:', error);
    }
  };

  /**
   * Open System Preferences for screen recording permission
   * (Screen recording permission cannot be requested programmatically)
   */
  const handleScreenClick = async () => {
    if (!window.evia?.permissions || permissions.screen === 'granted') return;
    
    console.log('[PermissionHeader] Opening System Preferences for screen recording...');
    
    try {
      await window.evia.permissions.openSystemPreferences('screen');
      console.log('[PermissionHeader] System Preferences opened');
    } catch (error) {
      console.error('[PermissionHeader] Error opening System Preferences:', error);
    }
  };

  /**
   * Handle continue button (only enabled when all permissions granted)
   */
  const handleContinue = () => {
    if (permissions.microphone === 'granted' && permissions.screen === 'granted') {
      onContinue();
    }
  };

  // Check permissions on mount and every 1s
  useEffect(() => {
    checkPermissions();
    
    const interval = setInterval(() => {
      checkPermissions();
    }, 1000);

    return () => clearInterval(interval);
  }, [checkPermissions]);

  const allGranted = permissions.microphone === 'granted' && permissions.screen === 'granted';

  return (
    <div className="container" style={{ height: '220px', padding: '18px 20px' }}>
      <button className="close-button" onClick={onClose} title="Close application">×</button>
      
      <h1 className="title">Permission Setup Required</h1>

      <div className={`form-content ${allGranted ? 'all-granted' : ''}`}>
        {!allGranted ? (
          <>
            <div className="subtitle">
              Grant access to microphone and screen recording to continue
            </div>
            
            <div className="permission-status">
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

            <button 
              className="action-button" 
              onClick={handleMicrophoneClick}
              disabled={permissions.microphone === 'granted'}
            >
              {permissions.microphone === 'granted' ? 'Microphone Access Granted' : 'Grant Microphone Access'}
            </button>

            <button 
              className="action-button" 
              onClick={handleScreenClick}
              disabled={permissions.screen === 'granted'}
            >
              {permissions.screen === 'granted' ? 'Screen Recording Granted' : 'Grant Screen Recording Access'}
            </button>
          </>
        ) : (
          <button 
            className="continue-button" 
            onClick={handleContinue}
          >
            Continue to EVIA
          </button>
        )}
      </div>
    </div>
  );
};

export default PermissionHeader;

