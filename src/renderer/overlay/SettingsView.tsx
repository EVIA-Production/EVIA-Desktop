import React, { useEffect, useState } from "react";
import "./overlay-tokens.css";
import "./overlay-glass.css";
import { i18n } from "../i18n/i18n";

interface SettingsViewProps {
  language: "de" | "en";
  onToggleLanguage: () => void;
  onClose?: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({
  language,
  onToggleLanguage,
}) => {
  // Loading / data
  const [isLoading, setIsLoading] = useState(true);
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const [showPresets, setShowPresets] = useState(false);
  const [presets, setPresets] = useState<
    { id: number; title: string; is_default: boolean }[]
  >([]);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);

  // Auth state
  const [authStatus, setAuthStatus] = useState<
    "unknown" | "logged-in" | "logged-out" | "error"
  >("unknown");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  // Chat ID indicator
  const [chatId, setChatId] = useState<string | null>(null);

  // Poll chatId (lightweight – updates only if changed)
  useEffect(() => {
    const read = () => {
      try {
        const cid = localStorage.getItem("current_chat_id");
        setChatId((prev) => (prev === cid ? prev : cid));
      } catch {}
    };
    read();
    const t = setInterval(read, 5000);
    return () => clearInterval(t);
  }, []);

  // Fetch token on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await (window as any).evia?.auth?.getToken?.();
        if (cancelled) return;
        setAuthStatus(token ? "logged-in" : "logged-out");
      } catch (e) {
        if (!cancelled) {
          setAuthStatus("error");
          setAuthMessage((e as Error).message || "Failed to read token");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Simulated load of UI data
  useEffect(() => {
    const t = setTimeout(() => {
      setShortcuts({
        toggleVisibility: "Cmd+\\",
        scrollUp: "Cmd+Up",
        scrollDown: "Cmd+Down",
      });
      setPresets([
        { id: 1, title: "Default Preset", is_default: true },
        { id: 2, title: "Custom Preset 1", is_default: false },
      ]);
      setSelectedPreset(2);
      setIsLoading(false);
    }, 400);
    return () => clearTimeout(t);
  }, []);

  const togglePresets = () => setShowPresets((s) => !s);
  const handlePresetSelect = (id: number) => setSelectedPreset(id);
  const handleToggleAutoUpdate = () => setAutoUpdateEnabled((a) => !a);
  const renderShortcutKeys = (accel: string) => {
    const map: Record<string, string> = {
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
    return accel.split("+").map((k, i) => (
      <span key={i} className="shortcut-key">
        {map[k] || k}
      </span>
    ));
  };

  if (isLoading) {
    return (
      <div
        className="settings-container"
        style={{
          background: "#1e1e1e",
          borderRadius: 12,
          padding: 16,
          color: "#fff",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div className="loading-spinner" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="settings-container"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "rgba(20,20,20,0.82)",
        borderRadius: 12,
        outline: "0.5px rgba(255,255,255,0.18) solid",
        outlineOffset: "-1px",
        boxSizing: "border-box",
        position: "relative",
        overflowY: "auto",
        padding: 12,
        color: "#fff",
      }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: 16,
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          paddingBottom: 8,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: "bold", margin: 0 }}>
          {i18n.t("overlay.settings.title")}
        </h1>
        <div
          style={{
            fontSize: 12,
            color:
              authStatus === "logged-in"
                ? "rgba(0,200,120,0.9)"
                : authStatus === "error"
                ? "rgba(255,120,120,0.9)"
                : "rgba(255,255,255,0.7)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {authStatus === "logged-in" && "Account: Logged In"}
          {authStatus === "logged-out" && "Account: Not Logged In"}
          {authStatus === "unknown" && "Account: Checking..."}
          {authStatus === "error" &&
            `Account: Error (${authMessage || "failed"})`}
          <span
            style={{
              fontSize: 11,
              opacity: 0.85,
              color: chatId
                ? "rgba(255,255,255,0.6)"
                : "rgba(255,255,255,0.35)",
            }}
          >
            Chat ID: {chatId || "—"}
          </span>
        </div>
      </div>

      {/* Authentication Section */}
      <div
        style={{
          marginBottom: 16,
          background: "rgba(255,255,255,0.05)",
          padding: 8,
          borderRadius: 6,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: "bold", margin: "0 0 8px" }}>
          Authentication
        </h2>
        {authStatus !== "logged-in" ? (
          <form
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
            onSubmit={async (e) => {
              e.preventDefault();
              setAuthBusy(true);
              setAuthMessage("");
              try {
                const res = await (window as any).evia?.auth?.login?.(
                  username.trim(),
                  password
                );
                if (res?.success) {
                  setAuthStatus("logged-in");
                  setAuthMessage("Login successful");
                  setPassword("");
                } else {
                  setAuthStatus("logged-out");
                  setAuthMessage(res?.error || "Login failed");
                }
              } catch (err) {
                setAuthStatus("error");
                setAuthMessage((err as Error).message);
              } finally {
                setAuthBusy(false);
              }
            }}
          >
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              required
              style={{
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 4,
                padding: "6px 8px",
                color: "#fff",
                fontSize: 12,
              }}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              style={{
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 4,
                padding: "6px 8px",
                color: "#fff",
                fontSize: 12,
              }}
            />
            <button
              type="submit"
              disabled={authBusy}
              style={{
                background: authBusy
                  ? "rgba(255,255,255,0.25)"
                  : "rgba(0,122,255,0.4)",
                border: "1px solid rgba(0,122,255,0.5)",
                borderRadius: 4,
                padding: "6px 8px",
                color: "#fff",
                fontSize: 12,
                fontWeight: 500,
                cursor: authBusy ? "default" : "pointer",
              }}
            >
              {authBusy ? "Logging in..." : "Login"}
            </button>
            {authMessage && (
              <div
                style={{
                  fontSize: 11,
                  color:
                    authStatus === "error"
                      ? "rgba(255,140,140,0.9)"
                      : "rgba(255,255,255,0.7)",
                }}
              >
                {authMessage}
              </div>
            )}
          </form>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
              You are logged in.
            </div>
            <div>
              <button
                disabled={authBusy}
                onClick={async () => {
                  setAuthBusy(true);
                  try {
                    await (window as any).evia?.auth?.logout?.();
                    setAuthStatus("logged-out");
                    setAuthMessage("Logged out");
                  } catch (e) {
                    setAuthStatus("error");
                    setAuthMessage((e as Error).message);
                  } finally {
                    setAuthBusy(false);
                  }
                }}
                style={{
                  background: "rgba(255,80,80,0.4)",
                  border: "1px solid rgba(255,80,80,0.5)",
                  borderRadius: 4,
                  padding: "6px 8px",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: authBusy ? "default" : "pointer",
                }}
              >
                {authBusy ? "Working..." : "Logout"}
              </button>
            </div>
            {authMessage && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
                {authMessage}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Language Section */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: "bold", margin: "0 0 8px" }}>
          {i18n.t("overlay.settings.language")}
        </h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onToggleLanguage}
            style={{
              flex: 1,
              background:
                language === "de"
                  ? "rgba(0,122,255,0.3)"
                  : "rgba(255,255,255,0.1)",
              border:
                language === "de"
                  ? "1px solid rgba(0,122,255,0.5)"
                  : "1px solid rgba(255,255,255,0.2)",
              borderRadius: 4,
              color: "#fff",
              padding: 8,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
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
                  ? "rgba(0,122,255,0.3)"
                  : "rgba(255,255,255,0.1)",
              border:
                language === "en"
                  ? "1px solid rgba(0,122,255,0.5)"
                  : "1px solid rgba(255,255,255,0.2)",
              borderRadius: 4,
              color: "#fff",
              padding: 8,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {i18n.t("overlay.settings.english")}
          </button>
        </div>
      </div>

      {/* Shortcuts */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: "bold", margin: "0 0 8px" }}>
          {i18n.t("overlay.settings.shortcuts")}
        </h2>
        {Object.entries(shortcuts).map(([name, acc]) => (
          <div
            key={name}
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)" }}>
              {name.replace(/([A-Z])/g, " $1")}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              {renderShortcutKeys(acc)}
            </div>
          </div>
        ))}
      </div>

      {/* Presets */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: "bold" }}>
            {i18n.t("overlay.settings.presets")}
            <span
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.5)",
                marginLeft: 4,
              }}
            >
              ({presets.filter((p) => !p.is_default).length})
            </span>
          </span>
          <span
            onClick={togglePresets}
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.7)",
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: 4,
            }}
          >
            {showPresets ? "▼" : "▶"}
          </span>
        </div>
        {showPresets && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {presets.filter((p) => !p.is_default).length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.5)",
                  textAlign: "center",
                }}
              >
                No custom presets yet.
              </div>
            ) : (
              presets
                .filter((p) => !p.is_default)
                .map((p) => (
                  <div
                    key={p.id}
                    onClick={() => handlePresetSelect(p.id)}
                    style={{
                      padding: 8,
                      background:
                        selectedPreset === p.id
                          ? "rgba(0,122,255,0.2)"
                          : "rgba(255,255,255,0.05)",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ fontSize: 12 }}>{p.title}</span>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      {/* Controls & Quit */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <button
            onClick={() => (window as any).evia?.app?.quit?.()}
            title="Quit EVIA"
            style={{
              width: "100%",
              background:
                "linear-gradient(135deg, rgba(255,60,60,0.85) 0%, rgba(200,40,40,0.85) 100%)",
              border: "1px solid rgba(255,80,80,0.6)",
              borderRadius: 6,
              color: "#fff",
              padding: "10px 12px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              letterSpacing: "0.5px",
              boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background =
                "linear-gradient(135deg, rgba(255,80,80,0.95) 0%, rgba(220,50,50,0.95) 100%)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background =
                "linear-gradient(135deg, rgba(255,60,60,0.85) 0%, rgba(200,40,40,0.85) 100%)")
            }
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: 4 }}
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Quit Application
          </button>
        <button
          onClick={handleToggleAutoUpdate}
          style={{
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 4,
            color: "#fff",
            padding: 8,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {i18n.t("overlay.settings.autoUpdate")}:{" "}
          {autoUpdateEnabled ? "On" : "Off"}
        </button>
        <div
          style={{
            marginTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: 12,
          }}
        >
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
