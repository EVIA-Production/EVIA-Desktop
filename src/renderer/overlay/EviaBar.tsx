import React from 'react';
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
  return (
    <div
      className="evia-glass drag-zone"
      style={{
        position: 'relative',
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '8px',
        pointerEvents: 'auto'
      }}
    >
      <button
        className="no-drag"
        style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--button-radius)',
          border: 'none',
          background: isListening ? 'rgba(239,68,68,0.8)' : 'rgba(255,255,255,0.12)',
          color: 'var(--text-color)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        title={isListening ? 'Stop' : 'Listen'}
        onClick={onToggleListening}
      >
        <img src={ListenIcon} alt="listen" width={12} height={12} />
      </button>

      <button
        className="no-drag"
        style={{
          height: 28,
          borderRadius: 6,
          border: 'none',
          padding: '0 10px',
          background: currentView === 'ask' ? 'rgba(59,130,246,0.9)' : 'rgba(255,255,255,0.12)',
          color: 'var(--text-color)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12
        }}
        title="Ask"
        onClick={() => onViewChange(currentView === 'ask' ? null : 'ask')}
      >
        <img src={CommandIcon} alt="ask" width={11} height={12} />
        <span>Ask</span>
      </button>

      <button
        className="no-drag"
        style={{
          height: 28,
          borderRadius: 6,
          border: 'none',
          padding: '0 10px',
          background: currentView === 'settings' ? 'rgba(59,130,246,0.9)' : 'rgba(255,255,255,0.12)',
          color: 'var(--text-color)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12
        }}
        title="Settings"
        onClick={() => onViewChange(currentView === 'settings' ? null : 'settings')}
      >
        <img src={SettingsIcon} alt="settings" width={12} height={12} />
        <span>Settings</span>
      </button>

      <button
        className="no-drag"
        style={{
          height: 28,
          borderRadius: 6,
          border: 'none',
          padding: '0 8px',
          background: 'rgba(255,255,255,0.12)',
          color: 'var(--text-color)',
          cursor: 'pointer',
          fontSize: 12
        }}
        title="Toggle language"
        onClick={onToggleLanguage}
      >
        {language.toUpperCase()}
      </button>

      {onToggleVisibility && (
        <button
          className="no-drag"
          style={{
            height: 28,
            borderRadius: 6,
            border: 'none',
            padding: '0 8px',
            background: 'rgba(255,255,255,0.12)',
            color: 'var(--text-color)',
            cursor: 'pointer',
            fontSize: 12
          }}
          title="Hide"
          onClick={onToggleVisibility}
        >
          Hide
        </button>
      )}
    </div>
  );
};

export default EviaBar;
