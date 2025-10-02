import React, { useEffect, useRef, useState } from 'react';
import './overlay-tokens.css';

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
    const shown = await toggleWindow('listen');
    setIsListenActive(shown);
    if (shown) {
      setListenStatus('in');
      onToggleListening();
    } else {
      setListenStatus('after');
      onToggleListening();
    }
  };

  const handleAskClick = async () => {
    const shown = await toggleWindow('ask');
    setIsAskActive(shown);
  };

  // Glass parity: Settings hover behavior with 200ms delay (windowManager.js:291-323)
  const showSettingsWindow = () => {
    // Cancel any pending hide
    if (settingsHideTimerRef.current) {
      clearTimeout(settingsHideTimerRef.current);
      settingsHideTimerRef.current = null;
    }
    // Show immediately
    (window as any).evia?.windows?.showSettingsWindow?.();
    setIsSettingsActive(true);
  };

  const hideSettingsWindow = () => {
    // Hide after 200ms delay (allows mouse to move to settings panel)
    if (settingsHideTimerRef.current) {
      clearTimeout(settingsHideTimerRef.current);
    }
    settingsHideTimerRef.current = setTimeout(() => {
      (window as any).evia?.windows?.hideSettingsWindow?.();
      setIsSettingsActive(false);
      settingsHideTimerRef.current = null;
    }, 200);
  };

  const handleToggleVisibility = async () => {
    await (window as any).evia?.windows?.toggleAllVisibility?.();
    onToggleVisibility?.();
  };

  const listenLabel = listenStatus === 'before' ? 'Listen' : listenStatus === 'in' ? 'Stop' : 'Done';

  return (
    <div ref={headerRef} className="evia-main-header">
      <style>{`
        .evia-main-header {
          position: relative;
          width: max-content;
          height: 47px;
          padding: 2px 10px 2px 13px;
          display: inline-flex;
          align-items: center;
          justify-content: space-between;
          border-radius: 9000px;
          backdrop-filter: blur(18px);
          -webkit-backface-visibility: hidden;
          -webkit-app-region: drag;
          box-sizing: border-box;
          user-select: none;
          font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .evia-main-header::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 9000px;
          background: rgba(0,0,0,0.6);
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          z-index: -2;
        }
        .evia-main-header::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 9000px;
          padding: 1px;
          background: linear-gradient(169deg, rgba(255,255,255,0.17) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.17) 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: destination-out;
          mask-composite: exclude;
          pointer-events: none;
          z-index: -1;
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
          inset: 0;
          border-radius: 9000px;
          background: rgba(255,255,255,0.14);
          transition: background 0.15s ease;
          z-index: -1;
        }
        .evia-listen-button:hover::before { background: rgba(255,255,255,0.18); }
        .evia-listen-button.listen-active::before { background: rgba(215, 0, 0, 0.56); }
        .evia-listen-button.listen-active:hover::before { background: rgba(255, 20, 20, 0.64); }
        .evia-listen-button.listen-done::before { background: rgba(255,255,255,0.65); }
        .evia-listen-button .evia-listen-label { font-size: 12px; font-weight: 500; }
        .evia-listen-icon {
          width: 12px;
          height: 11px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .evia-header-actions {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 9px;
          padding: 0 8px;
          height: 26px;
          border-radius: 6px;
          transition: background 0.15s ease;
          color: #ffffff;
          cursor: pointer;
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
        .evia-divider {
          width: 1px;
          height: 18px;
          background: rgba(255,255,255,0.08);
          margin: 0 6px;
        }
      `}</style>

      <button
        type="button"
        className={`evia-listen-button ${isListenActive ? 'listen-active' : ''} ${listenStatus === 'after' ? 'listen-done' : ''}`}
        onClick={handleListenClick}
      >
        <span className="evia-listen-icon">
          <img src={ListenIcon} alt="Listen" width={12} height={11} />
        </span>
        <span className="evia-listen-label">{listenLabel}</span>
      </button>

      <div className="evia-divider" aria-hidden="true" />

      <div className="evia-header-actions" onClick={handleAskClick} role="button" tabIndex={0}>
        <span className="evia-action-text">Ask</span>
        <div className="evia-icon-box">
          <img src={CommandIcon} alt="Cmd" width={12} height={12} />
        </div>
        <div className="evia-icon-box">↵</div>
      </div>

      <div className="evia-header-actions" onClick={handleToggleVisibility} role="button" tabIndex={0}>
        <span className="evia-action-text">Show/Hide</span>
        <div className="evia-icon-box">⌘</div>
        <div className="evia-icon-box">\</div>
      </div>

      <button
        type="button"
        className={`evia-settings-button ${isSettingsActive ? 'active' : ''}`}
        onMouseEnter={showSettingsWindow}
        onMouseLeave={hideSettingsWindow}
        aria-label="Settings"
      >
        <img src={SettingsIcon} alt="Settings" width={14} height={14} />
      </button>
    </div>
  );
};

export default EviaBar;
