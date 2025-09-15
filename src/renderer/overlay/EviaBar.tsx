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
  const [listenStatus, setListenStatus] = useState<'before' | 'in' | 'after'>('before')
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
        className={`listen-button ${(listenPressed || listenStatus === 'in' || isListening) ? 'active' : ''} ${listenStatus === 'after' ? 'done' : ''}`}
        aria-pressed={listenPressed}
        title={listenStatus === 'before' ? 'Listen' : listenStatus === 'in' ? 'Stop' : 'Done'}
        onClick={async () => {
          try {
            if (listenStatus === 'before') {
              // Ensure chat id exists and is valid before starting session
              let token = localStorage.getItem('auth_token') || ''
              try { const p = await (window as any).evia?.prefs?.get?.(); const fromPrefs = p?.prefs?.auth_token; if (fromPrefs) token = fromPrefs } catch {}
              const baseUrl = (window as any).EVIA_BACKEND_URL || (window as any).API_BASE_URL || 'http://localhost:8000'
              const apiBase = String(baseUrl).replace(/\/$/, '')
              // Prefer prefs current_chat_id
              let chatIdStr: string | null = null
              try { const p = await (window as any).evia?.prefs?.get?.(); const fromPrefsCid = p?.prefs?.current_chat_id; if (fromPrefsCid) chatIdStr = String(fromPrefsCid) } catch {}
              if (!chatIdStr) { try { chatIdStr = localStorage.getItem('current_chat_id') } catch {} }
              let chatId = Number(chatIdStr || '0')
              if (!token) { console.warn('[EviaBar] Missing auth token'); }
              // Validate existing chat id if present; otherwise create
              const ensureValidChat = async (): Promise<number> => {
                if (token && chatId && !Number.isNaN(chatId)) {
                  try {
                    const v = await fetch(`${apiBase}/chat/${encodeURIComponent(String(chatId))}/`, { headers: { 'Authorization': `Bearer ${token}` } })
                    if (v.ok) return chatId
                  } catch {}
                }
                if (!token) return chatId
                // Create new chat if missing or invalid
                try {
                  const res = await fetch(`${apiBase}/chat/`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } })
                  if (res.ok) {
                    const data = await res.json()
                    let newId = Number((data && (data.id ?? (data as any).chat_id)) ?? NaN)
                    // Fallback: list chats and pick the most recent
                    if (!newId || Number.isNaN(newId)) {
                      try {
                        const list = await fetch(`${apiBase}/chat/`, { headers: { 'Authorization': `Bearer ${token}` } })
                        if (list.ok) {
                          const chats = await list.json()
                          if (Array.isArray(chats) && chats.length) {
                            newId = Number(chats[0]?.id)
                          }
                        }
                      } catch {}
                    }
                    if (newId && !Number.isNaN(newId)) {
                      try { localStorage.setItem('current_chat_id', String(newId)) } catch {}
                      try { await (window as any).evia?.prefs?.set?.({ current_chat_id: String(newId) }) } catch {}
                      return newId
                    }
                  } else {
                    console.warn('[EviaBar] Failed to create chat', res.status)
                  }
                } catch (e) {
                  console.warn('[EviaBar] Error creating chat', e)
                }
                return chatId
              }
              chatId = await ensureValidChat()
              // Show listen window and enter session
              try { await (window as any).evia?.windows?.ensureShown?.('listen') } catch {}
              setListenStatus('in')
              onToggleListening()
            } else if (listenStatus === 'in') {
              // Stop session; keep window for post-call affordances
              setListenStatus('after')
              // Note: do not toggle visibility or onToggleListening here
            } else {
              // Done: hide window and reset to before
              try { await (window as any).evia?.windows?.hide?.('listen') } catch {}
              setListenStatus('before')
              onToggleListening()
            }
          } catch (e) {
            console.error('[EviaBar] Listen button flow failed', e)
          }
        }}
      >
        <div className="action-text">
          <div className="action-text-content">{listenStatus === 'before' ? 'Listen' : listenStatus === 'in' ? 'Stop' : 'Done'}</div>
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
        <div className="icon-container" style={{ gap: '6px' /* Adjusted gap for consistent spacing */ }}>
          <div className="icon-box">
            <img src={CommandIcon} alt="Command Icon" width={12} height={12} />
          </div>
          <div className="icon-box">↵</div>
        </div>
      </div>

      <div className="header-actions no-drag" onClick={onToggleVisibility}>
        <div className="action-text"><div className="action-text-content">Show/Hide</div></div>
        <div className="icon-container" style={{ gap: '6px' /* Adjusted gap for consistent spacing */ }}>
          <div className="icon-box">⌘</div>
          <div className="icon-box">\</div>
        </div>
      </div>

      <button
        className="settings-button no-drag"
        title="Settings"
        onMouseEnter={async () => { try { await (window as any).evia?.windows?.show('settings') } catch {} }}
        onMouseLeave={async () => { try { await (window as any).evia?.windows?.hide('settings') } catch {} }}
        style={{
          width: '20px', // Adjusted width to match Glass
          height: '20px', // Adjusted height to match Glass
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="settings-icon" aria-hidden>
          <img
            src={SettingsIcon}
            alt=""
            width={12} // Adjusted size to match Glass
            height={12} // Adjusted size to match Glass
            style={{
              margin: '0 auto', // Centered positioning
            }}
          />
        </div>
      </button>
    </div>
  );
};

export default EviaBar;
