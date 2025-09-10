import React from 'react';
import './overlay-tokens.css';

interface SettingsViewProps {
  language: 'de' | 'en';
  onToggleLanguage: () => void;
  onClose?: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ language, onToggleLanguage, onClose }) => {
  return (
    <div className="evia-glass" style={{ width: 520, height: 480, padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="drag-zone" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: 'var(--text-color)', fontSize: 'var(--font-size-title)' }}>Settings</div>
        {onClose && (
          <button className="no-drag" onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--text-color)', cursor: 'pointer' }}>✕</button>
        )}
      </div>
      <div className="no-drag" style={{ color: 'var(--text-color)' }}>
        <div style={{ marginBottom: 8 }}>Language</div>
        <button onClick={onToggleLanguage} style={{ border: 'none', borderRadius: 6, padding: '6px 10px', background: 'rgba(255,255,255,0.12)', color: 'var(--text-color)', cursor: 'pointer' }}>
          {language.toUpperCase()}
        </button>
      </div>
      <div style={{ color: 'var(--text-color)', opacity: 0.8 }}>
        Additional settings will be mirrored from Glass.
      </div>
    </div>
  );
};

export default SettingsView;
