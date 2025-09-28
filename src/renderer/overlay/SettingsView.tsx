import React, { useEffect, useState } from "react";
import "./overlay-tokens.css";
import "./overlay-glass.css";

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
  const [groqKey, setGroqKey] = useState<string | null>(null);
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState("");
  const [validationState, setValidationState] = useState<{
    loading?: boolean;
    ok?: boolean;
    error?: string;
  } | null>(null);
  const [shortcuts, setShortcuts] = useState<{ [key: string]: string }>({});
  const [showPresets, setShowPresets] = useState(false);
  const [presets, setPresets] = useState<
    { id: number; title: string; is_default: number }[]
  >([]);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);

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
        { id: 1, title: "Default Preset", is_default: 1 },
        { id: 2, title: "Custom Preset 1", is_default: 0 },
      ]);
      setSelectedPreset(2);
      setIsLoading(false);
    }, 1000);

    // Load initial keys (Groq + JWT from prefs)
    (async () => {
      try {
        const keysResp = await (
          window as any
        ).evia?.settingsView?.getAllKeys?.();
        const keys = keysResp?.keys || {};
        setGroqKey(keys.groq || null);
      } catch {}
      try {
        const prefs = await (window as any).evia?.prefs?.get?.();
        const token = prefs?.prefs?.auth_token || null;
        setJwtToken(token);
      } catch {}
    })();

    const onSettingsUpdated = () => {
      (async () => {
        try {
          const keysResp = await (
            window as any
          ).evia?.settingsView?.getAllKeys?.();
          const keys = keysResp?.keys || {};
          setGroqKey(keys.groq || null);
        } catch {}
        try {
          const prefs = await (window as any).evia?.prefs?.get?.();
          const token = prefs?.prefs?.auth_token || null;
          setJwtToken(token);
        } catch {}
      })();
    };
    try {
      (window as any).evia?.settingsView?.onSettingsUpdated?.(
        onSettingsUpdated
      );
    } catch {}
    return () => {
      try {
        (window as any).evia?.settingsView?.removeOnSettingsUpdated?.(
          onSettingsUpdated
        );
      } catch {}
    };
  }, []);

  const togglePresets = () => setShowPresets(!showPresets);

  const handlePresetSelect = (presetId: number) => {
    setSelectedPreset(presetId);
  };

  const handleToggleAutoUpdate = () => {
    setAutoUpdateEnabled(!autoUpdateEnabled);
  };

  const handleMouseEnter = () => {
    // Cancel hide timer when hovering over settings
    (window as any).evia?.windows?.cancelHideSettingsWindow?.();
  };

  const handleMouseLeave = () => {
    // Start hide timer when leaving settings
    (window as any).evia?.windows?.hideSettingsWindow?.();
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

  return (
    <div
      className="settings-container"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      // Use a flexible column layout and avoid forcing full height on the container
      // so the overlay window does not produce outer scrollbars. Inner sections
      // are arranged as compact boxes; overflow is clipped to avoid scrollbars.
      style={{
        background: "rgba(0, 0, 0, 0.7)",
        borderRadius: "12px",
        padding: "12px",
        color: "white",
        width: "100%",
        maxHeight: "100%",
        overflow: "hidden",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxSizing: "border-box",
      }}
    >
      <div
        className="header-section"
        style={{
          marginBottom: "12px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          paddingBottom: "6px",
        }}
      >
        <h1
          className="app-title"
          style={{ fontSize: "14px", fontWeight: "bold", margin: 0 }}
        >
          Settings
        </h1>
        <div
          className="account-info"
          style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.7)" }}
        >
          Account: Not Logged In
        </div>
      </div>

      {/* Scrollable inner content */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          className="glass-scroll"
          style={{
            paddingRight: 6,
            paddingBottom: 6,
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          {/* Token summary box */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: "bold" }}>
                  Credentials
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
                  Groq Token:{" "}
                  {groqKey
                    ? groqKey.length > 8
                      ? `${groqKey.slice(0, 6)}…${groqKey.slice(-4)}`
                      : groqKey
                    : "Not set"}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                  JWT:{" "}
                  {jwtToken
                    ? jwtToken.length > 10
                      ? `${jwtToken.slice(0, 8)}…${jwtToken.slice(-8)}`
                      : jwtToken
                    : "Not available"}
                </div>
              </div>
            </div>
          </div>

          {/* Groq key editor */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: "bold" }}>
              Groq API Key
            </label>
            <div style={{ marginTop: 6 }}>
              <input
                value={editingKey}
                onChange={(e) => setEditingKey(e.target.value)}
                placeholder={
                  groqKey ? "Enter new key to replace" : "Enter Groq API key"
                }
                style={{
                  width: "100%",
                  padding: "8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "white",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={async () => {
                    setValidationState({ loading: true });
                    try {
                      const res = await (
                        window as any
                      ).evia?.settingsView?.validateKey?.({
                        provider: "groq",
                        key: editingKey,
                      });
                      if (res?.success) {
                        await (window as any).evia?.settingsView?.saveApiKey?.({
                          provider: "groq",
                          key: editingKey,
                        });
                        setValidationState({ ok: true });
                        setEditingKey("");
                      } else {
                        setValidationState({
                          ok: false,
                          error: res?.error || "Validation failed",
                        });
                      }
                    } catch (e: any) {
                      setValidationState({ ok: false, error: String(e) });
                    }
                    setTimeout(() => setValidationState(null), 2500);
                  }}
                  className="settings-button primary"
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: 6,
                    background: "rgba(0,122,255,0.25)",
                    border: "1px solid rgba(0,122,255,0.6)",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  Save
                </button>
                <button
                  onClick={async () => {
                    if (!groqKey) return;
                    const ok = await (
                      window as any
                    ).evia?.settingsView?.removeApiKey?.("groq");
                    if (ok?.success) {
                      setGroqKey(null);
                    }
                  }}
                  className="settings-button danger"
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: 6,
                    background: "rgba(255,59,48,0.08)",
                    border: "1px solid rgba(255,59,48,0.3)",
                    color: "rgba(255,59,48,0.9)",
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
            {validationState?.loading && (
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.6)",
                  marginTop: 6,
                }}
              >
                Validating…
              </div>
            )}
            {validationState?.ok === true && (
              <div style={{ fontSize: 12, color: "#4ade80", marginTop: 6 }}>
                Key saved and validated.
              </div>
            )}
            {validationState?.ok === false && (
              <div style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>
                {validationState?.error}
              </div>
            )}
          </div>

          <div className="shortcuts-section" style={{ marginBottom: "12px" }}>
            <h2
              style={{
                fontSize: "12px",
                fontWeight: "bold",
                marginBottom: "6px",
              }}
            >
              Shortcuts
            </h2>
            {Object.entries(shortcuts).map(([name, accelerator]) => (
              <div
                key={name}
                className="shortcut-item"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "4px",
                }}
              >
                <span
                  className="shortcut-name"
                  style={{
                    fontSize: "12px",
                    color: "rgba(255, 255, 255, 0.9)",
                  }}
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

          <div
            className="preset-section"
            style={{
              marginBottom: "12px",
              flexShrink: 0,
            }}
          >
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
                style={{ fontSize: "12px", fontWeight: "bold" }}
              >
                My Presets
                <span
                  className="preset-count"
                  style={{
                    fontSize: "12px",
                    color: "rgba(255, 255, 255, 0.5)",
                    marginLeft: "4px",
                  }}
                >
                  ({presets.filter((p) => p.is_default === 0).length})
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
                {presets.filter((p) => p.is_default === 0).length === 0 ? (
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
                    .filter((p) => p.is_default === 0)
                    .map((preset) => (
                      <div
                        key={preset.id}
                        className={`preset-item ${
                          selectedPreset === preset.id ? "selected" : ""
                        }`}
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
        </div>
      </div>

      {/* Fixed buttons section (kept outside scrollable area) */}
      <div
        className="buttons-section"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          flexShrink: 0,
          paddingTop: "6px",
          borderTop: "1px solid rgba(255, 255, 255, 0.1)",
        }}
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
          Automatic Updates: {autoUpdateEnabled ? "On" : "Off"}
        </button>

        <button
          className="settings-button danger"
          onClick={async () => {
            if (window.confirm("Are you sure you want to quit EVIA?")) {
              console.log("About to call quit");
              try {
                const result = await (window as any).evia?.app?.quit();
                console.log("Quit result:", result);
              } catch (error) {
                console.error("Error calling quit:", error);
              }
            }
          }}
          style={{
            background: "rgba(255, 59, 48, 0.1)",
            border: "1px solid rgba(255, 59, 48, 0.3)",
            borderRadius: "4px",
            color: "rgba(255, 59, 48, 0.9)",
            padding: "8px",
            fontSize: "12px",
            fontWeight: "500",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            const target = e.currentTarget;
            target.style.background = "rgba(255, 59, 48, 0.15)";
            target.style.borderColor = "rgba(255, 59, 48, 0.4)";
          }}
          onMouseLeave={(e) => {
            const target = e.currentTarget;
            target.style.background = "rgba(255, 59, 48, 0.1)";
            target.style.borderColor = "rgba(255, 59, 48, 0.3)";
          }}
        >
          Quit
        </button>
      </div>
    </div>
  );
};

export default SettingsView;
