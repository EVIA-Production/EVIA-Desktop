import React, { useEffect, useState } from "react";
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
  // Global visibility: when true, windows are fully opaque (invisibility disabled)
  const [invisibilityDisabled, setInvisibilityDisabled] = useState<boolean>(
    () => {
      try {
        return localStorage.getItem("evia:invisibilityDisabled") === "1";
      } catch {
        return false;
      }
    }
  );

  // BroadcastChannel to sync visibility across overlay windows
  const bcRef = React.useRef<BroadcastChannel | null>(null);

  // Initialize BroadcastChannel and listen for external changes
  useEffect(() => {
    // Apply current state to this window
    document.body.classList.toggle(
      "invisibility-disabled",
      invisibilityDisabled
    );

    const bc = new BroadcastChannel("evia-visibility");
    bcRef.current = bc;

    const onMessage = (e: MessageEvent) => {
      const next = (e as any)?.data?.invisibilityDisabled;
      if (typeof next === "boolean") {
        setInvisibilityDisabled(next);
        document.body.classList.toggle("invisibility-disabled", next);
      }
    };
    bc.addEventListener("message", onMessage as any);

    // Announce current state so newly opened windows sync
    try {
      bc.postMessage({ invisibilityDisabled });
    } catch {}

    return () => {
      try {
        bc.removeEventListener("message", onMessage as any);
      } catch {}
      bc.close();
      bcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist and broadcast when toggled
  useEffect(() => {
    try {
      localStorage.setItem(
        "evia:invisibilityDisabled",
        invisibilityDisabled ? "1" : "0"
      );
    } catch {}
    document.body.classList.toggle(
      "invisibility-disabled",
      invisibilityDisabled
    );
    try {
      bcRef.current?.postMessage({ invisibilityDisabled });
    } catch {}
  }, [invisibilityDisabled]);

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
      <div className="settings-container">
        <div className="loading-state">
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
    <div className="settings-container">
      {/* NO close button - Glass has no close button (SettingsView.js:1183) */}
      <div className="settings-header">
        <h1 className="settings-title">{i18n.t("overlay.settings.title")}</h1>
        <div className="settings-subtext">Account: Not Logged In</div>
      </div>

      <div className="settings-section">
        <h2 className="settings-h2">{i18n.t("overlay.settings.language")}</h2>
        <div className="language-buttons">
          <button
            onClick={onToggleLanguage}
            className={`lang-btn ${language === "de" ? "selected" : ""}`}
          >
            {i18n.t("overlay.settings.german")}
          </button>
          <button
            onClick={onToggleLanguage}
            className={`lang-btn ${language === "en" ? "selected" : ""}`}
          >
            {i18n.t("overlay.settings.english")}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h2 className="settings-h2">{i18n.t("overlay.settings.shortcuts")}</h2>
        {Object.entries(shortcuts).map(([name, accelerator]) => (
          <div key={name} className="shortcut-item">
            <span className="shortcut-name">
              {name.replace(/([A-Z])/g, " $1")}
            </span>
            <div className="shortcut-keys">
              {renderShortcutKeys(accelerator)}
            </div>
          </div>
        ))}
      </div>

      <div className="settings-section">
        <div className="preset-header">
          <span className="preset-title">
            {i18n.t("overlay.settings.presets")}
            <span className="preset-count">
              ({presets.filter((p) => !p.is_default).length})
            </span>
          </span>
          <span className="preset-toggle" onClick={togglePresets}>
            {showPresets ? "▼" : "▶"}
          </span>
        </div>

        {showPresets && (
          <div className="preset-list">
            {presets.filter((p) => !p.is_default).length === 0 ? (
              <div className="no-presets-message">No custom presets yet.</div>
            ) : (
              presets
                .filter((p) => !p.is_default)
                .map((preset) => (
                  <div
                    key={preset.id}
                    className={`preset-item ${selectedPreset === preset.id ? "selected" : ""}`}
                    onClick={() => handlePresetSelect(preset.id)}
                  >
                    <span className="preset-name">{preset.title}</span>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      <div className="buttons-section">
        <button className="settings-cta-btn" onClick={handleToggleAutoUpdate}>
          {i18n.t("overlay.settings.autoUpdate")}:{" "}
          {autoUpdateEnabled ? "On" : "Off"}
        </button>
      </div>

      {/* Visibility / Invisibility toggle */}
      <div className="settings-section">
        <h2 className="settings-h2">Visibility</h2>
        <div className="buttons-section">
          <button
            className="settings-cta-btn"
            onClick={() => setInvisibilityDisabled((v) => !v)}
          >
            Disable Invisibility: {invisibilityDisabled ? "On" : "Off"}
          </button>
        </div>
      </div>

      {/* Account Actions */}
      <div className="settings-section">
        <h2 className="settings-h2">Account</h2>
        <div className="account-actions">
          <button onClick={handleLogout} className="btn-logout">
            <span>🚪</span>
            <span>Logout</span>
          </button>
          <button onClick={handleQuit} className="btn-quit">
            <span>🛑</span>
            <span>Quit EVIA</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
