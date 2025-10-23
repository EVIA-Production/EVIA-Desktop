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
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [shortcuts, setShortcuts] = useState<{ [key: string]: string }>({});
  const [showPresets, setShowPresets] = useState(false);
  type Prompt = {
    id: number;
    name: string;
    content?: string;
    description?: string | null;
    language?: string;
    is_active?: boolean;
  };
  const [presets, setPresets] = useState<Prompt[]>([]);
  const [activePromptId, setActivePromptId] = useState<number | null>(null);
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false);
  const [previewPromptId, setPreviewPromptId] = useState<number | null>(null);
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
      setIsLoggedIn(false);
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
    // Simulate loading of basic UI bits (shortcuts) while we fetch presets separately
    setTimeout(() => {
      setShortcuts({
        toggleVisibility: "Cmd+\\",
        nextStep: "Cmd+Enter",
        scrollUp: "Cmd+Up",
        scrollDown: "Cmd+Down",
      });
      setIsLoading(false);
    }, 400);
  }, []);

  // Determine login status: presence of a valid auth token indicates logged in
  const checkAuth = React.useCallback(async () => {
    try {
      const eviaAuth = (window as any).evia?.auth as
        | { getToken: () => Promise<string | null> }
        | undefined;
      const token = await eviaAuth?.getToken?.();
      setIsLoggedIn(!!token);
    } catch {
      setIsLoggedIn(false);
    }
  }, []);

  useEffect(() => {
    // Initial check
    checkAuth();
    // Refresh on window focus to pick up external login/logout changes
    const onFocus = () => {
      void checkAuth();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkAuth]);

  // Fetch presets from backend
  const fetchPresets = async () => {
    setIsLoadingPrompts(true);
    try {
      const baseUrl =
        (window as any).EVIA_BACKEND_URL ||
        (window as any).API_BASE_URL ||
        "http://localhost:8000";
      const eviaAuth = (window as any).evia?.auth as
        | { getToken: () => Promise<string | null> }
        | undefined;
      const token = await eviaAuth?.getToken();
      if (!token) {
        console.warn("[SettingsView] No auth token for fetching prompts");
        setPresets([]);
        return;
      }
      const res = await fetch(`${String(baseUrl).replace(/\/$/, "")}/prompts`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        console.error("[SettingsView] Failed to fetch prompts:", res.status);
        setPresets([]);
        return;
      }
      const list = (await res.json()) as Prompt[];
      setPresets(Array.isArray(list) ? list : []);
      const active = list.find((p) => p.is_active);
      setActivePromptId(active ? active.id : null);
    } catch (err) {
      console.error("[SettingsView] Error fetching prompts:", err);
      setPresets([]);
    } finally {
      setIsLoadingPrompts(false);
    }
  };

  useEffect(() => {
    fetchPresets();
  }, []);

  const togglePresets = () => setShowPresets(!showPresets);

  const handlePresetSelect = (presetId: number) => {
    setPreviewPromptId(presetId);
  };

  // Close preview via ESC
  useEffect(() => {
    if (!previewPromptId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPreviewPromptId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewPromptId]);

  // When opening preview, fetch full preset details if content is missing
  useEffect(() => {
    const run = async () => {
      if (previewPromptId == null) return;
      const current = presets.find((p) => p.id === previewPromptId);
      if (!current || (current && current.content)) return;
      try {
        const baseUrl =
          (window as any).EVIA_BACKEND_URL ||
          (window as any).API_BASE_URL ||
          "http://localhost:8000";
        const eviaAuth = (window as any).evia?.auth as
          | { getToken: () => Promise<string | null> }
          | undefined;
        const token = await eviaAuth?.getToken();
        if (!token) return;
        const res = await fetch(
          `${String(baseUrl).replace(/\/$/, "")}/prompts/${previewPromptId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (!res.ok) return;
        const detail = (await res.json()) as Prompt;
        setPresets((prev) =>
          prev.map((p) => (p.id === detail.id ? { ...p, ...detail } : p))
        );
      } catch (e) {
        console.error("[SettingsView] Failed to fetch preset detail:", e);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewPromptId]);

  // PUT to set active preset
  const setPresetActive = async (presetId: number) => {
    try {
      const baseUrl =
        (window as any).EVIA_BACKEND_URL ||
        (window as any).API_BASE_URL ||
        "http://localhost:8000";
      const eviaAuth = (window as any).evia?.auth as
        | { getToken: () => Promise<string | null> }
        | undefined;
      const token = await eviaAuth?.getToken();
      if (!token) return;
      const res = await fetch(
        `${String(baseUrl).replace(/\/$/, "")}/prompts/${presetId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ is_active: true }),
        }
      );
      if (!res.ok) {
        console.error(
          "[SettingsView] Failed to set active preset:",
          res.status
        );
        return;
      }
      // Optimistically update local state so only this one is active
      setPresets((prev) =>
        prev.map((p) => ({ ...p, is_active: p.id === presetId }))
      );
      setActivePromptId(presetId);
      setPreviewPromptId(null);
    } catch (err) {
      console.error("[SettingsView] Error updating preset:", err);
    }
  };

  const handleToggleAutoUpdate = () => {
    setAutoUpdateEnabled(!autoUpdateEnabled);
  };

  // Open Meeting Notes in external browser
  const handleOpenMeetingNotes = async () => {
    try {
      const frontendUrl =
        (import.meta as any).env?.VITE_FRONTEND_URL || "http://localhost:5173";
      const url = `${String(frontendUrl).replace(/\/$/, "")}/personalize`;
      if ((window as any).evia?.shell?.openExternal) {
        await (window as any).evia.shell.openExternal(url);
      } else {
        window.open(url, "_blank");
      }
    } catch (err) {
      console.error("[SettingsView] Failed to open Meeting Notes:", err);
    }
  };

  // Open the Shortcuts window (ShortCutSettingsView)
  const handleOpenShortcuts = async () => {
    try {
      await (window as any).evia?.windows?.show?.("shortcuts");
    } catch (err) {
      console.error("[SettingsView] Failed to open Shortcuts:", err);
    }
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
        <div
          className={`settings-subtext ${isLoggedIn ? "auth-logged-in" : "auth-logged-out"}`}
        >
          {isLoggedIn ? "Logged In" : "Not Logged In"}
        </div>
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

      {/* Divider between Language and Shortcuts */}
      <div className="section-divider" />

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
        <div className="buttons-section no-divider">
          <button
            className="settings-button full-width"
            onClick={handleOpenShortcuts}
          >
            Keyboard Shortcuts
          </button>
        </div>
      </div>

      {/* Divider between Shortcuts button and Presets */}
      <div className="section-divider" />

      <div className="settings-section">
        <div className="preset-header">
          <span className="preset-title">
            {i18n.t("overlay.settings.presets")}{" "}
            <span className="preset-count">({presets.length})</span>
          </span>
          <span className="preset-toggle" onClick={togglePresets}>
            {showPresets ? "▼" : "▶"}
          </span>
        </div>

        {showPresets && (
          <div className="preset-list">
            {isLoadingPrompts ? (
              <div className="no-presets-message">Loading presets…</div>
            ) : presets.length === 0 ? (
              <div className="no-presets-message">No presets yet.</div>
            ) : (
              presets.map((preset) => (
                <div
                  key={preset.id}
                  className={`preset-item ${activePromptId === preset.id ? "selected" : ""}`}
                  onClick={() => handlePresetSelect(preset.id)}
                  title={preset.description || preset.name}
                >
                  <span className="preset-name">{preset.name}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Unified buttons block (Glass-like spacing and sizing) */}
      <div className="buttons-section">
        <button
          className="settings-button full-width"
          onClick={handleOpenMeetingNotes}
        >
          Meeting Notes
        </button>
        <button
          className="settings-button full-width"
          onClick={handleToggleAutoUpdate}
        >
          {i18n.t("overlay.settings.autoUpdate")}:{" "}
          {autoUpdateEnabled ? "On" : "Off"}
        </button>
        {/* Invisibility toggle (stacked with same style) */}
        <button
          className="settings-button full-width"
          onClick={() => setInvisibilityDisabled((v) => !v)}
        >
          Disable Invisibility: {invisibilityDisabled ? "On" : "Off"}
        </button>
      </div>

      {/* Account Actions (no header) */}
      <div className="settings-section">
        <div className="account-actions">
          <button onClick={handleLogout} className="settings-button half-width">
            Logout
          </button>
          <button
            onClick={handleQuit}
            className="settings-button half-width danger"
          >
            Quit
          </button>
        </div>
      </div>

      {/* Preset Preview Modal */}
      {previewPromptId !== null &&
        (() => {
          const preset = presets.find((p) => p.id === previewPromptId);
          if (!preset) return null;
          return (
            <div
              className="preset-preview-backdrop"
              onClick={() => setPreviewPromptId(null)}
            >
              <div
                className="preset-preview-card evia-glass"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="preset-preview-close"
                  onClick={() => setPreviewPromptId(null)}
                  aria-label="Close preview"
                  title="Close"
                >
                  ×
                </button>
                <div className="preset-preview-header">
                  <div className="preset-preview-title">{preset.name}</div>
                  {preset.description && (
                    <div className="preset-preview-desc">
                      {preset.description}
                    </div>
                  )}
                </div>
                <div className="preset-preview-content">
                  <pre>{preset.content || "(No content)"}</pre>
                </div>
                <div className="preset-preview-actions">
                  <button
                    className="settings-cta-btn"
                    onClick={() => setPresetActive(preset.id)}
                  >
                    Use this preset
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
};

export default SettingsView;
