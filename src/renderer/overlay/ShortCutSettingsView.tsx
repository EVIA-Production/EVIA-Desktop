import React from "react";
import "../overlay/static/overlay-glass.css";

interface ShortCutSettingsViewProps {
  onClose?: () => void;
}

const ShortCutSettingsView: React.FC<ShortCutSettingsViewProps> = ({
  onClose,
}) => {
  return (
    <div className="evia-glass shortcuts-container">
      {/* Close button - Glass parity */}
      <button
        className="close-button"
        onClick={() => (window as any).evia?.closeWindow?.("shortcuts")}
        title="Close"
      >
        <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
          <path
            d="M1 1L9 9M9 1L1 9"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div className="drag-zone shortcuts-header">
        <div className="shortcuts-title">Shortcuts</div>
      </div>
      <div className="no-drag shortcuts-list">
        <div className="shortcuts-item">• Toggle overlay: Cmd/Ctrl + \</div>
        <div className="shortcuts-item">• Open Ask: Cmd/Ctrl + Enter</div>
        <div className="shortcuts-item">
          • Move overlay: Cmd/Ctrl + Arrow Keys
        </div>
      </div>
    </div>
  );
};

export default ShortCutSettingsView;
