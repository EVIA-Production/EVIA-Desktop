import React from 'react';
import './overlay-tokens.css';

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
        position: 'fixed',
        left: 20,
        top: 120,
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--gap)'
      }}
    >
      <button
        className="no-drag"
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--button-radius)',
          border: 'none',
          background: isListening ? '#ef4444' : 'rgba(255,255,255,0.12)',
          color: 'var(--text-color)',
          cursor: 'pointer'
        }}
        title={isListening ? 'Stop' : 'Listen'}
        onClick={onToggleListening}
      >
        ●
      </button>

      <button
        className="no-drag"
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--button-radius)',
          border: 'none',
          background: currentView === 'ask' ? '#3b82f6' : 'rgba(255,255,255,0.12)',
          color: 'var(--text-color)',
          cursor: 'pointer'
        }}
        title="Ask"
        onClick={() => onViewChange(currentView === 'ask' ? null : 'ask')}
      >
        ?
      </button>

      <button
        className="no-drag"
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--button-radius)',
          border: 'none',
          background: currentView === 'settings' ? '#3b82f6' : 'rgba(255,255,255,0.12)',
          color: 'var(--text-color)',
          cursor: 'pointer'
        }}
        title="Settings"
        onClick={() => onViewChange(currentView === 'settings' ? null : 'settings')}
      >
        ⚙
      </button>

      <button
        className="no-drag"
        style={{
          width: 44,
          height: 24,
          borderRadius: 6,
          border: 'none',
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
            width: 44,
            height: 24,
            borderRadius: 6,
            border: 'none',
            background: 'rgba(255,255,255,0.12)',
            color: 'var(--text-color)',
            cursor: 'pointer',
            fontSize: 12
          }}
          title="Hide"
          onClick={onToggleVisibility}
        >
          Ⓧ
        </button>
      )}
    </div>
  );
};

export default EviaBar;
