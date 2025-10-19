import React, { useEffect, useState } from "react";

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

const ScreenPickerModal: React.FC<ScreenPickerModalProps> = ({ onSelect, onCancel }) => {
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
          const filtered = list.filter((s: any) => !/evia/i.test(String(s?.name || "")));
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, 320px)",
          gap: "12px",
          background: "#1f1f1f",
          padding: 20,
          borderRadius: 8,
          maxHeight: "80vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div style={{ color: "white", padding: 8 }}>Loading screens…</div>
        ) : sources.length === 0 ? (
          <div style={{ color: "white", padding: 8 }}>No sources found.</div>
        ) : (
          sources.map((src) => (
            <div
              key={src.id}
              onClick={() => onSelect(src.id)}
              style={{
                cursor: "pointer",
                color: "white",
                textAlign: "center",
                border: "2px solid transparent",
                borderRadius: 4,
                padding: 4,
                background: "#2a2a2a",
              }}
              onMouseEnter={(e) => ((e.currentTarget.style.borderColor = "#00bfff"))}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "transparent")}
            >
              {src.thumbnail ? (
                <img
                  src={src.thumbnail.toDataURL()}
                  alt={src.name}
                  style={{ width: "100%", height: "auto", borderRadius: 4 }}
                />
              ) : (
                <div style={{
                  width: 320,
                  height: 200,
                  background: "#444",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#bbb",
                }}>
                  No preview
                </div>
              )}
              <div style={{ marginTop: 6 }}>{src.name}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ScreenPickerModal;
