import React, { useEffect, useRef, useState } from "react";
import { getAuthToken } from "../lib/authToken";
import "./overlay-tokens.css";
import "./overlay-glass.css";
import {
  getOrCreateChatId,
  getWebSocketInstance,
} from "../services/websocketService";
import { fetchInsights, Insight } from "../services/insightsService";
import { i18n } from "../i18n/i18n";
import {
  TranscriptAggregator,
  AggregatedMessage,
} from "./TranscriptAggregator";

interface ListenViewProps {
  followLive: boolean;
  onToggleFollow: () => void;
  onClose?: () => void;
}

// Using ambient window types declared elsewhere; only augment if not already present
declare global {
  interface Window {
    api: {
      listenView: {
        adjustWindowHeight: (view: string, height: number) => void;
      };
    };
    EVIA_BACKEND_URL?: string;
    API_BASE_URL?: string;
  }
}

const ListenView: React.FC<ListenViewProps> = ({
  followLive,
  onToggleFollow,
  onClose,
}) => {
  // Transcript aggregation state
  const [messages, setMessages] = useState<AggregatedMessage[]>([]);
  const aggregatorRef = useRef<TranscriptAggregator | null>(null);

  // UI state
  const [viewMode, setViewMode] = useState<"transcript" | "insights">(
    "transcript"
  );
  const [isHovering, setIsHovering] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [copiedView, setCopiedView] = useState<
    "transcript" | "insights" | null
  >(null);
  const [elapsedTime, setElapsedTime] = useState("00:00");
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const copyTimeout = useRef<NodeJS.Timeout | null>(null);
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Insights
  const nowIso = new Date().toISOString();
  const [insights, setInsights] = useState<Insight[]>([
    {
      id: "dummy-1",
      title: i18n.t("overlay.insights.dummyTitle1") || "Insight 1",
      prompt: i18n.t("overlay.insights.dummyInsight1"),
      created_at: nowIso,
    },
    {
      id: "dummy-2",
      title: i18n.t("overlay.insights.dummyTitle2") || "Insight 2",
      prompt: i18n.t("overlay.insights.dummyInsight2"),
      created_at: nowIso,
    },
    {
      id: "dummy-3",
      title: i18n.t("overlay.insights.dummyTitle3") || "Insight 3",
      prompt: i18n.t("overlay.insights.dummyInsight3"),
      created_at: nowIso,
    },
  ]);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);

  const adjustWindowHeight = () => {
    if (!window.api || !viewportRef.current) return;
    const topBar = document.querySelector(".top-bar") as HTMLElement;
    const activeContent = viewportRef.current as HTMLElement;
    if (!topBar || !activeContent) return;
    const topBarHeight = topBar.offsetHeight;
    const contentHeight = activeContent.scrollHeight;
    const idealHeight = topBarHeight + contentHeight;
    const targetHeight = Math.min(700, idealHeight);
    window.api.listenView.adjustWindowHeight("listen", targetHeight);
  };

  const startTimer = () => {
    const startTime = Date.now();
    timerInterval.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60)
        .toString()
        .padStart(2, "0");
      const seconds = (elapsed % 60).toString().padStart(2, "0");
      setElapsedTime(`${minutes}:${seconds}`);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
  };

  // Main subscription effect
  useEffect(() => {
    if (!aggregatorRef.current)
      aggregatorRef.current = new TranscriptAggregator();
    const agg = aggregatorRef.current;

    const unsubscribeAgg = agg.onUpdate((msgs) => {
      setMessages([...msgs]);
      if (autoScroll && viewportRef.current) {
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      }
    });

    let gaveUp = false;
    const backend =
      window.EVIA_BACKEND_URL || window.API_BASE_URL || "http://localhost:8000";
    let token: string = "";
    let chatId = localStorage.getItem("current_chat_id");

    async function primeToken() {
      token = (await getAuthToken()) || "";
    }

    async function ensureChat() {
      if (!chatId && token) {
        try {
          chatId = await getOrCreateChatId(backend, token);
          if (chatId) localStorage.setItem("current_chat_id", chatId);
        } catch (e) {
          console.error("[ListenView] Failed to obtain chat id", e);
        }
      }
    }

    async function initWithRetry(attempt = 1) {
      const maxAttempts = 5;
      const delay = 500 * Math.pow(2, attempt - 1);
      try {
        if (!token) throw new Error("no auth token");
        await ensureChat();
        await (window as any).evia?.transcripts?.init?.({
          backend,
          token,
          chat_id: chatId,
        });
        console.log(
          `[ListenView] transcript:init succeeded on attempt ${attempt}`
        );
      } catch (err: any) {
        console.warn(
          `[ListenView] transcript:init attempt ${attempt} failed: ${
            err?.message || err
          }`
        );
        if (attempt < maxAttempts) {
          setTimeout(() => initWithRetry(attempt + 1), delay);
        } else {
          console.error(
            `[ListenView] transcript:init giving up after ${attempt} attempts`
          );
          gaveUp = true;
        }
      }
    }

    // Kick off init
    primeToken().then(() => initWithRetry());

    // Fallback local sockets if central manager unavailable
    async function setupFallbackSockets() {
      console.warn("[ListenView][FALLBACK] Using renderer-local WebSockets");
      try {
        const micWs = getWebSocketInstance(chatId!, "mic");
        const sysWs = getWebSocketInstance(chatId!, "system");
        micWs.onMessage((msg: any) => {
          if (msg?.type === "transcript_segment") {
            const text = msg.data?.text || "";
            const isFinal = msg.data?.is_final || msg.data?.final || false;
            agg.applySegment({
              source: "mic",
              data: { text, is_final: isFinal },
            });
          }
        });
        sysWs.onMessage((msg: any) => {
          if (msg?.type === "transcript_segment") {
            const text = msg.data?.text || "";
            const isFinal = msg.data?.is_final || msg.data?.final || false;
            agg.applySegment({
              source: "system",
              data: { text, is_final: isFinal },
            });
          }
        });
        await Promise.all([micWs.connect(), sysWs.connect()]);
        console.log("[ListenView][FALLBACK] Local WebSockets connected");
      } catch (err) {
        console.error("[ListenView][FALLBACK] Failed local WS setup", err);
      }
    }

    // Subscribe to central transcript events
    const off = (window as any).evia?.transcripts?.onEvent?.((evt: any) => {
      if (!evt) return;
      try {
        if (evt.type === "transcript_segment") {
          console.log("[ListenView][evt] transcript_segment", {
            source: evt.source,
            text: evt.data?.text,
            is_final: evt.data?.is_final,
            final: evt.data?.final,
          });
        } else if (evt.type === "status") {
          console.log("[ListenView][evt] status", evt.data);
        } else if (evt.type === "insight_segment") {
          console.log(
            "[ListenView][evt] insight_segment",
            evt.data?.text || evt.data?.prompt
          );
        }
      } catch {}
      if (evt.type === "transcript_segment") {
        const text = evt.data?.text || "";
        const isFinal = evt.data?.is_final || evt.data?.final || false;
        const source: "mic" | "system" =
          evt.source === "system" ? "system" : "mic";
        agg.applySegment({ source, data: { text, is_final: isFinal } });
        console.log("[ListenView][agg] messageCount", agg.getMessages().length);
      } else if (evt.type === "status") {
        if (evt.data?.dg_open === true) {
          if (!isSessionActive) {
            setIsSessionActive(true);
            startTimer();
          }
        }
        if (evt.data?.dg_open === false) {
          if (isSessionActive) {
            setIsSessionActive(false);
            stopTimer();
          }
        }
      } else if (evt.type === "insight_segment") {
        const t = evt.data?.text || evt.data?.prompt;
        if (t)
          setInsights((prev) => [
            ...prev,
            {
              id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              title: "Insight",
              prompt: t,
              created_at: new Date().toISOString(),
            },
          ]);
      }
    });

    // Poll whether we gave up and then start fallback
    const fallbackCheck = setInterval(() => {
      if (gaveUp) {
        clearInterval(fallbackCheck);
        setupFallbackSockets();
      }
    }, 1000);

    return () => {
      off && off();
      unsubscribeAgg();
      clearInterval(fallbackCheck);
    };
  }, [autoScroll, isSessionActive]);

  // Recalculate window height on message changes
  useEffect(() => {
    adjustWindowHeight();
  }, [messages]);

  const toggleView = async () => {
    const newMode = viewMode === "transcript" ? "insights" : "transcript";
    setViewMode(newMode);
    if (copyState === "copied" && copiedView !== newMode) setCopyState("idle");

    if (newMode === "insights" && insights.length === 0) {
      setIsLoadingInsights(true);
      try {
        const chatId = Number(localStorage.getItem("current_chat_id") || "0");
        const token = (await getAuthToken()) || "";
        if (chatId && token) {
          const fetchedInsights = await fetchInsights({
            chatId,
            token,
            language: "de",
          });
          setInsights(fetchedInsights);
        }
      } catch (error) {
        console.error("[ListenView] Failed to fetch insights:", error);
      } finally {
        setIsLoadingInsights(false);
      }
    }
  };

  const handleCopyHover = (hovering: boolean) => setIsHovering(hovering);

  const handleCopy = async () => {
    if (copyState === "copied") return;
    const textToCopy =
      viewMode === "transcript"
        ? aggregatorRef.current?.getTranscriptText(false) || ""
        : insights.map((i) => `${i.title}: ${i.prompt}`).join("\n");

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopyState("copied");
      setCopiedView(viewMode);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => {
        setCopyState("idle");
        setCopiedView(null);
      }, 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleInsightClick = async (insight: Insight) => {
    console.log("[ListenView] Insight clicked:", insight.title);
    try {
      await (window as any).evia?.windows?.openAskWindow?.();
      setTimeout(() => {
        const askInput = document.querySelector(
          "#textInput"
        ) as HTMLInputElement;
        if (askInput) {
          askInput.value = insight.prompt;
          askInput.focus();
        }
      }, 300);
    } catch (error) {
      console.error("[ListenView] Failed to open Ask window:", error);
    }
  };

  const displayText =
    copyState === "copied" && copiedView === viewMode
      ? viewMode === "transcript"
        ? i18n.t("overlay.listen.copiedTranscript")
        : i18n.t("overlay.listen.copiedInsights")
      : isHovering
      ? viewMode === "transcript"
        ? i18n.t("overlay.listen.copyTranscript")
        : i18n.t("overlay.listen.copyInsights")
      : viewMode === "insights"
      ? i18n.t("overlay.listen.showInsights")
      : `${i18n.t("overlay.listen.listening")} ${elapsedTime}`;

  return (
    <div
      className="assistant-container"
      style={{
        width: "400px",
        transform: "translate3d(0, 0, 0)",
        backfaceVisibility: "hidden",
        transition:
          "transform 0.2s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.2s ease-out",
        willChange: "transform, opacity",
      }}
    >
      <style>
        {`
          .assistant-container { display: flex; flex-direction: column; color: #fff; position: relative; background: rgba(0,0,0,0.3); border-radius: 12px; }
          .assistant-container::after { content:''; position:absolute; inset:0; border-radius:12px; padding:1px; background:linear-gradient(169deg,rgba(255,255,255,0.17)0%,rgba(255,255,255,0.08)50%,rgba(255,255,255,0.17)100%); -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0); -webkit-mask-composite: destination-out; mask-composite: exclude; pointer-events:none; }
          .assistant-container::before { content:''; position:absolute; inset:0; background:rgba(0,0,0,0.15); box-shadow:0 8px 32px rgba(0,0,0,0.3); border-radius:12px; z-index:-1; }
          .top-bar { display:flex; justify-content:space-between; align-items:center; padding:6px 16px; min-height:32px; border-bottom:1px solid rgba(255,255,255,0.1); }
          .bar-left-text { color:#fff; font-size:13px; font-weight:500; white-space:nowrap; overflow:hidden; flex:1; min-width:0; max-width:200px; }
          .bar-left-text-content.slide-in { animation: slideIn 0.3s ease forwards; }
          .bar-controls { display:flex; gap:8px; align-items:center; padding:4px; }
          .toggle-button { display:flex; align-items:center; gap:5px; background:transparent; color:rgba(255,255,255,0.9); border:none; padding:4px 8px; border-radius:5px; font-size:11px; font-weight:500; cursor:pointer; height:24px; }
          .toggle-button:hover { background: rgba(255,255,255,0.1); color:#fff; }
          .copy-button { background:transparent; color:rgba(255,255,255,0.9); border:none; padding:4px; border-radius:3px; cursor:pointer; display:flex; align-items:center; justify-content:center; min-width:24px; height:24px; position:relative; }
          .copy-button:hover { background: rgba(255,255,255,0.15); }
          .copy-button svg { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); transition:opacity .2s, transform .2s; }
          .copy-button .copy-icon { opacity: ${
            copyState === "copied" ? "0" : "1"
          }; transform:${
          copyState === "copied"
            ? "translate(-50%,-50%) scale(.5)"
            : "translate(-50%,-50%) scale(1)"
        }; }
          .copy-button .check-icon { opacity: ${
            copyState === "copied" ? "1" : "0"
          }; transform:${
          copyState === "copied"
            ? "translate(-50%,-50%) scale(1)"
            : "translate(-50%,-50%) scale(.5)"
        }; }
          .glass-scroll { flex:1; overflow-y:auto; overflow-x:hidden; padding:12px 16px; display:flex; flex-direction:column; gap:8px; }
          .glass-scroll::-webkit-scrollbar { width:8px; background:rgba(0,0,0,0.2); }
          .glass-scroll::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.3); border-radius:4px; }
          .glass-scroll::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,0.5); }
          .bubble { padding:8px 12px; border-radius:12px; max-width:80%; font-size:13px; line-height:1.4; }
          .bubble.me { align-self:flex-end; }
          .bubble.them { align-self:flex-start; }
          .insights-placeholder { color:rgba(255,255,255,0.7); text-align:center; padding:16px; font-size:12px; font-style:italic; }
          .insight-item { padding:12px 16px; margin-bottom:8px; background:rgba(255,255,255,0.08); border-radius:8px; cursor:pointer; border:1px solid rgba(255,255,255,0.1); }
          .insight-item:hover { background:rgba(255,255,255,0.15); border-color:rgba(255,255,255,0.2); transform:translateY(-1px); }
          .insight-title { font-size:13px; font-weight:500; color:rgba(255,255,255,0.95); margin-bottom:4px; }
          .insight-prompt { font-size:11px; color:rgba(255,255,255,0.7); font-style:italic; }
        `}
      </style>
      <div className="assistant-container">
        <div className="top-bar">
          <div className="bar-left-text">
            <span
              className={`bar-left-text-content ${
                isHovering ? "slide-in" : ""
              }`}
            >
              {displayText}
            </span>
          </div>
          <div className="bar-controls">
            <button className="toggle-button" onClick={toggleView}>
              {viewMode === "insights" ? (
                <>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>{i18n.t("overlay.listen.showTranscript")}</span>
                </>
              ) : (
                <>
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 11l3 3L22 4" />
                    <path d="M22 12v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                  </svg>
                  <span>{i18n.t("overlay.listen.showInsights")}</span>
                </>
              )}
            </button>
            <button
              className={`copy-button ${
                copyState === "copied" ? "copied" : ""
              }`}
              onClick={handleCopy}
              onMouseEnter={() => handleCopyHover(true)}
              onMouseLeave={() => handleCopyHover(false)}
            >
              <svg
                className="copy-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              <svg
                className="check-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </button>
          </div>
        </div>
        <div className="glass-scroll" ref={viewportRef}>
          {viewMode === "transcript" ? (
            messages.length > 0 ? (
              <>
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`bubble ${m.speaker === 0 ? "me" : "them"}`}
                    style={{
                      opacity: m.isFinal ? 1 : 0.5,
                      fontStyle: m.isFinal ? "normal" : "italic",
                      background:
                        m.speaker === 0
                          ? m.isFinal
                            ? "linear-gradient(135deg, rgba(0, 122, 255, 0.9) 0%, rgba(10, 132, 255, 0.85) 100%)"
                            : "linear-gradient(135deg, rgba(0, 122, 255, 0.4) 0%, rgba(10,132,255,0.35) 100%)"
                          : m.isFinal
                          ? "rgba(255, 255, 255, 0.12)"
                          : "rgba(255,255,255,0.08)",
                      alignSelf: m.speaker === 0 ? "flex-end" : "flex-start",
                      color: "#ffffff",
                    }}
                  >
                    <span className="bubble-text">{m.text}</span>
                  </div>
                ))}
              </>
            ) : (
              <div
                className="insights-placeholder"
                style={{ padding: "8px 16px", fontStyle: "italic" }}
              >
                {i18n.t("overlay.listen.waitingForSpeech")}
              </div>
            )
          ) : isLoadingInsights ? (
            <div
              className="insights-placeholder"
              style={{ padding: "8px 16px", fontStyle: "italic" }}
            >
              Loading insights...
            </div>
          ) : insights.length > 0 ? (
            insights.map((insight) => (
              <div
                key={insight.id}
                className="insight-item"
                onClick={() => handleInsightClick(insight)}
              >
                <div className="insight-title">{insight.title}</div>
                <div className="insight-prompt">{insight.prompt}</div>
              </div>
            ))
          ) : (
            <div
              className="insights-placeholder"
              style={{ padding: "8px 16px", fontStyle: "italic" }}
            >
              {i18n.t("overlay.listen.noInsightsYet")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ListenView;
