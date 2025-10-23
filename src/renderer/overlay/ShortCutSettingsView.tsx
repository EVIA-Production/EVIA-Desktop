import React, { useEffect, useMemo, useRef, useState } from "react";
import "../overlay/static/overlay-glass.css";

interface ShortCutSettingsViewProps {
  onClose?: () => void;
}

type ShortcutMap = Record<string, string>;

const systemReserved = new Set([
  "Cmd+Q",
  "Cmd+W",
  "Cmd+A",
  "Cmd+S",
  "Cmd+Z",
  "Cmd+X",
  "Cmd+C",
  "Cmd+V",
  "Cmd+P",
  "Cmd+F",
  "Cmd+G",
  "Cmd+H",
  "Cmd+M",
  "Cmd+N",
  "Cmd+O",
  "Cmd+T",
  "Ctrl+Q",
  "Ctrl+W",
  "Ctrl+A",
  "Ctrl+S",
  "Ctrl+Z",
  "Ctrl+X",
  "Ctrl+C",
  "Ctrl+V",
  "Ctrl+P",
  "Ctrl+F",
  "Ctrl+G",
  "Ctrl+H",
  "Ctrl+M",
  "Ctrl+N",
  "Ctrl+O",
  "Ctrl+T",
]);

const displayNameMap: Record<string, string> = {
  nextStep: "Ask Anything",
  moveUp: "Move Up Window",
  moveDown: "Move Down Window",
  moveLeft: "Move Left Window",
  moveRight: "Move Right Window",
  toggleVisibility: "Toggle Overlay",
};

function formatName(key: string) {
  if (displayNameMap[key]) return displayNameMap[key];
  const spaced = key.replace(/([A-Z])/g, " $1");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const ShortCutSettingsView: React.FC<ShortCutSettingsViewProps> = ({
  onClose,
}) => {
  const [shortcuts, setShortcuts] = useState<ShortcutMap>({});
  const [defaults, setDefaults] = useState<ShortcutMap>({});
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    Record<string, { type: "error" | "success"; msg: string } | undefined>
  >({});

  // Load current and defaults
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ev = (window as any).evia;
        const cur = (await ev?.shortcuts?.get?.())?.data || {};
        const def = (await ev?.shortcuts?.getDefaults?.())?.data || {};
        if (!mounted) return;
        setShortcuts(cur);
        setDefaults(def);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const onCloseClick = () => {
    (window as any).evia?.closeWindow?.("shortcuts");
    onClose?.();
  };

  const startCapture = (key: string) => {
    setCapturing(key);
    setFeedback((f) => ({ ...f, [key]: undefined }));
  };
  const stopCapture = () => setCapturing(null);
  const disableKey = (key: string) => {
    setShortcuts((m) => ({ ...m, [key]: "" }));
    setFeedback((f) => ({
      ...f,
      [key]: { type: "success", msg: "Shortcut disabled" },
    }));
  };

  const parseAccelerator = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const parts: string[] = [];
    if (e.metaKey) parts.push("Cmd");
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    const isModifier = ["Meta", "Control", "Alt", "Shift"].includes(e.key);
    if (isModifier) return { accel: null, error: null };
    const map: Record<string, string> = {
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      " ": "Space",
    };
    const key = e.key.length === 1 ? e.key.toUpperCase() : map[e.key] || e.key;
    parts.push(key);
    const accel = parts.join("+");
    if (parts.length === 1)
      return { accel: null, error: "Invalid shortcut: needs a modifier" };
    if (parts.length > 4)
      return { accel: null, error: "Invalid shortcut: max 4 keys" };
    if (systemReserved.has(accel))
      return { accel: null, error: "Invalid shortcut: system reserved" };
    return { accel, error: null };
  };

  const handleKeydown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    shortcutKey: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const { accel, error } = parseAccelerator(e);
    if (!accel && !error) return; // only modifiers pressed
    if (error) {
      setFeedback((f) => ({
        ...f,
        [shortcutKey]: { type: "error", msg: error },
      }));
      return;
    }
    setShortcuts((m) => ({ ...m, [shortcutKey]: accel! }));
    setFeedback((f) => ({
      ...f,
      [shortcutKey]: { type: "success", msg: "Shortcut set" },
    }));
    stopCapture();
  };

  const handleSave = async () => {
    const ev = (window as any).evia;
    await ev?.shortcuts?.set?.(shortcuts);
  };

  const handleReset = () => {
    setShortcuts(defaults);
    setFeedback({});
  };

  const entries = useMemo(
    () => Object.keys(shortcuts).map((k) => [k, shortcuts[k]] as const),
    [shortcuts]
  );

  if (loading) {
    return (
      <div className="evia-glass shortcuts-container">
        <div className="shortcuts-header drag-zone">
          <div className="shortcuts-title">Shortcuts</div>
        </div>
        <div className="loading-state">Loading Shortcuts...</div>
      </div>
    );
  }

  return (
    <div className="evia-glass shortcuts-container">
      <button className="close-button" onClick={onCloseClick} title="Close">
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
        <div className="shortcuts-title">Edit Shortcuts</div>
      </div>
      <div className="no-drag shortcuts-list" style={{ overflowY: "auto" }}>
        {entries.map(([key, value]) => (
          <div key={key} style={{ marginBottom: 8 }}>
            <div
              className="shortcut-item"
              style={{ alignItems: "center", gap: 8 }}
            >
              <span className="shortcut-name">{formatName(key)}</span>
              <button className="action-btn" onClick={() => startCapture(key)}>
                Edit
              </button>
              <button className="action-btn" onClick={() => disableKey(key)}>
                Disable
              </button>
              <input
                readOnly
                className={`shortcut-input ${capturing === key ? "capturing" : ""}`}
                value={value || ""}
                placeholder={
                  capturing === key ? "Press new shortcut…" : "Click to edit"
                }
                onClick={() => startCapture(key)}
                onKeyDown={(e) => handleKeydown(e, key)}
                onBlur={stopCapture}
              />
            </div>
            {feedback[key] ? (
              <div className={`feedback ${feedback[key]!.type}`}>
                {feedback[key]!.msg}
              </div>
            ) : (
              <div className="feedback" />
            )}
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="settings-button" onClick={onCloseClick}>
          Cancel
        </button>
        <button className="settings-button danger" onClick={handleReset}>
          Reset to Default
        </button>
        <button className="settings-button primary" onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
};

export default ShortCutSettingsView;
