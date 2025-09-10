import React from 'react';
import './overlay-tokens.css';

interface ShortCutSettingsViewProps {
  onClose?: () => void;
}

const ShortCutSettingsView: React.FC<ShortCutSettingsViewProps> = ({ onClose }) => {
  return (
    <div className="evia-glass" style={{ width: 420, height: 360, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="drag-zone" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: 'var(--text-color)', fontSize: 'var(--font-size-title)' }}>Shortcuts</div>
        {onClose && (
          <button className="no-drag" onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--text-color)', cursor: 'pointer' }}>✕</button>
        )}
      </div>
      <div className="no-drag" style={{ color: 'var(--text-color)' }}>
        <div>• Toggle overlay: Cmd/Ctrl + \</div>
        <div>• Open Ask: Cmd/Ctrl + Enter</div>
        <div>• Move overlay: Cmd/Ctrl + Arrow Keys</div>
      </div>
    </div>
  );
};

export default ShortCutSettingsView;
