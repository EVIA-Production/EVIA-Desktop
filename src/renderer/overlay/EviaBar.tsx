import React, { useState } from 'react';
import './overlay-tokens.css';
// Use ESM-safe asset URLs under Vite (no require in browser)
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
  const [listenPressed, setListenPressed] = useState(false)
  const [askPressed, setAskPressed] = useState(false)
  const [settingsPressed, setSettingsPressed] = useState(false)
  const [isTogglingSession, setIsTogglingSession] = useState(false); // Ported from Glass

  const toggleWindow = async (name: 'listen' | 'ask' | 'settings' | 'shortcuts') => {
    if (isTogglingSession) return;
    setIsTogglingSession(true);
    try {
      const res = await (window as any).evia?.windows?.show(name)
      if (res && res.ok) {
        const isShown = res.toggled === 'shown'
        if (name === 'listen') setListenPressed(isShown)
        if (name === 'ask') setAskPressed(isShown)
        if (name === 'settings') setSettingsPressed(isShown)
        if (onViewChange) onViewChange(isShown ? name : null)
        return isShown
      }
    } catch (e) {
      console.error('[EviaBar] Toggle failed', e)
    } finally {
      setIsTogglingSession(false);
    }
    return false
  }
  return (
    <div className="evia-header">
      <button
        className={`listen-button ${(listenPressed || isListening) ? 'active' : ''}`}
        aria-pressed={listenPressed}
        title={isListening ? 'Stop' : 'Listen'}
        onClick={async () => {
          try {
            // Ensure chat id exists (Glass-like: session starts on Listen)
            const token = localStorage.getItem('auth_token') || ''
            const baseUrl = (window as any).EVIA_BACKEND_URL || (window as any).API_BASE_URL || 'http://localhost:8000'
            let chatId = Number(localStorage.getItem('current_chat_id') || '0')
            if (!token) { console.warn('[EviaBar] Missing auth token'); }
            if (!chatId || Number.isNaN(chatId)) {
              if (token) {
                const res = await fetch(`${String(baseUrl).replace(/\/$/, '')}/chat/`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } })
                if (res.ok) {
                  const data = await res.json()
                  chatId = Number(data?.id)
                  if (chatId && !Number.isNaN(chatId)) { try { localStorage.setItem('current_chat_id', String(chatId)) } catch {} }
                } else {
                  console.warn('[EviaBar] Failed to create chat', res.status)
                }
              }
            }
          } catch (e) {
            console.error('[EviaBar] ensure chat failed', e)
          }
          const shown = await toggleWindow('listen')
          if (shown !== undefined) onToggleListening()
        }}
      >
        <div className="action-text">
          <div className="action-text-content">{isListening ? 'Stop' : 'Listen'}</div>
        </div>
        <div className="listen-icon" aria-hidden>
          {isListening ? (
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
        </div>
      </button>

      <div className="header-actions ask-action no-drag" onClick={async () => { await toggleWindow('ask') }}>
        <div className="action-text"><div className="action-text-content">Ask</div></div>
        <div className="icon-container">
          <div className="icon-box">↵</div>
        </div>
      </div>

      <div className="header-actions no-drag" onClick={onToggleVisibility}>
        <div className="action-text"><div className="action-text-content">Show/Hide</div></div>
        <div className="icon-container">
          <div className="icon-box">⌘</div>
          <div className="icon-box">\</div>
        </div>
      </div>

      <button
        className="settings-button no-drag"
        title="Settings"
        onMouseEnter={async () => { try { await (window as any).evia?.windows?.show('settings') } catch {} }}
        onMouseLeave={async () => { try { await (window as any).evia?.windows?.hide('settings') } catch {} }}
      >
        <div className="settings-icon" aria-hidden>
          <img src={SettingsIcon} alt="" width={16} height={16} />
        </div>
      </button>
    </div>
  );
};

export default EviaBar;
