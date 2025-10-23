import React, { useEffect, useState } from "react";
import "./static/overlay-glass.css";

interface SourceThumb {
  toDataURL: () => string;
}

interface SourceItem {
  id: string;
  name: string;
  thumbnail?: SourceThumb;
}

interface ScreenPickerModalProps {
  onSelect: (sourceId: string) => void;
  onCancel: () => void;
  /** When false, renders only the modal (no full-screen backdrop) */
  backdrop?: boolean;
}

const ScreenPickerModal: React.FC<ScreenPickerModalProps> = ({
  onSelect,
  onCancel,
  backdrop = true,
}) => {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await (window as any).evia?.getDesktopCapturerSources?.({
          types: ["screen"],
          thumbnailSize: { width: 320, height: 200 },
          fetchWindowIcons: true,
        });
        if (Array.isArray(list)) {
          // Optional: filter out our own app windows
          const filtered = list.filter(
            (s: any) => !/evia/i.test(String(s?.name || ""))
          );
          setSources(filtered);
        } else {
          setSources([]);
        }
      } catch (e) {
        console.warn("[ScreenPicker] Failed to get desktop sources:", e);
        setSources([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Visibility sync: respond to global invisibility toggle
  useEffect(() => {
    const bc = new BroadcastChannel("evia-visibility");
    const applyFromStorage = () => {
      try {
        const stored =
          localStorage.getItem("evia:invisibilityDisabled") === "1";
        document.body.classList.toggle("invisibility-disabled", stored);
      } catch {}
    };
    applyFromStorage();
    const onMessage = (e: MessageEvent) => {
      const next = (e as any)?.data?.invisibilityDisabled;
      if (typeof next === "boolean") {
        document.body.classList.toggle("invisibility-disabled", next);
      }
    };
    bc.addEventListener("message", onMessage as any);
    return () => {
      try {
        bc.removeEventListener("message", onMessage as any);
      } catch {}
      bc.close();
    };
  }, []);

  // Close on ESC key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const content = (
    <div
      className={`screen-picker-modal evia-glass ${backdrop ? "" : "screen-picker-modal--floating"}`}
      onClick={(e) => e.stopPropagation()}
    >
      {loading ? (
        <div
          className="screen-picker-item"
          style={{
            border: "none",
            background: "transparent",
            cursor: "default",
            textAlign: "left",
          }}
        >
          Loading screens…
        </div>
      ) : sources.length === 0 ? (
        <div
          className="screen-picker-item"
          style={{
            border: "none",
            background: "transparent",
            cursor: "default",
            textAlign: "left",
          }}
        >
          No sources found.
        </div>
      ) : (
        sources.map((src) => (
          <div
            key={src.id}
            className="screen-picker-item"
            onClick={() => onSelect(src.id)}
          >
            {src.thumbnail ? (
              <img
                className="screen-picker-thumb"
                src={src.thumbnail.toDataURL()}
                alt={src.name}
              />
            ) : (
              <div className="screen-picker-thumb-placeholder">No preview</div>
            )}
            <div className="screen-picker-name">{src.name}</div>
          </div>
        ))
      )}
    </div>
  );

  if (!backdrop) return content;
  return (
    <div className="screen-picker-backdrop" onClick={onCancel}>
      {content}
    </div>
  );
};

export default ScreenPickerModal;
