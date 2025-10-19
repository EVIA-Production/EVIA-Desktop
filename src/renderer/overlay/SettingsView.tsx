import React, { useEffect, useState } from "react";
import "./static/overlay-tokens.css";
import "./static/overlay-glass.css";
import { i18n } from "../i18n/i18n";

interface SettingsViewProps {
  language: "de" | "en";
  onToggleLanguage: () => void;
  onClose?: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({
  language,
  onToggleLanguage,
  onClose,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [shortcuts, setShortcuts] = useState<{ [key: string]: string }>({});
  const [showPresets, setShowPresets] = useState(false);
  const [presets, setPresets] = useState<
    { id: number; title: string; is_default: boolean }[]
  >([]);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);

  // Handle logout - clears auth and returns to welcome
  const handleLogout = async () => {
    console.log("[SettingsView] 🚪 Logout clicked");
    try {
      await (window as any).evia?.auth?.logout?.();
      console.log("[SettingsView] ✅ Logout successful");
    } catch (error) {
      console.error("[SettingsView] ❌ Logout failed:", error);
    }
  };

  // Handle quit - closes entire app
  const handleQuit = async () => {
    console.log("[SettingsView] 🛑 Quit clicked");
    try {
      await (window as any).evia?.app?.quit?.();
      console.log("[SettingsView] ✅ Quit initiated");
    } catch (error) {
      console.error("[SettingsView] ❌ Quit failed:", error);
    }
  };

  useEffect(() => {
    // Simulate loading data
    setTimeout(() => {
      setShortcuts({
        toggleVisibility: "Cmd+\\",
        nextStep: "Cmd+Enter",
        scrollUp: "Cmd+Up",
        scrollDown: "Cmd+Down",
      });
      setPresets([
        { id: 1, title: "Default Preset", is_default: true },
        { id: 2, title: "Custom Preset 1", is_default: false },
      ]);
      setSelectedPreset(2);
      setIsLoading(false);
    }, 1000);
  }, []);

  const togglePresets = () => setShowPresets(!showPresets);

  const handlePresetSelect = (presetId: number) => {
    setSelectedPreset(presetId);
  };

  const handleToggleAutoUpdate = () => {
    setAutoUpdateEnabled(!autoUpdateEnabled);
  };

  const renderShortcutKeys = (accelerator: string) => {
    const keyMap: { [key: string]: string } = {
      Cmd: "⌘",
      Command: "⌘",
      Ctrl: "⌃",
      Alt: "⌥",
      Shift: "⇧",
      Enter: "↵",
      Up: "↑",
      Down: "↓",
      Left: "←",
      Right: "→",
    };
    return accelerator.split("+").map((key, index) => (
      <span key={index} className="shortcut-key">
        {keyMap[key] || key}
      </span>
    ));
  };

  if (isLoading) {
    return (
      <div
        className="settings-container"
        style={{ background: "#1e1e1e", borderRadius: "12px", padding: "16px" }}
      >
        <div
          className="loading-state"
          style={{ textAlign: "center", color: "white" }}
        >
          <div className="loading-spinner"></div>
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  // NOTE: Glass uses window-level mouse events (overlay-windows.ts:204-227)
  // React onMouseEnter/Leave don't fire when moving between different BrowserWindows
  // The main process handles mouse tracking via 'mouse-enter'/'mouse-leave' window events

  return (
    <div
      className="settings-container"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "rgba(20, 20, 20, 0.8)",
        borderRadius: "12px",
        outline: "0.5px rgba(255, 255, 255, 0.2) solid",
        outlineOffset: "-1px",
        boxSizing: "border-box",
        position: "relative",
        overflowY: "auto",
        padding: "12px",
        zIndex: 1000,
        color: "white",
      }}
    >
      <style>{`
        .settings-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.15);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          border-radius: 12px;
          filter: blur(10px);
          z-index: -1;
          pointer-events: none;
        }
        .settings-container::-webkit-scrollbar {
          width: 6px;
        }
        .settings-container::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 3px;
        }
        .settings-container::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }
        .settings-container::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>
      {/* NO close button - Glass has no close button (SettingsView.js:1183) */}
      <div
        className="header-section"
        style={{
          marginBottom: "16px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          paddingBottom: "8px",
        }}
      >
        <h1
          className="app-title"
          style={{ fontSize: "18px", fontWeight: "bold", margin: 0 }}
        >
          {i18n.t("overlay.settings.title")}
        </h1>
        <div
          className="account-info"
          style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.7)" }}
        >
          Account: Not Logged In
        </div>
      </div>

      <div className="language-section" style={{ marginBottom: "16px" }}>
        <h2
          style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}
        >
          {i18n.t("overlay.settings.language")}
        </h2>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={onToggleLanguage}
            style={{
              flex: 1,
              background:
                language === "de"
                  ? "rgba(0, 122, 255, 0.3)"
                  : "rgba(255, 255, 255, 0.1)",
              border:
                language === "de"
                  ? "1px solid rgba(0, 122, 255, 0.5)"
                  : "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: "4px",
              color: "white",
              padding: "8px",
              fontSize: "12px",
              fontWeight: "500",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {i18n.t("overlay.settings.german")}
          </button>
          <button
            onClick={onToggleLanguage}
            style={{
              flex: 1,
              background:
                language === "en"
                  ? "rgba(0, 122, 255, 0.3)"
                  : "rgba(255, 255, 255, 0.1)",
              border:
                language === "en"
                  ? "1px solid rgba(0, 122, 255, 0.5)"
                  : "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: "4px",
              color: "white",
              padding: "8px",
              fontSize: "12px",
              fontWeight: "500",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {i18n.t("overlay.settings.english")}
          </button>
        </div>
      </div>

      {/* Account Actions */}
      <div className="account-section" style={{ marginBottom: "16px" }}>
        <h2
          style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}
        >
          Account
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            onClick={handleLogout}
            style={{
              background: "rgba(255, 149, 0, 0.2)",
              border: "1px solid rgba(255, 149, 0, 0.4)",
              borderRadius: "6px",
              color: "white",
              padding: "10px 16px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 149, 0, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 149, 0, 0.2)";
            }}
          >
            <span>🚪</span>
            <span>Logout</span>
          </button>
          <button
            onClick={handleQuit}
            style={{
              background: "rgba(255, 59, 48, 0.2)",
              border: "1px solid rgba(255, 59, 48, 0.4)",
              borderRadius: "6px",
              color: "white",
              padding: "10px 16px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 59, 48, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 59, 48, 0.2)";
            }}
          >
            <span>🛑</span>
            <span>Quit EVIA</span>
          </button>
        </div>
      </div>

      <div className="shortcuts-section" style={{ marginBottom: "16px" }}>
        <h2
          style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}
        >
          {i18n.t("overlay.settings.shortcuts")}
        </h2>
        {Object.entries(shortcuts).map(([name, accelerator]) => (
          <div
            key={name}
            className="shortcut-item"
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span
              className="shortcut-name"
              style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.9)" }}
            >
              {name.replace(/([A-Z])/g, " $1")}
            </span>
            <div
              className="shortcut-keys"
              style={{ display: "flex", gap: "4px" }}
            >
              {renderShortcutKeys(accelerator)}
            </div>
          </div>
        ))}
      </div>

      <div className="preset-section" style={{ marginBottom: "16px" }}>
        <div
          className="preset-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "8px",
          }}
        >
          <span
            className="preset-title"
            style={{ fontSize: "14px", fontWeight: "bold" }}
          >
            {i18n.t("overlay.settings.presets")}
            <span
              className="preset-count"
              style={{
                fontSize: "12px",
                color: "rgba(255, 255, 255, 0.5)",
                marginLeft: "4px",
              }}
            >
              ({presets.filter((p) => !p.is_default).length})
            </span>
          </span>
          <span
            className="preset-toggle"
            onClick={togglePresets}
            style={{
              fontSize: "12px",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: "4px",
              transition: "background-color 0.2s",
            }}
          >
            {showPresets ? "▼" : "▶"}
          </span>
        </div>

        {showPresets && (
          <div
            className="preset-list"
            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
          >
            {presets.filter((p) => !p.is_default).length === 0 ? (
              <div
                className="no-presets-message"
                style={{
                  fontSize: "12px",
                  color: "rgba(255, 255, 255, 0.5)",
                  textAlign: "center",
                }}
              >
                No custom presets yet.
              </div>
            ) : (
              presets
                .filter((p) => !p.is_default)
                .map((preset) => (
                  <div
                    key={preset.id}
                    className={`preset-item ${selectedPreset === preset.id ? "selected" : ""}`}
                    onClick={() => handlePresetSelect(preset.id)}
                    style={{
                      padding: "8px",
                      background:
                        selectedPreset === preset.id
                          ? "rgba(0, 122, 255, 0.2)"
                          : "rgba(255, 255, 255, 0.05)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      transition: "background-color 0.2s",
                    }}
                  >
                    <span
                      className="preset-name"
                      style={{ fontSize: "12px", color: "white" }}
                    >
                      {preset.title}
                    </span>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      <div
        className="buttons-section"
        style={{ display: "flex", flexDirection: "column", gap: "8px" }}
      >
        <button
          className="settings-button"
          onClick={handleToggleAutoUpdate}
          style={{
            background: "rgba(255, 255, 255, 0.1)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: "4px",
            color: "white",
            padding: "8px",
            fontSize: "12px",
            fontWeight: "500",
            cursor: "pointer",
            transition: "background-color 0.2s",
          }}
        >
          {i18n.t("overlay.settings.autoUpdate")}:{" "}
          {autoUpdateEnabled ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
};

export default SettingsView;
