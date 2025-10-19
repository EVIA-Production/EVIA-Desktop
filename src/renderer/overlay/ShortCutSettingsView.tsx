import React from "react";
import "./static/overlay-tokens.css";

interface ShortCutSettingsViewProps {
  onClose?: () => void;
}

const ShortCutSettingsView: React.FC<ShortCutSettingsViewProps> = ({
  onClose,
}) => {
  return (
    <div
      className="evia-glass"
      style={{
        width: 420,
        height: 360,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        position: "relative",
      }}
    >
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
      <div
        className="drag-zone"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            color: "var(--text-color)",
            fontSize: "var(--font-size-title)",
          }}
        >
          Shortcuts
        </div>
      </div>
      <div className="no-drag" style={{ color: "var(--text-color)" }}>
        <div>• Toggle overlay: Cmd/Ctrl + \</div>
        <div>• Open Ask: Cmd/Ctrl + Enter</div>
        <div>• Move overlay: Cmd/Ctrl + Arrow Keys</div>
      </div>
    </div>
  );
};

export default ShortCutSettingsView;
