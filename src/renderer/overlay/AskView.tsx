import React, { useCallback, useEffect, useRef, useState } from 'react';
import './overlay-glass.css';
import { streamAsk, type AskQuerySource } from '../lib/evia-ask-stream';
import { i18n } from '../i18n/i18n';
import { consumePresetSessionReset, clearSessionBinding } from '../lib/pending-preset-reset';
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import { BACKEND_URL } from '../config/config';
import { getDemoAskResponse } from '../demo-scenario';
import taylosMarkUrl from './assets/taylos_mark.png';
import {
  trackAskFailed,
  trackAskRequestReady,
  trackAskResponseReceived,
  trackSuggestionContext,
  trackAskSubmitted,
} from '../services/posthogService';

interface AskViewProps {
  language: 'de' | 'en';
  onClose?: () => void;
  onSubmitPrompt?: (prompt: string) => void;
}

type AskTranscriptEntry = {
  speaker: number | null;
  text: string;
  created_at?: string;
  timestamp?: number;
};

type AskSendPayload = {
  text: string;
  sessionState?: string;
  transcriptContext?: string;
  chatId?: number | string;
  querySource?: AskQuerySource;
  // Set only when ListenView proved the transcript has not moved since the
  // insights refresh that produced this answer. Its presence means: display
  // this, do not ask the backend anything.
  preparedSuggestion?: string;
  preparedSuggestionId?: string;
  preparedFingerprint?: string;
  preparedClickedAtMs?: number;
};

type AskSessionState = 'before' | 'during' | 'after';

// The thinking layout (header + centered spinner + input row) has one deterministic
// height, but it depends on font metrics that only exist after render. We cache the real
// measurement so every open starts at EXACTLY the height thinking settles at - the window
// must not resize between "pressed Enter" and "first token".
const THINKING_HEIGHT_KEY = 'evia_ask_thinking_height';
const DEFAULT_THINKING_HEIGHT = 168;
const MIN_THINKING_HEIGHT = 120;
const MAX_THINKING_HEIGHT = 400;

const isSaneThinkingHeight = (value: number): boolean =>
  Number.isFinite(value) && value >= MIN_THINKING_HEIGHT && value <= MAX_THINKING_HEIGHT;

const readThinkingHeight = (): number => {
  try {
    const cached = Number(localStorage.getItem(THINKING_HEIGHT_KEY));
    if (isSaneThinkingHeight(cached)) return cached;
  } catch {
    /* localStorage unavailable - fall through to the default */
  }
  return DEFAULT_THINKING_HEIGHT;
};

const AskView: React.FC<AskViewProps> = ({ language, onClose, onSubmitPrompt }) => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [showTextInput, setShowTextInput] = useState(true);
  const [headerText, setHeaderText] = useState(i18n.t('overlay.ask.aiResponse'));
  const [responseHistory, setResponseHistory] = useState<{question: string, response: string}[]>([]);
  const [responseIndex, setResponseIndex] = useState(-1);
  const [responseSessionState, setResponseSessionState] = useState<AskSessionState>('before');
  const [responseNeedsScroll, setResponseNeedsScroll] = useState(false);
  
  const streamRef = useRef<{ abort: () => void } | null>(null);
  const streamStartTime = useRef<number | null>(null);
  const ttftLoggedRef = useRef(false);
  const responseContainerRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const restartStreamTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const deterministicDemoTimerRef = useRef<NodeJS.Timeout | null>(null);
  const demoModeEnabledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);  // UI IMPROVEMENT: Auto-focus input
  const lastResponseRef = useRef<string>('');  // UI IMPROVEMENT: Track when content actually changes
  const storedContentHeightRef = useRef<number | null>(null);  // CRITICAL: Store content-based height to restore after arrow key movement
  const responseBufferRef = useRef<string>('');
  const responseHistoryRef = useRef<{question: string, response: string}[]>([]);
  const responseIndexRef = useRef<number>(-1);
  const lastSendAndSubmitSignatureRef = useRef<string>('');
  const lastSendAndSubmitAtRef = useRef<number>(0);
  const normalizeContextText = useCallback((value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase(), []);
  const stripUserVisibleStreamArtifacts = useCallback((value: string) => {
    return (value || '')
      .replace(/\s*\[(?:Fehler|Error):[^\]]+\]\.?\s*/gi, ' ')
      .replace(/\s*(?:Was muss intern passieren, damit wir den nächsten Schritt fixieren\?|What would need to happen internally to lock the next step\?)\s*/gi, ' ')
      .replace(/\s+([.!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }, []);
  const sanitizeLiveAskMarkdown = useCallback((text: string) => {
    if (!text) return '';
    const cleaned = stripUserVisibleStreamArtifacts(text)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/`(.+?)`/gs, '$1')
      .replace(/^[\s,;:.\-–—]+/, '')
      // A direct answer and an optional spoken line are different products:
      // information for the seller, then exact words for the prospect.
      .replace(/\s*→\s*(Say|Sag)\s*:\s*/i, (_match, label: string) => `\n\n---\n\n**${label}:** `)
      // The backend appends a grounded next step as "---\n[Action: ...]". It is
      // not noise to strip: the divider is the line between what to SAY and what
      // to DO, and both belong on screen. Rendered as markdown it becomes a rule
      // plus a bold label instead of literal brackets, which is what shipped to
      // a live English call as "... ---\n[Action: End meeting - goal achieved]".
      .replace(
        /\n*\s*---\s*\n*\s*\[(?:Action|Aktion):\s*([^\]\n]+)\]\s*/gi,
        (_m, body: string) =>
          `\n\n---\n\n**${i18n.getLanguage() === 'de' ? 'Aktion' : 'Action'}:** ${body.trim()}\n`,
      )
      // An action the model emitted without the divider still gets one, so the
      // separation is consistent however the model formatted it.
      .replace(
        /\s*\[(?:Action|Aktion):\s*([^\]\n]+)\]\s*/gi,
        (_m, body: string) =>
          `\n\n---\n\n**${i18n.getLanguage() === 'de' ? 'Aktion' : 'Action'}:** ${body.trim()}\n`,
      )
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!cleaned) return '';
    const firstChar = cleaned.charAt(0);
    if (firstChar >= 'a' && firstChar <= 'z') {
      return firstChar.toUpperCase() + cleaned.slice(1);
    }
    return cleaned;
  }, [stripUserVisibleStreamArtifacts]);

  const sanitizeRichAskMarkdown = useCallback((text: string) => {
    if (!text) return '';
    // Preparation/post-call responses render full markdown structure (headings, lists,
    // bold, line breaks). Keep headings — h1-h6 are already in the render allow-list —
    // so the model's structure survives instead of being flattened to one block.
    return stripUserVisibleStreamArtifacts(text)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`(.+?)`/gs, '$1')
      // Normalize bullet markers to "-": a model that mixes "-" and "*"/"+" markers makes
      // CommonMark split one list into several, so the first bullet rendered detached from
      // the rest. Only matches a marker followed by whitespace at line start (never *bold*).
      .replace(/^([ \t]*)[*+]([ \t]+)/gm, '$1-$2')
      // Models occasionally glue a bold section title to the preceding takeaway. A bold
      // span followed by a list is structural, so make the boundary deterministic here too.
      .replace(/[ \t]*(\*\*[^*\n]{2,80}\*\*)[ \t]*(?=(?:\n[ \t]*)?[-*+]\s+)/g, '\n\n$1\n')
      .replace(/(\*\*[^*\n]+\*\*)[ \t]+(?=\*\*[^*\n]+\*\*)/g, '$1\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }, [stripUserVisibleStreamArtifacts]);

  const sanitizeAskOutput = useCallback((text: string, state: AskSessionState) => {
    return state === 'during'
      ? sanitizeLiveAskMarkdown(text)
      : sanitizeRichAskMarkdown(text);
  }, [sanitizeLiveAskMarkdown, sanitizeRichAskMarkdown]);

  const deduplicateTranscriptEntries = useCallback((entries: AskTranscriptEntry[]): AskTranscriptEntry[] => {
    const deduped: AskTranscriptEntry[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      const cleaned = (entry.text || '').trim();
      if (!cleaned) continue;
      if (/^(taylos|evia) connection ok$/i.test(cleaned)) continue;

      const normalized = normalizeContextText(cleaned);
      const key = `${entry.speaker ?? 'u'}:${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({ ...entry, text: cleaned });
    }

    return deduped;
  }, [normalizeContextText]);

  const formatTranscriptContextForLLM = useCallback((entries: AskTranscriptEntry[], maxChars = 40000) => {
    const lines: string[] = [];
    let charCount = 0;

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      const cleaned = (entry.text || '').trim();
      if (!cleaned) continue;
      const speakerLabel = entry.speaker === 1 ? 'User' : entry.speaker === 0 ? 'Prospect' : 'Unknown';
      const line = `${speakerLabel}: ${cleaned}`;
      const projected = charCount + line.length + 1;
      if (projected > maxChars) break;
      lines.unshift(line);
      charCount = projected;
    }

    return lines.join('\n');
  }, []);
  
  // Taylos-specific: Error handling
  const [errorToast, setErrorToast] = useState<{message: string, canRetry: boolean} | null>(null);
  const [isLoadingFirstToken, setIsLoadingFirstToken] = useState(false);
  const errorToastTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastPromptRef = useRef<string>('');
  const lastQuerySourceRef = useRef<AskQuerySource>('user_typed');
  const liveTranscriptOverrideRef = useRef<string | null>(null);
  const chatIdOverrideRef = useRef<string | null>(null);
  const startStreamRef = useRef<((captureScreenshot?: boolean, overridePrompt?: string, querySource?: AskQuerySource) => Promise<void>) | null>(null);
  const focusInputWithRetryRef = useRef<(() => void) | null>(null);
  const cancelActiveStreamRef = useRef<((reason: string) => void) | null>(null);

  useEffect(() => {
    responseHistoryRef.current = responseHistory;
  }, [responseHistory]);

  useEffect(() => {
    responseIndexRef.current = responseIndex;
  }, [responseIndex]);

  useEffect(() => {
    let cancelled = false;

    void window.evia?.demo?.isEnabled?.()
      .then((result) => {
        if (!cancelled) demoModeEnabledRef.current = result?.enabled === true;
      })
      .catch((error: unknown) => {
        console.warn('[AskView] Could not read demo mode state:', error);
      });

    return () => {
      cancelled = true;
      if (deterministicDemoTimerRef.current) {
        clearTimeout(deterministicDemoTimerRef.current);
        deterministicDemoTimerRef.current = null;
      }
    };
  }, []);

  // UX IMPROVEMENT: Helper function to focus input with retry (NO DELAYS - instant focus)
  const focusInputWithRetry = useCallback(() => {
    if (!inputRef.current) return;
    
    // INSTANT focus (no setTimeout delays)
    requestAnimationFrame(() => {
        inputRef.current?.focus();
        console.log('[AskView] ⌨️ Auto-focused input (attempt 1)');
        
      // Verify focus worked after next frame - if not, retry once
      requestAnimationFrame(() => {
          if (document.activeElement !== inputRef.current && inputRef.current) {
            console.warn('[AskView] ⚠️ Focus failed, retrying...');
            inputRef.current.focus();
            console.log('[AskView] ⌨️ Auto-focused input (attempt 2)');
          }
      });
    });
  }, []);

  // Keep sizing helpers above any hook dependency arrays that reference them.
  const MIN_ASK_BAR_HEIGHT = 58;

  const measureResponseContentHeight = useCallback(() => {
    const container = responseContainerRef.current;
    if (!container || container.classList.contains('hidden')) return 0;
    const hasRenderedText = Boolean(responseBufferRef.current.trim()) || Boolean(response.trim());
    if (!hasRenderedText && isLoadingFirstToken) return 0;
    const style = window.getComputedStyle(container);
    const paddingTop = parseFloat(style.paddingTop || '0') || 0;
    const paddingBottom = parseFloat(style.paddingBottom || '0') || 0;
    const markdownEl = container.querySelector('.markdown-content') as HTMLElement | null;
    const loadingEl = container.querySelector('.loading-dots') as HTMLElement | null;
    const abortButtonEl = container.querySelector('.abort-button') as HTMLElement | null;
    const emptyStateEl = container.querySelector('.empty-state') as HTMLElement | null;
    const markdownHeight = markdownEl?.scrollHeight || markdownEl?.offsetHeight || 0;
    const loadingHeight = loadingEl?.scrollHeight || loadingEl?.offsetHeight || 0;
    const abortHeight = abortButtonEl?.offsetHeight || 0;
    const emptyHeight = emptyStateEl?.scrollHeight || emptyStateEl?.offsetHeight || 0;
    return Math.ceil(Math.max(markdownHeight + abortHeight, loadingHeight, emptyHeight, 0) + paddingTop + paddingBottom);
  }, [response, isLoadingFirstToken]);

  const measureTargetWindowHeight = useCallback(() => {
    const headerEl = document.querySelector('.response-header:not(.hidden)') as HTMLElement | null;
    const inputEl = document.querySelector('.text-input-container:not(.hidden)') as HTMLElement | null;
    const headerH = headerEl?.offsetHeight || 0;
    const contentH = measureResponseContentHeight();
    const inputH = inputEl?.offsetHeight || 0;
    return Math.max(MIN_ASK_BAR_HEIGHT, Math.ceil(headerH + contentH + inputH + 2));
  }, [measureResponseContentHeight]);

  const requestWindowResize = useCallback((targetHeight: number) => {
    const eviaApi = (window as any).evia;
    if (eviaApi?.windows?.adjustAskHeight) {
      const availableHeight = Math.max(700, (window.screen?.availHeight || 820) - 56);
      const clampedHeight = Math.max(58, Math.min(availableHeight, targetHeight));
      eviaApi.windows.adjustAskHeight(clampedHeight);
    }
  }, []);

  const updateResponseOverflowState = useCallback(() => {
    const container = responseContainerRef.current;
    if (!container || container.classList.contains('hidden')) {
      setResponseNeedsScroll(false);
      return;
    }

    const needsScroll = (container.scrollHeight - container.clientHeight) > 2;
    setResponseNeedsScroll(prev => (prev === needsScroll ? prev : needsScroll));
  }, []);

  // SESSION STATE: Track current session state for context-aware responses
  // Values: 'before' (pre-call), 'during' (active call), 'after' (post-call)
  // Synced from EviaBar via IPC, with localStorage as backup for initial state
  const [sessionState, setSessionState] = useState<AskSessionState>(() => {
    const stored = localStorage.getItem('evia_session_state');
    if (stored === 'before' || stored === 'during' || stored === 'after') {
      console.log('[AskView] 🎯 Initial session state from localStorage:', stored);
      return stored;
    }
    console.log('[AskView] 🎯 Initial session state: before (default)');
    return 'before';
  });

  // Configure marked for syntax highlighting
  useEffect(() => {
    marked.setOptions({
      breaks: true,
      gfm: true,
    } as any);
    
    // Note: marked v9+ uses marked.use() for extensions, but we'll highlight after render
  }, []);

  // GLASS PARITY: RAF-throttled ResizeObserver (not time-based debounce)
  // Glass uses requestAnimationFrame to throttle measurements (at most once per frame)
  // CRITICAL: Final measurement happens in onDone(), this is just for live updates
  useEffect(() => {
    const container = document.querySelector('.ask-container');
    if (!container) return;

    let rafThrottled = false;

    resizeObserverRef.current = new ResizeObserver(entries => {
      // GLASS PATTERN: RAF throttling prevents measurement spam
      if (rafThrottled) return;
      
      rafThrottled = true;
      requestAnimationFrame(() => {
        for (const entry of entries) {
          const current = window.innerHeight;
          const contentChanged = isStreaming || response !== lastResponseRef.current;
          
          const hasLiveText = Boolean(responseBufferRef.current.trim());
          if (contentChanged && isStreaming && hasLiveText) {
            const targetHeight = measureTargetWindowHeight();
            const delta = Math.abs(targetHeight - current);
            
            if (delta > 12) {
              storedContentHeightRef.current = targetHeight;
              requestWindowResize(targetHeight);
              console.log('[AskView] 📏 Live (streaming): target=%dpx', targetHeight);
            }
          }
        }
        
        rafThrottled = false;
      });
    });

    resizeObserverRef.current.observe(container);

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [isStreaming, response, sessionState, measureTargetWindowHeight]);

  // Glass parity: Auto-scroll to bottom during streaming
  useEffect(() => {
    if (responseContainerRef.current && isStreaming) {
      responseContainerRef.current.scrollTop = responseContainerRef.current.scrollHeight;
    }
  }, [response, isStreaming]);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      updateResponseOverflowState();
    });
    return () => cancelAnimationFrame(rafId);
  }, [response, isStreaming, isLoadingFirstToken, updateResponseOverflowState]);

  // UI IMPROVEMENT: Update lastResponseRef when streaming completes
  // This allows ResizeObserver to know when content has actually changed vs just window moving
  useEffect(() => {
    if (!isStreaming && response) {
      // Streaming just completed - update the reference
      lastResponseRef.current = response;
      console.log('[AskView] 📝 Response complete, saved for resize detection');
    }
  }, [isStreaming, response]);

  // GLASS PARITY FIX: Listen for single-step IPC send-and-submit (from ListenView insight clicks)
  useEffect(() => {
    const eviaIpc = (window as any).evia?.ipc;
    if (!eviaIpc) {
      console.warn('[AskView] ⚠️ IPC bridge not available for cross-window communication');
      return;
    }

    const handleSendAndSubmit = (payload: string | AskSendPayload) => {
      // FIX: Handle both old format (string) and new format (object with sessionState)
      const incomingPrompt = typeof payload === 'string' ? payload : payload.text;
      const explicitSessionState = typeof payload === 'object' ? payload.sessionState : undefined;
      const transcriptContext = typeof payload === 'object' ? payload.transcriptContext : undefined;
      const explicitChatId = typeof payload === 'object' ? payload.chatId : undefined;
      // ListenView says which control was pressed. A bare string is an older
      // sender, and 'insight_click' is the right reading of it: every existing
      // producer of this channel is an insights control.
      const incomingQuerySource: AskQuerySource =
        (typeof payload === 'object' ? payload.querySource : undefined) ?? 'insight_click';
      const signature = JSON.stringify([
        incomingPrompt.trim(),
        explicitSessionState || '',
        transcriptContext || '',
        explicitChatId || '',
      ]);
      const now = Date.now();

      if (
        signature === lastSendAndSubmitSignatureRef.current &&
        (
          now - lastSendAndSubmitAtRef.current < 1500 ||
          Boolean(streamRef.current) ||
          Boolean(restartStreamTimeoutRef.current)
        )
      ) {
        console.log('[AskView] ⏭️ Ignoring duplicate send-and-submit payload');
        return;
      }

      lastSendAndSubmitSignatureRef.current = signature;
      lastSendAndSubmitAtRef.current = now;
      
      console.log('[AskView] 📥 Received send-and-submit via IPC:', incomingPrompt.substring(0, 50));

      // A prepared answer is displayed, not requested. No stream is opened, no
      // /ask call is made, and nothing here can fail slowly: the text already
      // passed the full production contract server-side before it was sent.
      const prepared = typeof payload === 'object' ? (payload.preparedSuggestion || '').trim() : '';
      if (prepared) {
        const preparedSessionState = (
          explicitSessionState === 'before' || explicitSessionState === 'during' || explicitSessionState === 'after'
            ? explicitSessionState
            : 'during'
        ) as AskSessionState;
        const clickedAt = typeof payload === 'object' ? payload.preparedClickedAtMs : undefined;
        const clickToVisibleMs = clickedAt ? Math.max(0, Date.now() - clickedAt) : 0;
        trackAskSubmitted({
          question_length: incomingPrompt.length,
          session_state: preparedSessionState,
          is_typed: false,
          language,
          query_source: incomingQuerySource,
          has_transcript_context: Boolean(transcriptContext),
          delivery: 'prepared',
        });
        trackAskResponseReceived({
          response_length: prepared.length,
          latency_ms: clickToVisibleMs,
          ttft_ms: clickToVisibleMs,
          session_state: preparedSessionState,
          query_source: incomingQuerySource,
          delivery: 'prepared',
        });
        // The answer AND what produced it - the question, and the conversation
        // it was asked inside.
        trackSuggestionContext({
          surface: 'ask',
          suggestion: prepared,
          question: incomingPrompt,
          transcript: transcriptContext,
          session_state: preparedSessionState,
          language,
        });
        if (restartStreamTimeoutRef.current) {
          clearTimeout(restartStreamTimeoutRef.current);
          restartStreamTimeoutRef.current = null;
        }
        cancelActiveStreamRef.current?.('prepared suggestion displayed');
        if (explicitSessionState) {
          localStorage.setItem('evia_session_state', explicitSessionState);
          setSessionState(explicitSessionState as AskSessionState);
        }
        liveTranscriptOverrideRef.current = transcriptContext || null;
        chatIdOverrideRef.current = explicitChatId ? String(explicitChatId) : null;
        setPrompt(incomingPrompt);
        setShowTextInput(true);
        setIsStreaming(false);
        setErrorToast(null);
        setTtftMs(null);
        responseBufferRef.current = prepared;
        lastResponseRef.current = prepared;
        setResponse(prepared);
        setCurrentQuestion(incomingPrompt);
        setHeaderText(i18n.t('overlay.ask.aiResponse'));
        // Same shape the streamed path appends, so history navigation cannot
        // tell a prepared answer from a generated one.
        setResponseHistory((prev) => {
          const next = [...prev, { question: incomingPrompt, response: prepared }];
          setResponseIndex(next.length - 1);
          return next;
        });
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const targetHeight = measureTargetWindowHeight();
            storedContentHeightRef.current = targetHeight;
            requestWindowResize(targetHeight);
            console.log(
              '[PREPARED] displayed id=%s click_to_visible_ms=%s chars=%d',
              (typeof payload === 'object' ? payload.preparedSuggestionId : '') || '-',
              clickedAt ? String(Date.now() - clickedAt) : 'unknown',
              prepared.length,
            );
          });
        });
        return;
      }
      
      // FIX: If session state explicitly provided, update it BEFORE starting stream
      // This ensures backend receives correct session_state (especially 'after' from Insights clicks)
      if (explicitSessionState) {
        console.log('[AskView] 🎯 Updating session state from Insights:', explicitSessionState);
        localStorage.setItem('evia_session_state', explicitSessionState);
        setSessionState(explicitSessionState as 'before' | 'during' | 'after');
      }
      liveTranscriptOverrideRef.current = transcriptContext || null;
      chatIdOverrideRef.current = explicitChatId ? String(explicitChatId) : null;
      
      setPrompt(incomingPrompt);
      setShowTextInput(true);

      const queueReplacementStart = (delayMs: number) => {
        if (restartStreamTimeoutRef.current) {
          clearTimeout(restartStreamTimeoutRef.current);
        }
        restartStreamTimeoutRef.current = setTimeout(() => {
          restartStreamTimeoutRef.current = null;
          startStreamRef.current?.(false, incomingPrompt, incomingQuerySource);
          setTimeout(() => {
            focusInputWithRetryRef.current?.();
          }, 100);
        }, delayMs);
      };

      if (streamRef.current) {
        cancelActiveStreamRef.current?.('new suggestion requested');
        queueReplacementStart(250);
        return;
      }

      queueReplacementStart(50);
    };

    // FIX #27: Clear response when session FULLY closes (Fertig pressed, not just Stopp)
    const handleSessionClosed = () => {
      cancelActiveStreamRef.current?.('session closed');
      console.log('[AskView] 🛑 Session closed (Fertig pressed) - clearing all state');
      setResponse('');
      setResponseHistory([]);
      setResponseIndex(-1);
      setResponseSessionState('before');
      setCurrentQuestion('');
      setPrompt('');
      setIsStreaming(false);
      setTtftMs(null);
      ttftLoggedRef.current = false;
      setErrorToast(null);
      liveTranscriptOverrideRef.current = null;
      chatIdOverrideRef.current = null;
      lastResponseRef.current = '';
      storedContentHeightRef.current = 58;
      if (restartStreamTimeoutRef.current) {
        clearTimeout(restartStreamTimeoutRef.current);
        restartStreamTimeoutRef.current = null;
      }
      // Window will be hidden by EviaBar, no need to resize
    };

    // DESKTOP SENTINEL: Abort streaming if language toggle occurs
    const handleAbortStream = () => {
      console.log('[AskView] 🛑 Received abort-ask-stream - stopping stream');
      cancelActiveStreamRef.current?.('ipc abort-ask-stream');
      console.log('[AskView] ✅ Stream aborted due to language toggle');
    };

    // Keep pre-meeting content visible when Listen starts (before→during).
    // Only cancel transient streaming state; response/history/question persist
    // so the user can still see preparation help at the start of the call.
    const handleClearSession = () => {
      console.log('[AskView] 🧹 Received clear-session - cancelling active stream, keeping content');
      cancelActiveStreamRef.current?.('clear session');
      setIsStreaming(false);
      setTtftMs(null);
      ttftLoggedRef.current = false;
      setErrorToast(null);
      setIsLoadingFirstToken(false);
      liveTranscriptOverrideRef.current = null;
      chatIdOverrideRef.current = null;
      console.log('[AskView] ✅ Stream cancelled, content preserved');
    };

    // SESSION STATE: Listen for session state changes from EviaBar
    const handleSessionStateChanged = (newState: 'before' | 'during' | 'after') => {
      console.log('[AskView] 🎯 Session state changed:', newState);
      // CRITICAL FIX: Also update localStorage in THIS window's context
      // Each Electron window has its own localStorage, so we must sync it here!
      localStorage.setItem('evia_session_state', newState);
      setSessionState(newState);

      // A failed/aborted capture also transitions back to `before`. Preserve
      // the visible answer in that case; only the explicit `session:closed`
      // event above is allowed to clear Ask content.
    };

    // FIX: Clear state on language change (fixes Test 3 failure)
    const handleLanguageChanged = (newLang: string) => {
      console.log('[AskView] 🌐 Language changed to', newLang, '- clearing all state');
      
      // NOTE: i18n.changeLanguage() call removed due to Vite bundler minification issue
      // The bundler minifies 'i18n' to 'ie' which becomes undefined at runtime
      // UI language will update automatically when window reopens or on next backend request
      
      cancelActiveStreamRef.current?.('language changed');
      // Clear all state (same as clear-session)
      setResponse('');
      setResponseHistory([]);
      setResponseIndex(-1);
      setCurrentQuestion('');
      setPrompt('');
      setIsStreaming(false);
      setIsLoadingFirstToken(false);
      lastResponseRef.current = '';
      storedContentHeightRef.current = 58;
      liveTranscriptOverrideRef.current = null;
      chatIdOverrideRef.current = null;

      // Force a fresh chat after language switch so follow-up suggestions
      // cannot inherit stale language/session context from the previous chat.
      try {
        localStorage.removeItem('current_chat_id');
        // And the shared store, or getOrCreateChatId re-adopts the old chat.
        (window as any).evia?.prefs?.set?.({ current_chat_id: null });
      } catch {}
      console.log('[AskView] ✅ State cleared due to language change');
    };

    const handleShortcutNextStep = () => {
      startStream(false, undefined, 'shortcut');
    };

    const handleShortcutPreviousResponse = () => {
      const history = responseHistoryRef.current;
      if (!history.length) return;

      const current = responseIndexRef.current >= 0 ? responseIndexRef.current : history.length - 1;
      const nextIdx = Math.max(0, current - 1);
      if (nextIdx === current) return;

      const entry = history[nextIdx];
      setResponseIndex(nextIdx);
      setResponse(entry.response);
      setCurrentQuestion(entry.question);
      setHeaderText(i18n.t('overlay.ask.aiResponse'));
    };

    const handleShortcutNextResponse = () => {
      const history = responseHistoryRef.current;
      if (!history.length) return;

      const current = responseIndexRef.current >= 0 ? responseIndexRef.current : history.length - 1;
      const nextIdx = Math.min(history.length - 1, current + 1);
      if (nextIdx === current) return;

      const entry = history[nextIdx];
      setResponseIndex(nextIdx);
      setResponse(entry.response);
      setCurrentQuestion(entry.question);
      setHeaderText(i18n.t('overlay.ask.aiResponse'));
    };

    eviaIpc.on('ask:send-and-submit', handleSendAndSubmit);
    eviaIpc.on('session:closed', handleSessionClosed);
    eviaIpc.on('abort-ask-stream', handleAbortStream);
    eviaIpc.on('clear-session', handleClearSession);  // NEW: Listen for clear-session
    eviaIpc.on('session-state-changed', handleSessionStateChanged);
    eviaIpc.on('language-changed', handleLanguageChanged);  // FIX: Listen for language-changed
    eviaIpc.on('shortcut:next-step', handleShortcutNextStep);
    eviaIpc.on('shortcut:previous-response', handleShortcutPreviousResponse);
    eviaIpc.on('shortcut:next-response', handleShortcutNextResponse);
    
    // CRITICAL: Register debug-log listener to show Listen window logs here
    // (since F12 doesn't work in Listen window due to volume controls)
    eviaIpc.on('debug-log', (message: string) => {
      console.log('[🔊 LISTEN WINDOW]', message);
    });
    
    console.log('[AskView] ✅ IPC listeners registered (send-and-submit, session:closed, abort-ask-stream, clear-session, session-state-changed, language-changed, debug-log)');

    return () => {
      if (restartStreamTimeoutRef.current) {
        clearTimeout(restartStreamTimeoutRef.current);
        restartStreamTimeoutRef.current = null;
      }
      eviaIpc.off('ask:send-and-submit', handleSendAndSubmit);
      eviaIpc.off('session:closed', handleSessionClosed);
      eviaIpc.off('abort-ask-stream', handleAbortStream);
      eviaIpc.off('clear-session', handleClearSession);
      eviaIpc.off('session-state-changed', handleSessionStateChanged);
      eviaIpc.off('language-changed', handleLanguageChanged);
      eviaIpc.off('shortcut:next-step', handleShortcutNextStep);
      eviaIpc.off('shortcut:previous-response', handleShortcutPreviousResponse);
      eviaIpc.off('shortcut:next-response', handleShortcutNextResponse);
      eviaIpc.off('debug-log');  // Clean up debug-log listener
      console.log('[AskView] 🧹 Cleaning up IPC listeners');
    };
  }, []);

  // UI IMPROVEMENT: Auto-focus input when window becomes visible
  // CRITICAL FIX: Window persists between opens (not unmounted), so useEffect with []
  // only runs once. Must listen to window focus AND visibility changes.
  useEffect(() => {
    // CRITICAL: Listen to visibility change (when window shows/hides)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[AskView] 👁️ Window became visible, waiting for animation...');
        
        // ASYNC FIX: Use transitionend event instead of setTimeout
        // Wait for actual window animation to complete, not arbitrary delay
        const waitForAnimation = () => {
          const askContainer = document.querySelector('.ask-view-container');
          if (askContainer) {
            // Listen for CSS transition end
            const handleTransitionEnd = (e: TransitionEvent) => {
              if (e.propertyName === 'height' || e.propertyName === 'transform') {
                console.log('[AskView] ⌨️ Animation complete, focusing input now');
                askContainer.removeEventListener('transitionend', handleTransitionEnd as EventListener);
        focusInputWithRetry();
              }
            };
            
            askContainer.addEventListener('transitionend', handleTransitionEnd as EventListener);
            
            // Fallback: If no transition detected in 200ms, focus anyway
            setTimeout(() => {
              askContainer.removeEventListener('transitionend', handleTransitionEnd as EventListener);
              focusInputWithRetry();
            }, 200);
          } else {
            // No container, focus immediately
            focusInputWithRetry();
          }
        };
        
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(waitForAnimation);
      }
    };
    
    // CRITICAL: Listen to window focus (when user clicks window or Cmd+Tab back)
    const handleWindowFocus = () => {
      console.log('[AskView] 🎯 Window gained focus, focusing input');
      focusInputWithRetry();
    };

    // Focus on mount (first open)
    console.log('[AskView] 🚀 Component mounted, initial focus');
    focusInputWithRetry();

    // Focus when window becomes visible (Cmd+Enter reopens)
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Focus when window gains focus (Cmd+Tab back to app)
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [focusInputWithRetry]);

  // FIX #7: Blink header frame red twice to indicate error
  const blinkHeaderRed = () => {
    // Send IPC message to main process to blink header
    try {
      const eviaIpc = (window as any).evia?.ipc;
      if (eviaIpc?.send) {
        eviaIpc.send('blink-header-error');
      }
    } catch (err) {
      console.warn('[AskView] Could not blink header:', err);
    }
  };
  
  // Taylos enhancement: Error toast with auto-dismiss
  // FIX #6: Map technical errors to user-friendly messages
  const showError = (message: string, canRetry: boolean = false) => {
    console.error('[AskView] 💥 Error:', message);
    
    // DIAGNOSTIC: Relay error to main process for terminal visibility
    try {
      const eviaIpc = (window as any).evia?.ipc;
      eviaIpc?.send?.('ask:error-diagnostic', { error: message, canRetry });
    } catch (e) {
      // Ignore IPC errors
    }
    
    // Map technical errors to user-friendly messages
    let friendlyMessage = message;
    let userCanRetry = canRetry;
    
    // Groq rate limit error
    if (message.includes('rate_limit') || message.includes('429') || message.includes('Rate limit')) {
      friendlyMessage = i18n.getLanguage() === 'en' 
        ? 'Service temporarily unavailable. Please try again in a moment.'
        : 'Service vorübergehend nicht verfügbar. Bitte versuchen Sie es in einem Moment erneut.';
      userCanRetry = true;
    }
    // Network errors
    else if (message.includes('Failed to fetch') || message.includes('Network')) {
      friendlyMessage = i18n.getLanguage() === 'en'
        ? 'Connection issue. Please check your network.'
        : 'Verbindungsproblem. Bitte überprüfen Sie Ihre Netzwerkverbindung.';
      userCanRetry = true;
    }
    // Backend not running
    else if (message.includes('ECONNREFUSED') || message.includes('connection refused')) {
      friendlyMessage = i18n.getLanguage() === 'en'
        ? 'Cannot reach the service. Please ensure the backend is running.'
        : 'Service nicht erreichbar. Bitte stellen Sie sicher, dass das Backend läuft.';
      userCanRetry = false;
    }
    // Auth errors
    else if (message.includes('Authentication') || message.includes('Token') || message.includes('401')) {
      friendlyMessage = i18n.getLanguage() === 'en'
        ? 'Please log in again.'
        : 'Bitte melden Sie sich erneut an.';
      userCanRetry = false;
    }
    
    setErrorToast({ message: friendlyMessage, canRetry: userCanRetry });
    
    // Visual error indicator - blink header frame red
    blinkHeaderRed();
    
    if (errorToastTimeout.current) {
      clearTimeout(errorToastTimeout.current);
    }
    
    errorToastTimeout.current = setTimeout(() => {
      setErrorToast(null);
    }, 5000);
  };

  const retryLastRequest = () => {
    if (lastPromptRef.current) {
      setPrompt(lastPromptRef.current);
      setErrorToast(null);
      if (restartStreamTimeoutRef.current) {
        clearTimeout(restartStreamTimeoutRef.current);
      }
      restartStreamTimeoutRef.current = setTimeout(() => {
        restartStreamTimeoutRef.current = null;
        // A retried insight click is still an insight click. Re-sending it as
        // 'user_typed' would flip the backend's reading of the same request.
        startStreamRef.current?.(false, undefined, lastQuerySourceRef.current);
      }, 100);
    }
  };

  const cancelActiveStream = useCallback((reason: string) => {
    if (deterministicDemoTimerRef.current) {
      clearTimeout(deterministicDemoTimerRef.current);
      deterministicDemoTimerRef.current = null;
    }
    if (restartStreamTimeoutRef.current) {
      clearTimeout(restartStreamTimeoutRef.current);
      restartStreamTimeoutRef.current = null;
    }
    if (streamRef.current?.abort) {
      console.log('[AskView] 🛑 Cancelling active stream:', reason);
      try {
        streamRef.current.abort();
      } catch {}
    }
    streamRef.current = null;
    setIsStreaming(false);
    setIsLoadingFirstToken(false);
    setHeaderText(i18n.t('overlay.ask.aiResponse'));
    ttftLoggedRef.current = false;
    streamStartTime.current = null;
  }, []);

  /**
   * Resolve before/during/after from the main process capture controller.
   *
   * Falls back to the cached localStorage value only when the IPC is
   * unavailable, and defaults to 'before' rather than 'during' so an unknown
   * state never claims a call is in progress.
   */
  const resolveAuthoritativeSessionState = async (): Promise<AskSessionState> => {
    try {
      const snapshot = await (window as any).evia?.captureSession?.get?.();
      const authoritative = snapshot?.legacyState;
      if (authoritative === 'before' || authoritative === 'during' || authoritative === 'after') {
        const cached = localStorage.getItem('evia_session_state');
        if (cached !== authoritative) {
          console.warn(
            '[AskView] ⚠️ Session state cache was stale:', cached, '→', authoritative,
            '(capture state:', snapshot?.state, ')'
          );
          localStorage.setItem('evia_session_state', authoritative);
        }
        return authoritative;
      }
    } catch (err) {
      console.warn('[AskView] ⚠️ Could not read capture session state, using cache:', err);
    }
    const stored = localStorage.getItem('evia_session_state');
    if (stored === 'before' || stored === 'during' || stored === 'after') return stored;
    return 'before';
  };

  const startStream = async (
    captureScreenshot: boolean = false,
    overridePrompt?: string,
    // Defaults to the box because that is the only origin that reaches
    // startStream without going through a caller that knows better: the form,
    // the Enter key, the submit button. Every other entry point states its own.
    querySource: AskQuerySource = 'user_typed',
  ) => {
    // FIX: Support override prompt for auto-submit from insights
    const actualPrompt = overridePrompt || prompt;
    if (!actualPrompt.trim() || streamRef.current || deterministicDemoTimerRef.current) return;

    // A preset was activated since the last interaction. Reset HERE, before the
    // request, so this question becomes the first turn of a session bound to
    // the new preset - and so that merely toggling a preset never destroyed
    // anything. The previous answers go on purpose: paging back to a reply that
    // was generated under a different preset is the confusion this prevents.
    if (consumePresetSessionReset()) {
      console.log('[AskView] 🔄 Preset changed since last interaction - starting a new session');
      clearSessionBinding();
      chatIdOverrideRef.current = null;
      liveTranscriptOverrideRef.current = null;
      responseBufferRef.current = '';
      lastResponseRef.current = '';
      setResponse('');
      setResponseHistory([]);
      setResponseIndex(-1);
      setCurrentQuestion('');
      setErrorToast(null);
    }

    const requestStartedAt = performance.now();
    const clientStartedAtMs = Date.now();
    const requestId = crypto.randomUUID();
    let firstVisibleTokenMs: number | undefined;
    let askFailureTracked = false;
    streamStartTime.current = requestStartedAt;

    // The cached state is good enough to paint with; only the request itself
    // needs the authoritative value. Awaiting before this point would put an
    // IPC round trip in front of the first pixel the user sees.
    const cachedSessionState = (localStorage.getItem('evia_session_state') as AskSessionState) || 'before';

    lastPromptRef.current = actualPrompt;
    lastQuerySourceRef.current = querySource;
    setCurrentQuestion(actualPrompt);
    setErrorToast(null);
    setShowTextInput(true);
    setResponse('');
    responseBufferRef.current = '';
    lastResponseRef.current = '';
    setResponseSessionState(cachedSessionState);
    setIsStreaming(true);
    setIsLoadingFirstToken(true);
    setHeaderText(i18n.t('overlay.ask.thinking'));
    setTtftMs(null);
    ttftLoggedRef.current = false;
    setPrompt('');

    // Render the complete thinking layout before auth, transcript hydration, or
    // any network request begins: question in the header, spinner centered,
    // and the input anchored below it. Without this immediate expansion the
    // user sees an inert compact bar during the slowest part of the request.
    const thinkingHeight = readThinkingHeight();
    storedContentHeightRef.current = thinkingHeight;
    requestWindowResize(thinkingHeight);

    // The main process owns capture truth; localStorage is only a cache of a
    // broadcast this window may never have received (it is written by whichever
    // view happened to be mounted). Resolving it here is what stops a finished
    // call from being answered as if it were still live.
    const currentSessionState = await resolveAuthoritativeSessionState();
    if (currentSessionState !== cachedSessionState) {
      setResponseSessionState(currentSessionState);
    }

    trackAskSubmitted({
      question_length: actualPrompt.length,
      session_state: currentSessionState,
      is_typed: querySource === 'user_typed',
      language,
      query_source: querySource,
      delivery: 'interactive',
    });

    const trackFailure = (
      stage: 'authentication' | 'chat_resolution' | 'stream' | 'backend',
      reason: 'authentication' | 'network' | 'rate_limit' | 'unavailable' | 'aborted' | 'unknown',
    ) => {
      if (askFailureTracked) return;
      askFailureTracked = true;
      trackAskFailed({
        session_state: currentSessionState,
        query_source: querySource,
        stage,
        reason,
        latency_ms: Math.max(0, performance.now() - requestStartedAt),
      });
    };

    const resetPendingRequest = () => {
      setIsStreaming(false);
      setIsLoadingFirstToken(false);
      setHeaderText(i18n.t('overlay.ask.aiResponse'));
      ttftLoggedRef.current = false;
      streamStartTime.current = null;
      storedContentHeightRef.current = MIN_ASK_BAR_HEIGHT;
      requestWindowResize(MIN_ASK_BAR_HEIGHT);
    };

    // Demo mode substitutes only explicitly scripted outcomes at the same
    // request boundary as production. Every unmatched prompt still uses the
    // normal backend, layout, input, actions, and session lifecycle.
    const deterministicDemoResponse = demoModeEnabledRef.current
      ? getDemoAskResponse(actualPrompt, currentSessionState)
      : null;

    if (deterministicDemoResponse) {
      if (currentSessionState !== sessionState) setSessionState(currentSessionState);
      onSubmitPrompt?.(actualPrompt);

      const nextHeight = thinkingHeight;
      const startedAt = performance.now();

      storedContentHeightRef.current = nextHeight;
      requestWindowResize(nextHeight);

      deterministicDemoTimerRef.current = setTimeout(() => {
        deterministicDemoTimerRef.current = null;
        const finalResponse = sanitizeAskOutput(
          deterministicDemoResponse.content,
          currentSessionState,
        ).trim();

        responseBufferRef.current = finalResponse;
        lastResponseRef.current = finalResponse;
        setResponse(finalResponse);
        setIsLoadingFirstToken(false);
        setIsStreaming(false);
        setHeaderText(i18n.t('overlay.ask.aiResponse'));
        setTtftMs(performance.now() - startedAt);
        const demoLatencyMs = Math.max(0, performance.now() - requestStartedAt);
        trackAskResponseReceived({
          response_length: finalResponse.length,
          latency_ms: demoLatencyMs,
          ttft_ms: demoLatencyMs,
          session_state: currentSessionState,
          query_source: querySource,
          delivery: 'interactive',
        });
        setResponseHistory((previous) => {
          const next = [...previous, { question: actualPrompt, response: finalResponse }];
          setResponseIndex(next.length - 1);
          return next;
        });

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const targetHeight = measureTargetWindowHeight();
            storedContentHeightRef.current = targetHeight;
            requestWindowResize(targetHeight);
            requestAnimationFrame(() => updateResponseOverflowState());
            setTimeout(() => focusInputWithRetry(), 300);
          });
        });
      }, deterministicDemoResponse.delayMs);
      return;
    }
    
    const baseUrl = BACKEND_URL;
    
    console.log('[AskView] Getting auth token from keytar...');
    const eviaAuth = (window as any).evia?.auth as { 
      getToken: () => Promise<string | null>,
      checkTokenValidity?: () => Promise<{ valid: boolean, reason: string, expiresIn?: number }>
    } | undefined;
    const token = await eviaAuth?.getToken();
    if (!token) {
      trackFailure('authentication', 'authentication');
      showError('Authentication required. Please login first.', false);
      resetPendingRequest();
      return;
    }
    
    // FIX: Check token validity before making request
    if (eviaAuth?.checkTokenValidity) {
      const validity = await (eviaAuth as any).checkTokenValidity();
      if (!validity.valid) {
        trackFailure('authentication', 'authentication');
        showError(`Token ${validity.reason === 'expired' ? 'expired' : 'invalid'}. Please re-login.`, false);
        resetPendingRequest();
        return;
      }
      if (validity.reason === 'expiring_soon') {
        console.warn('[AskView] ⚠️ Token expires in', validity.expiresIn, 'seconds');
      }
    }

    const explicitChatId = chatIdOverrideRef.current;
    chatIdOverrideRef.current = null;
    let chatId = Number(explicitChatId || '0');
    try {
      if (!chatId || Number.isNaN(chatId)) {
        const { getOrCreateChatId } = await import('../services/websocketService');
        chatId = Number(await getOrCreateChatId(baseUrl.replace(/\/$/, ''), token));
      }
      if (!chatId || Number.isNaN(chatId)) throw new Error('Invalid canonical chat id');
    } catch (e: any) {
      const isNetworkError = e.message?.includes('fetch') || e.message?.includes('network');
      trackFailure('chat_resolution', isNetworkError ? 'network' : 'unknown');
      showError(
        isNetworkError
          ? 'Network error. Check connection and reconnect?'
          : 'Failed to resolve chat session. Reconnect?',
        true
      );
      resetPendingRequest();
      return;
    }

    // GLASS PARITY: Fetch transcript context for backend
    let transcriptContext = '';
    try {
      const explicitTranscriptContext = liveTranscriptOverrideRef.current || '';
      const { getChatTranscripts } = await import('../services/websocketService');
      const liveSnapshot = explicitTranscriptContext
        ? null
        : await (window as any).evia?.liveTranscript?.get?.(chatId);
      const liveTranscriptContext = explicitTranscriptContext || liveSnapshot?.data?.transcriptContext || '';

      // During a call, the renderer snapshot is the freshest source and avoids
      // a blocking database round trip on the user-visible response path.
      if (currentSessionState === 'during' && liveTranscriptContext) {
        transcriptContext = liveTranscriptContext;
        const lineCount = transcriptContext.split('\n').filter(Boolean).length;
        console.log('[AskView] 📄 Using live transcript context:', transcriptContext.length, 'chars,', lineCount, 'entries');
      } else {
        const transcripts = await getChatTranscripts(chatId, token, 200);
        const deduped = deduplicateTranscriptEntries(transcripts as AskTranscriptEntry[]);
        const dbTranscriptContext = deduped.length > 0
          ? formatTranscriptContextForLLM(deduped)
          : '';

        transcriptContext = currentSessionState === 'after'
          ? (liveTranscriptContext || dbTranscriptContext)
          : (dbTranscriptContext || liveTranscriptContext);
        console.log(
          transcriptContext
            ? `[AskView] 📄 Using ${transcriptContext === liveTranscriptContext ? 'live' : 'DB'} transcript context: ${transcriptContext.length} chars`
            : '[AskView] ℹ️ No transcript history yet'
        );
      }
    } catch (e) {
      console.warn('[AskView] ⚠️ Could not fetch transcript (continuing without context):', e);
    } finally {
      liveTranscriptOverrideRef.current = null;
    }

    // Taylos enhancement: Screenshot capture
    let screenshotRef: string | undefined;
    if (captureScreenshot) {
      try {
        const result = await (window as any).evia?.capture?.takeScreenshot?.();
        
        if (result?.ok && result?.base64) {
          screenshotRef = result.base64;
          console.log('[AskView] 📸 Screenshot captured:', result.width, 'x', result.height);
        } else if (result?.needsPermission) {
          trackFailure('stream', 'unavailable');
          showError(result.error || 'Screen Recording permission required.', false);
          resetPendingRequest();
          return;
        }
      } catch (err: any) {
        console.error('[AskView] Screenshot capture error:', err);
      }
    }

    if (onSubmitPrompt) onSubmitPrompt(actualPrompt);

    // This request-side event contains only timing and context availability;
    // transcript content never enters analytics.
    trackAskRequestReady({
      session_state: currentSessionState,
      query_source: querySource,
      has_transcript_context: Boolean(transcriptContext),
      context_preparation_ms: Math.max(0, performance.now() - requestStartedAt),
    });

    const nextHeight = thinkingHeight;

    setResponse('');
    responseBufferRef.current = '';
    setResponseSessionState('before');
    lastResponseRef.current = '';  // UI IMPROVEMENT: Clear last response ref on new question
    storedContentHeightRef.current = nextHeight;
    requestWindowResize(nextHeight);
    console.log('[AskView] Context preparation:', (performance.now() - requestStartedAt).toFixed(0), 'ms');

    // CRITICAL FIX: Re-read session state from localStorage before streaming
    // EviaBar updates localStorage immediately when Listen starts, but the IPC event
    // might arrive too late (after user clicks shortcut button)
    if (currentSessionState !== sessionState) {
      console.log('[AskView] 🔄 Syncing session state from localStorage:', currentSessionState, '(was:', sessionState, ')');
      setSessionState(currentSessionState);
    }
    setResponseSessionState(currentSessionState);

    console.log('[AskView] 🚀 Starting stream with prompt:', actualPrompt.substring(0, 50));
    console.log('[AskView] 🎯 Session state:', currentSessionState);

    // GLASS PARITY: Pass transcript context to backend
    // Use currentSessionState (freshly read from localStorage) instead of stale sessionState
    const handle = streamAsk({ 
      baseUrl, 
      chatId, 
      prompt: actualPrompt, 
      transcript: transcriptContext || undefined,  // Pass transcript for context
      language, 
      sessionState: currentSessionState,  // CRITICAL: Use freshly synced session state
      token, 
      screenshotRef,
      requestId,
      clientStartedAtMs,
      querySource,
    });
    streamRef.current = handle;

    handle.onDelta((d) => {
      if (streamRef.current !== handle) return;
      // CRITICAL FIX #2: Detect backend error messages and show friendly error
      // Backend yields "Error generating suggestion: <error>" on failures
      if (d.includes('Error generating suggestion:')) {
        console.error('[AskView] ❌ Backend error detected in stream:', d);
        
        // Check if it's a rate limit error
        if (d.includes('rate_limit') || d.includes('429') || d.includes('Rate limit')) {
          trackFailure('backend', 'rate_limit');
          showError(language === 'en' 
            ? 'Service temporarily unavailable. Please try again in a moment.'
            : 'Service vorübergehend nicht verfügbar. Bitte versuchen Sie es in einem Moment erneut.', 
            true
          );
        } else if (d.includes('401') || d.includes('Unauthorized')) {
          trackFailure('backend', 'authentication');
          showError('Authentication expired. Please reconnect.', true);
        } else {
          trackFailure('backend', 'unavailable');
          // Generic error
          showError('Request failed. Please try again.', true);
        }
        
        // Abort the stream
        handle.abort();
        setIsStreaming(false);
        setIsLoadingFirstToken(false);
        if (streamRef.current === handle) {
          streamRef.current = null;
        }
        return; // Don't add error text to response
      }
      if (/\[(?:Fehler|Error):/i.test(d)) {
        console.warn('[AskView] ⚠️ Suppressed user-visible stream error fragment');
        return;
      }
      
      if (isLoadingFirstToken) {
        setIsLoadingFirstToken(false);
        setHeaderText(i18n.t('overlay.ask.aiResponse'));
      }
      
      if (!ttftLoggedRef.current && streamStartTime.current) {
        const ttft = performance.now() - streamStartTime.current;
        firstVisibleTokenMs = ttft;
        setTtftMs(ttft);
        ttftLoggedRef.current = true;
        console.log('[AskView] ⚡ Click-to-first-visible-token:', ttft.toFixed(0), 'ms');
      }
      responseBufferRef.current += d;
      setResponse(sanitizeAskOutput(responseBufferRef.current, currentSessionState));
    });

    handle.onReplace((text) => {
      if (streamRef.current !== handle) return;
      responseBufferRef.current = text;
      setResponse(sanitizeAskOutput(text, currentSessionState));
    });
    
    handle.onDone(() => {
      if (streamRef.current !== handle) return;
      setIsStreaming(false);
      setIsLoadingFirstToken(false);
      setHeaderText(i18n.t('overlay.ask.aiResponse')); // FIX: Ensure header updates when stream completes
      ttftLoggedRef.current = false;
      streamStartTime.current = null;
      streamRef.current = null;
      console.log('[AskView] ✅ Stream completed');

      const finalResponse = sanitizeAskOutput(responseBufferRef.current, currentSessionState).trim();
      if (finalResponse !== responseBufferRef.current) {
        responseBufferRef.current = finalResponse;
        setResponse(finalResponse);
      }
      if (finalResponse) {
        console.log('[AskView] 🧠 Final suggestion content:\n%s', finalResponse);
      }
      if (finalResponse) {
        trackAskResponseReceived({
          response_length: finalResponse.length,
          latency_ms: Math.max(0, performance.now() - requestStartedAt),
          ttft_ms: firstVisibleTokenMs,
          session_state: currentSessionState,
          query_source: querySource,
          delivery: 'interactive',
        });
        setResponseHistory((prev) => {
          // Pair the answer with this request's immutable prompt. Reading
          // currentQuestion here uses the render closure from before
          // setCurrentQuestion() and shifts every question one response ahead.
          const next = [...prev, { question: actualPrompt, response: finalResponse }];
          setResponseIndex(next.length - 1);
          return next;
        });
      } else {
        trackFailure('backend', 'unavailable');
      }
      
      // Final measurement from the actual visible DOM. The loading animation must not inflate the window.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const targetHeight = measureTargetWindowHeight();
          const current = window.innerHeight;
          const delta = Math.abs(targetHeight - current);
          
          if (delta > 3) {
            storedContentHeightRef.current = targetHeight;
            requestWindowResize(targetHeight);
            console.log('[AskView] 📏 FINAL: target=%dpx (was %dpx)', targetHeight, current);
          } else {
            storedContentHeightRef.current = targetHeight;
            console.log('[AskView] ✅ Size correct, no adjustment needed:', current, 'px');
          }

          requestAnimationFrame(() => updateResponseOverflowState());
          
          // UX IMPROVEMENT: Auto-focus input after response completes
          // Allows users to ask follow-up questions without clicking back into field
          console.log('[AskView] 🎯 Auto-focusing input after response completion');
          setTimeout(() => focusInputWithRetry(), 300); // Delay to ensure window resize completes first
        });
      });
    });
    
    handle.onError((e: any) => {
      if (streamRef.current !== handle) return;
      setIsStreaming(false);
      setIsLoadingFirstToken(false);
      streamRef.current = null;
      setHeaderText(i18n.t('overlay.ask.aiResponse'));
      ttftLoggedRef.current = false;
      streamStartTime.current = null;
      
      console.error('[AskView] ❌ Stream error:', e);
      
      const errorMsg = e?.message || String(e);
      const is401 = errorMsg.includes('401') || errorMsg.includes('Unauthorized');
      const isNetwork = errorMsg.includes('fetch') || errorMsg.includes('network');
      const isSuggestionUnavailable = errorMsg.includes('SUGGESTION_UNAVAILABLE');

      trackFailure(
        'stream',
        is401
          ? 'authentication'
          : isNetwork
            ? 'network'
            : isSuggestionUnavailable
              ? 'unavailable'
              : errorMsg.includes('aborted')
                ? 'aborted'
                : 'unknown',
      );
      
      if (isSuggestionUnavailable) {
        showError(
          language === 'de'
            ? 'Gerade ist kein verlässlicher Vorschlag verfügbar. Bitte erneut versuchen.'
            : 'No reliable suggestion is available right now. Please try again.',
          true,
        );
      } else if (is401) {
        showError('Authentication expired. Please reconnect.', true);
      } else if (isNetwork) {
        showError('Network connection lost. Reconnect?', true);
      } else if (!errorMsg.includes('aborted')) {
        showError(`Request failed. Reconnect?`, true);
      }
    });

  };

  useEffect(() => {
    startStreamRef.current = startStream;
    focusInputWithRetryRef.current = focusInputWithRetry;
    cancelActiveStreamRef.current = cancelActiveStream;
  }, [startStream, focusInputWithRetry, cancelActiveStream]);

  const onAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    startStream();
  };

  const onAbort = () => {
    cancelActiveStream('user abort');
  };

  // Glass parity: Copy entire response
  const handleCopy = async () => {
    if (copyState === 'copied' || !response) return;

    // FIX #10: Use i18n for clipboard labels (Frage/Question, Antwort/Answer)
    const questionLabel = i18n.t('overlay.ask.questionLabel');
    const answerLabel = i18n.t('overlay.ask.answerLabel');
    const textToCopy = `${questionLabel}: ${currentQuestion}\n\n${answerLabel}: ${response}`;

    try {
      await navigator.clipboard.writeText(textToCopy);
      console.log('[AskView] Content copied to clipboard');

      setCopyState('copied');

      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }

      copyTimeoutRef.current = setTimeout(() => {
        setCopyState('idle');
      }, 1500);
    } catch (err) {
      console.error('[AskView] Failed to copy:', err);
    }
  };

  // Glass parity: Close window if no content (ESC key)
  const handleCloseIfNoContent = () => {
    if (!response && !isStreaming && !isLoadingFirstToken) {
      (window as any).evia?.closeWindow?.('ask');
    }
  };

  // Glass parity: ESC key handler
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseIfNoContent();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [response, isStreaming, isLoadingFirstToken]);

  // Keep local Cmd/Ctrl+Enter aligned with shortcut submit behavior
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        startStream();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, isStreaming, language, measureTargetWindowHeight]);

  // REMOVED: Old two-step IPC pattern useEffect (was lines 350-389)
  // Now using ONLY single-step 'ask:send-and-submit' (lines 85-106) for Glass parity

  // FIX (2025-12-10): Resize to fit content - measure components
  const triggerManualResize = useCallback(() => {
    if (isLoadingFirstToken) {
      const preservedHeight = Math.max(MIN_ASK_BAR_HEIGHT, storedContentHeightRef.current || MIN_ASK_BAR_HEIGHT);
      requestWindowResize(preservedHeight);
      return;
    }

    // Empty state: compact ask bar
    if (!response || response.trim() === '') {
      storedContentHeightRef.current = MIN_ASK_BAR_HEIGHT;
      requestWindowResize(MIN_ASK_BAR_HEIGHT);
      console.log('[AskView] 📏 Manual resize: compact ask bar (%dpx)', MIN_ASK_BAR_HEIGHT);
      return;
    }
    
    const targetHeight = measureTargetWindowHeight();
    const current = window.innerHeight;
    const delta = Math.abs(targetHeight - current);
    
    if (delta > 3) {
      storedContentHeightRef.current = targetHeight;
      requestWindowResize(targetHeight);
      console.log('[AskView] 📏 Manual: target=%dpx', targetHeight);
    } else {
      storedContentHeightRef.current = targetHeight;
    }
    requestAnimationFrame(() => updateResponseOverflowState());
  }, [response, isLoadingFirstToken, measureTargetWindowHeight, requestWindowResize, updateResponseOverflowState]);

  // Trigger on empty response (collapse to compact bar)
  useEffect(() => {
    if ((!response || response.trim() === '') && !isLoadingFirstToken) {
      triggerManualResize();
    }
    // ResizeObserver handles non-empty states automatically
  }, [response, isLoadingFirstToken, triggerManualResize]);

  // Calibrate the thinking height against the real spinner layout. measureResponseContentHeight()
  // deliberately reports 0 while loading, so the spinner is measured directly here. The result is
  // cached, which makes every later open land on exactly this height with no resize at all.
  useEffect(() => {
    if (!isLoadingFirstToken) return;
    if (responseBufferRef.current.trim()) return;

    const rafId = requestAnimationFrame(() => requestAnimationFrame(() => {
      const container = responseContainerRef.current;
      const headerEl = document.querySelector('.response-header:not(.hidden)') as HTMLElement | null;
      const inputEl = document.querySelector('.text-input-container:not(.hidden)') as HTMLElement | null;
      const loadingEl = container?.querySelector('.loading-dots') as HTMLElement | null;
      if (!container || !headerEl || !inputEl || !loadingEl) return;

      const style = window.getComputedStyle(container);
      const padding = (parseFloat(style.paddingTop || '0') || 0) + (parseFloat(style.paddingBottom || '0') || 0);
      const measured = Math.ceil(
        headerEl.offsetHeight + loadingEl.offsetHeight + padding + inputEl.offsetHeight + 2,
      );
      if (!isSaneThinkingHeight(measured)) return;

      try {
        localStorage.setItem(THINKING_HEIGHT_KEY, String(measured));
      } catch {
        /* non-fatal: we still resize this session */
      }

      if (Math.abs(measured - window.innerHeight) > 2) {
        storedContentHeightRef.current = measured;
        requestWindowResize(measured);
        console.log('[AskView] 📏 Thinking height calibrated: %dpx', measured);
      }
    }));

    return () => cancelAnimationFrame(rafId);
  }, [isLoadingFirstToken, requestWindowResize]);

  // After streaming completes, shrink or grow Ask exactly to the settled content.
  useEffect(() => {
    if (isStreaming) return;
    const rafId = requestAnimationFrame(() => triggerManualResize());
    return () => cancelAnimationFrame(rafId);
  }, [response, isStreaming, triggerManualResize]);

  // Give a single resize nudge when the Ask window becomes visible again.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[AskView] 📏 Window became visible, triggering manual resize');
        requestAnimationFrame(() => {
          triggerManualResize();
          updateResponseOverflowState();
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [triggerManualResize]);

  // Glass parity: Render markdown with syntax highlighting
  const renderMarkdown = (text: string): string => {
    if (!text) return '';

    try {
      const html = marked.parse(sanitizeAskOutput(text, responseSessionState)) as string;
      const sanitized = DOMPurify.sanitize(html, {
        ALLOWED_TAGS:
          responseSessionState === 'during'
            ? ['p', 'br', 'strong', 'b', 'em', 'i', 'hr']
            : ['p', 'br', 'strong', 'b', 'em', 'i', 'hr', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        ALLOWED_ATTR: [],
      });
      
      return sanitized;
    } catch (error) {
      console.error('[AskView] Markdown parsing error:', error);
      return text;
    }
  };
  
  // Apply syntax highlighting to code blocks after render
  useEffect(() => {
    if (response && responseContainerRef.current) {
      const codeBlocks = responseContainerRef.current.querySelectorAll('pre code');
      codeBlocks.forEach((block) => {
        if (!(block as HTMLElement).hasAttribute('data-highlighted')) {
          hljs.highlightElement(block as HTMLElement);
          (block as HTMLElement).setAttribute('data-highlighted', 'true');
        }
      });
    }
  }, [response]);

  // Glass parity: Truncate question for header
  const getTruncatedQuestion = (question: string, maxLength: number = 30): string => {
    if (!question) return '';
    if (question.length <= maxLength) return question;
    return question.substring(0, maxLength) + '...';
  };

  const hasExpandedHeight = (storedContentHeightRef.current || MIN_ASK_BAR_HEIGHT) > MIN_ASK_BAR_HEIGHT;
  const hasResponse = Boolean(response) || isLoadingFirstToken || (isStreaming && hasExpandedHeight);

  return (
    <div className="ask-container">
      {/* Taylos enhancement: Error Toast - Compact Version */}
      {errorToast && (
        <div className="error-toast">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{errorToast.message}</span>
          {errorToast.canRetry && (
            <button onClick={retryLastRequest} className="retry-button">
              Retry
            </button>
          )}
          <button onClick={() => setErrorToast(null)} className="close-toast-button">
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1L9 9M9 1L1 9" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Glass parity: Response Header */}
      <div className={`response-header ${!hasResponse ? 'hidden' : ''}`}>
        <div className="header-left">
          <div className="response-icon">
            {/* The Taylos mark, extracted from the app icon: squircle and glass rim cropped
                away, background keyed transparent. The bead around it (CSS) reproduces the
                icon's own background colour plus the liquid-glass frame. */}
            <img src={taylosMarkUrl} alt="" aria-hidden="true" />
          </div>
          <span className="response-label">{headerText}</span>
        </div>
        <div className="header-right">
          <span className="question-text">{getTruncatedQuestion(currentQuestion)}</span>
          <div className="header-controls">
            <button 
              className={`copy-button ${copyState === 'copied' ? 'copied' : ''}`} 
              onClick={handleCopy}
              disabled={!response}
            >
              <svg className="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </button>
            <button className="close-button" onClick={() => (window as any).evia?.closeWindow?.('ask')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Glass parity: Response Container with markdown */}
      <div 
        className={`response-container ${!hasResponse ? 'hidden' : ''} ${responseNeedsScroll ? 'scrollable' : 'centered'}`}
        ref={responseContainerRef}
        id="responseContainer"
      >
        {isLoadingFirstToken ? (
          <div className="loading-dots">
            <div className="loading-dot"></div>
            <div className="loading-dot"></div>
            <div className="loading-dot"></div>
          </div>
        ) : response ? (
          <>
            <div 
              className="markdown-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(response) }}
            />
            {isStreaming && (
              <button onClick={onAbort} className="abort-button">
                Abort
              </button>
            )}
          </>
        ) : (
          <div className="empty-state">...</div>
        )}
      </div>

      {/* Glass parity: Text Input Container */}
      <div className={`text-input-container ${!hasResponse ? 'no-response' : ''} ${!showTextInput ? 'hidden' : ''}`}>
        <input
          ref={inputRef}
          type="text"
          id="textInput"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.nativeEvent as any).isComposing) return;
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              startStream();
            }
          }}
          placeholder={i18n.t('overlay.ask.placeholder')}
          disabled={isStreaming}
        />
        <button
          className="submit-btn"
          onClick={() => startStream()}
          disabled={isStreaming || !prompt.trim()}
        >
          <span className="btn-label">{i18n.t('overlay.ask.submit')}</span>
          <span className="btn-icon">
            {/* Framework 7 Return Icon */}
            <svg width="14" height="14" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 14H20C21.1046 14 22 13.1046 22 12V8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10 9L5 14L10 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </button>
      </div>
    </div>
  );
};

export default AskView;
