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
  const [listenStatus, setListenStatus] = useState<'before' | 'in' | 'after'>(isListening ? 'in' : 'before');
  const [isListenActive, setIsListenActive] = useState(currentView === 'listen');
  const [isAskActive, setIsAskActive] = useState(currentView === 'ask');
  const [isSettingsActive, setIsSettingsActive] = useState(currentView === 'settings');

  useEffect(() => {
    setListenStatus(isListening ? 'in' : 'before');
  }, [isListening]);

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

  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;

    const handleMouseDown = async (event: MouseEvent) => {
      if (event.button !== 0) return;
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
    } else if (listenStatus === 'in') {
      // Stop → Done: Window STAYS visible
      console.log('[EviaBar] Stop → Done: Window stays visible');
      setListenStatus('after');
      setIsListenActive(false);
      onToggleListening();
      // Window remains visible for insights
    } else if (listenStatus === 'after') {
      // Done → Listen: Hide window
      console.log('[EviaBar] Done → Listen: Hiding listen window');
      const result = await (window as any).evia?.windows?.hide?.('listen');
      console.log('[EviaBar] Hide result:', result);
      setListenStatus('before');
      setIsListenActive(false);
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
    // Show immediately
    (window as any).evia?.windows?.showSettingsWindow?.();
    setIsSettingsActive(true);
  };

  const hideSettingsWindow = () => {
    console.log('[EviaBar] hideSettingsWindow called - starting 200ms timer');
    // Hide after 200ms delay (allows mouse to move to settings panel)
    if (settingsHideTimerRef.current) {
      clearTimeout(settingsHideTimerRef.current);
    }
    settingsHideTimerRef.current = setTimeout(() => {
      console.log('[EviaBar] 200ms timer expired - hiding settings');
      (window as any).evia?.windows?.hideSettingsWindow?.();
      setIsSettingsActive(false);
      settingsHideTimerRef.current = null;
    }, 200);
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
          width: 100%;
          height: 47px;
          padding: 2px 10px 2px 13px;
          background: transparent;
          overflow: hidden;
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
