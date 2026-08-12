import React, { useEffect, useMemo, useRef, useState } from 'react';
import './overlay-glass.css';
import { getWebSocketInstance } from '../services/websocketService';
import { fetchInsights, Insight, InsightActionItem } from '../services/insightsService';
import { i18n } from '../i18n/i18n';
import { showToast, ToastContainer } from '../components/ToastNotification';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { buildDemoInsights, DEMO_LIVE_THINKING_MS, DEMO_POST_THINKING_MS } from '../demo-scenario';

declare global {
  interface Window {
    api: {
      listenView: {
        adjustWindowHeight: (view: string, height: number) => void;
      };
      // Add other methods as needed
    };
  }
}

import {
  groupIntoBlocks,
  type OrderedTranscriptLine,
} from '../../main/transcript-order';
import {
  applyRealtimeTranscriptEvent,
  createRealtimeTranscriptState,
  currentDownstreamIdentity,
  isDownstreamResultApplicable,
  normalizeRealtimeTranscriptEvent,
  projectRealtimeTranscriptState,
  type NormalizedRealtimeTranscriptEvent,
  type RealtimeTranscriptState,
} from '../../main/realtime-transcript-state';

type TranscriptLine = OrderedTranscriptLine;

type TranscriptAdapterResult =
  | { event: NormalizedRealtimeTranscriptEvent; reason: null }
  | { event: null; reason: string };

const nonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Adapt the backend wire contract without inventing identity or timing.
 * Clockless legacy events are deliberately rejected: arrival time cannot
 * reconstruct order across the independent mic and system streams.
 */
const adaptServerTranscriptEvent = (message: unknown, chatId: string | null): TranscriptAdapterResult => {
  if (!message || typeof message !== 'object') return { event: null, reason: 'invalid-message' };
  const envelope = message as Record<string, unknown>;
  if (envelope.type !== 'transcript_segment') return { event: null, reason: 'not-transcript' };
  if (!envelope.data || typeof envelope.data !== 'object') return { event: null, reason: 'missing-data' };
  if (!chatId) return { event: null, reason: 'missing-chat-id' };

  const data = envelope.data as Record<string, unknown>;
  const source = data.source;
  const forwardedSource = envelope._source;
  if (source !== 'mic' && source !== 'system') return { event: null, reason: 'invalid-source' };
  if (forwardedSource !== undefined && forwardedSource !== source) {
    return { event: null, reason: 'source-mismatch' };
  }
  if (data.clock_domain_valid !== true) return { event: null, reason: 'invalid-clock-domain' };

  const sessionId = typeof data.capture_session_id === 'string' ? data.capture_session_id.trim() : '';
  const utteranceId = data.utterance_id === undefined || data.utterance_id === null
    ? ''
    : String(data.utterance_id).trim();
  const eventId = typeof data.event_id === 'string' ? data.event_id.trim() : '';
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!sessionId || !utteranceId || !eventId || !text) {
    return { event: null, reason: 'missing-canonical-identity-or-text' };
  }
  if (
    !nonNegativeInteger(data.capture_generation) ||
    !nonNegativeInteger(data.stream_generation) ||
    !nonNegativeInteger(data.seq) ||
    !finiteNumber(data.capture_start_ms) ||
    !finiteNumber(data.capture_end_ms)
  ) {
    return { event: null, reason: 'invalid-canonical-metadata' };
  }
  if (!Array.isArray(data.words)) return { event: null, reason: 'missing-timed-words' };

  const words = [] as Array<{ text: string; startMs: number; endMs: number }>;
  for (const candidate of data.words) {
    if (!candidate || typeof candidate !== 'object') return { event: null, reason: 'invalid-word' };
    const word = candidate as Record<string, unknown>;
    const wordText = typeof word.text === 'string' ? word.text.trim() : '';
    if (
      !wordText ||
      !finiteNumber(word.capture_start_ms) ||
      !finiteNumber(word.capture_end_ms)
    ) {
      return { event: null, reason: 'unmapped-word-clock' };
    }
    words.push({
      text: wordText,
      startMs: word.capture_start_ms,
      endMs: word.capture_end_ms,
    });
  }

  const event = normalizeRealtimeTranscriptEvent({
    chatId,
    sessionId,
    source,
    captureGeneration: data.capture_generation,
    streamGeneration: data.stream_generation,
    utteranceId,
    eventId,
    seq: data.seq,
    captureStartMs: data.capture_start_ms,
    captureEndMs: data.capture_end_ms,
    words,
    clockDomainValid: true,
    text,
    isFinal: data.is_final === true,
  });
  return event ? { event, reason: null } : { event: null, reason: 'invalid-normalized-event' };
};

interface ListenViewProps {
  lines: TranscriptLine[];
  followLive: boolean;
  onToggleFollow: () => void;
  onClose?: () => void;
}

const ListenView: React.FC<ListenViewProps> = ({ lines, followLive, onToggleFollow, onClose }) => {
  const [canonicalTranscriptState, setCanonicalTranscriptState] = useState<RealtimeTranscriptState>(
    createRealtimeTranscriptState,
  );
  const canonicalTranscriptStateRef = useRef<RealtimeTranscriptState>(canonicalTranscriptState);
  const canonicalProjection = useMemo(
    () => projectRealtimeTranscriptState(canonicalTranscriptState),
    [canonicalTranscriptState],
  );
  const transcripts = useMemo<TranscriptLine[]>(
    () => canonicalProjection.visibleRows.map(row => ({
      speaker: row.source === 'mic' ? 1 : 0,
      text: row.text,
      isFinal: row.isFinal,
      isPartial: !row.isFinal,
      timestamp: row.captureStartMs,
      updatedAt: row.captureEndMs,
      audioStartMs: row.captureStartMs,
      audioEndMs: row.captureEndMs,
      utteranceId: row.key,
    })),
    [canonicalProjection],
  );
  const visibleTranscripts = transcripts;
  const [localFollowLive, setLocalFollowLive] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  // Insights is ALWAYS the default view: the user must get suggestions immediately on Listen.
  // Transcript stays one click away via the header toggle.
  const [viewMode, setViewMode] = useState<'transcript' | 'insights'>('insights');
  const [isHovering, setIsHovering] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [copiedView, setCopiedView] = useState<'transcript' | 'insights' | null>(null); // Track which view was copied
  const [elapsedTime, setElapsedTime] = useState('00:00');
  const [isSessionActive, setIsSessionActive] = useState(false);

  const [sessionState, setSessionState] = useState<'before' | 'during' | 'after'>(() => {
    const stored = localStorage.getItem('evia_session_state');
    if (stored === 'before' || stored === 'during' || stored === 'after') {
      console.log('[ListenView] 🎯 Initial session state from localStorage:', stored);
      return stored;
    }
    return 'before';
  });
  // Glass parity: Insights fetched from backend via fetchInsights service
  const [insights, setInsights] = useState<Insight | null>(null);
  const [insightsHistory, setInsightsHistory] = useState<Insight[]>([]);
  const [insightsIndex, setInsightsIndex] = useState(-1);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [insightsRefreshPending, setInsightsRefreshPending] = useState(false);
  const [presetContextWarning, setPresetContextWarning] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true); // Glass parity: auto-scroll when at bottom
  
  const autoScrollRef = useRef(true); // FIX: Use ref to avoid re-render dependency issues
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const copyTimeout = useRef<NodeJS.Timeout | null>(null);
  const demoModeEnabledRef = useRef(false);
  const demoInsightTimerRef = useRef<NodeJS.Timeout | null>(null);
  const liveInsightsRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const insightsRequestInFlightRef = useRef(false);
  const liveInsightsRefreshQueuedRef = useRef(false);
  const shouldScrollAfterUpdate = useRef(false); // GLASS PARITY: Track if near bottom before update
  // Diagnostics: track message counts and last received time
  const messageCountRef = useRef(0);
  const lastMessageAtRef = useRef<number | null>(null);
  const [showUndoButton, setShowUndoButton] = useState(false); 
  // UI diagnostics state to show counts and last message age
  const [diagMessageCount, setDiagMessageCount] = useState(0);
  const [diagLastMessageAgeMs, setDiagLastMessageAgeMs] = useState<number | null>(null);
  const insightsHistoryRef = useRef<Insight[]>([]);
  const insightsIndexRef = useRef(-1);
  const fetchInsightsNowRef = useRef<(options?: { fullReplace?: boolean }) => Promise<void>>(async () => {});
  const afterInsightsFrozenRef = useRef(false);
  const afterInsightsRequestPendingRef = useRef(false);
  const viewModeRef = useRef<'transcript' | 'insights'>(viewMode);
  const transcriptsRef = useRef<TranscriptLine[]>([]);
  const sessionStateRef = useRef<'before' | 'during' | 'after'>(sessionState);
  const isSessionActiveRef = useRef(false);
  const lastInsightsProspectRevisionRef = useRef(0);
  const lastInsightsFetchAtRef = useRef(0);
  const normalizeTranscriptText = (value: string) =>
    value.trim().replace(/\s+/g, ' ').toLowerCase();

  const isStubInsightPayload = (payload: Insight | null | undefined) => {
    if (!payload) return true;
    if ((payload as any).stub === true) return true;
    const normalizedSummary = ((payload.prospect_info && payload.prospect_info.length > 0 ? payload.prospect_info : payload.summary) || [])
      .map(line => normalizeTranscriptText(line || ''))
      .filter(Boolean);
    const knownStubSets = [
      [
        'kein transkript erkannt',
        'sprich, um insights zu generieren',
        'taylos hört zu',
      ],
      [
        'no transcript detected',
        'speak to generate insights',
        'taylos is listening',
      ],
      [
        'meeting beendet',
        'ergebnisse dokumentieren',
        'follow-up plan ausführen',
      ],
      [
        'meeting ended',
        'document key outcomes',
        'execute follow-up plan',
      ],
    ];
    return knownStubSets.some(stubSet => stubSet.every(line => normalizedSummary.includes(line)));
  };

  const getProspectInfo = (payload: Insight | null | undefined): string[] => {
    if (!payload) return [];
    if (Array.isArray(payload.prospect_info) && payload.prospect_info.length > 0) return payload.prospect_info;
    return Array.isArray(payload.summary) ? payload.summary : [];
  };

  const getSalesAnalysis = (payload: Insight | null | undefined): string[] => {
    if (!payload) return [];
    if (Array.isArray(payload.sales_analysis) && payload.sales_analysis.length > 0) return payload.sales_analysis;
    if (Array.isArray(payload.topic?.bullets) && payload.topic.bullets.length > 0) return payload.topic.bullets;
    return [];
  };

  const hasGroundedProspectSpeech = (entries: TranscriptLine[]) =>
    entries.some(entry =>
      entry.speaker === 0 &&
      !entry.isPartial &&
      Boolean(normalizeTranscriptText(entry.text || ''))
    );

  const getCanonicalAfterActions = (language: string): Record<string, InsightActionItem> =>
    language === 'en'
      ? {
          follow_up_email: { label: '📧 Follow-up Email', icon: 'mail', prompt: 'Follow-up Email' },
          follow_up_plan: { label: '📞 Plan follow-up', icon: 'phone', prompt: 'Plan follow-up' },
          action_items: { label: '📋 Action Items', icon: 'check', prompt: 'Action Items' },
          crm_update: { label: '📊 Update CRM', icon: 'chart', prompt: 'Update CRM' },
          summary: { label: '📝 Summary', icon: 'note', prompt: 'Summary' },
        }
      : {
          follow_up_email: { label: '📧 Follow-up E-Mail', icon: 'mail', prompt: 'Follow-up E-Mail' },
          follow_up_plan: { label: '📞 Follow-up planen', icon: 'phone', prompt: 'Follow-up planen' },
          action_items: { label: '📋 Action Items', icon: 'check', prompt: 'Action Items' },
          crm_update: { label: '📊 CRM aktualisieren', icon: 'chart', prompt: 'CRM aktualisieren' },
          summary: { label: '📝 Zusammenfassung', icon: 'note', prompt: 'Zusammenfassung' },
        };

  const classifyAfterAction = (label: string): string | null => {
    const lowered = (label || '').trim().toLowerCase();
    if (!lowered) return null;
    if (lowered.includes('recap') || (lowered.includes('follow') && lowered.includes('mail')) || (lowered.includes('follow') && lowered.includes('email'))) return 'follow_up_email';
    if (lowered.includes('crm')) return 'crm_update';
    if (lowered.includes('action item')) return 'action_items';
    if (lowered.includes('zusammenfassung') || lowered.includes('summary')) return 'summary';
    if (lowered.includes('follow-up') || lowered.includes('follow up') || lowered.includes('termin') || lowered.includes('plan')) return 'follow_up_plan';
    return null;
  };

  const getInsightActions = (payload: Insight | null | undefined): InsightActionItem[] => {
    if (!payload) return [];
    const primary = Array.isArray(payload.action_items) && payload.action_items.length > 0
      ? payload.action_items.filter(item => item && typeof item.label === 'string' && item.label.trim())
      : (payload.actions || [])
          .filter(action => typeof action === 'string' && action.trim())
          .map(action => ({ label: action.trim() }));

    if (payload.session_state === 'after') {
      const canonical = getCanonicalAfterActions(i18n.getLanguage());
      const merged = new Map<string, InsightActionItem>();
      const followUps = Array.isArray(payload.followUpActions)
        ? payload.followUpActions.filter(item => item && typeof item.label === 'string' && item.label.trim())
        : [];

      [...primary, ...followUps].forEach((item) => {
        const key = classifyAfterAction(item.label);
        if (key && !merged.has(key)) merged.set(key, canonical[key]);
      });

      return ['follow_up_email', 'follow_up_plan', 'action_items', 'crm_update', 'summary']
        .map(key => merged.get(key) || canonical[key]);
    }

    return primary;
  };

  useEffect(() => {
    insightsHistoryRef.current = insightsHistory;
  }, [insightsHistory]);

  useEffect(() => {
    insightsIndexRef.current = insightsIndex;
  }, [insightsIndex]);

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    const speaker0Count = transcripts.filter(t => t.speaker === 0).length;
    const speaker1Count = transcripts.filter(t => t.speaker === 1).length;
    console.log(`[Transcript] Total: ${transcripts.length}, Speaker0: ${speaker0Count}, Speaker1: ${speaker1Count}`);
  }, [transcripts]);

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    isSessionActiveRef.current = isSessionActive;
  }, [isSessionActive]);

  useEffect(() => {
    let cancelled = false;

    void window.evia?.demo?.isEnabled?.()
      .then((result) => {
        if (!cancelled) demoModeEnabledRef.current = result?.enabled === true;
      })
      .catch((error: unknown) => {
        console.warn('[ListenView] Could not read demo mode state:', error);
      });

    return () => {
      cancelled = true;
      if (demoInsightTimerRef.current) {
        clearTimeout(demoInsightTimerRef.current);
        demoInsightTimerRef.current = null;
      }
      if (liveInsightsRefreshTimerRef.current) {
        clearTimeout(liveInsightsRefreshTimerRef.current);
        liveInsightsRefreshTimerRef.current = null;
      }
    };
  }, []);

  // Render markdown inline (for bold, italics, etc. in Insights)
  const renderMarkdownInline = (text: string): string => {
    if (!text) return '';
    
    try {
      // Parse markdown to HTML
      const html = marked.parseInline(text) as string;
      // Sanitize to prevent XSS
      const sanitized = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['strong', 'b', 'em', 'i', 'code', 'a', 'br'],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
      });
      return sanitized;
    } catch (error) {
      console.error('[ListenView] Markdown parsing error:', error);
      return text; // Fallback to raw text
    }
  };

  // Keep autoScrollRef in sync with state without causing re-renders
  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  useEffect(() => {
    const chatId = Number(localStorage.getItem('current_chat_id') || '0');
    const liveTranscriptApi = (window as any).evia?.liveTranscript;
    if (!liveTranscriptApi) return;
    if (!chatId || Number.isNaN(chatId)) {
      liveTranscriptApi.clear?.();
      return;
    }
    liveTranscriptApi.set?.({
      chatId,
      sessionState,
      transcriptContext: canonicalProjection.context,
      updatedAt: Date.now(),
    });
  }, [canonicalProjection.context, sessionState]);

  const schedulePostMeetingInsightsFetch = () => {
    if (afterInsightsFrozenRef.current || afterInsightsRequestPendingRef.current) {
      console.log('[ListenView] ⏭️ Post-meeting insights already frozen or pending - skipping duplicate fetch');
      return;
    }
    afterInsightsRequestPendingRef.current = true;
    console.log('[ListenView] ⏳ Scheduling first post-call insights fetch in 300ms...');
    setTimeout(() => {
      console.log('[ListenView] 🚀 Fetching first post-call insights snapshot');
      fetchInsightsNowRef.current({ fullReplace: true });
    }, 300);
  };

  const adjustWindowHeight = () => {
    if (!window.api || !viewportRef.current) return;

    const topBar = document.querySelector('.top-bar') as HTMLElement;
    const activeContent = viewportRef.current as HTMLElement;
    if (!topBar || !activeContent) return;

    const topBarHeight = topBar.offsetHeight;
    const contentHeight = activeContent.scrollHeight;
    const idealHeight = topBarHeight + contentHeight;
    const targetHeight = Math.min(700, idealHeight);

    window.api.listenView.adjustWindowHeight('listen', targetHeight);
  };

  const startTimer = () => {
    const startTime = Date.now();
    timerInterval.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const seconds = (elapsed % 60).toString().padStart(2, '0');
      setElapsedTime(`${minutes}:${seconds}`);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
  };

  // FIX 2026-01-22: Improved auto-scroll with scroll-to-bottom button
  const SCROLL_THRESHOLD = 50; // pixels from bottom to consider "at bottom"
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Check if viewport is at bottom
  const isAtBottom = () => {
    const viewport = viewportRef.current;
    if (!viewport) return true;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    return scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD;
  };

  // Scroll to bottom function
  const scrollToBottom = (smooth: boolean = true) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  };

  // Handle scroll events
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      // Clear any pending timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      // Check if at bottom and update auto-scroll state
      const atBottom = isAtBottom();
      setAutoScroll(atBottom);
      autoScrollRef.current = atBottom;
      
      // Reset scroll flag after scroll stops (150ms debounce)
      scrollTimeoutRef.current = setTimeout(() => {
        shouldScrollAfterUpdate.current = atBottom;
      }, 150);
    };

    viewport.addEventListener('scroll', handleScroll);
    return () => {
      viewport.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // GLASS PARITY: Scroll AFTER React renders (lines 178-185 in SttView.js)
  // Glass uses setTimeout(fn, 0) to ensure DOM is fully updated before scrolling
  useEffect(() => {
    if (viewMode !== 'transcript') return;
    if ((!autoScrollRef.current && !shouldScrollAfterUpdate.current) || !viewportRef.current) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!viewportRef.current) return;
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        // Fallback pass for browsers that report stale scrollHeight in the same frame.
        setTimeout(() => {
          if (viewportRef.current) {
            viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
          }
        }, 0);
      });
    });
    shouldScrollAfterUpdate.current = false;
  }, [transcripts, viewMode]); // Run after transcripts update

  useEffect(() => {
    adjustWindowHeight();
    return () => {
      if (copyTimeout.current) {
        clearTimeout(copyTimeout.current);
      }
    };
  }, []);

  // FIX: Cleanup timer on unmount
  useEffect(() => {
    return () => {
      console.log('[ListenView] 🛑 Stopping timer on unmount');
      stopTimer();
      setIsSessionActive(false);
    };
  }, []); // Empty dependency - cleanup on unmount

  const resetCanonicalTranscript = (reason: string) => {
    const freshState = createRealtimeTranscriptState();
    canonicalTranscriptStateRef.current = freshState;
    setCanonicalTranscriptState(freshState);
    lastInsightsProspectRevisionRef.current = 0;
    lastInsightsFetchAtRef.current = 0;
    afterInsightsFrozenRef.current = false;
    afterInsightsRequestPendingRef.current = false;
    liveInsightsRefreshQueuedRef.current = false;
    console.log('[ListenView][Canonical] Reset transcript state:', reason);
  };

  // Header owns capture; this view owns one canonical transcript state. Every
  // visible row and every model-context line is projected from that same state.
  useEffect(() => {
    console.log('[ListenView] Setting up canonical transcript IPC listeners');
    const eviaIpc = (window as any).evia?.ipc;
    if (!eviaIpc?.on) {
      console.error('[ListenView] IPC bridge unavailable; realtime transcript cannot start');
      return;
    }

    const resetSessionPresentation = (reason: string) => {
      (window as any).evia?.liveTranscript?.clear?.();
      resetCanonicalTranscript(reason);
      setInsights(null);
      setInsightsHistory([]);
      setInsightsIndex(-1);
      setInsightsRefreshPending(false);
      setViewMode('insights');
      setElapsedTime('00:00');
      setCopyState('idle');
      setCopiedView(null);
      setShowUndoButton(false);
      setIsLoadingInsights(false);
      setPresetContextWarning(false);
      setAutoScroll(true);
      autoScrollRef.current = true;
      shouldScrollAfterUpdate.current = true;
      lastInsightsFetchAtRef.current = 0;
    };

    const handleTranscriptMessage = (msg: any) => {
      if (!msg || typeof msg !== 'object') {
        console.warn('[ListenView][Canonical] Rejected non-object transcript message');
        return;
      }

      messageCountRef.current += 1;
      lastMessageAtRef.current = Date.now();
      setDiagMessageCount(messageCountRef.current);
      setDiagLastMessageAgeMs(0);

      if (msg.type === 'recording_started') {
        console.log('[ListenView] Recording started; canonical session is now live');
        resetSessionPresentation('recording-started');
        messageCountRef.current = 0;
        lastMessageAtRef.current = null;
        sessionStateRef.current = 'during';
        isSessionActiveRef.current = true;
        setSessionState('during');
        setIsSessionActive(true);
        localStorage.setItem('evia_session_state', 'during');
        startTimer();
        requestAnimationFrame(() => {
          if (viewportRef.current) viewportRef.current.scrollTop = 0;
        });
        return;
      }

      if (msg.type === 'recording_stopped') {
        console.log('[ListenView] Recording stopped; preserving canonical rows unchanged');
        stopTimer();
        sessionStateRef.current = 'after';
        isSessionActiveRef.current = false;
        setSessionState('after');
        setIsSessionActive(false);
        localStorage.setItem('evia_session_state', 'after');
        setInsights(null);
        setInsightsHistory([]);
        setInsightsIndex(-1);
        setInsightsRefreshPending(false);
        setViewMode('insights');
        schedulePostMeetingInsightsFetch();
        return;
      }

      if (msg.type === 'context_status') {
        const contextAvailable = msg.data?.available !== false;
        setPresetContextWarning(!contextAvailable);
        if (!contextAvailable) {
          console.warn('[ListenView] Bound preset context unavailable; preset-dependent AI is paused');
        }
        return;
      }

      if (msg.type !== 'transcript_segment') {
        if (msg.type !== 'status' && msg.type !== 'keepalive') {
          console.debug('[ListenView][Canonical] Ignoring non-transcript message:', msg.type);
        }
        return;
      }

      const storedChatId = localStorage.getItem('current_chat_id');
      const adapted = adaptServerTranscriptEvent(msg, storedChatId);
      if (!adapted.event) {
        console.error('[ListenView][Canonical] Rejected transcript event:', {
          reason: adapted.reason,
          source: msg._source ?? msg.data?.source,
          eventId: msg.data?.event_id,
          utteranceId: msg.data?.utterance_id,
          captureSessionId: msg.data?.capture_session_id,
        });
        return;
      }

      const transition = applyRealtimeTranscriptEvent(
        canonicalTranscriptStateRef.current,
        adapted.event,
      );
      if (!transition.accepted) {
        const log = transition.reason === 'stale-seq' || transition.reason === 'finalized-row'
          ? console.debug
          : console.error;
        log('[ListenView][Canonical] Event not accepted:', {
          reason: transition.reason,
          source: adapted.event.source,
          eventId: adapted.event.eventId,
          tuple: [
            adapted.event.captureGeneration,
            adapted.event.streamGeneration,
            adapted.event.utteranceId,
          ],
          seq: adapted.event.seq,
        });
        return;
      }

      canonicalTranscriptStateRef.current = transition.state;
      setCanonicalTranscriptState(transition.state);
      shouldScrollAfterUpdate.current = true;
      const projection = projectRealtimeTranscriptState(transition.state);
      console.log('[ListenView][Canonical] Accepted event:', {
        eventId: adapted.event.eventId,
        source: adapted.event.source,
        isFinal: adapted.event.isFinal,
        seq: adapted.event.seq,
        captureStartMs: adapted.event.captureStartMs,
        captureEndMs: adapted.event.captureEndMs,
        prospectRevision: transition.state.prospectRevision,
        sellerRevision: transition.state.sellerRevision,
        visibleRows: projection.visibleRows.length,
        contextHash: projection.contextHash,
      });
    };

    const onTranscript = (payload: any) => handleTranscriptMessage(payload);

    const onClearSession = () => {
      console.log('[ListenView] Received clear-session');
      resetSessionPresentation('clear-session');
      sessionStateRef.current = 'before';
      isSessionActiveRef.current = false;
      setSessionState('before');
      setIsSessionActive(false);
      localStorage.setItem('evia_session_state', 'before');
      stopTimer();
    };

    const onLanguageChanged = () => {
      console.log('[ListenView] Language changed; clearing session-derived state');
      resetSessionPresentation('language-changed');
    };

    const onSessionStateChanged = (newState: 'before' | 'during' | 'after') => {
      const previousState = sessionStateRef.current;
      console.log('[ListenView] Session state changed:', newState, '(previous:', previousState, ')');
      sessionStateRef.current = newState;
      localStorage.setItem('evia_session_state', newState);
      setSessionState(newState);

      if (newState === 'during') {
        isSessionActiveRef.current = true;
        setIsSessionActive(true);
        if (previousState === 'before') {
          resetSessionPresentation('session-state-before-to-during');
        }
        return;
      }

      isSessionActiveRef.current = false;
      setIsSessionActive(false);
      if (newState === 'after') {
        setViewMode('insights');
        schedulePostMeetingInsightsFetch();
      } else if (newState === 'before') {
        resetSessionPresentation('session-state-before');
        stopTimer();
      }
    };

    eviaIpc.on('transcript-message', onTranscript);
    eviaIpc.on('clear-session', onClearSession);
    eviaIpc.on('language-changed', onLanguageChanged);
    eviaIpc.on('session-state-changed', onSessionStateChanged);
    console.log('[ListenView] Canonical IPC listeners registered');

    return () => {
      const bridge = (window as any).evia?.ipc;
      if (!bridge) return;
      const remove = typeof bridge.off === 'function'
        ? bridge.off.bind(bridge)
        : typeof bridge.removeListener === 'function'
          ? bridge.removeListener.bind(bridge)
          : null;
      if (!remove) {
        console.warn('[ListenView] IPC bridge cannot remove named listeners');
        return;
      }
      remove('transcript-message', onTranscript);
      remove('clear-session', onClearSession);
      remove('language-changed', onLanguageChanged);
      remove('session-state-changed', onSessionStateChanged);
      console.log('[ListenView] Canonical IPC listeners removed');
    };
  }, []);
  const latestHistoricalInsight =
    insightsHistory.length > 0
      ? insightsHistory[insightsIndex >= 0 ? insightsIndex : insightsHistory.length - 1]
      : null;
  const displayedInsights = insights || latestHistoricalInsight;

  // Handle insight clicks - send to AskView via IPC
  // When user clicks an insight (summary point, topic bullet, or action), we:
  // 1. Log the click for debugging
  // 2. Determine current session state (after recording stops, isSessionActive = false)
  // 3. Send to AskView via IPC with 'ask:send-and-submit' channel INCLUDING session state
  // 4. AskView receives it, populates input, updates session state, and auto-submits
  const handleInsightClick = (insightText: string, promptOverride?: string) => {
    const outboundPrompt = (promptOverride || insightText || '').trim();
    console.log('[ListenView] 📨 Insight clicked:', outboundPrompt.substring(0, 50));
    
    // Use session_state FROM THE INSIGHTS OBJECT, not localStorage!
    // Insights are generated WITH a specific session_state and MUST use that state when clicked
    // Otherwise: Insights generated "during" call are clicked "after" call → wrong prompt!
    const insightSessionState = displayedInsights?.session_state || 'during';
    const localStorageState = localStorage.getItem('evia_session_state') as 'before' | 'during' | 'after' || 'during';
    
    console.log('[ListenView] 🎯 Insight click session state:');
    console.log('[ListenView]   - Insight metadata session_state:', insightSessionState, '(USING THIS ONE!)');
    console.log('[ListenView]   - localStorage current state:', localStorageState, '(ignoring - might be stale)');
    console.log('[ListenView]   - Component isSessionActive:', isSessionActive);
    
    // If states don't match, log WARNING (insights are stale!)
    if (insightSessionState !== localStorageState) {
      console.warn('[ListenView] ⚠️ STALE INSIGHTS DETECTED!');
      console.warn('[ListenView]   - Insights were generated for:', insightSessionState);
      console.warn('[ListenView]   - Current session state is:', localStorageState);
      console.warn('[ListenView]   - User should refresh insights by toggling view!');
    }
    
    // Send to AskView via IPC for auto-submit WITH insight's original session state
    const eviaIpc = (window as any).evia?.ipc;
    if (eviaIpc?.send) {
      // Send as object with text and sessionState (using insight's metadata)
      eviaIpc.send('ask:send-and-submit', { 
        text: outboundPrompt,
        sessionState: insightSessionState,
      });
      console.log('[ListenView] ✅ Sent insight to AskView via IPC with session_state:', insightSessionState);
    } else {
      console.error('[ListenView] ❌ IPC bridge not available for ask:send-and-submit');
    }
  };

  // Extract insights fetching to reusable function
  const fetchInsightsNow = async (options: { fullReplace?: boolean } = {}) => {
    const latestSessionState = localStorage.getItem('evia_session_state') as 'before' | 'during' | 'after' || 'during';
    if (insightsRequestInFlightRef.current) {
      if (latestSessionState === 'during' && hasGroundedProspectSpeech(transcriptsRef.current)) {
        liveInsightsRefreshQueuedRef.current = true;
      }
      return;
    }
    insightsRequestInFlightRef.current = true;
    const currentTranscripts = transcriptsRef.current;
    const currentSessionState = sessionStateRef.current;
    const currentIsSessionActive = isSessionActiveRef.current;
    const requestIdentity = currentDownstreamIdentity(canonicalTranscriptStateRef.current);

    // DIAGNOSTIC: Log start of fetch
    console.log('[ListenView] 🔍 DIAGNOSTIC: Starting fetchInsightsNow');
    console.log('[ListenView] 🔍 Transcript count (local UI):', currentTranscripts.length);
    console.log('[ListenView] 🔍 Canonical revisions:', {
      prospect: canonicalTranscriptStateRef.current.prospectRevision,
      seller: canonicalTranscriptStateRef.current.sellerRevision,
      contextHash: requestIdentity.contextHash,
    });
    console.log('[ListenView] 🔍 Session state:', currentSessionState);
    console.log('[ListenView] 🔍 Is session active:', currentIsSessionActive);

    const fullReplace = options.fullReplace === true || latestSessionState === 'after';
    // Live refreshes are atomic: keep the last stable frame visible until a
    // complete replacement arrives. Only an empty post-call load blocks.
    const showBlockingLoader = latestSessionState === 'after' && insightsHistoryRef.current.length === 0;

    if (demoModeEnabledRef.current && (latestSessionState === 'during' || latestSessionState === 'after')) {
      if (showBlockingLoader) setIsLoadingInsights(true);
      setInsightsRefreshPending(false);
      await new Promise((resolve) => setTimeout(
        resolve,
        latestSessionState === 'after' ? DEMO_POST_THINKING_MS : DEMO_LIVE_THINKING_MS,
      ));

      const deterministicInsights = buildDemoInsights(latestSessionState, currentTranscripts);
      setInsights(deterministicInsights);
      if (fullReplace) {
        setInsightsHistory([deterministicInsights]);
        setInsightsIndex(0);
      } else {
        setInsightsHistory((previous) => {
          const next = [...previous, deterministicInsights];
          setInsightsIndex(next.length - 1);
          return next;
        });
      }
      lastInsightsProspectRevisionRef.current = requestIdentity.prospectRevision;
      lastInsightsFetchAtRef.current = Date.now();
      if (latestSessionState === 'after') {
        afterInsightsFrozenRef.current = true;
        afterInsightsRequestPendingRef.current = false;
      }
      insightsRequestInFlightRef.current = false;
      if (showBlockingLoader) setIsLoadingInsights(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (viewportRef.current) viewportRef.current.scrollTop = 0;
        });
      });
      return;
    }

    // Nothing was captured, so there is nothing an insight could be grounded
    // in. The backend can only answer with its safe stub, and the retry ladder
    // below then spends three round trips rediscovering that - 11.4s measured
    // on a session that recorded no speech at all. An empty call is a normal
    // outcome, not a slow one, so answer it locally and immediately.
    //
    // Deliberately does not set afterInsightsFrozenRef: freezing here would
    // block a real fetch if rows arrive late. Only the pending flag is cleared,
    // exactly as the finally block below would have done.
    if (currentTranscripts.length === 0) {
      console.log('[ListenView] ⏭️ No transcripts captured - skipping insights fetch');
      setInsightsRefreshPending(false);
      if (latestSessionState === 'after' && !afterInsightsFrozenRef.current) {
        afterInsightsRequestPendingRef.current = false;
      }
      insightsRequestInFlightRef.current = false;
      setIsLoadingInsights(false);
      return;
    }

    // Keep current insights visible while refreshing. Only replace on successful fetch.

    // SMART RETRY STRATEGY: Poll with exponential backoff instead of hardcoded delay
    // - Attempt 1: Immediate (0ms) - Fast path if transcripts already saved
    // - Attempt 2: After 300ms - Quick retry for fast saves
    // - Attempt 3: After 700ms (total 1000ms) - Final retry for slow saves
    // This is FASTER than hardcoded 1s delay when transcripts save quickly!
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [0, 300, 700]; // Exponential: 0ms, 300ms, 700ms
    
    if (showBlockingLoader) setIsLoadingInsights(true);
    setInsightsRefreshPending(false);
    const ttftStart = Date.now();
    
    // Get auth credentials once
    const chatId = Number(localStorage.getItem('current_chat_id') || '0');
    const eviaAuth = (window as any).evia?.auth as { getToken: () => Promise<string | null> } | undefined;
    let token: string | null | undefined;
    try {
      token = await eviaAuth?.getToken();
    } catch (error) {
      console.error('[ListenView] ❌ Failed to read auth token for insights:', error);
      insightsRequestInFlightRef.current = false;
      setIsLoadingInsights(false);
      return;
    }

    console.log('[ListenView] 🔍 Chat ID:', chatId);
    console.log('[ListenView] 🔍 Token available:', !!token);

    if (!chatId || !token) {
      console.error('[ListenView] ❌ Missing chat_id or auth token for insights fetch');
      insightsRequestInFlightRef.current = false;
      setIsLoadingInsights(false);
      return;
    }

    // ALWAYS use latest session state from localStorage (truth source)
    // Don't derive from isSessionActive - it can be stale!
    // EviaBar updates localStorage IMMEDIATELY when Stopp is pressed → listenStatus = 'after'
    const localStorageState = latestSessionState; // For logging purposes
    const derivedSessionState = latestSessionState;
    const currentLang = i18n.getLanguage();
    const liveProspectSpeechAvailable = hasGroundedProspectSpeech(currentTranscripts);
    
    console.log('[ListenView] 🎯 Session state for insights: localStorage =', latestSessionState, ', component state =', currentSessionState, ', isSessionActive =', currentIsSessionActive);
    
    console.log('[ListenView] 🚀 Starting smart retry strategy (max 3 attempts)');
    
    // Try immediately, then retry with delays if no transcripts
    let fetchedInsights: any = null;
    let attempt = 0;
    
    try {
      for (attempt = 0; attempt < MAX_RETRIES; attempt++) {
        // Wait before retry (0ms for first attempt, then 300ms, 700ms)
        if (RETRY_DELAYS[attempt] > 0) {
          console.log(`[ListenView] ⏳ Retry #${attempt + 1}: Waiting ${RETRY_DELAYS[attempt]}ms for transcripts to save...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
        } else {
          console.log(`[ListenView] 🚀 Attempt #${attempt + 1}: Trying immediately (fast path)...`);
        }
        
        // Attempt to fetch insights
        console.log('[ListenView] 📊 Fetching insights:', {
          chatId,
          language: currentLang,
          sessionState: derivedSessionState,
          attempt: attempt + 1
        });
        
        fetchedInsights = await fetchInsights({
          chatId,
          token,
          language: currentLang,
          sessionState: derivedSessionState
        });
        
        const receivedStub = isStubInsightPayload(fetchedInsights);

        if (!receivedStub) {
          const ttftMs = Date.now() - ttftStart;
          console.log(`[ListenView] ✅ Success on attempt #${attempt + 1}! Got grounded insights in ${ttftMs}ms`);
          break; // Success - exit retry loop
        } else if (derivedSessionState !== 'after' && !liveProspectSpeechAvailable) {
          console.log('[ListenView] 🛡️ Safe live stub: waiting for final prospect speech before generating insights');
          break;
        } else {
          console.log(`[ListenView] ⚠️ Attempt #${attempt + 1}: Stub received despite available insight context`);
          if (attempt < MAX_RETRIES - 1) {
            console.log(`[ListenView] 🔄 Will retry in ${RETRY_DELAYS[attempt + 1]}ms...`);
            fetchedInsights = null;
          } else {
            console.log('[ListenView] ⏭️ Max retries reached; preserving the safe backend stub');
          }
        }
      }
      
      const ttftMs = Date.now() - ttftStart;
      console.log('[ListenView] 🔍 DIAGNOSTIC: Insights fetch complete');
      console.log('[ListenView] 🔍 Total time (including retries):', ttftMs, 'ms');
      console.log('[ListenView] 🔍 Attempts used:', attempt + 1);
      
      if (fetchedInsights) {
        if (!isDownstreamResultApplicable(canonicalTranscriptStateRef.current, requestIdentity)) {
          console.warn('[ListenView] Discarding obsolete insights result:', {
            requested: requestIdentity,
            current: currentDownstreamIdentity(canonicalTranscriptStateRef.current),
          });
          if (sessionStateRef.current === 'during') liveInsightsRefreshQueuedRef.current = true;
          return;
        }
        console.log('[ListenView] ✅ Glass insights received!');
        if (isStubInsightPayload(fetchedInsights)) {
          if (insightsHistoryRef.current.length > 0) {
            console.log('[ListenView] 🚫 Stub-like insights detected, keeping previous insights state');
            setInsightsRefreshPending(false);
            return;
          }
          console.log('[ListenView] 🛡️ Stub-like insights detected before any valid insight; showing the safe waiting state');
          setInsightsRefreshPending(false);
          return;
        }
        setInsightsRefreshPending(false);
        
        // Log session_state metadata from insights
        console.log('[ListenView] 🎯 INSIGHT METADATA:');
        console.log('[ListenView]   - session_state from backend:', fetchedInsights.session_state);
        console.log('[ListenView]   - This state will be used when insights are clicked!');
        console.log('[ListenView]   - Current localStorage state:', localStorageState);
        
        console.log('[ListenView] 🔍 Insights structure:', {
          prospectInfoCount: getProspectInfo(fetchedInsights).length,
          salesAnalysisCount: getSalesAnalysis(fetchedInsights).length,
          hasActions: !!fetchedInsights.actions,
          actionsCount: getInsightActions(fetchedInsights).length,
          followUpActionsCount: 0,
          sessionState: fetchedInsights.session_state,
          ttftMs
        });
        console.log('[ListenView] 🔍 Prospect info:', getProspectInfo(fetchedInsights));
        console.log('[ListenView] 🔍 Sales analysis:', getSalesAnalysis(fetchedInsights));
        console.log('[ListenView] 🔍 Actions:', getInsightActions(fetchedInsights).map(action => action.label));
        if (fullReplace) {
          setInsights(fetchedInsights);
          setInsightsHistory([fetchedInsights]);
          setInsightsIndex(0);
        } else {
          setInsights(fetchedInsights);
          setInsightsHistory((prev) => {
            const next = [...prev, fetchedInsights];
            setInsightsIndex(next.length - 1);
            return next;
          });
        }
        lastInsightsProspectRevisionRef.current = requestIdentity.prospectRevision;
        lastInsightsFetchAtRef.current = Date.now();
        if (derivedSessionState === 'after') {
          afterInsightsFrozenRef.current = true;
        }
      } else {
        console.warn('[ListenView] ⚠️ No insights returned from backend');
        console.warn('[ListenView] ⚠️ This could mean:');
        console.warn('[ListenView] ⚠️   - No transcripts in database for this chat');
        console.warn('[ListenView] ⚠️   - Backend error during generation');
        console.warn('[ListenView] ⚠️   - API key issue (check backend logs)');
      }
    } catch (error) {
      console.error('[ListenView] ❌ Failed to fetch insights:', error);
      
      // Show user-friendly error message instead of infinite loading
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ListenView] 🔍 Error details:', errorMessage);
      setInsightsRefreshPending(false);
    } finally {
      if (derivedSessionState === 'after' && !afterInsightsFrozenRef.current) {
        afterInsightsRequestPendingRef.current = false;
      }
      insightsRequestInFlightRef.current = false;
      setIsLoadingInsights(false);
      if (liveInsightsRefreshQueuedRef.current) {
        liveInsightsRefreshQueuedRef.current = false;
        setTimeout(() => {
          if (
            sessionStateRef.current === 'during' &&
            viewModeRef.current === 'insights' &&
            hasGroundedProspectSpeech(transcriptsRef.current) &&
            canonicalTranscriptStateRef.current.prospectRevision > lastInsightsProspectRevisionRef.current
          ) {
            void fetchInsightsNowRef.current();
          }
        }, 0);
      }
    }
  };

  useEffect(() => {
    fetchInsightsNowRef.current = fetchInsightsNow;
  }, [fetchInsightsNow]);

  useEffect(() => {
    if (!demoModeEnabledRef.current || sessionState !== 'during' || viewMode !== 'insights') return;

    if (demoInsightTimerRef.current) clearTimeout(demoInsightTimerRef.current);
    demoInsightTimerRef.current = setTimeout(() => {
      demoInsightTimerRef.current = null;
      const deterministicInsights = buildDemoInsights('during', transcriptsRef.current);
      setInsights(deterministicInsights);
      setInsightsRefreshPending(false);
      setInsightsHistory((previous) => {
        if (previous.length === 0) {
          setInsightsIndex(0);
          return [deterministicInsights];
        }
        const next = [...previous];
        next[next.length - 1] = deterministicInsights;
        setInsightsIndex(next.length - 1);
        return next;
      });
    }, DEMO_LIVE_THINKING_MS);

    return () => {
      if (demoInsightTimerRef.current) {
        clearTimeout(demoInsightTimerRef.current);
        demoInsightTimerRef.current = null;
      }
    };
  }, [transcripts, sessionState, viewMode]);

  useEffect(() => {
    if (demoModeEnabledRef.current || sessionState !== 'during' || viewMode !== 'insights') return;
    if (!hasGroundedProspectSpeech(transcripts)) return;
    if (canonicalTranscriptState.prospectRevision <= lastInsightsProspectRevisionRef.current) return;

    if (liveInsightsRefreshTimerRef.current) clearTimeout(liveInsightsRefreshTimerRef.current);
    liveInsightsRefreshTimerRef.current = setTimeout(() => {
      liveInsightsRefreshTimerRef.current = null;
      console.log('[ListenView] 🔄 Grounded prospect speech arrived - refreshing visible insights');
      void fetchInsightsNowRef.current();
    }, 450);

    return () => {
      if (liveInsightsRefreshTimerRef.current) {
        clearTimeout(liveInsightsRefreshTimerRef.current);
        liveInsightsRefreshTimerRef.current = null;
      }
    };
  }, [canonicalTranscriptState.prospectRevision, transcripts, sessionState, viewMode]);


  useEffect(() => {
    const eviaIpc = (window as any).evia?.ipc;
    if (!eviaIpc?.on) return;

    const onShortcutNextStep = () => {
      const wasTranscript = viewModeRef.current === 'transcript';
      setViewMode('insights');
      if (wasTranscript && sessionStateRef.current === 'during') {
        fetchInsightsNowRef.current();
      }
    };

    const onShortcutPreviousResponse = () => {
      const history = insightsHistoryRef.current;
      if (!history.length) return;

      const current = insightsIndexRef.current >= 0 ? insightsIndexRef.current : history.length - 1;
      const nextIdx = Math.max(0, current - 1);
      if (nextIdx === current) return;

      setInsightsIndex(nextIdx);
      setInsights(history[nextIdx]);
      setViewMode('insights');
    };

    const onShortcutNextResponse = () => {
      const history = insightsHistoryRef.current;
      if (!history.length) return;

      const current = insightsIndexRef.current >= 0 ? insightsIndexRef.current : history.length - 1;
      const nextIdx = Math.min(history.length - 1, current + 1);
      if (nextIdx === current) return;

      setInsightsIndex(nextIdx);
      setInsights(history[nextIdx]);
      setViewMode('insights');
    };

    eviaIpc.on('shortcut:next-step', onShortcutNextStep);
    eviaIpc.on('shortcut:previous-response', onShortcutPreviousResponse);
    eviaIpc.on('shortcut:next-response', onShortcutNextResponse);

    return () => {
      if (typeof eviaIpc.off === 'function') {
        eviaIpc.off('shortcut:next-step', onShortcutNextStep);
        eviaIpc.off('shortcut:previous-response', onShortcutPreviousResponse);
        eviaIpc.off('shortcut:next-response', onShortcutNextResponse);
      } else if (typeof eviaIpc.removeListener === 'function') {
        eviaIpc.removeListener('shortcut:next-step', onShortcutNextStep);
        eviaIpc.removeListener('shortcut:previous-response', onShortcutPreviousResponse);
        eviaIpc.removeListener('shortcut:next-response', onShortcutNextResponse);
      }
    };
  }, []);

  const toggleView = async () => {
    const newMode = viewMode === 'transcript' ? 'insights' : 'transcript';
    console.log(`[ListenView] 🔄 Toggling view: ${viewMode} → ${newMode}`);
    setViewMode(newMode);
    
    // FIX 2026-01-22: Always enable auto-scroll when switching to transcript view
    if (newMode === 'transcript') {
      setAutoScroll(true);
      autoScrollRef.current = true;
      shouldScrollAfterUpdate.current = true;
      // Scroll to bottom after DOM update
      setTimeout(() => {
        scrollToBottom(false);
      }, 50);
    }

    // Hide undo button when manually toggling (user has control)
    if (showUndoButton) {
      setShowUndoButton(false);
    }

    // Glass parity: Reset copy state when switching views (only show "Copied X" for the view that was actually copied)
    if (copyState === 'copied' && copiedView !== newMode) {
      setCopyState('idle');
    }

    if (newMode === 'insights') {
      if (sessionStateRef.current === 'during') {
        console.log('[ListenView] Switched to insights view during meeting - fetching a fresh manual snapshot');
        await fetchInsightsNow();
      } else {
        console.log('[ListenView] Switched to insights view after meeting - keeping frozen snapshot');
      }
    } else {
      console.log(`[ListenView] Switched to transcript view, no fetch needed`);
    }
  };

  const handleCopyHover = (hovering: boolean) => {
    setIsHovering(hovering);
  };

  const handleCopy = async () => {
    if (copyState === 'copied') return;

    // WINDOWS FIX (2025-12-05): Merge consecutive same-speaker messages into paragraphs
    // Previously each line had its own speaker label, now only add label when speaker changes
    const currentLang = i18n.getLanguage();
    const meLabel = currentLang === 'de' ? 'Ich' : 'Me';
    const themLabel = currentLang === 'de' ? 'Gegenüber' : 'Them';

    let textToCopy = viewMode === 'transcript' 
      ? (() => {
          // Group consecutive same-speaker messages
          const groups: { speaker: number | null; texts: string[] }[] = [];
          let currentGroup: { speaker: number | null; texts: string[] } | null = null;
          
          for (const line of visibleTranscripts) {
            if (!currentGroup || currentGroup.speaker !== line.speaker) {
              // New speaker - start new group
              if (currentGroup) groups.push(currentGroup);
              currentGroup = { speaker: line.speaker, texts: [line.text] };
            } else {
              // Same speaker - append to current group
              currentGroup.texts.push(line.text);
            }
          }
          if (currentGroup) groups.push(currentGroup);
          
          // Format: Speaker label once per group, texts as paragraphs
          // FIX 2026-01-22: Remove blank line after speaker label
          return groups.map(group => {
            const speakerLabel = group.speaker === 1 ? meLabel : themLabel;
            const joinedText = group.texts.join(' ');  // Join with space (same utterance)
            return `${speakerLabel}:\n${joinedText}`;  // No blank line after label
          }).join('\n\n');  // Blank lines between speakers
        })()
	        : displayedInsights
	        ? (() => {
	            const currentLang = i18n.getLanguage();
	            const prospectHeader = currentLang === 'de' ? 'Prospect' : 'Prospect';
	            const salesHeader = currentLang === 'de' ? 'Sales Analyse' : 'Sales Analysis';
	            const actionsHeader = currentLang === 'de' ? 'Aktionen' : 'Actions';
	            const prospectInfo = getProspectInfo(displayedInsights);
	            const salesAnalysis = getSalesAnalysis(displayedInsights);
	            const actionLabels = getInsightActions(displayedInsights).map(action => action.label);

	            return `${prospectHeader}:\n${prospectInfo.join('\n')}\n\n${salesHeader}:\n${salesAnalysis.join('\n')}\n\n${actionsHeader}:\n${actionLabels.join('\n')}`;
	          })()
	        : '';

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopyState('copied');
      setCopiedView(viewMode); // Track which view was copied
      if (copyTimeout.current) {
        clearTimeout(copyTimeout.current);
      }
      copyTimeout.current = setTimeout(() => {
        setCopyState('idle');
        setCopiedView(null); // Reset after timeout
      }, 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Insights ARE clickable - clicking sends to AskView for elaboration
  // handleInsightClick is implemented above (line 427) and used in all insight items

  // Glass parity: Only show "Copied X" if current view matches what was copied
  const displayText = (copyState === 'copied' && copiedView === viewMode)
    ? viewMode === 'transcript'
      ? i18n.t('overlay.listen.copiedTranscript')
      : i18n.t('overlay.listen.copiedInsights')
      : isHovering
    ? viewMode === 'transcript'
      ? i18n.t('overlay.listen.copyTranscript')
      : i18n.t('overlay.listen.copyInsights')
    : viewMode === 'insights'
    ? i18n.t('overlay.listen.showInsights')
    : `${i18n.t('overlay.listen.listening')} ${elapsedTime}`;

  return (
    <div className="assistant-container" style={{ width: '400px', transform: 'translate3d(0, 0, 0)', backfaceVisibility: 'hidden', transition: 'transform 0.2s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.2s ease-out', willChange: 'transform, opacity' }}>
      {/* Glass parity: NO close button in ListenView (ListenView.js:636-686) */}
      <div className="top-bar">
          <div className="bar-left-text">
            <span className={`bar-left-text-content ${isHovering ? 'slide-in' : ''}`}>
              {displayText}
            </span>
            {/* Diagnostics badge (dev-only)
            <div style={{ display: 'inline-block', marginLeft: 8 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginRight: 6 }}>msgs: {diagMessageCount}</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{diagLastMessageAgeMs !== null ? `${Math.round(diagLastMessageAgeMs)}ms` : '—'}</span>
            </div> */}
          </div>
          <div className="bar-controls">
            {/* DEBUG: WAV recorder button */}
            {/* TASK 1: Undo button (shown for 10s after auto-switch) */}
            {showUndoButton && viewMode === 'insights' && (
              <button
                className="toggle-button" 
                onClick={() => {
                  setViewMode('transcript');
                  setShowUndoButton(false);
                }}
                style={{ 
                  background: 'rgba(255, 193, 7, 0.15)',
                  borderLeft: '2px solid rgba(255, 193, 7, 0.5)'
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 7v6h6" />
                  <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
                </svg>
                <span>Undo</span>
              </button>
            )}
            <button className="toggle-button" onClick={toggleView}>
              {viewMode === 'insights' ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>{i18n.t('overlay.listen.showTranscript')}</span>
                </>
              ) : (
                <>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M22 12v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                  </svg>
                  <span>{i18n.t('overlay.listen.showInsights')}</span>
                </>
              )}
            </button>
            <button
              className={`copy-button ${copyState === 'copied' ? 'copied' : ''}`}
              onClick={handleCopy}
              onMouseEnter={() => handleCopyHover(true)}
              onMouseLeave={() => handleCopyHover(false)}
            >
              <svg className="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              <svg className="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </button>
          </div>
        </div>
        <div className="glass-scroll" ref={viewportRef}>
          {presetContextWarning && (
            <div className="listen-context-warning" role="status">
              {i18n.t('overlay.listen.presetContextUnavailable')}
            </div>
          )}
          {viewMode === 'transcript' ? (
            visibleTranscripts.length > 0 ? (
              // Turns, in the order the words were spoken - not one bubble per
              // provider utterance, and not the order the two capture sockets
              // happened to deliver them. A block is sealed at three sentences
              // and never changes again, so nothing above the cursor reflows
              // while it is being read.
              groupIntoBlocks(visibleTranscripts).map((block) => {
                // GLASS PARITY: speaker 0 = system/them (grey, left), speaker 1 = mic/me (blue, right)
                // null defaults to system (grey, left) for safety
                const isMe = block.speaker === 1;
                const isThem = block.speaker === 0 || block.speaker === null; // Default to "them" if unknown

                return (
                  <div key={block.key}>
                    <div
                      className={`bubble ${isMe ? 'me' : 'them'} ${block.isPartial ? 'partial' : 'final'}`}
                      style={{
                        // GLASS PARITY: Highlight partial vs final directly in opacity
                        opacity: block.isPartial ? 0.78 : 1,
                        // GLASS PARITY: Blue for me, grey for them (exact colors from Glass SttView.js)
                        background: isMe
                          ? 'rgba(0, 122, 255, 0.75)'  // Slightly more transparent mic blue
                          : 'rgba(255, 255, 255, 0.1)', // Glass .them color
                        color: isMe ? '#ffffff' : 'rgba(255, 255, 255, 0.9)',
                        // REMOVED inline alignment - let CSS handle it for proper specificity
                        // GLASS PARITY: Border radius (asymmetric per Glass)
                        borderRadius: '12px',
                        borderBottomLeftRadius: isThem ? '4px' : '12px',
                        borderBottomRightRadius: isMe ? '4px' : '12px',
                        padding: '8px 12px',
                        marginBottom: '8px',
                        // Cap the measure as well as the fraction: past roughly
                        // 70 characters the eye starts losing the line return,
                        // which is the dominant cost when scanning rather than
                        // reading. On a narrow overlay the 80% still wins.
                        maxWidth: 'min(80%, 68ch)',
                        // GLASS PARITY: iMessage-style width shrinks to content, not full-width
                        width: 'fit-content',
                        wordWrap: 'break-word',
                        fontSize: '13px',
                        lineHeight: '1.5',
                      }}
                    >
                      {/* GLASS PARITY: No speaker labels, only CSS-based styling via background color */}
                      <span className="bubble-text">{block.text}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="insights-placeholder" style={{ padding: '8px 16px', textAlign: 'center', fontStyle: 'italic', background: 'transparent', color: 'rgba(255, 255, 255, 0.7)' }}>
                {i18n.t('overlay.listen.waitingForSpeech')}
              </div>
            )
          ) : displayedInsights ? (
              <div style={{ padding: '0px 12px 4px 12px' }}>
	              <div style={{ marginBottom: '4px' }}>
	                <h3 style={{ fontSize: '13px', fontWeight: '600', marginTop: '0px', marginBottom: '0px', color: 'rgba(255, 255, 255, 0.9)' }}>
	                  {i18n.getLanguage() === 'en' ? 'Prospect' : 'Prospect'}
	                </h3>
                {getProspectInfo(displayedInsights).map((point, idx) => (
                  <p
                    key={`prospect-${idx}`}
                    onClick={() => handleInsightClick(point)}
                    style={{
                      fontSize: '12px',
                      lineHeight: '1.3',
                      marginBottom: '0px',
                      marginTop: '0px',
                      color: 'rgba(255, 255, 255, 0.85)',
                      paddingLeft: '12px',
                      position: 'relative',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      padding: '4px 12px',
                      marginLeft: '0',
                      transition: 'all 0.15s ease',
                      background: 'transparent'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                      e.currentTarget.style.transform = 'translateX(2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}
                  >
                    <span style={{ position: 'absolute', left: '12px' }}>•</span>
                    <span
                      style={{ marginLeft: '12px', display: 'block' }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdownInline(point) }}
                    />
                  </p>
                ))}
              </div>

              <div style={{ marginBottom: '4px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '0px', color: 'rgba(255, 255, 255, 0.9)' }}>
                  {i18n.getLanguage() === 'en' ? 'Sales Analysis' : 'Sales Analyse'}
                </h3>
                {getSalesAnalysis(displayedInsights).map((bullet, idx) => (
                  <p
                    key={`analysis-${idx}`}
                    onClick={() => handleInsightClick(bullet)}
                    style={{
                      fontSize: '12px',
                      lineHeight: '1.3',
                      marginBottom: '0px',
                      marginTop: '0px',
                      color: 'rgba(255, 255, 255, 0.85)',
                      paddingLeft: '12px',
                      position: 'relative',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      padding: '4px 12px',
                      marginLeft: '0',
                      transition: 'all 0.15s ease',
                      background: 'transparent'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                      e.currentTarget.style.transform = 'translateX(2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}
                  >
                    <span style={{ position: 'absolute', left: '12px' }}>•</span>
                    <span
                      style={{ marginLeft: '12px', display: 'block' }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdownInline(bullet) }}
                    />
                  </p>
                ))}
              </div>

              <div>
                <h3 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '2px', color: 'rgba(255, 255, 255, 0.9)' }}>
                  {i18n.t('overlay.listen.nextActions')}
                </h3>
	                {getInsightActions(displayedInsights).map((action, idx) => (
	                  <p
                    key={`action-${idx}`}
                    onClick={() => handleInsightClick(action.label, action.prompt)}
                    style={{
                      fontSize: '12px',
                      lineHeight: '1.4',
                      marginBottom: '3px',
                      color: 'rgba(255, 255, 255, 0.85)',
                      padding: '6px 10px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                      e.currentTarget.style.transform = 'translateX(2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}
	                    dangerouslySetInnerHTML={{ __html: renderMarkdownInline(action.label) }}
	                  />
	                ))}
	              </div>
            </div>
          ) : isLoadingInsights ? (
            <div className="insights-placeholder" style={{ padding: '8px 16px', textAlign: 'center', fontStyle: 'italic', background: 'transparent', color: 'rgba(255, 255, 255, 0.7)' }}>
              Loading insights...
            </div>
          ) : sessionState === 'during' ? (
            <div style={{ padding: '0px 12px 4px 12px' }}>
              {/* Prospect - no grounded input yet */}
              <div style={{ marginBottom: '4px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: '600', marginTop: '0px', marginBottom: '0px', color: 'rgba(255, 255, 255, 0.9)' }}>
                  Prospect
                </h3>
                <p style={{ fontSize: '12px', lineHeight: '1.3', marginTop: '0px', marginBottom: '0px', color: 'rgba(255, 255, 255, 0.65)', position: 'relative', padding: '4px 12px', fontStyle: 'italic' }}>
                  <span style={{ position: 'absolute', left: '12px' }}>•</span>
                  <span style={{ marginLeft: '12px', display: 'block' }}>{i18n.t('overlay.listen.noContextProspect')}</span>
                </p>
              </div>

              {/* Sales Analysis - proactive advice while there is no context yet */}
              <div style={{ marginBottom: '4px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '0px', color: 'rgba(255, 255, 255, 0.9)' }}>
                  {i18n.getLanguage() === 'en' ? 'Sales Analysis' : 'Sales Analyse'}
                </h3>
                <p style={{ fontSize: '12px', lineHeight: '1.3', marginTop: '0px', marginBottom: '0px', color: 'rgba(255, 255, 255, 0.85)', position: 'relative', padding: '4px 12px' }}>
                  <span style={{ position: 'absolute', left: '12px' }}>•</span>
                  <span style={{ marginLeft: '12px', display: 'block' }}>{i18n.t('overlay.listen.noContextAnalysis')}</span>
                </p>
              </div>

              {/* Next Actions - clickable, in its usual position */}
              <div>
                <h3 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '2px', color: 'rgba(255, 255, 255, 0.9)' }}>
                  {i18n.t('overlay.listen.nextActions')}
                </h3>
                <p
                  onClick={() => handleInsightClick(i18n.t('overlay.listen.whatToSayNext'), i18n.t('overlay.listen.whatToSayNextPrompt'))}
                  style={{
                    fontSize: '12px',
                    lineHeight: '1.4',
                    marginBottom: '3px',
                    color: 'rgba(255, 255, 255, 0.85)',
                    padding: '6px 10px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.transform = 'translateX(2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.transform = 'translateX(0)';
                  }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdownInline(i18n.t('overlay.listen.whatToSayNext')) }}
                />
              </div>
            </div>
          ) : (
            <div className="insights-placeholder" style={{ padding: '8px 16px', textAlign: 'center', fontStyle: 'italic', background: 'transparent', color: 'rgba(255, 255, 255, 0.7)' }}>
              {i18n.t('overlay.listen.noInsightsYet')}
            </div>
          )}
      </div>
    </div>
  );
};

export default ListenView;
