import React from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';

interface SettingsViewProps {
  language: 'de' | 'en';
  onToggleLanguage: () => void;
  onClose?: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ language, onToggleLanguage, onClose }) => {
  return (
    <div className="glass-panel evia-glass" style={{ width: 240, height: 360, pointerEvents: 'auto' }} onMouseEnter={() => window.evia.windows.cancelHideSettingsWindow()} >
      <div className="glass-topbar drag-zone">
        <div className="glass-topbar-title">Settings</div>
        {onClose && (
          <button className="glass-button" onClick={onClose}>✕</button>
        )}
      </div>
      <div className="glass-scroll no-drag" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ color: 'var(--text-color)', fontSize: 'var(--font-size-label)', opacity: 0.85 }}>Language</div>
        <button onClick={onToggleLanguage} className="glass-button" style={{ background: 'rgba(255,255,255,0.12)', height: 28 }}>
          {language.toUpperCase()}
        </button>
        <div style={{ height: 8 }} />
        <div style={{ color: 'var(--text-color)', fontSize: 'var(--font-size-label)', opacity: 0.85 }}>Links</div>
        <button className="glass-button" style={{ background: 'rgba(255,255,255,0.08)' }}>Open Web Settings</button>
      </div>
    </div>
  );
};

export default SettingsView;
