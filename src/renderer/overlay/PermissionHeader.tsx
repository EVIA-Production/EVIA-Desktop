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
  const checkingRef = useRef(false);

  /**
   * Check permission status
   */
  const checkPermissions = useCallback(async () => {
    if (!window.evia?.permissions || checkingRef.current) return;
    
    checkingRef.current = true;
    setIsChecking(true);
    
    try {
      const result = await window.evia.permissions.check();
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
    if (!window.evia?.permissions || permissions.microphone === 'granted' || isRequestingMic) return;
    
    console.log('[PermissionHeader] 🎤 Checking microphone permission...');
    setIsRequestingMic(true);
    
    try {
      // First, check current status (Glass pattern)
      const result = await window.evia.permissions.check();
      console.log('[PermissionHeader] Current permission status:', result.microphone);
      
      if (result.microphone === 'granted') {
        setPermissions(prev => ({ ...prev, microphone: 'granted' }));
        console.log('[PermissionHeader] ✅ Microphone already granted');
        return;
      }
      
      // Only request if not determined/denied/unknown/restricted
      if (['not-determined', 'denied', 'unknown', 'restricted'].includes(result.microphone)) {
        console.log('[PermissionHeader] 📢 Requesting microphone permission...');
        const res = await window.evia.permissions.requestMicrophone();
        
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
    if (!window.evia?.permissions || permissions.screen === 'granted') return;
    
    console.log('[PermissionHeader] 🖥️  Opening System Preferences for screen recording...');
    
    try {
      await window.evia.permissions.openSystemPreferences('screen-recording');
      console.log('[PermissionHeader] ✅ System Preferences opened');
    } catch (error) {
      console.error('[PermissionHeader] ❌ Error opening System Preferences:', error);
    }
  };

  // Note: handleContinue removed - auto-continue happens in checkPermissions

  // Check permissions on mount and set up interval
  useEffect(() => {
    console.log('[PermissionHeader] 🚀 Component mounted, starting permission checks');
    checkPermissions();
    
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
    <div style={styles.container}>
      {/* Glass border effect */}
      <div style={styles.borderOverlay} />

      {/* Close button */}
      <button style={styles.closeButton} onClick={onClose} title="Close application">
        ×
      </button>
      
      {/* Title */}
      <h1 style={styles.title}>Permission Setup Required</h1>

      {/* Content */}
      <div style={{
        ...styles.formContent,
        ...(allGranted ? styles.formContentAllGranted : {})
      }}>
        {!allGranted ? (
          <>
            <div style={styles.subtitle}>
              Grant access to microphone and screen recording to continue
            </div>
            
            {/* Permission Status Icons */}
            <div style={styles.permissionStatus}>
              {/* Microphone */}
              <div style={{
                ...styles.permissionItem,
                ...(permissions.microphone === 'granted' ? styles.permissionItemGranted : {})
              }}>
                {permissions.microphone === 'granted' ? (
                  <>
                    <svg style={styles.checkIcon} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Microphone ✓</span>
                  </>
                ) : (
                  <>
                    <svg style={styles.permissionIcon} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                    </svg>
                    <span>Microphone</span>
                  </>
                )}
              </div>
              
              {/* Screen Recording */}
              <div style={{
                ...styles.permissionItem,
                ...(permissions.screen === 'granted' ? styles.permissionItemGranted : {})
              }}>
                {permissions.screen === 'granted' ? (
                  <>
                    <svg style={styles.checkIcon} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Screen ✓</span>
                  </>
                ) : (
                  <>
                    <svg style={styles.permissionIcon} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" />
                    </svg>
                    <span>Screen Recording</span>
                  </>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <button 
              style={{
                ...styles.actionButton,
                ...(permissions.microphone === 'granted' || isRequestingMic ? styles.actionButtonDisabled : {}),
                ...(isRequestingMic ? { cursor: 'wait' } : {}),
              }}
              onClick={handleMicrophoneClick}
              disabled={permissions.microphone === 'granted' || isRequestingMic}
            >
              <div style={styles.buttonBorderOverlay} />
              <span style={{ position: 'relative', zIndex: 1 }}>
                {isRequestingMic 
                  ? 'Check system dialog...' 
                  : permissions.microphone === 'granted' 
                    ? 'Microphone Access Granted' 
                    : 'Grant Microphone Access'}
              </span>
            </button>

            <button 
              style={{
                ...styles.actionButton,
                ...(permissions.screen === 'granted' ? styles.actionButtonDisabled : {}),
              }}
              onClick={handleScreenClick}
              disabled={permissions.screen === 'granted'}
            >
              <div style={styles.buttonBorderOverlay} />
              <span style={{ position: 'relative', zIndex: 1 }}>
                {permissions.screen === 'granted' ? 'Screen Recording Granted' : 'Grant Screen Recording Access'}
              </span>
            </button>
          </>
        ) : (
          // All permissions granted - show brief success message (auto-continues via checkPermissions)
          <div style={{
            ...styles.successMessage,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 16px',
            background: 'rgba(0, 200, 0, 0.2)',
            borderRadius: '8px',
            border: '1px solid rgba(0, 255, 0, 0.3)',
          }}>
            <span style={{ fontSize: '20px' }}>✅</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '14px', fontWeight: 500 }}>
              All permissions granted
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// Inline styles matching Glass pixel-perfectly
const styles: Record<string, React.CSSProperties> = {
  container: {
    WebkitAppRegion: 'drag' as any,
    width: '100%',
    height: '100%',
    minWidth: '285px',
    minHeight: '220px',
    padding: '18px 20px',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '16px',
    overflow: 'visible',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    boxSizing: 'border-box',
    fontFamily: "'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    userSelect: 'none',
  },
  borderOverlay: {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: '16px',
    padding: '1px',
    background: 'linear-gradient(169deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.5) 100%)',
    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    WebkitMaskComposite: 'destination-out' as any,
    maskComposite: 'exclude',
    pointerEvents: 'none',
  },
  closeButton: {
    WebkitAppRegion: 'no-drag' as any,
    position: 'absolute',
    top: '10px',
    right: '10px',
    width: '14px',
    height: '14px',
    background: 'rgba(255, 255, 255, 0.1)',
    border: 'none',
    borderRadius: '3px',
    color: 'rgba(255, 255, 255, 0.7)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
    zIndex: 10,
    fontSize: '16px',
    lineHeight: 1,
    padding: 0,
  },
  title: {
    color: 'white',
    fontSize: '16px',
    fontWeight: 500,
    margin: 0,
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  formContent: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    width: '100%',
    marginTop: 'auto',
  },
  formContentAllGranted: {
    flexGrow: 1,
    justifyContent: 'center',
    marginTop: 0,
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: '11px',
    fontWeight: 400,
    textAlign: 'center' as const,
    marginBottom: '12px',
    lineHeight: 1.3,
  },
  permissionStatus: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '12px',
    minHeight: '20px',
  },
  permissionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: '11px',
    fontWeight: 400,
  },
  permissionItemGranted: {
    color: 'rgba(34, 197, 94, 0.9)',
  },
  permissionIcon: {
    width: '12px',
    height: '12px',
    opacity: 0.8,
  },
  checkIcon: {
    width: '12px',
    height: '12px',
    color: 'rgba(34, 197, 94, 0.9)',
  },
  actionButton: {
    WebkitAppRegion: 'no-drag' as any,
    width: '100%',
    height: '34px',
    background: 'rgba(255, 255, 255, 0.2)',
    border: 'none',
    borderRadius: '10px',
    color: 'white',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    position: 'relative',
    overflow: 'hidden',
    marginBottom: '6px',
    // Reset any browser default focus/active states
    outline: 'none',
  },
  actionButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
    // Disable pointer events to prevent stuck hover states
    pointerEvents: 'none' as any,
  },
  buttonBorderOverlay: {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: '10px',
    padding: '1px',
    background: 'linear-gradient(169deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.5) 100%)',
    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    WebkitMaskComposite: 'destination-out' as any,
    maskComposite: 'exclude',
    pointerEvents: 'none',
  },
  continueButton: {
    WebkitAppRegion: 'no-drag' as any,
    width: '100%',
    height: '34px',
    background: 'rgba(34, 197, 94, 0.8)',
    border: 'none',
    borderRadius: '10px',
    color: 'white',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    position: 'relative',
    overflow: 'hidden',
    marginTop: '4px',
  },
  continueBorderOverlay: {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: '10px',
    padding: '1px',
    background: 'linear-gradient(169deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.5) 100%)',
    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    WebkitMaskComposite: 'destination-out' as any,
    maskComposite: 'exclude',
    pointerEvents: 'none',
  },
};

export default PermissionHeader;
