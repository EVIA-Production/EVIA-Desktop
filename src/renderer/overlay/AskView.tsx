import React, { useCallback, useEffect, useRef, useState } from 'react';
import './overlay-glass.css';
import { streamAsk } from '../lib/evia-ask-stream';
import { i18n } from '../i18n/i18n';
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import { BACKEND_URL } from '../config/config';

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
};

type AskSessionState = 'before' | 'during' | 'after';

const AskView: React.FC<AskViewProps> = ({ language, onClose, onSubmitPrompt }) => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [showTextInput, setShowTextInput] = useState(true);
  const [headerText, setHeaderText] = useState(i18n.t('overlay.ask.aiResponse'));
  const [responseHistory, setResponseHistory] = useState<string[]>([]);
  const [responseIndex, setResponseIndex] = useState(-1);
  const [responseSessionState, setResponseSessionState] = useState<AskSessionState>('before');
  
  const streamRef = useRef<{ abort: () => void } | null>(null);
  const streamStartTime = useRef<number | null>(null);
  const ttftLoggedRef = useRef(false);
  const responseContainerRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const restartStreamTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);  // UI IMPROVEMENT: Auto-focus input
  const lastResponseRef = useRef<string>('');  // UI IMPROVEMENT: Track when content actually changes
  const storedContentHeightRef = useRef<number | null>(null);  // CRITICAL: Store content-based height to restore after arrow key movement
  const responseBufferRef = useRef<string>('');
  const responseHistoryRef = useRef<string[]>([]);
  const responseIndexRef = useRef<number>(-1);
  const normalizeContextText = useCallback((value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase(), []);
  const sanitizeLiveAskMarkdown = useCallback((text: string) => {
    if (!text) return '';
    return text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/`(.+?)`/gs, '$1');
  }, []);

  const sanitizeRichAskMarkdown = useCallback((text: string) => {
    if (!text) return '';
    return text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`(.+?)`/gs, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/(?:\n\s*)?---\s*\n\s*\[(?:Aktion|Action):[^\]\n]+\]\s*/gi, '\n\n')
      .replace(/^\s*\[(?:Aktion|Action):[^\]\n]+\]\s*$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }, []);

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
  
  // Taylos-specific: Error handling
  const [errorToast, setErrorToast] = useState<{message: string, canRetry: boolean} | null>(null);
  const [isLoadingFirstToken, setIsLoadingFirstToken] = useState(false);
  const errorToastTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastPromptRef = useRef<string>('');
  const liveTranscriptOverrideRef = useRef<string | null>(null);
  const startStreamRef = useRef<((captureScreenshot?: boolean, overridePrompt?: string) => Promise<void>) | null>(null);
  const focusInputWithRetryRef = useRef<(() => void) | null>(null);
  const cancelActiveStreamRef = useRef<((reason: string) => void) | null>(null);

  useEffect(() => {
    responseHistoryRef.current = responseHistory;
  }, [responseHistory]);

  useEffect(() => {
    responseIndexRef.current = responseIndex;
  }, [responseIndex]);

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
  const MIN_CONTENT_HEIGHT = 180;

  const measureResponseContentHeight = useCallback(() => {
    const markdownEl = document.querySelector('.markdown-content') as HTMLElement | null;
    const responseEl = responseContainerRef.current;
    const markdownHeight = markdownEl?.scrollHeight || markdownEl?.offsetHeight || 0;
    const responseHeight = responseEl?.scrollHeight || responseEl?.offsetHeight || 0;
    return Math.max(markdownHeight, responseHeight, 50);
  }, []);

  const requestWindowResize = useCallback((targetHeight: number) => {
    const eviaApi = (window as any).evia;
    if (eviaApi?.windows?.adjustAskHeight) {
      const availableHeight = Math.max(700, (window.screen?.availHeight || 820) - 56);
      const clampedHeight = Math.max(58, Math.min(availableHeight, targetHeight));
      eviaApi.windows.adjustAskHeight(clampedHeight);
    }
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
          
          if (contentChanged && isStreaming) {
            // CASE 1: During streaming - measure actual component heights
            const headerEl = document.querySelector('.response-header') as HTMLElement;
            const inputEl = document.querySelector('.text-input-container') as HTMLElement;
            
            const headerH = headerEl?.offsetHeight || 45;
            const contentH = measureResponseContentHeight();
            const inputH = inputEl?.offsetHeight || 50;
            const padding = 24; // Response container padding
            
            const targetHeight = Math.max(MIN_CONTENT_HEIGHT, headerH + contentH + inputH + padding);
            const delta = Math.abs(targetHeight - current);
            
            // Only resize if notably wrong (>30px off) - prevents jitter
            if (delta > 30) {
              requestWindowResize(targetHeight);
              console.log('[AskView] 📏 Live (streaming): header=%d + content=%d + input=%d + pad=%d = %dpx', 
                headerH, contentH, inputH, padding, targetHeight);
            }
          } else if (
            storedContentHeightRef.current &&
            Math.abs(current - storedContentHeightRef.current) > 5
          ) {
            // Between sessions ('before') we intentionally keep compact height and
            // must not restore stale expanded heights from the previous call.
            if (sessionState === 'before' && !response && !isStreaming) {
              return;
            }
            // CASE 2: Content stable but height wrong (external resize like arrow keys)
            console.warn('[AskView] ⚠️ Height mismatch detected, restoring: %dpx → %dpx', 
              current, storedContentHeightRef.current);
            requestWindowResize(storedContentHeightRef.current);
          }
        }
        
        rafThrottled = false;
      });
    });

    resizeObserverRef.current.observe(container);

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [isStreaming, response, sessionState, measureResponseContentHeight]);

  // Glass parity: Auto-scroll to bottom during streaming
  useEffect(() => {
    if (responseContainerRef.current && isStreaming) {
      responseContainerRef.current.scrollTop = responseContainerRef.current.scrollHeight;
    }
  }, [response, isStreaming]);

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
      
      console.log('[AskView] 📥 Received send-and-submit via IPC:', incomingPrompt.substring(0, 50));
      
      // FIX: If session state explicitly provided, update it BEFORE starting stream
      // This ensures backend receives correct session_state (especially 'after' from Insights clicks)
      if (explicitSessionState) {
        console.log('[AskView] 🎯 Updating session state from Insights:', explicitSessionState);
        localStorage.setItem('evia_session_state', explicitSessionState);
        setSessionState(explicitSessionState as 'before' | 'during' | 'after');
      }
      liveTranscriptOverrideRef.current = transcriptContext || null;
      
      setPrompt(incomingPrompt);
      setShowTextInput(true);

      const queueReplacementStart = (delayMs: number) => {
        if (restartStreamTimeoutRef.current) {
          clearTimeout(restartStreamTimeoutRef.current);
        }
        restartStreamTimeoutRef.current = setTimeout(() => {
          restartStreamTimeoutRef.current = null;
          startStreamRef.current?.(false, incomingPrompt);
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

    // FIX: Clear session on language change (clears question, response, etc.)
    const handleClearSession = () => {
      console.log('[AskView] 🧹 Received clear-session - clearing all state (language change or session end)');
      cancelActiveStreamRef.current?.('clear session');
      // Clear all state
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
      setIsLoadingFirstToken(false);
      lastResponseRef.current = '';  // Clear resize tracking
      storedContentHeightRef.current = null;  // Clear stored height for fresh recalculation
      liveTranscriptOverrideRef.current = null;
      console.log('[AskView] ✅ Session cleared');
    };

    // SESSION STATE: Listen for session state changes from EviaBar
    const handleSessionStateChanged = (newState: 'before' | 'during' | 'after') => {
      console.log('[AskView] 🎯 Session state changed:', newState);
      // CRITICAL FIX: Also update localStorage in THIS window's context
      // Each Electron window has its own localStorage, so we must sync it here!
      localStorage.setItem('evia_session_state', newState);
      setSessionState(newState);

      if (newState === 'before') {
        // Hard reset between sessions so no previous response/height is restored.
        setResponse('');
        setResponseHistory([]);
        setResponseIndex(-1);
        setCurrentQuestion('');
        setPrompt('');
        setIsStreaming(false);
        setIsLoadingFirstToken(false);
        lastResponseRef.current = '';
        storedContentHeightRef.current = null;
      }
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
      storedContentHeightRef.current = null;  // Clear stored height for fresh recalculation
      liveTranscriptOverrideRef.current = null;

      // Force a fresh chat after language switch so follow-up suggestions
      // cannot inherit stale language/session context from the previous chat.
      try {
        localStorage.removeItem('current_chat_id');
      } catch {}
      console.log('[AskView] ✅ State cleared due to language change');
    };

    const handleShortcutNextStep = () => {
      startStream();
    };

    const handleShortcutPreviousResponse = () => {
      const history = responseHistoryRef.current;
      if (!history.length) return;

      const current = responseIndexRef.current >= 0 ? responseIndexRef.current : history.length - 1;
      const nextIdx = Math.max(0, current - 1);
      if (nextIdx === current) return;

      setResponseIndex(nextIdx);
      setResponse(history[nextIdx]);
      setHeaderText(i18n.t('overlay.ask.aiResponse'));
    };

    const handleShortcutNextResponse = () => {
      const history = responseHistoryRef.current;
      if (!history.length) return;

      const current = responseIndexRef.current >= 0 ? responseIndexRef.current : history.length - 1;
      const nextIdx = Math.min(history.length - 1, current + 1);
      if (nextIdx === current) return;

      setResponseIndex(nextIdx);
      setResponse(history[nextIdx]);
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
        startStreamRef.current?.();
      }, 100);
    }
  };

  const cancelActiveStream = useCallback((reason: string) => {
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

  const startStream = async (captureScreenshot: boolean = false, overridePrompt?: string) => {
    // FIX: Support override prompt for auto-submit from insights
    const actualPrompt = overridePrompt || prompt;
    if (!actualPrompt.trim() || streamRef.current) return;
    
    lastPromptRef.current = actualPrompt;
    setCurrentQuestion(actualPrompt);
    setErrorToast(null);
    setIsLoadingFirstToken(true);
    setHeaderText(i18n.t('overlay.ask.thinking'));
    
    const baseUrl = BACKEND_URL;
    
    console.log('[AskView] Getting auth token from keytar...');
    const eviaAuth = (window as any).evia?.auth as { 
      getToken: () => Promise<string | null>,
      checkTokenValidity?: () => Promise<{ valid: boolean, reason: string, expiresIn?: number }>
    } | undefined;
    const token = await eviaAuth?.getToken();
    if (!token) {
      showError('Authentication required. Please login first.', false);
      setIsLoadingFirstToken(false);
      setHeaderText(i18n.t('overlay.ask.aiResponse'));
      return;
    }
    
    // FIX: Check token validity before making request
    if (eviaAuth?.checkTokenValidity) {
      const validity = await (eviaAuth as any).checkTokenValidity();
      if (!validity.valid) {
        showError(`Token ${validity.reason === 'expired' ? 'expired' : 'invalid'}. Please re-login.`, false);
        setIsLoadingFirstToken(false);
        setHeaderText(i18n.t('overlay.ask.aiResponse'));
        return;
      }
      if (validity.reason === 'expiring_soon') {
        console.warn('[AskView] ⚠️ Token expires in', validity.expiresIn, 'seconds');
      }
    }

    let chatId = Number(localStorage.getItem('current_chat_id') || '0');
    if (!chatId || Number.isNaN(chatId)) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ language }),
        });
        
        if (res.status === 401) {
          showError('Authentication expired. Please reconnect.', true);
          setIsLoadingFirstToken(false);
          setHeaderText(i18n.t('overlay.ask.aiResponse'));
          return;
        }
        
        if (!res.ok) {
          showError(`Failed to create chat session (HTTP ${res.status}). Reconnect?`, true);
          setIsLoadingFirstToken(false);
          setHeaderText(i18n.t('overlay.ask.aiResponse'));
          return;
        }
        
        const data = await res.json();
        chatId = Number(data?.id);
        if (chatId && !Number.isNaN(chatId)) {
          try {
            localStorage.setItem('current_chat_id', String(chatId));
          } catch {}
          try {
            await (window as any).evia?.prefs?.set?.({ current_chat_id: String(chatId) });
          } catch {}
        } else {
          showError('Invalid chat session. Please reconnect.', true);
          setIsLoadingFirstToken(false);
          setHeaderText(i18n.t('overlay.ask.aiResponse'));
          return;
        }
      } catch (e: any) {
        const isNetworkError = e.message?.includes('fetch') || e.message?.includes('network');
        showError(
          isNetworkError 
            ? 'Network error. Check connection and reconnect?' 
            : 'Failed to create chat session. Reconnect?',
          true
        );
        setIsLoadingFirstToken(false);
        setHeaderText(i18n.t('overlay.ask.aiResponse'));
        return;
      }
    }

    // GLASS PARITY: Fetch transcript context for backend
    let transcriptContext = '';
    try {
      const liveSnapshot = await (window as any).evia?.liveTranscript?.get?.(chatId);
      const sharedTranscriptContext = liveTranscriptOverrideRef.current
        || liveSnapshot?.data?.transcriptContext
        || '';

      if (sharedTranscriptContext) {
        transcriptContext = sharedTranscriptContext;
        const lineCount = transcriptContext.split('\n').filter(Boolean).length;
        console.log('[AskView] 📄 Using live transcript snapshot:', transcriptContext.length, 'chars,', lineCount, 'entries');
      } else {
        const { getChatTranscripts } = await import('../services/websocketService');
        const transcripts = await getChatTranscripts(chatId, token, 200); // Last 200 turns
        
        if (transcripts && transcripts.length > 0) {
          const deduped = deduplicateTranscriptEntries(transcripts as AskTranscriptEntry[]);
          const maxChars = 40000;
          const lines: string[] = [];
          let charCount = 0;

          // Build from most recent backwards, then reassemble chronologically.
          for (let i = deduped.length - 1; i >= 0; i--) {
            const entry = deduped[i];
            const speakerLabel = entry.speaker === 1 ? 'You' : 'Prospect';
            const line = `${speakerLabel}: ${entry.text}`;
            const projected = charCount + line.length + 1;
            if (projected > maxChars) break;
            lines.unshift(line);
            charCount = projected;
          }

          transcriptContext = lines.join('\n');
          
          console.log('[AskView] 📄 Fetched transcript context:', transcriptContext.length, 'chars,', lines.length, 'entries');
        } else {
          console.log('[AskView] ℹ️ No transcript history yet');
        }
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
          showError(result.error || 'Screen Recording permission required.', false);
          setIsLoadingFirstToken(false);
          setHeaderText(i18n.t('overlay.ask.aiResponse'));
          return;
        }
      } catch (err: any) {
        console.error('[AskView] Screenshot capture error:', err);
      }
    }

    if (onSubmitPrompt) onSubmitPrompt(prompt);

    setResponse('');
    responseBufferRef.current = '';
    setResponseSessionState('before');
    lastResponseRef.current = '';  // UI IMPROVEMENT: Clear last response ref on new question
    storedContentHeightRef.current = null;  // CRITICAL: Clear stored height for new question
    setIsStreaming(true);
    setTtftMs(null);
    ttftLoggedRef.current = false;
    streamStartTime.current = performance.now();

    // CRITICAL FIX: Re-read session state from localStorage before streaming
    // EviaBar updates localStorage immediately when Listen starts, but the IPC event
    // might arrive too late (after user clicks shortcut button)
    const currentSessionState = localStorage.getItem('evia_session_state') as AskSessionState || 'during';
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
      screenshotRef 
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
          showError(language === 'en' 
            ? 'Service temporarily unavailable. Please try again in a moment.'
            : 'Service vorübergehend nicht verfügbar. Bitte versuchen Sie es in einem Moment erneut.', 
            true
          );
        } else if (d.includes('401') || d.includes('Unauthorized')) {
          showError('Authentication expired. Please reconnect.', true);
        } else {
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
      
      if (isLoadingFirstToken) {
        setIsLoadingFirstToken(false);
        setHeaderText(i18n.t('overlay.ask.aiResponse'));
      }
      
      if (!ttftLoggedRef.current && streamStartTime.current) {
        const ttft = performance.now() - streamStartTime.current;
        setTtftMs(ttft);
        ttftLoggedRef.current = true;
        console.log('[AskView] ⚡ TTFT:', ttft.toFixed(0), 'ms');
      }
      responseBufferRef.current += d;
      setResponse(sanitizeAskOutput(responseBufferRef.current, currentSessionState));
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
        setResponseHistory((prev) => {
          const next = [...prev, finalResponse];
          setResponseIndex(next.length - 1);
          return next;
        });
      }
      
      // FIX (2025-12-10): Final measurement - calculate from components
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const headerEl = document.querySelector('.response-header') as HTMLElement;
          const inputEl = document.querySelector('.text-input-container') as HTMLElement;

          const headerH = headerEl?.offsetHeight || 45;
          const contentH = measureResponseContentHeight();
          const inputH = inputEl?.offsetHeight || 50;
          const padding = 32; // Response container padding (8px top + 8px bottom + margins)
          
          const targetHeight = Math.max(MIN_CONTENT_HEIGHT, headerH + contentH + inputH + padding);
          const current = window.innerHeight;
          const delta = Math.abs(targetHeight - current);
          
          if (delta > 3) {
            storedContentHeightRef.current = targetHeight;
            requestWindowResize(targetHeight);
            console.log('[AskView] 📏 FINAL: header=%d + content=%d + input=%d + pad=%d = %dpx (was %dpx)', 
              headerH, contentH, inputH, padding, targetHeight, current);
          } else {
            console.log('[AskView] ✅ Size correct, no adjustment needed:', current, 'px');
          }
          
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
      
      if (is401) {
        showError('Authentication expired. Please reconnect.', true);
      } else if (isNetwork) {
        showError('Network connection lost. Reconnect?', true);
      } else if (!errorMsg.includes('aborted')) {
        showError(`Request failed. Reconnect?`, true);
      }
    });

    setPrompt('');
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
  }, [prompt, isStreaming, language, measureResponseContentHeight]);

  // REMOVED: Old two-step IPC pattern useEffect (was lines 350-389)
  // Now using ONLY single-step 'ask:send-and-submit' (lines 85-106) for Glass parity

  // FIX (2025-12-10): Resize to fit content - measure components
  const triggerManualResize = useCallback(() => {
    // Empty state: compact ask bar
    if (!response || response.trim() === '') {
      requestWindowResize(58);
      console.log('[AskView] 📏 Manual resize: compact ask bar (58px)');
      return;
    }
    
    // With content: measure actual component heights
    const headerEl = document.querySelector('.response-header') as HTMLElement;
    const inputEl = document.querySelector('.text-input-container') as HTMLElement;
    const contentH = measureResponseContentHeight();

    if (contentH > 0) {
      const headerH = headerEl?.offsetHeight || 45;
      const inputH = inputEl?.offsetHeight || 50;
      const padding = 24; // Response container padding
      
      const targetHeight = Math.max(MIN_CONTENT_HEIGHT, headerH + contentH + inputH + padding);
      const current = window.innerHeight;
      const delta = Math.abs(targetHeight - current);
      
      if (delta > 3) {
        requestWindowResize(targetHeight);
        console.log('[AskView] 📏 Manual: header=%d + content=%d + input=%d = %dpx', headerH, contentH, inputH, targetHeight);
      }
    }
  }, [response, measureResponseContentHeight]);

  // Trigger on empty response (collapse to compact bar)
  useEffect(() => {
    if (!response || response.trim() === '') {
      triggerManualResize();
    }
    // ResizeObserver handles non-empty states automatically
  }, [response, triggerManualResize]);

  // FIX #41: On visibility change, give ResizeObserver a nudge
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[AskView] 📏 Window became visible, triggering manual resize');
        setTimeout(triggerManualResize, 100);
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

  const hasResponse = isLoadingFirstToken || response || isStreaming;
  
  // GLASS PARITY (2025-12-10): Don't return early for loading state
  // Glass shows full component with header ("Thinking...") + loading dots in response area + input field
  // Removed the minimal loading bar that caused "cut off" appearance

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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
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
        className={`response-container ${!hasResponse ? 'hidden' : ''}`}
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
