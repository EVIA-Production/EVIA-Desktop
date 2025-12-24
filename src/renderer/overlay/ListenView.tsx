import React, { useEffect, useRef, useState } from 'react';
import './overlay-glass.css';
import { getWebSocketInstance } from '../services/websocketService';
import { fetchInsights, Insight } from '../services/insightsService';
import { i18n } from '../i18n/i18n';
import { showToast, ToastContainer } from '../components/ToastNotification';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { 
  trackInsightClicked,
  trackInsightsViewed,
  trackInsightsLoaded,
  trackTranscriptViewToggled,
  trackTranscriptCopied,
  trackInsightsCopied,
  checkForInsightImplementation
} from '../services/posthogService';

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

interface TranscriptLine {
  speaker: number | null;
  text: string;
  isFinal?: boolean;
  isPartial?: boolean;
  timestamp?: number;
  utteranceId?: string;
}

interface ListenViewProps {
  lines: TranscriptLine[];
  followLive: boolean;
  onToggleFollow: () => void;
  onClose?: () => void;
}

const ListenView: React.FC<ListenViewProps> = ({ lines, followLive, onToggleFollow, onClose }) => {
  // DEBUG LOGS REMOVED - were causing severe lag by running on every render
  
  const [transcripts, setTranscripts] = useState<{text: string, speaker: number | null, isFinal: boolean, isPartial?: boolean, timestamp?: number, utteranceId?: string}[]>([]);
  const [localFollowLive, setLocalFollowLive] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'transcript' | 'insights'>('transcript');
  const [isHovering, setIsHovering] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [copiedView, setCopiedView] = useState<'transcript' | 'insights' | null>(null); // Track which view was copied
  const [elapsedTime, setElapsedTime] = useState('00:00');
  const [isSessionActive, setIsSessionActive] = useState(false);
  // 🔥 CRITICAL FIX: Track session state for insights context
  const [sessionState, setSessionState] = useState<'before' | 'during' | 'after'>('before');
  // Glass parity: Insights fetched from backend via fetchInsights service
  const [insights, setInsights] = useState<Insight | null>(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true); // Glass parity: auto-scroll when at bottom
  
  const autoScrollRef = useRef(true); // 🔧 FIX: Use ref to avoid re-render dependency issues
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const copyTimeout = useRef<NodeJS.Timeout | null>(null);
  const shouldScrollAfterUpdate = useRef(false); // 🔧 GLASS PARITY: Track if near bottom before update
  // Diagnostics: track message counts and last received time
  const messageCountRef = useRef(0);
  const lastMessageAtRef = useRef<number | null>(null);
  const watchdogIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [showUndoButton, setShowUndoButton] = useState(false); // 🎯 TASK 1: Undo button for auto-switched Insights
  const finalTranscriptCountRef = useRef(0); // 🔥 GLASS PARITY: Counter for triggering auto-insights every 5 final transcripts
  // UI diagnostics state to show counts and last message age
  const [diagMessageCount, setDiagMessageCount] = useState(0);
  const [diagLastMessageAgeMs, setDiagLastMessageAgeMs] = useState<number | null>(null);
  const stallToastShownRef = useRef(false);
  const hasActivePartialRef = useRef(false);

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

  // Sync autoScroll state with ref
  useEffect(() => {
    // Watchdog: if session is active but no transcript messages arrive for WATCHDOG_MS, warn the user
    // 🔥 FIX: Only run watchdog when in transcript view (not insights view)
    const WATCHDOG_MS = 8000; // consider stall if >8s without transcript while session active
    const CHECK_INTERVAL = 3000;

    const checkFn = () => {
      // CRITICAL: Don't show warnings when viewing insights (no transcription happening)
      if (!isSessionActive || viewMode !== 'transcript') return;
      
      const last = lastMessageAtRef.current;
      if (!last) {
        // No messages received yet - might still be initializing
        console.log('[ListenView] ⏳ Waiting for first transcript message...');
        return;
      }
      
      // Only check if we have an active partial (someone was speaking)
      if (!hasActivePartialRef.current) {
        return;
      }
      
      const since = Date.now() - last;
      
      if (since > WATCHDOG_MS) {
        console.warn(`[ListenView] 🚨 Transcript stall detected: ${Math.round(since/1000)}s since last message`);
        
        // First occurrence: show warning
        if (!stallToastShownRef.current) {
          showToast(i18n.t('overlay.listen.transcriptStalled') || 'Transcription stalled - reconnecting...', 'warning');
          stallToastShownRef.current = true;
        }
        
        // WINDOWS FIX: Trigger auto-recovery via IPC (Windows only to avoid affecting macOS)
        const isWindows = Boolean((window as any)?.platformInfo?.isWindows);
        if (isWindows) {
          const eviaIpc = (window as any).evia?.ipc;
          if (eviaIpc?.send) {
            console.log('[ListenView] 🔄 Triggering audio recovery via IPC (Windows)...');
            eviaIpc.send('audio:trigger-recovery');
          }
        }
        
        // Reset the timestamp to avoid rapid-fire recovery attempts
        lastMessageAtRef.current = Date.now();
      }
    };

    watchdogIntervalRef.current = setInterval(checkFn, CHECK_INTERVAL);
    return () => {
      if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
      watchdogIntervalRef.current = null;
    };
  }, [isSessionActive, viewMode]);

  // Keep autoScrollRef in sync with state without causing re-renders
  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  useEffect(() => {
    const hasPartial = transcripts.some(t => t.isPartial);
    hasActivePartialRef.current = hasPartial;
    if (!hasPartial) {
      stallToastShownRef.current = false;
    }
  }, [transcripts]);

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

  // Glass parity: Auto-scroll when at bottom
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      const isAtBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 50;
      setAutoScroll(isAtBottom);
    };

    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  // 🔧 GLASS PARITY: Scroll AFTER React renders (lines 178-185 in SttView.js)
  // Glass uses setTimeout(fn, 0) to ensure DOM is fully updated before scrolling
  useEffect(() => {
    if (shouldScrollAfterUpdate.current && viewportRef.current) {
      // Use setTimeout(0) like Glass SttView.js line 179-184 scrollToBottom()
      setTimeout(() => {
        if (viewportRef.current) {
          viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        }
      }, 0);
      shouldScrollAfterUpdate.current = false;
    }
  }, [transcripts]); // Run after transcripts update

  useEffect(() => {
    adjustWindowHeight();
    return () => {
      if (copyTimeout.current) {
        clearTimeout(copyTimeout.current);
      }
    };
  }, []);

  // 🔧 FIX: Cleanup timer on unmount
  useEffect(() => {
    return () => {
      console.log('[ListenView] 🛑 Stopping timer on unmount');
      stopTimer();
      setIsSessionActive(false);
    };
  }, []); // Empty dependency - cleanup on unmount

  // Listen for transcript messages forwarded from Header window via IPC
  // Header window captures audio, sends to backend via WebSocket, and forwards transcripts here
  useEffect(() => {
    console.log('[ListenView] Setting up IPC listener for transcript messages');

    const handleTranscriptMessage = (msg: any) => {
      console.log('[ListenView] 📨 Received IPC message:', msg.type, '_source:', msg._source);

      // Diagnostics: update last received timestamp and count
      messageCountRef.current += 1;
      lastMessageAtRef.current = Date.now();
      stallToastShownRef.current = false;
      if (messageCountRef.current % 10 === 0) {
        console.log(`[ListenView] 📈 Received ${messageCountRef.current} transcript messages so far. Last at ${new Date(lastMessageAtRef.current).toISOString()}`);
      }

      // Handle recording_started
      if (msg.type === 'recording_started') {
        console.log('[ListenView] ▶️  Recording started - starting timer');
        setTranscripts([]);
        setInsights(null);
        setViewMode('transcript');
        setElapsedTime('00:00');
        setIsSessionActive(true);
        finalTranscriptCountRef.current = 0;
        // 🔧 GLASS PARITY: Enable auto-scroll at session start
        setAutoScroll(true);
        autoScrollRef.current = true;
        shouldScrollAfterUpdate.current = true;
        console.log('[ListenView] 🔄 Reset final transcript counter, auto-scroll enabled');
        // 🔧 GLASS PARITY: Force scroll to bottom after DOM updates (session fresh start)
        setTimeout(() => {
          if (viewportRef.current) {
            viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
            console.log('[ListenView] 📜 Scrolled to bottom on session start');
          }
        }, 50);
        startTimer();
        return;
      }

      // Handle recording_stopped
      if (msg.type === 'recording_stopped') {
        console.log('[ListenView] 🛑 Recording stopped - stopping timer');
        stopTimer();
        setIsSessionActive(false);

        console.log('[ListenView] 🔄 Auto-switching to Insights view...');
        setViewMode('insights');
        setShowUndoButton(false);

        console.log('[ListenView] ⏳ Scheduling insights fetch in 300ms...');
        setTimeout(() => {
          console.log('[ListenView] 🚀 Fetching post-call insights NOW');
          fetchInsightsNow();
        }, 300);

        return;
      }

      // Keepalive
      if (msg.type === 'keepalive') {
        console.log('[ListenView] ❤️ Keepalive ping received - connection healthy');
        return;
      }

      // Extract transcript text
      let text: string | undefined;
      let speaker: number | null = null;
      let isFinal = false;
      let isPartial = false;
      let utteranceId: string | undefined;

      if (msg.type === 'transcript_segment' && msg.data) {
        text = msg.data.text || '';
        speaker = msg.data.speaker ?? null;
        isFinal = msg.data.is_final === true;
        isPartial = !isFinal;
        const rawUtterance = msg.data.utterance_id ?? msg.data.utteranceId ?? msg.data.utteranceID;
        if (rawUtterance !== undefined && rawUtterance !== null) {
          utteranceId = String(rawUtterance);
        }
      } else if (msg.type === 'status' && msg.data?.echo_text) {
        text = msg.data.echo_text;
        speaker = msg._source === 'mic' ? 1 : msg._source === 'system' ? 0 : null;
        isFinal = msg.data.final === true;
        isPartial = !isFinal;
        const rawUtterance = msg.data.utterance_id ?? msg.data.utteranceId ?? msg.data.utteranceID;
        if (rawUtterance !== undefined && rawUtterance !== null) {
          utteranceId = String(rawUtterance);
        }
      } else if (msg.type === 'status') {
        console.log('[ListenView] 📊 CONNECTION STATUS:', msg.data);
        return;
      }

      if (!text) return;

      if (text.trim().toLowerCase().includes('evia connection')) {
        console.log('[ListenView] 🚫 Filtered connection status message');
        return;
      }

      const messageTimestamp = Date.now();

      console.log('[ListenView] 📨', 
        msg.type === 'transcript_segment' ? 'transcript_segment:' : 'status:',
        text.substring(0, 50), 'speaker:', speaker, 'isFinal:', isFinal, 'utt:', utteranceId ?? '—'
      );

      const container = viewportRef.current;
      if (container) {
        // 🔧 GLASS PARITY FIX: Only check isAtBottom, exactly like Glass SttView.js line 120
        // This ensures auto-scroll works when user is at bottom, regardless of autoScrollRef state
        const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 10;
        shouldScrollAfterUpdate.current = isAtBottom;
        // Also sync the autoScroll state for UI consistency
        if (isAtBottom !== autoScrollRef.current) {
          autoScrollRef.current = isAtBottom;
        }
      }

      // Merge logic...
      setTranscripts(prev => {
        // Diagnostics: log sizes to detect when UI updates
        try {
          const prevLen = prev.length;
          // update diag counters optimistically; will be rendered in top-bar
          setDiagMessageCount(messageCountRef.current);
          setDiagLastMessageAgeMs(0);
          console.log('[ListenView] DIAG setTranscripts invoked - prevLen =', prevLen);
        } catch (err) {
          console.warn('[ListenView] DIAG logging failed', err);
        }
        // Find last partial for THIS speaker (like Glass SttView.js:122-128)s
        const findLastPartialIdx = (spk: number | null, candidateUtteranceId?: string) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            const item = prev[i];
            if (item.speaker !== spk) continue;
            if (!item.isPartial || item.isFinal) continue;

            if (candidateUtteranceId) {
              // Only consider entries with matching utteranceId when candidate has one
              if (!item.utteranceId) continue;
              if (item.utteranceId === candidateUtteranceId) {
              return i;
            }
              continue;
            }

            // If incoming message lacks an utteranceId, prefer entries that also lack it
            if (item.utteranceId) continue;
            return i;
          }
          return -1;
        };

        const newMessages = [...prev];
        const normalizedUtteranceId = utteranceId ?? undefined;
        let targetIdx = findLastPartialIdx(speaker, normalizedUtteranceId);
        if (targetIdx === -1 && !normalizedUtteranceId) {
          // Fallback: match any partial for this speaker when no IDs are present at all
          targetIdx = findLastPartialIdx(speaker);
        }

        // Just display what Deepgram sends (already accumulated)
        // Deepgram sends accumulated text in partials: "Hello" → "Hello there" → "Hello there friend"
        // We display it as-is - no extraction needed!
        if (isPartial) {
          if (targetIdx !== -1) {
            // Update existing partial with new accumulated text
            const existing = prev[targetIdx];
            if (existing.text === text) {
              console.log('[ListenView] ⏭️ Skipping identical partial update for speaker', speaker, 'utt:', normalizedUtteranceId ?? '∅');
              return prev;
            }
            console.log('[ListenView] 🔄 UPDATING partial at index', targetIdx, 'utt:', normalizedUtteranceId ?? '∅');
            console.log('  ├─ OLD:', existing.text.substring(0, 50));
            console.log('  └─ NEW:', text.substring(0, 50));
            console.log('  ⚠️  REASON: Found existing partial for speaker', speaker, 'at index', targetIdx);
            console.log('  📊 Current state: prevLen=' + prev.length + ', partials:', prev.filter(t => t.isPartial).length);
            newMessages[targetIdx] = {
              ...newMessages[targetIdx],
              text: text,  // ← Just use Deepgram's text as-is!
              speaker,
              isFinal: false,
              isPartial: true,
              timestamp: messageTimestamp,
              utteranceId: normalizedUtteranceId ?? newMessages[targetIdx].utteranceId,
            };
          } else{
            // No partial found, add new one
            console.log('[ListenView] ➕ ADDING new partial (utt:', normalizedUtteranceId ?? '∅', ')');
            console.log('  └─ NEW:', text.substring(0, 50));
            console.log('  ✅ REASON: No existing partial found for speaker', speaker);
            console.log('  📊 Current state: prevLen=' + prev.length + ', partials:', prev.filter(t => t.isPartial).length);
            newMessages.push({
              text,
              speaker,
              isFinal: false,
              isPartial: true,
              timestamp: messageTimestamp,
              utteranceId: normalizedUtteranceId,
            });
          }
        } else if (isFinal) {
          // Final: Convert existing partial to final, OR merge with last final, OR add new
          if (targetIdx !== -1) {
            // Convert existing partial to final
            const oldText = prev[targetIdx].text;
            console.log('[ListenView] ✅ CONVERTING partial to FINAL at index', targetIdx, 'utt:', normalizedUtteranceId ?? '∅');
            console.log('  ├─ OLD:', oldText.substring(0, 50));
            console.log('  └─ NEW:', text.substring(0, 50));
            console.log('  🎯 REASON: Found existing partial for speaker', speaker, 'converting to final');
            console.log('  📊 Current state: prevLen=' + prev.length + ', finals:', prev.filter(t => t.isFinal).length);
              newMessages[targetIdx] = {
                text,
                speaker,
                isFinal: true,
                isPartial: false,
                timestamp: messageTimestamp,
                utteranceId: normalizedUtteranceId ?? newMessages[targetIdx].utteranceId,
              };

              finalTranscriptCountRef.current += 1;
              
              // 📊 POSTHOG: Check if user implemented a clicked insight (speaker 1 = user)
              if (speaker === 1) {
                const chatId = Number(localStorage.getItem('current_chat_id') || '0');
                checkForInsightImplementation(chatId, text);
              }
              
              if (finalTranscriptCountRef.current >= 5 && finalTranscriptCountRef.current % 5 === 0 && isSessionActive) {
                console.log(`[ListenView] 🎯 Triggering auto-insights - ${finalTranscriptCountRef.current} final transcripts accumulated`);
                setTimeout(() => fetchInsightsNow(), 100);
              }
          } else {
              // No previous partial - create new bubble
              console.log('[ListenView] ➕ ADDING new FINAL (no partial found) utt:', normalizedUtteranceId ?? '∅');
              console.log('  └─ NEW:', text.substring(0, 50));
              console.log('  ✅ REASON: No existing partial found for speaker', speaker, '- creating new final bubble');
              console.log('  📊 Current state: prevLen=' + prev.length + ', finals:', prev.filter(t => t.isFinal).length);
              newMessages.push({
                text,
                speaker,
                isFinal: true,
                isPartial: false,
                timestamp: messageTimestamp,
                utteranceId: normalizedUtteranceId,
              });
              finalTranscriptCountRef.current += 1;
              
              // 📊 POSTHOG: Check if user implemented a clicked insight (speaker 1 = user)
              if (speaker === 1) {
                const chatId = Number(localStorage.getItem('current_chat_id') || '0');
                checkForInsightImplementation(chatId, text);
              }
              
              if (finalTranscriptCountRef.current >= 5 && finalTranscriptCountRef.current % 5 === 0 && isSessionActive) {
                console.log(`[ListenView] 🎯 Triggering auto-insights - ${finalTranscriptCountRef.current} final transcripts accumulated`);
                setTimeout(() => fetchInsightsNow(), 100);
              }
          }
        }

        return newMessages;
      });
      // After transcripts state scheduled update, schedule an update of last-message age (ms) DEV-ONLY metric
      setTimeout(() => {
        const lastAt = lastMessageAtRef.current;
        if (lastAt) {
          setDiagLastMessageAgeMs(Date.now() - lastAt);
        }
      }, 60);
    };


    const eviaIpc = (window as any).evia?.ipc;

    if (eviaIpc?.on) {
      // Use named handlers so we can reliably remove them later
      const onTranscript = (payload: any) => handleTranscriptMessage(payload);

      const onClearSession = () => {
        console.log('[ListenView] 🧹 Received clear-session - resetting all state');
        setTranscripts([]);
        setInsights(null);
        setViewMode('transcript');
        setElapsedTime('00:00');
        setIsSessionActive(false);
        stopTimer();
        console.log('[ListenView] ✅ Session cleared');
      };

      const onLanguageChanged = (newLang: string) => {
        console.log('[ListenView] 🌐 Language changed - clearing insights');
        setInsights(null);
      };

      const onSessionStateChanged = (newState: 'before' | 'during' | 'after') => {
        console.log('[ListenView] 📡 Session state changed:', newState);
        // 🔴 CRITICAL FIX: Also update localStorage in THIS window's context
        // Each Electron window has its own localStorage, so we must sync it here!
        localStorage.setItem('evia_session_state', newState);
        setSessionState(newState);
        if (newState === 'during') setIsSessionActive(true);
        else if (newState === 'after') setIsSessionActive(false);
      };

      // Register listeners
      try {
        // If removeAllListeners exists on the bridge, clear channels first to avoid duplication
        if (typeof eviaIpc.removeAllListeners === 'function') {
          ['transcript-message', 'clear-session', 'language-changed', 'session-state-changed'].forEach(ch => eviaIpc.removeAllListeners(ch));
        }
      } catch (err) {
        // continue silently; not all bridges expose removeAllListeners
        console.warn('[ListenView] removeAllListeners not available on eviaIpc:', err);
      }

      eviaIpc.on('transcript-message', onTranscript);
      eviaIpc.on('clear-session', onClearSession);
      eviaIpc.on('language-changed', onLanguageChanged);
      eviaIpc.on('session-state-changed', onSessionStateChanged);

      console.log('[ListenView] ✅ IPC listeners registered (named handlers)');

      // Cleanup: try removeAllListeners first; otherwise remove the exact handlers
      return () => {
        console.log('[ListenView] Cleaning up IPC listeners');
        const bridge = (window as any).evia?.ipc;
        if (!bridge) return;

        if (typeof bridge.removeAllListeners === 'function') {
          try {
            ['transcript-message', 'clear-session', 'language-changed', 'session-state-changed'].forEach(ch => bridge.removeAllListeners(ch));
            return;
          } catch (err) {
            console.warn('[ListenView] removeAllListeners failed during cleanup:', err);
          }
        }

        // Fallback: remove using off/removeListener if provided
        try {
          if (typeof bridge.off === 'function') {
            bridge.off('transcript-message', onTranscript);
            bridge.off('clear-session', onClearSession);
            bridge.off('language-changed', onLanguageChanged);
            bridge.off('session-state-changed', onSessionStateChanged);
          } else if (typeof bridge.removeListener === 'function') {
            bridge.removeListener('transcript-message', onTranscript);
            bridge.removeListener('clear-session', onClearSession);
            bridge.removeListener('language-changed', onLanguageChanged);
            bridge.removeListener('session-state-changed', onSessionStateChanged);
          } else {
            console.warn('[ListenView] No supported listener removal methods on bridge');
          }
        } catch (err) {
          console.error('[ListenView] Failed to remove IPC listeners via fallback methods:', err);
        }
      };
    }

    // If eviaIpc isn't present or doesn't support `.on`, provide a no-op cleanup
    return () => {
      /* no-op cleanup if bridge isn't available */
    };

  }, []);

  // Handle insight clicks - send to AskView via IPC
  // When user clicks an insight (summary point, topic bullet, or action), we:
  // 1. Log the click for debugging
  // 2. Determine current session state (after recording stops, isSessionActive = false)
  // 3. Send to AskView via IPC with 'ask:send-and-submit' channel INCLUDING session state
  // 4. AskView receives it, populates input, updates session state, and auto-submits
  const handleInsightClick = (insightText: string, insightType: 'summary' | 'topic' | 'action' | 'followup' = 'action', insightIndex: number = 0) => {
    const chatId = Number(localStorage.getItem('current_chat_id') || '0');
    const insightSessionState = insights?.session_state || sessionState;
    
    // 📊 POSTHOG: Track insight click
    trackInsightClicked({
      chat_id: chatId,
      insight_type: insightType,
      insight_text: insightText,
      insight_index: insightIndex,
      session_state: insightSessionState as 'before' | 'during' | 'after',
    });
    
    console.log('[ListenView] 📨 Insight clicked:', insightText.substring(0, 50));
    
    // Use session_state FROM THE INSIGHTS OBJECT, not localStorage!
    // Insights are generated WITH a specific session_state and MUST use that state when clicked
    // Otherwise: Insights generated "during" call are clicked "after" call → wrong prompt!
    // (insightSessionState already defined above for PostHog tracking)
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
        text: insightText,
        sessionState: insightSessionState
      });
      console.log('[ListenView] ✅ Sent insight to AskView via IPC with session_state:', insightSessionState);
    } else {
      console.error('[ListenView] ❌ IPC bridge not available for ask:send-and-submit');
    }
  };

  // Extract insights fetching to reusable function
  const fetchInsightsNow = async () => {
    if (isLoadingInsights) return; // Prevent duplicate fetches

    // DIAGNOSTIC: Log start of fetch
    console.log('[ListenView] 🔍 DIAGNOSTIC: Starting fetchInsightsNow');
    console.log('[ListenView] 🔍 Transcript count (local UI):', transcripts.length);
    console.log('[ListenView] 🔍 Final transcript count (ref):', finalTranscriptCountRef.current);
    console.log('[ListenView] 🔍 Session state:', sessionState);
    console.log('[ListenView] 🔍 Is session active:', isSessionActive);

    // ASYNC FIX: Clear insights FIRST to show loading state, preventing stub flicker
    // Users will see spinner instead of wrong "Vorbereitung" insights
    setInsights(null);

    // SMART RETRY STRATEGY: Poll with exponential backoff instead of hardcoded delay
    // - Attempt 1: Immediate (0ms) - Fast path if transcripts already saved
    // - Attempt 2: After 300ms - Quick retry for fast saves
    // - Attempt 3: After 700ms (total 1000ms) - Final retry for slow saves
    // This is FASTER than hardcoded 1s delay when transcripts save quickly!
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [0, 300, 700]; // Exponential: 0ms, 300ms, 700ms
    
    setIsLoadingInsights(true);
    const ttftStart = Date.now();
    
    // Get auth credentials once
    const chatId = Number(localStorage.getItem('current_chat_id') || '0');
    const eviaAuth = (window as any).evia?.auth as { getToken: () => Promise<string | null> } | undefined;
    const token = await eviaAuth?.getToken();

    console.log('[ListenView] 🔍 Chat ID:', chatId);
    console.log('[ListenView] 🔍 Token available:', !!token);

    if (!chatId || !token) {
      console.error('[ListenView] ❌ Missing chat_id or auth token for insights fetch');
      setIsLoadingInsights(false);
      return;
    }

    // ALWAYS use latest session state from localStorage (truth source)
    // Don't derive from isSessionActive - it can be stale!
    // EviaBar updates localStorage IMMEDIATELY when Stopp is pressed → listenStatus = 'after'
    const latestSessionState = localStorage.getItem('evia_session_state') as 'before' | 'during' | 'after' || 'during';
    const localStorageState = latestSessionState; // For logging purposes
    const derivedSessionState = latestSessionState;
    const currentLang = i18n.getLanguage();
    
    console.log('[ListenView] 🎯 Session state for insights: localStorage =', latestSessionState, ', component state =', sessionState, ', isSessionActive =', isSessionActive);
    
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
        
        // 🔍 Check if we got actual insights (not stub "no transcripts" message)
        const hasTranscripts = fetchedInsights?.summary?.[0] !== "Keine Transkripte vorhanden für Analyse" &&
                              fetchedInsights?.summary?.[0] !== "No transcripts available for analysis";
        
        if (hasTranscripts) {
          const ttftMs = Date.now() - ttftStart;
          console.log(`[ListenView] ✅ Success on attempt #${attempt + 1}! Got insights with transcripts in ${ttftMs}ms`);
          break; // Success - exit retry loop
        } else {
          console.log(`[ListenView] ⚠️ Attempt #${attempt + 1}: No transcripts yet (stub message received)`);
          if (attempt < MAX_RETRIES - 1) {
            console.log(`[ListenView] 🔄 Will retry in ${RETRY_DELAYS[attempt + 1]}ms...`);
            // 🔥 CRITICAL: DON'T set stub insights - keep showing loading spinner
            fetchedInsights = null;
          } else {
            // 🔥 CRITICAL: Even on max retries, DON'T show stub - keep null/loading
            console.log('[ListenView] ⏭️ Max retries reached, NO transcripts yet - keeping loading state');
            fetchedInsights = null;
          }
        }
      }
      
      const ttftMs = Date.now() - ttftStart;
      console.log('[ListenView] 🔍 DIAGNOSTIC: Insights fetch complete');
      console.log('[ListenView] 🔍 Total time (including retries):', ttftMs, 'ms');
      console.log('[ListenView] 🔍 Attempts used:', attempt + 1);
      
      if (fetchedInsights) {
        console.log('[ListenView] ✅ Glass insights received!');
        
        // Log session_state metadata from insights
        console.log('[ListenView] 🎯 INSIGHT METADATA:');
        console.log('[ListenView]   - session_state from backend:', fetchedInsights.session_state);
        console.log('[ListenView]   - This state will be used when insights are clicked!');
        console.log('[ListenView]   - Current localStorage state:', localStorageState);
        
        console.log('[ListenView] 🔍 Insights structure:', {
          hasSummary: !!fetchedInsights.summary,
          summaryLength: fetchedInsights.summary?.length,
          hasTopic: !!fetchedInsights.topic,
          topicHeader: fetchedInsights.topic?.header,
          topicBulletsCount: fetchedInsights.topic?.bullets?.length,
          hasActions: !!fetchedInsights.actions,
          actionsCount: fetchedInsights.actions?.length,
          sessionState: fetchedInsights.session_state,
          ttftMs
        });
        console.log('[ListenView] 🔍 Summary content:', fetchedInsights.summary);
        console.log('[ListenView] 🔍 Topic bullets:', fetchedInsights.topic?.bullets);
        console.log('[ListenView] 🔍 Actions:', fetchedInsights.actions);
        
        // 📊 POSTHOG: Track insights loaded
        trackInsightsLoaded({
          chat_id: chatId,
          load_time_ms: ttftMs,
          summary_count: fetchedInsights.summary?.length || 0,
          topic_count: fetchedInsights.topic?.bullets?.length || 0,
          action_count: fetchedInsights.actions?.length || 0,
          followup_count: fetchedInsights.followUps?.length || 0,
        });
        
        setInsights(fetchedInsights);
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
      
      // Set stub insights with error message so UI shows something meaningful
      const lang = i18n.getLanguage();
      setInsights({
        summary: [
          lang === 'de' 
            ? '⚠️ Insights konnten nicht geladen werden'
            : '⚠️ Failed to load insights',
          lang === 'de'
            ? 'Versuche es erneut oder überprüfe deine Verbindung'
            : 'Try again or check your connection'
        ],
        topic: {
          header: lang === 'de' ? 'Fehlerdetails' : 'Error Details',
          bullets: [errorMessage.substring(0, 100)]
        },
        actions: [
          lang === 'de' 
            ? '🔄 Transkript ↔ Erkenntnisse (um erneut zu versuchen)'
            : '🔄 Toggle view to retry'
        ],
        followUps: []
      });
    } finally {
      setIsLoadingInsights(false);
    }
  };


  const toggleView = async () => {
    const newMode = viewMode === 'transcript' ? 'insights' : 'transcript';
    const chatId = Number(localStorage.getItem('current_chat_id') || '0');
    
    // 📊 POSTHOG: Track view toggle
    trackTranscriptViewToggled({
      chat_id: chatId,
      from_mode: viewMode,
      to_mode: newMode,
      session_state: sessionState,
    });
    
    console.log(`[ListenView] 🔄 Toggling view: ${viewMode} → ${newMode}`);
    setViewMode(newMode);

    // Hide undo button when manually toggling (user has control)
    if (showUndoButton) {
      setShowUndoButton(false);
    }

    // Glass parity: Reset copy state when switching views (only show "Copied X" for the view that was actually copied)
    if (copyState === 'copied' && copiedView !== newMode) {
      setCopyState('idle');
    }

    // 🔥 COLD CALLING FIX: ALWAYS fetch fresh insights when toggling to insights view
    // This ensures insights reflect the latest transcript context, critical for real-time coaching
    if (newMode === 'insights') {
      console.log(`[ListenView] Switched to insights view - Fetching fresh insights`);
      await fetchInsightsNow();
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
          
          for (const line of transcripts) {
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
          return groups.map(group => {
            const speakerLabel = group.speaker === 1 ? meLabel : themLabel;
            const joinedText = group.texts.join(' ');  // Join with space (same utterance)
            return `${speakerLabel}:\n\n${joinedText}`;
          }).join('\n\n---\n\n');  // Separator between different speakers
        })()
        : insights
        ? (() => {
            // Use translated headers instead of hardcoded "Summary"
            const currentLang = i18n.getLanguage();
            const summaryHeader = currentLang === 'de' ? 'Zusammenfassung' : 'Summary';
            const actionsHeader = currentLang === 'de' ? 'Actions' : 'Actions';
            const followUpsHeader = currentLang === 'de' ? 'Follow-Ups' : 'Follow-Ups';
            
            // Build insights text with translated sections
            let text = `${summaryHeader}:\n${insights.summary.join('\n')}\n\n${insights.topic.header}:\n${insights.topic.bullets.join('\n')}\n\n${actionsHeader}:\n${insights.actions.join('\n')}`;
            
            // 🔧 DEMO FIX: Only include Follow-Ups if session is NOT active (after meeting)
            // During active recording, user only wants Summary/Topics/Actions copied
            if (insights.followUps && insights.followUps.length > 0 && !isSessionActive) {
              text += `\n\n${followUpsHeader}:\n${insights.followUps.join('\n')}`;
              console.log('[ListenView] 📋 Copy: Included Follow-Ups (session inactive)');
            } else if (isSessionActive) {
              console.log('[ListenView] 📋 Copy: Excluded Follow-Ups (session active)');
            }
            
            return text;
          })()
        : '';

    try {
      await navigator.clipboard.writeText(textToCopy);
      
      // 📊 POSTHOG: Track copy event
      const chatId = Number(localStorage.getItem('current_chat_id') || '0');
      if (viewMode === 'transcript') {
        trackTranscriptCopied({
          chat_id: chatId,
          line_count: transcripts.length,
          speaker_count: new Set(transcripts.map(t => t.speaker)).size,
        });
      } else if (insights) {
        trackInsightsCopied({
          chat_id: chatId,
          content_length: textToCopy.length,
          sections_included: [
            'summary',
            'topics', 
            'actions',
            ...(insights.followUps && insights.followUps.length > 0 && !isSessionActive ? ['followups'] : [])
          ],
        });
      }
      
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
      <div className="assistant-container">
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
            {/* 🎙️ DEBUG: WAV recorder button */}
            {/* 🎯 TASK 1: Undo button (shown for 10s after auto-switch) */}
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
          {viewMode === 'transcript' ? (
            transcripts.length > 0 ? (
              transcripts.map((line, i) => {
                // 🎨 GLASS PARITY: speaker 0 = system/them (grey, left), speaker 1 = mic/me (blue, right)
                // null defaults to system (grey, left) for safety
                const isMe = line.speaker === 1;
                const isThem = line.speaker === 0 || line.speaker === null; // Default to "them" if unknown

                const bubbleKey = `${line.utteranceId ?? line.timestamp ?? i}-${i}`;
                return (
                  <div key={bubbleKey}>
                    <div
                      className={`bubble ${isMe ? 'me' : 'them'} ${line.isPartial ? 'partial' : 'final'}`}
                      style={{
                        // 🎨 GLASS PARITY: Highlight partial vs final directly in opacity
                        opacity: line.isPartial ? 0.78 : 1,
                        // 🎨 GLASS PARITY: Blue for me, grey for them (exact colors from Glass SttView.js)
                        background: isMe
                          ? 'rgba(0, 122, 255, 0.75)'  // Slightly more transparent mic blue
                          : 'rgba(255, 255, 255, 0.1)', // Glass .them color
                        color: isMe ? '#ffffff' : 'rgba(255, 255, 255, 0.9)',
                        // 🎨 REMOVED inline alignment - let CSS handle it for proper specificity
                        // 🎨 GLASS PARITY: Border radius (asymmetric per Glass)
                        borderRadius: '12px',
                        borderBottomLeftRadius: isThem ? '4px' : '12px',
                        borderBottomRightRadius: isMe ? '4px' : '12px',
                        padding: '8px 12px',
                        marginBottom: '8px',
                        maxWidth: '80%',
                        // 🎨 GLASS PARITY: iMessage-style width shrinks to content, not full-width
                        width: 'fit-content',
                        wordWrap: 'break-word',
                        fontSize: '13px',
                        lineHeight: '1.5',
                      }}
                    >
                      {/* 🔧 GLASS PARITY: No speaker labels, only CSS-based styling via background color */}
                      <span className="bubble-text">{line.text}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="insights-placeholder" style={{ padding: '8px 16px', textAlign: 'center', fontStyle: 'italic', background: 'transparent', color: 'rgba(255, 255, 255, 0.7)' }}>
                {i18n.t('overlay.listen.waitingForSpeech')}
              </div>
            )
          ) : isLoadingInsights ? (
            <div className="insights-placeholder" style={{ padding: '8px 16px', textAlign: 'center', fontStyle: 'italic', background: 'transparent', color: 'rgba(255, 255, 255, 0.7)' }}>
              Loading insights...
            </div>
          ) : insights ? (
              <div style={{ padding: '0px 12px 4px 12px' }}>
              {/* Summary Section */}
              <div style={{ marginBottom: '4px' }}>
                {/* 🔧 FIX #33: Added marginTop:0 to eliminate browser default spacing above "Zusammenfassung" */}
                <h3 style={{ fontSize: '13px', fontWeight: '600', marginTop: '0px', marginBottom: '0px', color: 'rgba(255, 255, 255, 0.9)' }}>
                  {i18n.t('overlay.listen.summary')}
                </h3>
                {insights.summary.map((point, idx) => (
                  <p 
                    key={`summary-${idx}`}
                    onClick={() => handleInsightClick(point, 'summary', idx)}
                    style={{ 
                      fontSize: '12px',    // 🔧 FIX #20: Increased from 11px per user feedback
                      lineHeight: '1.3',   // 🔧 FIX #16: Tighter line height
                      marginBottom: '0px',
                      marginTop: '0px',    // 🔧 FIX #16: Zero margins
                      color: 'rgba(255, 255, 255, 0.85)',
                      paddingLeft: '12px',
                      position: 'relative',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      padding: '4px 12px',  // 🔧 FIX #16: Reduce vertical padding
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

              {/* Topic Section */}
              <div style={{ marginBottom: '4px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '0px', color: 'rgba(255, 255, 255, 0.9)' }}>
                  {insights.topic.header}
                </h3>
                {insights.topic.bullets.map((bullet, idx) => (
                  <p 
                    key={`bullet-${idx}`}
                    onClick={() => handleInsightClick(bullet, 'topic', idx)}
                    style={{ 
                      fontSize: '12px',    // 🔧 FIX #20: Increased from 11px per user feedback
                      lineHeight: '1.3',   // 🔧 FIX #16: Tighter line height
                      marginBottom: '0px',
                      marginTop: '0px',    // 🔧 FIX #16: Zero margins
                      color: 'rgba(255, 255, 255, 0.85)',
                      paddingLeft: '12px',
                      position: 'relative',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      padding: '4px 12px',  // 🔧 FIX #16: Reduce vertical padding
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

              {/* Actions Section */}
              <div>
                <h3 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '2px', color: 'rgba(255, 255, 255, 0.9)' }}>
                  {i18n.t('overlay.listen.nextActions')}
                </h3>
                {insights.actions.map((action, idx) => {
                  // 🔥 FIX: Only display title (before ":"), but send full question when clicked
                  // Backend now returns format: "💬 Title: Answer text..."
                  // Button should only show "💬 Title"
                  // When clicked, send "💬 Title" (the question) to Ask bar
                  const colonIndex = action.indexOf(':');
                  const displayText = colonIndex > -1 ? action.substring(0, colonIndex) : action;
                  const questionText = displayText; // Send the title/question to Ask bar
                  
                  return (
                    <p 
                      key={`action-${idx}`}
                      onClick={() => handleInsightClick(questionText, 'action', idx)}
                      style={{ 
                        fontSize: '12px',    // 🔧 FIX #20: Increased from 11px per user feedback
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
                      dangerouslySetInnerHTML={{ __html: renderMarkdownInline(displayText) }}
                    />
                  );
                })}
              </div>

              {/* 🔧 FIX #3: Follow-Ups Section (Glass parity) - Only shown when recording is complete */}
              {!isSessionActive && insights.followUps && insights.followUps.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <h3 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '2px', color: 'rgba(255, 255, 255, 0.9)' }}>
                    {i18n.getLanguage() === 'en' ? 'Follow-Ups' : 'Follow-Ups'}
                  </h3>
                  {insights.followUps.map((followUp, idx) => (
                    <p 
                      key={`followup-${idx}`}
                      onClick={() => handleInsightClick(followUp, 'followup', idx)}
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
                      dangerouslySetInnerHTML={{ __html: renderMarkdownInline(followUp) }}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="insights-placeholder" style={{ padding: '8px 16px', textAlign: 'center', fontStyle: 'italic', background: 'transparent', color: 'rgba(255, 255, 255, 0.7)' }}>
              {i18n.t('overlay.listen.noInsightsYet')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ListenView;