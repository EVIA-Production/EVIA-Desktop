import React, { useCallback, useEffect, useRef, useState } from 'react';
import './overlay-tokens.css';
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

const AskView: React.FC<AskViewProps> = ({ language, onClose, onSubmitPrompt }) => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasFirstDelta, setHasFirstDelta] = useState(false);
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [showTextInput, setShowTextInput] = useState(true);
  const [headerText, setHeaderText] = useState(i18n.t('overlay.ask.aiResponse'));
  
  const streamRef = useRef<{ abort: () => void } | null>(null);
  const streamStartTime = useRef<number | null>(null);
  const responseContainerRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);  // 🔧 UI IMPROVEMENT: Auto-focus input
  const lastResponseRef = useRef<string>('');  // 🔧 UI IMPROVEMENT: Track when content actually changes
  const storedContentHeightRef = useRef<number | null>(null);  // 🔧 CRITICAL: Store content-based height to restore after arrow key movement
  
  // EVIA-specific: Error handling
  const [errorToast, setErrorToast] = useState<{message: string, canRetry: boolean} | null>(null);
  const [isLoadingFirstToken, setIsLoadingFirstToken] = useState(false);
  const errorToastTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastPromptRef = useRef<string>('');

  // 🔧 SESSION STATE: Track current session state for context-aware responses
  // Values: 'before' (pre-call), 'during' (active call), 'after' (post-call)
  // Synced from EviaBar via IPC, with localStorage as backup for initial state
  const [sessionState, setSessionState] = useState<'before' | 'during' | 'after'>(() => {
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

  // 🔥 GLASS PARITY: RAF-throttled ResizeObserver (not time-based debounce)
  // Glass uses requestAnimationFrame to throttle measurements (at most once per frame)
  // CRITICAL: Final measurement happens in onDone(), this is just for live updates
  useEffect(() => {
    const container = document.querySelector('.ask-container');
    if (!container) return;

    let rafThrottled = false;

    resizeObserverRef.current = new ResizeObserver(entries => {
      // 🔥 GLASS PATTERN: RAF throttling prevents measurement spam
      if (rafThrottled) return;
      
      rafThrottled = true;
      requestAnimationFrame(() => {
        for (const entry of entries) {
          const current = window.innerHeight;
          const contentChanged = isStreaming || response !== lastResponseRef.current;
          
          if (contentChanged && isStreaming) {
            // CASE 1: During streaming - light measurement for overflow prevention only
            // Don't try to be perfect here - final measurement happens in onDone()
            const container = entry.target as HTMLElement;
            const needed = Math.ceil(container.scrollHeight);
            const delta = Math.abs(needed - current);
            
            // Only resize if grossly wrong (>50px off) - prevents jitter
            if (delta > 50) {
              const targetHeight = needed + 5;
              requestWindowResize(targetHeight);
              console.log('[AskView] 📏 Live adjustment (streaming): %dpx → %dpx (large delta: %dpx)', 
                current, targetHeight, delta);
            }
          } else if (storedContentHeightRef.current && Math.abs(current - storedContentHeightRef.current) > 5) {
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
  }, [isStreaming, response]);

  // Glass parity: Auto-scroll to bottom during streaming
  useEffect(() => {
    if (responseContainerRef.current && isStreaming) {
      responseContainerRef.current.scrollTop = responseContainerRef.current.scrollHeight;
    }
  }, [response, isStreaming]);

  // 🔧 UI IMPROVEMENT: Update lastResponseRef when streaming completes
  // This allows ResizeObserver to know when content has actually changed vs just window moving
  useEffect(() => {
    if (!isStreaming && response) {
      // Streaming just completed - update the reference
      lastResponseRef.current = response;
      console.log('[AskView] 📝 Response complete, saved for resize detection');
    }
  }, [isStreaming, response]);

  // 🔧 GLASS PARITY FIX: Listen for single-step IPC send-and-submit (from ListenView insight clicks)
  useEffect(() => {
    const eviaIpc = (window as any).evia?.ipc;
    if (!eviaIpc) {
      console.warn('[AskView] ⚠️ IPC bridge not available for cross-window communication');
      return;
    }

    const handleSendAndSubmit = (incomingPrompt: string) => {
      console.log('[AskView] 📥 Received send-and-submit via IPC:', incomingPrompt.substring(0, 50));
      setPrompt(incomingPrompt);
      setShowTextInput(true);
      // Auto-submit after state updates (next tick)
      setTimeout(() => {
        startStream(false, incomingPrompt);
      }, 50);
    };

    // 🔧 FIX #27: Clear response when session FULLY closes (Fertig pressed, not just Stopp)
    const handleSessionClosed = () => {
      console.log('[AskView] 🛑 Session closed (Fertig pressed) - clearing all state');
      setResponse('');
      setCurrentQuestion('');
      setPrompt('');
      setIsStreaming(false);
      setHasFirstDelta(false);
      setTtftMs(null);
      setErrorToast(null);
      // Window will be hidden by EviaBar, no need to resize
    };

    // 🔧 DESKTOP SENTINEL: Abort streaming if language toggle occurs
    const handleAbortStream = () => {
      console.log('[AskView] 🛑 Received abort-ask-stream - stopping stream');
      if (streamRef.current?.abort) {
        streamRef.current.abort();
        streamRef.current = null;
      }
      setIsStreaming(false);
      setIsLoadingFirstToken(false);
      console.log('[AskView] ✅ Stream aborted due to language toggle');
    };

    // 🔧 FIX: Clear session on language change (clears question, response, etc.)
    const handleClearSession = () => {
      console.log('[AskView] 🧹 Received clear-session - clearing all state (language change or session end)');
      // Abort any active stream first
      if (streamRef.current?.abort) {
        streamRef.current.abort();
        streamRef.current = null;
      }
      // Clear all state
      setResponse('');
      setCurrentQuestion('');
      setPrompt('');
      setIsStreaming(false);
      setHasFirstDelta(false);
      setTtftMs(null);
      setErrorToast(null);
      setIsLoadingFirstToken(false);
      lastResponseRef.current = '';  // Clear resize tracking
      storedContentHeightRef.current = null;  // Clear stored height for fresh recalculation
      console.log('[AskView] ✅ Session cleared');
    };

    // 🔧 SESSION STATE: Listen for session state changes from EviaBar
    const handleSessionStateChanged = (newState: 'before' | 'during' | 'after') => {
      console.log('[AskView] 🎯 Session state changed:', newState);
      setSessionState(newState);
    };

    // 🔧 FIX: Clear state on language change (fixes Test 3 failure)
    const handleLanguageChanged = (newLang: string) => {
      console.log('[AskView] 🌐 Language changed to', newLang, '- clearing all state');
      // Abort any active stream first
      if (streamRef.current?.abort) {
        streamRef.current.abort();
        streamRef.current = null;
      }
      // Clear all state (same as clear-session)
      setResponse('');
      setCurrentQuestion('');
      setPrompt('');
      setIsStreaming(false);
      setIsLoadingFirstToken(false);
      lastResponseRef.current = '';
      storedContentHeightRef.current = null;  // Clear stored height for fresh recalculation
      console.log('[AskView] ✅ State cleared due to language change');
    };

    eviaIpc.on('ask:send-and-submit', handleSendAndSubmit);
    eviaIpc.on('session:closed', handleSessionClosed);
    eviaIpc.on('abort-ask-stream', handleAbortStream);
    eviaIpc.on('clear-session', handleClearSession);  // 🔧 NEW: Listen for clear-session
    eviaIpc.on('session-state-changed', handleSessionStateChanged);
    eviaIpc.on('language-changed', handleLanguageChanged);  // 🔧 FIX: Listen for language-changed
    console.log('[AskView] ✅ IPC listeners registered (send-and-submit, session:closed, abort-ask-stream, clear-session, session-state-changed, language-changed)');

    return () => {
      eviaIpc.off('ask:send-and-submit', handleSendAndSubmit);
      eviaIpc.off('session:closed', handleSessionClosed);
      eviaIpc.off('abort-ask-stream', handleAbortStream);
      eviaIpc.off('clear-session', handleClearSession);
      eviaIpc.off('session-state-changed', handleSessionStateChanged);
      eviaIpc.off('language-changed', handleLanguageChanged);
      console.log('[AskView] 🧹 Cleaning up IPC listeners');
    };
  }, []);

  // 🔧 UI IMPROVEMENT: Auto-focus input when window becomes visible
  useEffect(() => {
    // Helper function to focus with retry (fixes Test 4 failure)
    const focusInputWithRetry = () => {
      if (!inputRef.current) return;
      
      requestAnimationFrame(() => {
        setTimeout(() => {
          inputRef.current?.focus();
          console.log('[AskView] ⌨️ Auto-focused input (attempt 1)');
          
          // Verify focus worked - if not, retry once
          setTimeout(() => {
            if (document.activeElement !== inputRef.current && inputRef.current) {
              console.warn('[AskView] ⚠️ Focus failed, retrying...');
              inputRef.current.focus();
              console.log('[AskView] ⌨️ Auto-focused input (attempt 2)');
            }
          }, 100);
        }, 200);  // Increased delay from 100ms to 200ms for reliability
      });
    };
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        focusInputWithRetry();
      }
    };

    // Focus on mount
    focusInputWithRetry();

    // Focus when window becomes visible (e.g., reopened via keyboard shortcut)
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // 🔧 FIX #7: Blink header frame red twice to indicate error
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
  
  // EVIA enhancement: Error toast with auto-dismiss
  // 🔧 FIX #6: Map technical errors to user-friendly messages
  const showError = (message: string, canRetry: boolean = false) => {
    console.error('[AskView] 💥 Error:', message);
    
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
      setTimeout(() => startStream(), 100);
    }
  };

  const startStream = async (captureScreenshot: boolean = false, overridePrompt?: string) => {
    // 🔧 FIX: Support override prompt for auto-submit from insights
    const actualPrompt = overridePrompt || prompt;
    if (!actualPrompt.trim() || isStreaming) return;
    
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
    
    // 🔧 FIX: Check token validity before making request
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

    // 🔧 GLASS PARITY: Fetch transcript context for backend
    let transcriptContext = '';
    try {
      const { getChatTranscripts } = await import('../services/websocketService');
      const transcripts = await getChatTranscripts(chatId, token, 30); // Last 30 turns
      
      if (transcripts && transcripts.length > 0) {
        // Format as conversation: "You: ... | Prospect: ..."
        transcriptContext = transcripts
          .map(t => {
            const speaker = t.speaker === 1 ? 'You' : 'Prospect';
            const text = (t.text || '').trim();
            return text ? `${speaker}: ${text}` : null;
          })
          .filter(Boolean)
          .join('\n');
        
        console.log('[AskView] 📄 Fetched transcript context:', transcriptContext.length, 'chars,', transcripts.length, 'entries');
      } else {
        console.log('[AskView] ℹ️ No transcript history yet');
      }
    } catch (e) {
      console.warn('[AskView] ⚠️ Could not fetch transcript (continuing without context):', e);
    }

    // EVIA enhancement: Screenshot capture
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
    lastResponseRef.current = '';  // 🔧 UI IMPROVEMENT: Clear last response ref on new question
    storedContentHeightRef.current = null;  // 🔧 CRITICAL: Clear stored height for new question
    setIsStreaming(true);
    setHasFirstDelta(false);
    setTtftMs(null);
    streamStartTime.current = performance.now();

    console.log('[AskView] 🚀 Starting stream with prompt:', actualPrompt.substring(0, 50));
    console.log('[AskView] 🎯 Session state:', sessionState);

    // 🔧 GLASS PARITY: Pass transcript context to backend
    const handle = streamAsk({ 
      baseUrl, 
      chatId, 
      prompt: actualPrompt, 
      transcript: transcriptContext || undefined,  // Pass transcript for context
      language, 
      sessionState,  // 🔧 NEW: Pass session state for context-aware responses
      token, 
      screenshotRef 
    });
    streamRef.current = handle;

    handle.onDelta((d) => {
      if (isLoadingFirstToken) {
        setIsLoadingFirstToken(false);
        setHeaderText(i18n.t('overlay.ask.aiResponse'));
      }
      
      if (!hasFirstDelta && streamStartTime.current) {
        const ttft = performance.now() - streamStartTime.current;
        setTtftMs(ttft);
        setHasFirstDelta(true);
        console.log('[AskView] ⚡ TTFT:', ttft.toFixed(0), 'ms');
      }
      setResponse((prev) => prev + d);
    });
    
    handle.onDone(() => {
      setIsStreaming(false);
      setIsLoadingFirstToken(false);
      setHeaderText(i18n.t('overlay.ask.aiResponse')); // 🔧 FIX: Ensure header updates when stream completes
      streamRef.current = null;
      console.log('[AskView] ✅ Stream completed');
      
      // 🔥 CRITICAL FIX: Do FINAL measurement after stream completes
      // Glass parity: Measure when done, not during streaming
      // Wait for React to finish rendering + browser to complete layout
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const container = document.querySelector('.ask-container') as HTMLElement;
          if (container) {
            const needed = Math.ceil(container.scrollHeight);
            const current = window.innerHeight;
            const delta = Math.abs(needed - current);
            
            if (delta > 3) {
              const targetHeight = needed + 5;
              storedContentHeightRef.current = targetHeight;
              requestWindowResize(targetHeight);
              console.log('[AskView] 📏 FINAL measurement (stream done): %dpx → %dpx (delta: %dpx)', 
                current, targetHeight, delta);
            } else {
              console.log('[AskView] ✅ Size correct, no adjustment needed:', current, 'px');
            }
          }
        });
      });
    });
    
    handle.onError((e: any) => {
      setIsStreaming(false);
      setIsLoadingFirstToken(false);
      streamRef.current = null;
      setHeaderText(i18n.t('overlay.ask.aiResponse'));
      
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

  const onAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    startStream();
  };

  const onAbort = () => {
    try {
      streamRef.current?.abort();
    } catch {}
    setIsStreaming(false);
    setIsLoadingFirstToken(false);
    streamRef.current = null;
    setHeaderText(i18n.t('overlay.ask.aiResponse'));
  };

  // Glass parity: Copy entire response
  const handleCopy = async () => {
    if (copyState === 'copied' || !response) return;

    // 🔧 FIX #10: Use i18n for clipboard labels (Frage/Question, Antwort/Answer)
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

  // Cmd+Enter for screenshot
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        startStream(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, isStreaming, language]);

  // 🧹 REMOVED: Old two-step IPC pattern useEffect (was lines 350-389)
  // Now using ONLY single-step 'ask:send-and-submit' (lines 85-106) for Glass parity

  // 🔧 FIX #15/#17: Glass-parity window sizing (auto-expand AND auto-detract)
  // Based on Glass AskView.js lines 1407-1428
  const requestWindowResize = (targetHeight: number) => {
    const eviaApi = (window as any).evia;
    if (eviaApi?.windows?.adjustAskHeight) {
      // Glass formula: Math.min(700, idealHeight) - NO minimum when content exists
      const clampedHeight = Math.min(700, targetHeight);
      eviaApi.windows.adjustAskHeight(clampedHeight);
    }
  };

  // 🔧 FIX #41: Simplified manual resize (ResizeObserver is primary, this is fallback for edge cases)
  // Handles initial empty state and visibility changes
  const triggerManualResize = useCallback(() => {
    // Empty state: compact ask bar
    if (!response || response.trim() === '') {
      requestWindowResize(58);
      console.log('[AskView] 📏 Manual resize: compact ask bar (58px)');
      return;
    }
    
    // With content: let ResizeObserver handle it, but trigger a recalc on visibility change
    const container = document.querySelector('.ask-container') as HTMLElement;
    if (container) {
      // 🔧 Use scrollHeight for full content measurement (matches ResizeObserver fix)
      const needed = Math.ceil(container.scrollHeight);
      const current = window.innerHeight;
      const delta = Math.abs(needed - current);
      
      if (delta > 3) {
        requestWindowResize(needed + 5);
        console.log('[AskView] 📏 Manual resize (visibility change): %dpx → %dpx', current, needed + 5);
      }
    }
  }, [response]);

  // Trigger on empty response (collapse to compact bar)
  useEffect(() => {
    if (!response || response.trim() === '') {
      triggerManualResize();
    }
    // ResizeObserver handles non-empty states automatically
  }, [response, triggerManualResize]);

  // 🔧 FIX #41: On visibility change, give ResizeObserver a nudge
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
      const html = marked.parse(text) as string;
      const sanitized = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'b', 'em', 'i',
          'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'table', 'thead',
          'tbody', 'tr', 'th', 'td', 'hr', 'sup', 'sub', 'del', 'ins', 'span',
        ],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'],
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

  return (
    <div className="ask-container">
      {/* EVIA enhancement: Error Toast - Compact Version */}
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
            {ttftMs !== null && (
              <div className="ttft-indicator" style={{ color: ttftMs < 400 ? '#32CD32' : '#FFA500' }}>
                TTFT: {ttftMs.toFixed(0)}ms {ttftMs < 400 ? '✅' : '⚠️'}
              </div>
            )}
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
          <span className="btn-icon">↵</span>
        </button>
      </div>
    </div>
  );
};

export default AskView;
