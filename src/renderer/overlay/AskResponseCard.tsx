import React, { useEffect, useRef } from "react";

interface AskResponseCardProps {
  prompt: string;
  response: string;
  isStreaming: boolean;
  onAbort?: () => void;
  latencyMs?: number; // future use when non-stream snapshot used
}

// Lightweight markdown-ish renderer (preserve paragraphs, code fences later if needed)
function basicFormat(text: string): JSX.Element {
  const lines = text.split(/\n{2,}/g);
  return (
    <>
      {lines.map((block, i) => (
        <p key={i} style={{ margin: "0 0 8px", lineHeight: 1.35 }}>
          {block}
        </p>
      ))}
    </>
  );
}

const AskResponseCard: React.FC<AskResponseCardProps> = ({
  prompt,
  response,
  isStreaming,
  onAbort,
  latencyMs,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Auto-scroll to bottom as new deltas arrive
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [response]);

  return (
    <div
      className="ask-response-card"
      style={{
        width: "100%",
        maxWidth: 800,
        flex: "1 1 auto",
        marginTop: 18,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "rgba(20,20,20,0.72)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 4px 22px rgba(0,0,0,0.55)",
        fontFamily: "Helvetica Neue, system-ui, sans-serif",
        color: "#fff",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 12.5, opacity: 0.85, flex: 1 }} title={prompt}>
          {prompt || "—"}
        </div>
        {latencyMs !== undefined && !isStreaming && (
          <div style={{ fontSize: 11, opacity: 0.55 }}>{latencyMs} ms</div>
        )}
        {isStreaming && (
          <button
            onClick={onAbort}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              color: "#fff",
              fontSize: 11,
              padding: "5px 10px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Stop
          </button>
        )}
      </div>
      <div
        ref={scrollRef}
        style={{
          padding: "14px 16px 18px",
          overflowY: "auto",
          fontSize: 13,
          lineHeight: 1.4,
          scrollbarWidth: "thin",
          flex: "1 1 auto",
          minHeight: 0,
        }}
      >
        {response ? (
          <div style={{ whiteSpace: "pre-wrap" }}>{basicFormat(response)}</div>
        ) : (
          <div
            style={{
              fontSize: 12,
              opacity: 0.5,
              fontStyle: "italic",
            }}
          >
            {isStreaming ? "Starting…" : "No answer yet."}
          </div>
        )}
        {isStreaming && (
          <div
            style={{
              marginTop: 4,
              width: 42,
              height: 6,
              borderRadius: 4,
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0.5), rgba(255,255,255,0.12))",
              backgroundSize: "200% 100%",
              animation: "eviaPulse 1.2s linear infinite",
            }}
          />
        )}
      </div>
    </div>
  );
};

export default AskResponseCard;
