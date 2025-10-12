import React, { useEffect, useRef, useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';
import { streamAsk } from '../lib/evia-ask-stream';
import { i18n } from '../i18n/i18n';
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

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
  const [headerText, setHeaderText] = useState('AI Response');
  
  const streamRef = useRef<{ abort: () => void } | null>(null);
  const streamStartTime = useRef<number | null>(null);
  const responseContainerRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // EVIA-specific: Error handling
  const [errorToast, setErrorToast] = useState<{message: string, canRetry: boolean} | null>(null);
  const [isLoadingFirstToken, setIsLoadingFirstToken] = useState(false);
  const errorToastTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastPromptRef = useRef<string>('');

  // Configure marked for syntax highlighting
  useEffect(() => {
    marked.setOptions({
      breaks: true,
      gfm: true,
    } as any);
    
    // Note: marked v9+ uses marked.use() for extensions, but we'll highlight after render
  }, []);

  // Glass parity: ResizeObserver for dynamic window height
  useEffect(() => {
    const container = document.querySelector('.ask-container');
    if (!container) return;

    resizeObserverRef.current = new ResizeObserver(entries => {
      for (const entry of entries) {
        const needed = Math.ceil(entry.contentRect.height);
        const current = window.innerHeight;
        
        // 🔧 FIX: Always resize to match content (allow both grow and shrink)
        const delta = Math.abs(needed - current);
        if (delta > 10) {  // Only resize if difference > 10px to avoid jitter
          requestWindowResize(needed + 20);  // Add 20px padding for scrollbar
          console.log('[AskView] 📏 Resizing window:', current, '→', needed + 20);
        }
      }
    });

    resizeObserverRef.current.observe(container);

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, []);

  // Glass parity: Auto-scroll to bottom during streaming
  useEffect(() => {
    if (responseContainerRef.current && isStreaming) {
      responseContainerRef.current.scrollTop = responseContainerRef.current.scrollHeight;
    }
  }, [response, isStreaming]);

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

    eviaIpc.on('ask:send-and-submit', handleSendAndSubmit);
    console.log('[AskView] ✅ IPC listener registered for ask:send-and-submit');

    return () => {
      console.log('[AskView] 🧹 Cleaning up IPC listener');
    };
  }, []);

  // EVIA enhancement: Error toast with auto-dismiss
  const showError = (message: string, canRetry: boolean = false) => {
    console.error('[AskView] 💥 Error:', message);
    setErrorToast({ message, canRetry });
    
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
    setHeaderText('Thinking...');
    
    const baseUrl = (window as any).EVIA_BACKEND_URL || (window as any).API_BASE_URL || 'http://localhost:8000';
    
    console.log('[AskView] Getting auth token from keytar...');
    const eviaAuth = (window as any).evia?.auth as { getToken: () => Promise<string | null> } | undefined;
    const token = await eviaAuth?.getToken();
    if (!token) {
      showError('Authentication required. Please login first.', false);
      setIsLoadingFirstToken(false);
      setHeaderText('AI Response');
      return;
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
          setHeaderText('AI Response');
          return;
        }
        
        if (!res.ok) {
          showError(`Failed to create chat session (HTTP ${res.status}). Reconnect?`, true);
          setIsLoadingFirstToken(false);
          setHeaderText('AI Response');
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
          setHeaderText('AI Response');
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
        setHeaderText('AI Response');
        return;
      }
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
          setHeaderText('AI Response');
          return;
        }
      } catch (err: any) {
        console.error('[AskView] Screenshot capture error:', err);
      }
    }

    if (onSubmitPrompt) onSubmitPrompt(prompt);

    setResponse('');
    setIsStreaming(true);
    setHasFirstDelta(false);
    setTtftMs(null);
    streamStartTime.current = performance.now();

    console.log('[AskView] 🚀 Starting stream with prompt:', actualPrompt.substring(0, 50));

    const handle = streamAsk({ baseUrl, chatId, prompt: actualPrompt, language, token, screenshotRef });
    streamRef.current = handle;

    handle.onDelta((d) => {
      if (isLoadingFirstToken) {
        setIsLoadingFirstToken(false);
        setHeaderText('AI Response');
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
      setHeaderText('AI Response'); // 🔧 FIX: Ensure header updates when stream completes
      streamRef.current = null;
      console.log('[AskView] ✅ Stream completed');
    });
    
    handle.onError((e: any) => {
      setIsStreaming(false);
      setIsLoadingFirstToken(false);
      streamRef.current = null;
      setHeaderText('AI Response');
      
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
    setHeaderText('AI Response');
  };

  // Glass parity: Copy entire response
  const handleCopy = async () => {
    if (copyState === 'copied' || !response) return;

    const textToCopy = `Question: ${currentQuestion}\n\nAnswer: ${response}`;

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

  // Glass parity: IPC prompt relay from insights
  useEffect(() => {
    if (!(window as any).evia?.ipc) return;
    
    // Store the received prompt in a ref to avoid React state timing issues
    const pendingPromptRef = { current: '' };
    
    const handleSetPrompt = (receivedPrompt: string) => {
      console.log('[AskView] 📨 Received prompt via IPC:', receivedPrompt.substring(0, 50));
      pendingPromptRef.current = receivedPrompt;
      setPrompt(receivedPrompt);
      setTimeout(() => {
        const input = document.querySelector('#textInput') as HTMLInputElement;
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }, 100);
    };

    // 🔧 FIX: Handle auto-submit from insights click with override prompt
    const handleSubmitPrompt = () => {
      console.log('[AskView] 📨 Received submit-prompt via IPC - auto-submitting with:', pendingPromptRef.current.substring(0, 50));
      if (pendingPromptRef.current) {
        startStream(false, pendingPromptRef.current);
      } else {
        console.warn('[AskView] ⚠️ No pending prompt, calling startStream with state');
        startStream();
      }
    };

    (window as any).evia.ipc.on('ask:set-prompt', handleSetPrompt);
    (window as any).evia.ipc.on('ask:submit-prompt', handleSubmitPrompt);
    
    return () => {
      console.log('[AskView] Cleaning up IPC listeners');
    };
  }, [startStream]);

  // Glass parity: Request window resize via IPC
  const requestWindowResize = (targetHeight: number) => {
    const eviaApi = (window as any).evia;
    if (eviaApi?.windows?.adjustAskHeight) {
      // 🔧 FIX: Min height 450px for better UX, max 700px
      const clampedHeight = Math.max(450, Math.min(700, targetHeight));
      eviaApi.windows.adjustAskHeight(clampedHeight);
    }
  };

  // 🔧 FIX: Set initial window height to 450px on mount for better UX
  useEffect(() => {
    requestWindowResize(450);
    console.log('[AskView] Set initial window height to 450px');
  }, []);

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
      {/* EVIA enhancement: Error Toast */}
      {errorToast && (
        <div className="error-toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{errorToast.message}</span>
          {errorToast.canRetry && (
            <button onClick={retryLastRequest} className="retry-button">
              Reconnect
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
