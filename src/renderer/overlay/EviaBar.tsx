import React, { useEffect, useRef, useState } from 'react';
import './overlay-tokens.css';
import { i18n } from '../i18n/i18n';

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
  const settingsHideTimerRef = useRef<NodeJS.Timeout | null>(null); // Glass parity: timer for settings hover
  const [listenStatus, setListenStatus] = useState<'before' | 'in' | 'after'>('before');
  const [isListenActive, setIsListenActive] = useState(currentView === 'listen');
  const [isAskActive, setIsAskActive] = useState(currentView === 'ask');
  const [isSettingsActive, setIsSettingsActive] = useState(currentView === 'settings');

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

  // REMOVED: useEffect that resets listenStatus based on isListening
  // This was breaking the 'after' (Done) state by resetting to 'before' when audio stops

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
        // Add error-blink class
        headerRef.current.classList.add('error-blink');
        // Remove after animation completes (0.5s * 2 = 1s)
        setTimeout(() => {
          headerRef.current?.classList.remove('error-blink');
        }, 1000);
      }
    };

    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc) {
      eviaIpc.on('trigger-error-blink', handleErrorBlink);
    }

    return () => {
      if (eviaIpc) {
        eviaIpc.off('trigger-error-blink', handleErrorBlink);
      }
    };
  }, []);

  // 🆕 BACKEND INTEGRATION: Sync session state on app load
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
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ chat_id: Number(chatId) })
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('[EviaBar] ✅ Backend session status:', data.status);
          
          // Map backend states to Desktop states
          if (data.status === 'during') {
            setListenStatus('in');
          } else if (data.status === 'after') {
            setListenStatus('after');
          } else {
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
    
    // Re-sync when chat_id changes (user switches chats)
    const handleChatChanged = () => {
      console.log('[EviaBar] 💬 Chat changed - syncing session state');
      syncSessionState();
    };
    
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc) {
      eviaIpc.on('chat-changed', handleChatChanged);
    }
    
    return () => {
      if (eviaIpc) {
        eviaIpc.off('chat-changed', handleChatChanged);
      }
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

    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc) {
      eviaIpc.on('language-changed', handleLanguageChanged);
      eviaIpc.on('clear-session', handleSessionClosed);
      console.log('[EviaBar] ✅ Registered language-changed and clear-session listeners');
    }

    return () => {
      if (eviaIpc) {
        eviaIpc.off('language-changed', handleLanguageChanged);
        eviaIpc.off('clear-session', handleSessionClosed);
      }
    };
  }, []);

  // Dynamic window sizing: measure content and resize window to fit
  useEffect(() => {
    const measureAndResize = async () => {
      if (!headerRef.current) return;
      
      // Wait for DOM to settle (fonts, layout)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const rect = headerRef.current.getBoundingClientRect();
      const contentWidth = Math.ceil(rect.width);
      
      console.log(`[EviaBar] Content width measured: ${contentWidth}px`);
      
      // Request window resize via IPC
      if (window.electron?.ipcRenderer) {
        try {
          const success = await window.electron.ipcRenderer.invoke(
            'header:set-window-width',
            contentWidth
          );
          if (success) {
            console.log(`[EviaBar] Window resized to fit content`);
          }
        } catch (error) {
          console.warn('[EviaBar] Failed to resize window:', error);
        }
      }
    };
    
    // Measure on mount and when language changes
    measureAndResize();
  }, [language]); // Re-measure when language changes (German words are longer!)

  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;

    const handleMouseDown = async (event: MouseEvent) => {
      if (event.button !== 0) return;
      
      // 🔧 FIX #3 + BUG-2: Check for buttons BEFORE preventDefault to allow button clicks!
      // preventDefault() blocks click events, so we must check button status first
      const target = event.target as HTMLElement;
      if (target.closest('button, .action, .evia-header-actions')) {
        console.log('[EviaBar] Click on button/action, skipping drag');
        // Don't preventDefault - let button's onClick handler fire!
        return;
      }
      
      // NOW prevent default for drag (only on header background)
      event.preventDefault();
      const pos = await (window as any).evia?.windows?.getHeaderPosition?.();
      if (!pos) return;
      dragState.current = {
        startX: event.screenX,
        startY: event.screenY,
        initialX: pos.x,
        initialY: pos.y,
      };
      window.addEventListener('mousemove', handleMouseMove, { capture: true });
      window.addEventListener('mouseup', handleMouseUp, { once: true, capture: true });
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!dragState.current) return;
      event.preventDefault();
      const dx = event.screenX - dragState.current.startX;
      const dy = event.screenY - dragState.current.startY;
      (window as any).evia?.windows?.moveHeaderTo?.(
        dragState.current.initialX + dx,
        dragState.current.initialY + dy,
      );
    };

    const handleMouseUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', handleMouseMove, true);
    };

    node.addEventListener('mousedown', handleMouseDown);
    return () => {
      node.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
    };
  }, []);

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
      // Listen → Stop: Show window
      console.log('[EviaBar] Listen → Stop: Showing listen window');
      await (window as any).evia?.windows?.ensureShown?.('listen');
      setListenStatus('in');
      setIsListenActive(true);
      onToggleListening();
      
      // 🆕 BACKEND INTEGRATION: Call /session/start
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
      // Stop → Done: Window STAYS visible
      console.log('[EviaBar] Stop → Done: Window stays visible');
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
      <style>{`
        .evia-main-header {
          -webkit-app-region: drag;
          width: max-content;
          height: 47px;
          padding: 2px 10px 2px 13px;
          margin: 1px 0; /* GLASS BORDER FIX: 1px margin top/bottom for border rendering */
          background: transparent;
          overflow: visible; /* GLASS BORDER FIX: Changed from hidden to allow border to render */
          border-radius: 9000px;
          justify-content: space-between;
          align-items: center;
          display: flex;
          box-sizing: border-box;
          position: relative;
          user-select: none;
          font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .evia-main-header::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.6);
          border-radius: 9000px;
          z-index: -1;
        }
        .evia-main-header::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          border-radius: 9000px;
          padding: 1px;
          background: linear-gradient(169deg, rgba(255,255,255,0.17) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.17) 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: destination-out;
          mask-composite: exclude;
          pointer-events: none;
        }
        .evia-main-header button,
        .evia-main-header .action {
          -webkit-app-region: no-drag;
          position: relative;
          z-index: 1;
        }

        /* 🔧 FIX #7: Error blink animation - blink header border red twice */
        @keyframes error-blink {
          0%, 100% { border-color: rgba(255, 255, 255, 0.6); }
          50% { border-color: rgba(255, 59, 48, 0.9); /* iOS red */ }
        }
        
        .evia-main-header.error-blink {
          animation: error-blink 0.5s ease-in-out 2;
        }
        .evia-listen-button {
          height: 26px;
          min-width: 78px;
          padding: 0 13px;
          border-radius: 9000px;
          border: none;
          background: transparent;
          display: flex;
          align-items: center;
          gap: 6px;
          color: #ffffff;
          cursor: pointer;
          transition: transform 0.12s ease;
        }
        .evia-listen-button::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          border-radius: 9000px;
          background: rgba(255,255,255,0.14);
          transition: background 0.15s ease;
          z-index: -1;
        }
        .evia-listen-button::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          border-radius: 9000px;
          padding: 1px;
          background: linear-gradient(169deg, rgba(255,255,255,0.17) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.17) 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: destination-out;
          mask-composite: exclude;
          pointer-events: none;
        }
        .evia-listen-button:hover::before { background: rgba(255,255,255,0.18); }
        .evia-listen-button.listen-active::before { background: rgba(215, 0, 0, 0.5); }
        .evia-listen-button.listen-active:hover::before { background: rgba(255, 20, 20, 0.6); }
        .evia-listen-button.listen-done { background-color: rgba(255,255,255,0.6); transition: background-color 0.15s ease; }
        .evia-listen-button.listen-done::before { display: none; }
        .evia-listen-button.listen-done::after { display: none; }
        .evia-listen-button.listen-done .evia-listen-label { color: black; }
        .evia-listen-button.listen-done .evia-listen-icon svg rect,
        .evia-listen-button.listen-done .evia-listen-icon svg path { fill: black; }
        .evia-listen-button .evia-listen-label { font-size: 12px; font-weight: 600; }
        .evia-listen-icon {
          width: 12px;
          height: 11px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .evia-header-actions {
          -webkit-app-region: no-drag; /* Glass parity: Allow hover + click */
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 4px;
          padding: 0 8px;
          height: 26px;
          border-radius: 6px;
          transition: background 0.15s ease;
          color: #ffffff;
          cursor: pointer;
          position: relative;
          z-index: 1;
        }
        .evia-header-actions:hover {
          background: rgba(255,255,255,0.1);
        }
        .evia-action-text { font-size: 12px; font-weight: 500; }
        .evia-icon-box {
          width: 18px;
          height: 18px;
          border-radius: 13%;
          background: rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 500;
        }
        .evia-settings-button {
          height: 26px;
          width: 26px;
          border-radius: 50%;
          border: none;
          background: transparent;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .evia-settings-button:hover {
          background: rgba(255,255,255,0.1);
        }
        .evia-settings-button.active {
          background: rgba(255,255,255,0.14);
        }
      `}</style>

      <button
        type="button"
        className={`evia-listen-button ${isListenActive ? 'listen-active' : ''} ${listenStatus === 'after' ? 'listen-done' : ''}`}
        onClick={handleListenClick}
      >
        <span className="evia-listen-label">{listenLabel}</span>
        <span className="evia-listen-icon">
          {(isListenActive || listenStatus === 'after') ? (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="9" height="9" rx="1" fill="white"/>
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

        <div className="evia-header-actions" onClick={handleAskClick} role="button" tabIndex={0}>
        <span className="evia-action-text">{i18n.t('overlay.header.ask')}</span>
        <div className="evia-icon-box">
          <img src={CommandIcon} alt="Cmd" width={11} height={12} />
        </div>
        <div className="evia-icon-box">↵</div>
      </div>

      <div className="evia-header-actions" onClick={handleToggleVisibility} role="button" tabIndex={0}>
        <span className="evia-action-text">{i18n.t('overlay.header.show')}/{i18n.t('overlay.header.hide')}</span>
        <div className="evia-icon-box">
          <img src={CommandIcon} alt="Cmd" width={11} height={12} />
        </div>
        <div className="evia-icon-box">\</div>
      </div>

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
