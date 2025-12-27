import React, { useEffect, useRef, useState, useMemo } from 'react';
import './overlay-glass.css';
import { i18n } from '../i18n/i18n';
import { startCaptureWithStreams } from '../audio-processor-glass-parity';

const ListenIcon = new URL('./assets/Listen.svg', import.meta.url).href;
const SettingsIcon = new URL('./assets/setting.svg', import.meta.url).href;
const CommandIcon = new URL('./assets/command.svg', import.meta.url).href;

interface EviaBarProps {
  currentView: 'listen' | 'ask' | 'settings' | 'shortcuts' | null;
  onViewChange: (v: 'listen' | 'ask' | 'settings' | 'shortcuts' | null) => void;
  isListening: boolean;
  onToggleListening: () => void;
  language: 'de' | 'en';
  onToggleLanguage: () => void;
  onToggleVisibility?: () => void;
}

// Shortcut configuration type
interface ShortcutConfig {
  toggleVisibility?: string;
  nextStep?: string;
  moveUp?: string;
  moveDown?: string;
  moveLeft?: string;
  moveRight?: string;
  scrollUp?: string;
  scrollDown?: string;
  toggleClickThrough?: string;
  manualScreenshot?: string;
  previousResponse?: string;
  nextResponse?: string;
}

const EviaBar: React.FC<EviaBarProps> = ({
  currentView,
  onViewChange,
  isListening,
  onToggleListening,
  language,
  onToggleLanguage,
  onToggleVisibility,
}) => {
  const headerRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  const lastMoveTimeRef = useRef<number>(0); // Throttle mouse move events
  const settingsHideTimerRef = useRef<NodeJS.Timeout | null>(null); // Glass parity: timer for settings hover

  // WINDOWS FIX (2025-12-05): Get platform info inside component where it's guaranteed to be available
  const isWindowsPlatform = useMemo(() => {
    return typeof window !== 'undefined' && (window as any)?.platformInfo?.isWindows === true;
  }, []);

  // WINDOWS FIX (2025-12-06): Load shortcuts dynamically like Glass MainHeader.js
  // Default shortcuts for initial render (before IPC loads)
  const defaultShortcuts: ShortcutConfig = {
    toggleVisibility: isWindowsPlatform ? 'Ctrl+Space' : 'Cmd+Space',
    nextStep: 'Ctrl+Enter',
  };
  const [shortcuts, setShortcuts] = useState<ShortcutConfig>(defaultShortcuts);
  
  useEffect(() => {
    // Load shortcuts on mount
    const loadShortcuts = async () => {
      try {
        const eviaIpc = (window as any).evia?.ipc;
        console.log('[EviaBar] 🔍 Checking for evia.ipc:', !!eviaIpc, 'invoke:', !!eviaIpc?.invoke);
        
        if (eviaIpc?.invoke) {
          const result = await eviaIpc.invoke('shortcuts:get');
          console.log('[EviaBar] 📡 Raw IPC result:', result);
          
          if (result?.ok && result.shortcuts) {
            console.log('[EviaBar] ✅ Loaded shortcuts:', result.shortcuts);
            setShortcuts(result.shortcuts);
          } else {
            console.log('[EviaBar] ⚠️ Invalid result format, using defaults');
          }
        } else {
          console.log('[EviaBar] ⚠️ IPC not available, using default shortcuts');
        }
      } catch (err) {
        console.error('[EviaBar] ❌ Failed to load shortcuts:', err);
      }
    };
    
    // Small delay to ensure preload is ready
    setTimeout(loadShortcuts, 100);

    // Listen for shortcut updates (like Glass MainHeader.js line 490-494)
    const handleShortcutsUpdated = (newShortcuts: ShortcutConfig) => {
      console.log('[EviaBar] 🔄 Shortcuts updated via IPC:', newShortcuts);
      setShortcuts(newShortcuts);
    };

    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc?.on) {
      eviaIpc.on('shortcuts-updated', handleShortcutsUpdated);
    }

    return () => {
      if (eviaIpc?.off) {
        eviaIpc.off('shortcuts-updated', handleShortcutsUpdated);
      }
    };
  }, [isWindowsPlatform]);

  // Render shortcut key with proper symbols (like Glass MainHeader.js line 578-599)
  const renderShortcutKey = (accelerator: string | undefined): React.ReactNode => {
    if (!accelerator) return null;
    
    const keyMap: { [key: string]: React.ReactNode } = isWindowsPlatform ? {
      'Cmd': 'Ctrl',
      'Command': 'Ctrl', 
      'Ctrl': 'Ctrl',
      'Control': 'Ctrl',
      'Alt': 'Alt',
      'Option': 'Alt',
      'Shift': 'Shift',
      'Enter': '↵',
      'Space': 'Space',
      '\\': '\\',
    } : {
      'Cmd': '⌘',
      'Command': '⌘',
      'Ctrl': '⌃',
      'Control': '⌃',
      'Alt': '⌥',
      'Option': '⌥',
      'Shift': '⇧',
      'Enter': '↵',
      'Space': '␣',
      '\\': (
        <svg viewBox="0 0 6 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{width: '6px', height: '12px'}}>
          <path d="M1.5 1.3L5.1 10.6" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    };

    const keys = accelerator.split('+');
    return keys.map((key, idx) => (
      <div key={idx} className="evia-icon-box">
        {keyMap[key] || key}
      </div>
    ));
  };
  const [listenStatus, setListenStatus] = useState<'before' | 'in' | 'after'>('before');
  const [isListenActive, setIsListenActive] = useState(currentView === 'listen');
  const [isAskActive, setIsAskActive] = useState(currentView === 'ask');
  const [isSettingsActive, setIsSettingsActive] = useState(currentView === 'settings');
  const startInProgressRef = useRef(false); // Prevent duplicate ScreenPicker opens on rapid clicks
  const lastLocalStartMsRef = useRef(0); // Grace period after local start to ignore 'before' resets
  const listenStatusRef = useRef<'before' | 'in' | 'after'>('before'); // Para WINDOWS

  // For windows grace capturing correctly
  useEffect(() => {
    listenStatusRef.current = listenStatus;
  }, [listenStatus]);

  // 🔧 SESSION STATE: Broadcast listenStatus changes to other components (especially AskView)
  // This allows AskView to send the correct session_state to backend
  useEffect(() => {
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc?.send) {
      // Map Desktop states to backend session states
      const sessionState = listenStatus === 'in' ? 'during' : listenStatus;
      
      // Store in localStorage as backup for windows that open after state change
      localStorage.setItem('evia_session_state', sessionState);
      
      // Broadcast via IPC for real-time sync
      eviaIpc.send('session-state-changed', sessionState);
      console.log('[EviaBar] 📡 Broadcast session state:', sessionState, '(from listenStatus:', listenStatus, ')');
    }
  }, [listenStatus]);

  useEffect(() => {
    setIsListenActive(currentView === 'listen');
    setIsAskActive(currentView === 'ask');
    setIsSettingsActive(currentView === 'settings');
  }, [currentView]);

  // Cleanup settings timer on unmount
  useEffect(() => {
    return () => {
      if (settingsHideTimerRef.current) {
        clearTimeout(settingsHideTimerRef.current);
      }
    };
  }, []);

  // 🔧 FIX #7: Listen for error blink trigger from main process
  useEffect(() => {
    const handleErrorBlink = () => {
      console.log('[EviaBar] ⚠️ Triggering error blink animation');
      if (headerRef.current) {
        headerRef.current.classList.add('error-blink');
        setTimeout(() => {
          headerRef.current?.classList.remove('error-blink');
        }, 1000);
      }
    };

    const eviaIpc = (window as any).evia?.ipc;
    eviaIpc?.on?.('overlay:error-blink', handleErrorBlink);
    return () => {
      eviaIpc?.off?.('overlay:error-blink', handleErrorBlink);
    };
  }, []);

  // 🔄 Sync session state with backend and listen for chat changes
  useEffect(() => {
    const syncSessionState = async () => {
      try {
        const eviaAuth = (window as any).evia?.auth;
        const token = await eviaAuth?.getToken?.();
        const chatId = localStorage.getItem('current_chat_id');
        const { BACKEND_URL: baseUrl } = await import('../config/config');

        if (!token || !chatId) {
          console.log('[EviaBar] ⏭️ Skipping session status sync: no token or chat_id');
          return;
        }

        console.log('[EviaBar] 🔄 Syncing session state with backend...');
        const response = await fetch(`${baseUrl}/session/status`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ chat_id: Number(chatId) }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('[EviaBar] ✅ Backend session status:', data.status);

          const now = Date.now();
          const withinGrace = now - lastLocalStartMsRef.current < 2000;
          if (data.status === 'during') {
            setListenStatus('in');
          } else if (data.status === 'after') {
            setListenStatus('after');
          } else if (!(withinGrace && listenStatusRef.current === 'in')) {
            setListenStatus('before');
          }
        } else {
          console.error('[EviaBar] ❌ Failed to get session status:', response.status, await response.text());
        }
      } catch (error) {
        console.error('[EviaBar] ❌ Error syncing session state:', error);
      }
    };

    // Sync on mount
    syncSessionState();

    const handleChatChanged = () => {
      console.log('[EviaBar] 💬 Chat changed - syncing session state');
      syncSessionState();
    };

    const eviaIpc = (window as any).evia?.ipc;
    eviaIpc?.on?.('chat-changed', handleChatChanged);
    return () => {
      eviaIpc?.off?.('chat-changed', handleChatChanged);
    };
  }, []);

  // 🔧 FIX: Reset listen button state when language is changed or session is cleared
  useEffect(() => {
    const handleLanguageChanged = () => {
      console.log('[EviaBar] 🌐 Language changed - resetting listen button to "before" state');
      setListenStatus('before');
      setIsListenActive(false);
    };

    const handleSessionClosed = () => {
      console.log('[EviaBar] 🧹 Session closed - resetting listen button to "before" state');
      setListenStatus('before');
      setIsListenActive(false);
    };

    // 🔧 TODO #9 FIX: Handle graceful shutdown - complete active session before quit
    const handleBeforeQuit = async () => {
      console.log('[EviaBar] 🚪 App quitting - completing active session...');
      
      // Only complete if session is active (during or after state)
      if (listenStatus === 'in' || listenStatus === 'after') {
        try {
          const eviaAuth = (window as any).evia?.auth;
          const token = await eviaAuth?.getToken?.();
          const chatId = localStorage.getItem('current_chat_id');
          const { BACKEND_URL: baseUrl } = await import('../config/config');
          
          if (token && chatId) {
            console.log('[EviaBar] 🎯 Completing session before quit:', chatId);
            const response = await fetch(`${baseUrl}/session/complete`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ 
                chat_id: Number(chatId),
                summary: 'Session ended by app quit'
              })
            });
            
            if (response.ok) {
              console.log('[EviaBar] ✅ Session completed before quit');
            } else {
              console.error('[EviaBar] ❌ Failed to complete session:', response.status);
            }
          }
        } catch (error) {
          console.error('[EviaBar] ❌ Error completing session on quit:', error);
        }
      }
    };

    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc) {
      eviaIpc.on('language-changed', handleLanguageChanged);
      eviaIpc.on('clear-session', handleSessionClosed);
      eviaIpc.on('app:before-quit', handleBeforeQuit);
      console.log('[EviaBar] ✅ Registered language-changed, clear-session, and before-quit listeners');
    }

    return () => {
      if (eviaIpc) {
        eviaIpc.off('language-changed', handleLanguageChanged);
        eviaIpc.off('clear-session', handleSessionClosed);
        eviaIpc.off('app:before-quit', handleBeforeQuit);
      }
    };
  }, [listenStatus]);

  // WINDOWS FIX: Handle audio recovery triggers from ListenView (Windows only)
  // CRITICAL: We DON'T restart the full audio pipeline - that would reset transcripts!
  // Instead, just restart the WASAPI helper via IPC to the main process
  useEffect(() => {
    // Only register this handler on Windows to avoid any impact on macOS
    const isWindows = Boolean((window as any)?.platformInfo?.isWindows);
    if (!isWindows) return;
    
    const handleRecoveryTrigger = async () => {
      console.log('[EviaBar] 🔄 Audio recovery triggered (Windows) - WASAPI restart only, NOT full pipeline');
      
      // Only recover if we're actively listening
      if (listenStatusRef.current !== 'in') {
        console.log('[EviaBar] Ignoring recovery - not in listening state');
        return;
      }
      
      try {
        // CRITICAL FIX: Only restart WASAPI helper, NOT the full audio pipeline
        // This preserves WebSocket connections and transcript state
        console.log('[EviaBar] Requesting WASAPI restart via IPC (preserving transcripts)...');
        
        // Request WASAPI restart from main process - this will NOT affect mic capture or WebSocket
        if (window.electron?.ipcRenderer) {
          await window.electron.ipcRenderer.invoke('system-audio-windows:restart');
          console.log('[EviaBar] ✅ WASAPI restart requested');
        }
        
        // Notify ListenView of recovery (but NOT recording_started which would reset transcripts)
        const eviaIpc = (window as any).evia?.ipc;
        if (eviaIpc?.send) {
          eviaIpc.send('transcript-message', { 
            type: 'status', 
            data: { message: 'Audio reconnected', recovered: true }
          });
        }
        
        console.log('[EviaBar] Audio recovery completed (WASAPI only)');
      } catch (err) {
        console.error('[EviaBar] Audio recovery failed:', err);
      }
    };
    
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc?.on) {
      eviaIpc.on('audio:trigger-recovery', handleRecoveryTrigger);
      return () => {
        if (eviaIpc.off) {
          eviaIpc.off('audio:trigger-recovery', handleRecoveryTrigger);
        }
      };
    }
  }, []);

  // Dynamic window sizing: measure content and resize window to fit
  useEffect(() => {
    const measureAndResize = async () => {
      if (!headerRef.current) return;

      // Wait for DOM to settle (fonts, layout)
      await new Promise(resolve => setTimeout(resolve, 100));

      const rect = headerRef.current.getBoundingClientRect();
      const contentWidth = Math.ceil(rect.width);
      // Add 2px to height to match main process initial header height (glass border: 1px top + 1px bottom)
      const contentHeight = Math.ceil(rect.height) + 2;

      console.log(`[EviaBar] Content measured: ${contentWidth}px × ${contentHeight}px (w×h)`);

      // Request window resize via IPC (use unified resize handler that accepts width+height)
      if (window.electron?.ipcRenderer) {
        try {
          const success = await window.electron.ipcRenderer.invoke('win:resizeHeader', contentWidth, contentHeight);
          if (success) {
            console.log('[EviaBar] Window resized to fit content (width+height)');
          }
        } catch (error) {
          console.warn('[EviaBar] Failed to resize window:', error);
        }
      }
    };
    
    // Measure on mount and when language changes
    measureAndResize();
  }, [language]); // Re-measure when language changes (German words are longer!)

  // Remove global/header-level drag logic: dragging is now handled exclusively
  // by the right-side semicircular <DraggableHandle /> using app-region: drag.
  // No header-wide listeners are needed here.

  const toggleWindow = async (name: 'listen' | 'ask' | 'settings' | 'shortcuts') => {
    const res = await (window as any).evia?.windows?.show?.(name);
    if (!res || !res.ok) return false;
    const visible = res.toggled === 'shown';
    if (onViewChange) onViewChange(visible ? name : null);
    return visible;
  };

  const handleListenClick = async () => {
    // Glass parity: listenService.js:56-97
    // Listen → Stop: Show window + start
    // Stop → Done: Window STAYS, show insights
    // Done → Listen: Hide window
    
    console.log(`[EviaBar] handleListenClick - current status: ${listenStatus}`);
    
    if (listenStatus === 'before') {
      console.log('[EviaBar] Listen → Stop: Showing listen window');

      await (window as any).evia?.windows?.ensureShown?.('listen');
      onViewChange?.('listen');

      // Sync session state BEFORE React state updates (prevents race in ListenView)
      localStorage.setItem('evia_session_state', 'during');
      console.log('[EviaBar] 🔥 SYNC UPDATE: localStorage.evia_session_state = "during" (BEFORE React state)');

      setListenStatus('in');
      setIsListenActive(true);
      onToggleListening();

      // Backend: /session/start
      try {
        const eviaAuth = (window as any).evia?.auth;
        const token = await eviaAuth?.getToken?.();
        const chatId = localStorage.getItem('current_chat_id');
        const { BACKEND_URL: baseUrl } = await import('../config/config');
        if (token && chatId) {
          console.log('[EviaBar] 🎯 Calling /session/start for chat_id:', chatId);
          const response = await fetch(`${baseUrl}/session/start`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ chat_id: Number(chatId) })
          });
          if (response.ok) {
            const data = await response.json();
            console.log('[EviaBar] ✅ Session started:', data);
          } else {
            console.error('[EviaBar] ❌ Failed to start session:', response.status, await response.text());
        }
        } else {
          console.warn('[EviaBar] ⚠️ Cannot call /session/start: missing token or chat_id');
        }
      } catch (error) {
        console.error('[EviaBar] ❌ Error calling /session/start:', error);
      }

    } else if (listenStatus === 'in') {

      console.log('[EviaBar] Stop → Done: Window stays visible');
      
      // 🔥 FORCE SESSION LIFECYCLE: Call /session/pause when "Stop" pressed
      try {
        const eviaAuth = (window as any).evia?.auth;
        const token = await eviaAuth?.getToken?.();
        const chatId = localStorage.getItem('current_chat_id');
        const { BACKEND_URL: baseUrl } = await import('../config/config');
        
        if (token && chatId) {
          console.log('[EviaBar] 🎯 Calling /session/pause for chat_id:', chatId);
          const response = await fetch(`${baseUrl}/session/pause`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ chat_id: Number(chatId) })
          });
          
          if (response.ok) {
            const data = await response.json();
            console.log('[EviaBar] ✅ Session paused:', data);
          } else {
            console.error('[EviaBar] ❌ Failed to pause session:', response.status, await response.text());
          }
        } else {
          console.warn('[EviaBar] ⚠️ Cannot call /session/pause: missing token or chat_id');
        }
      } catch (error) {
        console.error('[EviaBar] ❌ Error calling /session/pause:', error);
      }
      
      // 🔥 CRITICAL FIX: Update localStorage SYNCHRONOUSLY **BEFORE** React state update
      localStorage.setItem('evia_session_state', 'after');
      console.log('[EviaBar] 🔥 SYNC UPDATE: localStorage.evia_session_state = "after" (BEFORE React state)');
      
      setListenStatus('after');
      setIsListenActive(false);
      onToggleListening();
      // Window remains visible for insights
    } else if (listenStatus === 'after') {
      // 🔧 FIX #27: Done (Fertig) → Hide BOTH Listen AND Ask windows
      console.log('[EviaBar] Fertig pressed: Hiding listen and ask windows');
      
      // 🆕 BACKEND INTEGRATION: Call /session/complete BEFORE hiding windows
      try {
        const eviaAuth = (window as any).evia?.auth;
        const token = await eviaAuth?.getToken?.();
        const chatId = localStorage.getItem('current_chat_id');
        const { BACKEND_URL: baseUrl } = await import('../config/config');

        if (token && chatId) {
          console.log('[EviaBar] 🎯 Calling /session/complete for chat_id:', chatId);
          const response = await fetch(`${baseUrl}/session/complete`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              chat_id: Number(chatId),
              summary: null  // Optional - can add user input later
            })
          });
          
          if (response.ok) {
            const data = await response.json();
            console.log('[EviaBar] ✅ Session completed:', data);
            console.log(`[EviaBar] 📦 Archived ${data.transcript_count} transcripts`);
            // Log the implementation report for debugging/metrics
            if (data.suggestion_report) {
              console.log('[EviaBar] 📊 SUGGESTION IMPLEMENTATION REPORT:');
              console.log(data.suggestion_report);
            }
          } else {
            console.error('[EviaBar] ❌ Failed to complete session:', response.status, await response.text());
          }
        } else {
          console.warn('[EviaBar] ⚠️ Cannot call /session/complete: missing token or chat_id');
        }
      } catch (error) {
        console.error('[EviaBar] ❌ Error calling /session/complete:', error);
      }
      
      await (window as any).evia?.windows?.hide?.('listen');
      await (window as any).evia?.windows?.hide?.('ask');
      // Broadcast session-closed event so Ask can clear its state
      (window as any).evia?.ipc?.send?.('session:closed');

      // 🔧 FIX #CRITICAL: Clear chat_id so next session creates NEW chat instead of reusing old one
      // This ensures each "Listen → Done" cycle creates a separate session
      localStorage.removeItem('current_chat_id');
      console.log('[EviaBar] 🗑️ Cleared chat_id from localStorage - next session will create new chat');
      
      setListenStatus('before');
      setIsListenActive(false);
      console.log('[EviaBar] ✅ Session closed, windows hidden');
    }
  };

  const handleAskClick = async () => {
    const shown = await toggleWindow('ask');
    setIsAskActive(shown);
  };

  // Glass parity: Settings hover behavior with 200ms delay (windowManager.js:291-323)
  const showSettingsWindow = () => {
    console.log('[EviaBar] showSettingsWindow called');
    // Cancel any pending hide
    if (settingsHideTimerRef.current) {
      console.log('[EviaBar] Clearing pending hide timer');
      clearTimeout(settingsHideTimerRef.current);
      settingsHideTimerRef.current = null;
    }
    
    // 🔧 FIX #1: Calculate actual 3-dot button position for settings window
    // This fixes the issue where English header is narrower but settings position stays the same
    const settingsButton = document.querySelector('.evia-settings-button') as HTMLElement;
    if (settingsButton) {
      const buttonRect = settingsButton.getBoundingClientRect();
      const headerRect = headerRef.current?.getBoundingClientRect();
      if (headerRect) {
        // Calculate button position relative to header
        const buttonX = buttonRect.left - headerRect.left;
        console.log('[EviaBar] 📍 Settings button position:', { buttonX, buttonRect, headerRect });
        // Send button position to main process
        (window as any).evia?.windows?.showSettingsWindow?.(buttonX);
        setIsSettingsActive(true);
        return;
      }
    }
    
    // Fallback: show without position (uses old calculation)
    (window as any).evia?.windows?.showSettingsWindow?.();
    setIsSettingsActive(true);
  };

  const hideSettingsWindow = () => {
    console.log('[EviaBar] hideSettingsWindow called - starting 50ms timer');
    // 🔧 TASK: Reduce delay from 200ms to 50ms for more responsive hide/show (per user feedback)
    // Hide after 50ms delay (allows mouse to move to settings panel)
    if (settingsHideTimerRef.current) {
      clearTimeout(settingsHideTimerRef.current);
    }
    settingsHideTimerRef.current = setTimeout(() => {
      console.log('[EviaBar] 50ms timer expired - hiding settings');
      (window as any).evia?.windows?.hideSettingsWindow?.();
      setIsSettingsActive(false);
      settingsHideTimerRef.current = null;
    }, 50);
  };

  const handleToggleVisibility = async () => {
    await (window as any).evia?.windows?.toggleAllVisibility?.();
    onToggleVisibility?.();
  };

  const listenLabel = listenStatus === 'before' 
    ? i18n.t('overlay.header.listen') 
    : listenStatus === 'in' 
    ? i18n.t('overlay.header.stop') 
    : i18n.t('overlay.header.done');

  return (
    <div ref={headerRef} className="evia-main-header">
      {/* Listen button */}
      <button
        type="button"
        className={`evia-listen-button ${isListenActive ? 'listen-active' : ''} ${listenStatus === 'after' ? 'listen-done' : ''}`}
        onClick={handleListenClick}
      >
        <span className="evia-listen-label">{listenLabel}</span>
        <span className="evia-listen-icon">
          {(isListenActive || listenStatus === 'after') ? (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="9" height="9" rx="1" fill="white" />
            </svg>
          ) : (
            <svg width="12" height="11" viewBox="0 0 12 11" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.69922 2.7515C1.69922 2.37153 2.00725 2.0635 2.38722 2.0635H2.73122C3.11119 2.0635 3.41922 2.37153 3.41922 2.7515V8.2555C3.41922 8.63547 3.11119 8.9435 2.73122 8.9435H2.38722C2.00725 8.9435 1.69922 8.63547 1.69922 8.2555V2.7515Z" fill="white"/>
              <path d="M5.13922 1.3755C5.13922 0.995528 5.44725 0.6875 5.82722 0.6875H6.17122C6.55119 0.6875 6.85922 0.995528 6.85922 1.3755V9.6315C6.85922 10.0115 6.55119 10.3195 6.17122 10.3195H5.82722C5.44725 10.3195 5.13922 10.0115 5.13922 9.6315V1.3755Z" fill="white"/>
              <path d="M8.57922 3.0955C8.57922 2.71553 8.88725 2.4075 9.26722 2.4075H9.61122C9.99119 2.4075 10.2992 2.71553 10.2992 3.0955V7.9115C10.2992 8.29147 9.99119 8.5995 9.61122 8.5995H9.26722C8.88725 8.5995 8.57922 8.29147 8.57922 7.9115V3.0955Z" fill="white"/>
            </svg>
          )}
        </span>
      </button>

      {/* Ask action - WINDOWS FIX: Load shortcut dynamically like Glass MainHeader.js */}
      <div className="evia-header-actions" onClick={handleAskClick} role="button" tabIndex={0}>
        <span className="evia-action-text">{i18n.t('overlay.header.ask')}</span>
        <div className="evia-shortcut-keys">
          {renderShortcutKey(shortcuts.nextStep)}
        </div>
      </div>

      {/* Show/Hide action - WINDOWS FIX: Load shortcut dynamically like Glass MainHeader.js */}
      <div className="evia-header-actions" onClick={handleToggleVisibility} role="button" tabIndex={0}>
        <span className="evia-action-text">{i18n.t('overlay.header.show')}/{i18n.t('overlay.header.hide')}</span>
        <div className="evia-shortcut-keys">
          {renderShortcutKey(shortcuts.toggleVisibility)}
        </div>
      </div>

      {/* Settings button */}
      <button
        type="button"
        className={`evia-settings-button ${isSettingsActive ? 'active' : ''}`}
        onMouseEnter={showSettingsWindow}
        onMouseLeave={hideSettingsWindow}
        aria-label="Settings"
      >
        <svg width="16" height="17" viewBox="0 0 16 17" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="3.83" r="1" fill="white"/>
          <circle cx="8" cy="8.5" r="1" fill="white"/>
          <circle cx="8" cy="13.17" r="1" fill="white"/>
        </svg>
      </button>

    </div>
  );
};

export default EviaBar;
