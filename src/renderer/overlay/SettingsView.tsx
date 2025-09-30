console.log("[renderer] module evaluated: AskView.tsx");
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
  // LLM API key management moved to frontend
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
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
  // Backend login state (FastAPI /login/)
  const [backendUsername, setBackendUsername] = useState<string>("");
  const [backendPassword, setBackendPassword] = useState<string>("");
  const [backendBusy, setBackendBusy] = useState<boolean>(false);
  const [backendError, setBackendError] = useState<string>("");

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

    // Credentials are now managed by the web frontend. The desktop overlay
    // shouldn't provide credential editing. Instead we show a small status
    // indicator that reflects whether the Electron app can provide a valid
    // short-lived access token via the PKCE flow (main process + keytar).
    // We poll the preload bridge periodically because tokens can refresh.
    let mounted = true;
    const checkToken = async () => {
      try {
        const res = await (window as any).evia?.auth?.getAccessToken?.();
        const ok = !!(res && res.ok && res.access_token);
        if (mounted) setIsLoggedIn(ok);
      } catch (e) {
        if (mounted) setIsLoggedIn(false);
      }
    };

    checkToken();
    const iv = setInterval(checkToken, 2000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, []);

  const togglePresets = () => setShowPresets(!showPresets);

  const handlePresetSelect = (presetId: number) => {
    setSelectedPreset(presetId);
  };

  const handleToggleAutoUpdate = () => {
    setAutoUpdateEnabled(!autoUpdateEnabled);
  };

  const handleBackendLogin = async () => {
    setBackendError("");
    console.log("[SettingsView] handleBackendLogin invoked");
    if (!backendUsername || !backendPassword) {
      setBackendError("Please fill Username and Password.");
      console.warn("[SettingsView] Missing username or password");
      return;
    }
    setBackendBusy(true);
    try {
      const baseUrl =
        (window as any).EVIA_BACKEND_URL ||
        (window as any).API_BASE_URL ||
        "http://localhost:8000";
      const loginPath =
        (window as any).EVIA_BACKEND_LOGIN_PATH ||
        (window as any).BACKEND_LOGIN_PATH;
      const effectiveLoginPath =
        loginPath && String(loginPath).trim().length
          ? String(loginPath).trim()
          : "/login/";
      console.log("[SettingsView] backendLogin calling", {
        baseUrl,
        loginPath: effectiveLoginPath,
        usernamePresent: !!backendUsername,
      });
      const res = await (window as any).evia?.auth?.backendLogin?.(
        baseUrl,
        backendUsername,
        backendPassword,
        effectiveLoginPath
      );
      console.log("[SettingsView] backendLogin result", res);
      if (!res || !res.ok) {
        console.warn(
          "[SettingsView] backendLogin via IPC failed, trying direct fetch fallback"
        );
        // Fallback: try direct fetch from renderer (mirrors frontend login behavior)
        const targetUrl = `${String(baseUrl).replace(/\/$/, "")}${
          effectiveLoginPath.startsWith("/")
            ? effectiveLoginPath
            : `/${effectiveLoginPath}`
        }`;
        console.log("[SettingsView] direct login POST", targetUrl);
        let ok = false;
        let accessToken: string | null = null;
        let tokenType: string | null = null;
        try {
          // Try JSON first – this matches backend UserAuthenticate {username,password}
          let r = await fetch(targetUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              username: backendUsername,
              password: backendPassword,
            }),
          });
          if (!r.ok) {
            if (r.status === 401 || r.status === 400) {
              // Invalid credentials – don't spam with alternate formats
              const txt = await r.text().catch(() => "");
              console.warn("[SettingsView] JSON login HTTP", r.status, txt);
            } else {
              const txt = await r.text().catch(() => "");
              console.warn("[SettingsView] JSON login HTTP", r.status, txt);
              // Try form-encoded as a compatibility fallback
              const form = new URLSearchParams();
              form.set("username", backendUsername);
              form.set("password", backendPassword);
              form.set("grant_type", "password");
              form.set("scope", "");
              r = await fetch(targetUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  Accept: "application/json",
                },
                body: form.toString(),
              });
            }
          }
          if (r.ok) {
            const data = await r.json().catch(() => ({} as any));
            accessToken =
              data?.access_token || data?.token || data?.jwt || null;
            tokenType = data?.token_type || data?.type || "Bearer";
            ok = !!accessToken;
          }
        } catch (e) {
          console.error("[SettingsView] direct login error", e);
        }
        if (!ok || !accessToken) {
          const msg = res?.error || "Login failed";
          setBackendError(msg);
        } else {
          try {
            // Persist and broadcast via preload bridge
            (window as any).evia?.setAuthToken?.(
              accessToken,
              tokenType || undefined
            );
          } catch {}
          // Re-check token availability to flip UI state
          try {
            const tk = await (window as any).evia?.auth?.getAccessToken?.();
            console.log(
              "[SettingsView] post-login(getAccessToken) via fallback",
              {
                ok: !!(tk && tk.ok && tk.access_token),
                tokenLen: tk?.access_token?.length || 0,
              }
            );
            setIsLoggedIn(!!(tk && tk.ok && tk.access_token));
          } catch {
            setIsLoggedIn(true);
          }
          setBackendPassword("");
        }
      } else {
        // Re-check token availability to flip UI state
        try {
          const tk = await (window as any).evia?.auth?.getAccessToken?.();
          console.log("[SettingsView] post-login getAccessToken result", {
            ok: !!(tk && tk.ok && tk.access_token),
            tokenLen: tk?.access_token?.length || 0,
          });
          setIsLoggedIn(!!(tk && tk.ok && tk.access_token));
        } catch {
          setIsLoggedIn(true);
        }
        // Clear password from memory ASAP
        setBackendPassword("");
      }
    } catch (e: any) {
      console.error("[SettingsView] backendLogin error", e);
      setBackendError(String(e?.message || e));
    } finally {
      console.log("[SettingsView] handleBackendLogin done");
      setBackendBusy(false);
    }
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
          style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.9)" }}
        >
          Account:{" "}
          {isLoggedIn ? (
            <span style={{ color: "#3ad65f", fontWeight: 600 }}>Logged in</span>
          ) : (
            <span style={{ color: "#ff6b6b", fontWeight: 600 }}>
              Not logged in
            </span>
          )}
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
          {/* Credentials/status moved to header */}

          {/* LLM API key management moved to frontend app; desktop overlay no longer stores or edits provider keys. */}

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
        {/* Auth controls */}
        {isLoggedIn && (
          <button
            className="settings-button"
            onClick={async () => {
              try {
                console.log("[SettingsView] Sign out clicked");
                await (window as any).evia?.auth?.logout?.();
                console.log("[SettingsView] logout done");
              } catch {}
            }}
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
            Sign out
          </button>
        )}

        {/* Backend login (FastAPI /login/ via defaults) */}
        {!isLoggedIn && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "8px",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              background: "rgba(255,255,255,0.05)",
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.8)",
                fontWeight: 600,
              }}
            >
              Or sign in to EVIA backend
            </div>
            <input
              placeholder="Username"
              value={backendUsername}
              onChange={(e) => setBackendUsername(e.target.value)}
              style={{
                padding: "6px 8px",
                borderRadius: 4,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(0,0,0,0.35)",
                color: "white",
                fontSize: 12,
              }}
            />
            <input
              placeholder="Password"
              type="password"
              value={backendPassword}
              onChange={(e) => setBackendPassword(e.target.value)}
              style={{
                padding: "6px 8px",
                borderRadius: 4,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(0,0,0,0.35)",
                color: "white",
                fontSize: 12,
              }}
            />
            {backendError && (
              <div style={{ color: "#ff6b6b", fontSize: 12 }}>
                {backendError}
              </div>
            )}
            <button
              className="settings-button"
              disabled={backendBusy}
              onClick={handleBackendLogin}
              style={{
                background: backendBusy
                  ? "rgba(255,255,255,0.05)"
                  : "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 4,
                color: "white",
                padding: 8,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {backendBusy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        )}

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
