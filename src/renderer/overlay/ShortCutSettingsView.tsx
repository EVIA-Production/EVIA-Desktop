import React from 'react';
import './overlay-glass.css';

interface ShortCutSettingsViewProps {
  onClose?: () => void;
}

const ShortCutSettingsView: React.FC<ShortCutSettingsViewProps> = ({ onClose }) => {
  const isMacPlatform = typeof window !== 'undefined' && (window as any)?.platformInfo?.isMac === true;
  const isGermanLocale = typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('de');
  const modifierKey = isMacPlatform ? 'Cmd' : 'Ctrl';
  const toggleKey = isMacPlatform ? (isGermanLocale ? '#' : '\\') : 'Space';

  return (
    <div className="shortcuts-container">
      {/* Close button - Glass parity */}
      <button
        className="close-button"
        onClick={() => (window as any).evia?.closeWindow?.('shortcuts')}
        title="Close"
      >
        <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>

      <div className="shortcuts-header drag-zone">
        <h2>Shortcuts</h2>
      </div>

      <div className="shortcuts-list no-drag">
        <div className="shortcut-row">
          <div className="shortcut-name">• Toggle overlay: {modifierKey} + {toggleKey}</div>
        </div>
        <div className="shortcut-row">
          <div className="shortcut-name">• Open Ask: {modifierKey} + Enter</div>
        </div>
        <div className="shortcut-row">
          <div className="shortcut-name">• Move overlay: {modifierKey} + Arrow Keys</div>
        </div>
      </div>
    </div>
  );
};

export default ShortCutSettingsView;
