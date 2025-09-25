import React, { useState } from 'react';
import './overlay-tokens.css';
// Use ESM-safe asset URLs under Vite (no require in browser)
const ListenIcon = new URL('./assets/Listen.svg', import.meta.url).href;
const SettingsIcon = new URL('./assets/setting.svg', import.meta.url).href;
const CommandIcon = new URL('./assets/command.svg', import.meta.url).href;
// Change to regular import
import { startCapture } from '../audio-processor.js';
import { getWebSocketInstance, getOrCreateChatId } from '../services/websocketService';

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

  const handleListenClick = () => {
    startCapture();
    // Update UI state
  }

  return (
    <div style={{
      height: '32px',
      borderRadius: '16px',
      backdropFilter: 'blur(10px)',
      background: 'linear-gradient(169deg, rgba(255,255,255,0.17) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.17) 100%)',
      fontFamily: "'Helvetica Neue', sans-serif",
      fontSize: '13px',
      fontWeight: 500,
      // Add hover via class or state
    }}>
      {/* Buttons with hover bg rgba(255,255,255,0.1) */}
    </div>
  );
};

export default EviaBar;
