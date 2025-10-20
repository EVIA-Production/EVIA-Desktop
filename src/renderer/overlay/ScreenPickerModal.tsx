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
}

const ScreenPickerModal: React.FC<ScreenPickerModalProps> = ({
  onSelect,
  onCancel,
}) => {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await (window as any).evia?.getDesktopCapturerSources?.({
          types: ["screen", "window"],
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

  return (
    <div className="screen-picker-backdrop" onClick={onCancel}>
      <div className="screen-picker-modal" onClick={(e) => e.stopPropagation()}>
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
                <div className="screen-picker-thumb-placeholder">
                  No preview
                </div>
              )}
              <div className="screen-picker-name">{src.name}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ScreenPickerModal;
