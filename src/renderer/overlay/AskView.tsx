import React, { useEffect, useRef, useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';
import { streamAsk } from '../lib/evia-ask-stream';
import { i18n } from '../i18n/i18n';

interface AskViewProps {
  language: 'de' | 'en';
  onClose?: () => void;
  onSubmitPrompt?: (prompt: string) => void;
}

const AskView: React.FC<AskViewProps> = ({ language, onClose, onSubmitPrompt }) => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasFirstDelta, setHasFirstDelta] = useState(false);
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  const streamRef = useRef<{ abort: () => void } | null>(null);
  const streamStartTime = useRef<number | null>(null);
  // 🎯 TASK 2: Error handling + loading states
  const [errorToast, setErrorToast] = useState<{message: string, canRetry: boolean} | null>(null);
  const [isLoadingFirstToken, setIsLoadingFirstToken] = useState(false);
  const errorToastTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastPromptRef = useRef<string>(''); // Store last prompt for retry

  // 🎯 TASK 2: Show error toast with auto-dismiss (5 seconds)
  const showError = (message: string, canRetry: boolean = false) => {
    console.error('[AskView] 💥 Error:', message);
    setErrorToast({ message, canRetry });
    
    // Clear any existing timeout
    if (errorToastTimeout.current) {
      clearTimeout(errorToastTimeout.current);
    }
    
    // Auto-dismiss after 5 seconds
    errorToastTimeout.current = setTimeout(() => {
      setErrorToast(null);
    }, 5000);
  };

  // 🎯 TASK 2: Retry last failed request
  const retryLastRequest = () => {
    if (lastPromptRef.current) {
      setPrompt(lastPromptRef.current);
      setErrorToast(null);
      setTimeout(() => startStream(), 100); // Brief delay for state update
    }
  };

  const startStream = async (captureScreenshot: boolean = false) => {
    if (!prompt.trim() || isStreaming) return;
    
    // 🎯 TASK 2: Store prompt for retry and clear any existing errors
    lastPromptRef.current = prompt;
    setErrorToast(null);
    setIsLoadingFirstToken(true); // Start loading spinner
    
    const baseUrl = (window as any).EVIA_BACKEND_URL || (window as any).API_BASE_URL || 'http://localhost:8000';
    
    // 🔐 FIX: Get token from secure keytar storage (not localStorage!)
    console.log('[AskView] Getting auth token from keytar...');
    const eviaAuth = (window as any).evia?.auth as { getToken: () => Promise<string | null> } | undefined;
    const token = await eviaAuth?.getToken();
    if (!token) {
      showError('Authentication required. Please login first.', false);
      setIsLoadingFirstToken(false);
      return;
    }
    console.log('[AskView] ✅ Got auth token (length:', token.length, 'chars)');

    // Ensure there is a chat id; if missing, create a new chat
    let chatId = Number(localStorage.getItem('current_chat_id') || '0');
    if (!chatId || Number.isNaN(chatId)) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        
        // 🎯 TASK 2: Handle auth errors specifically
        if (res.status === 401) {
          showError('Authentication expired. Please reconnect.', true);
          setIsLoadingFirstToken(false);
          return;
        }
        
        if (!res.ok) {
          showError(`Failed to create chat session (HTTP ${res.status}). Reconnect?`, true);
          setIsLoadingFirstToken(false);
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
          return;
        }
      } catch (e: any) {
        // 🎯 TASK 2: Network errors
        const isNetworkError = e.message?.includes('fetch') || e.message?.includes('network');
        showError(
          isNetworkError 
            ? 'Network error. Check connection and reconnect?' 
            : 'Failed to create chat session. Reconnect?',
          true
        );
        setIsLoadingFirstToken(false);
        return;
      }
    }

    // 🎯 TASK 3: Capture screenshot if requested (Cmd+Enter or explicit call)
    let screenshotRef: string | undefined;
    if (captureScreenshot) {
      try {
        const result = await (window as any).evia?.capture?.takeScreenshot?.();
        
        if (result?.ok && result?.base64) {
          screenshotRef = result.base64;
          console.log('[AskView] 📸 Screenshot captured:', result.width, 'x', result.height, 'Base64 length:', result.base64.length);
        } else if (result?.needsPermission) {
          // 🔒 TASK 3: Handle permission denial
          showError(result.error || 'Screen Recording permission required. Please grant in System Preferences.', false);
          setIsLoadingFirstToken(false);
          return;
        } else {
          console.warn('[AskView] Screenshot capture failed:', result?.error);
          // Continue without screenshot - user can retry
        }
      } catch (err: any) {
        console.error('[AskView] Screenshot capture error:', err);
        // Continue without screenshot
      }
    }

    if (onSubmitPrompt) onSubmitPrompt(prompt);

    setResponse('');
    setIsStreaming(true);
    setHasFirstDelta(false);
    setTtftMs(null);
    streamStartTime.current = performance.now();

    console.log('[AskView] 🚀 Starting stream at', streamStartTime.current);

    const handle = streamAsk({ baseUrl, chatId, prompt, language, token, screenshotRef });
    streamRef.current = handle;

    handle.onDelta((d) => {
      // 🎯 TASK 2: Clear loading spinner on first token
      if (isLoadingFirstToken) {
        setIsLoadingFirstToken(false);
      }
      
      if (!hasFirstDelta && streamStartTime.current) {
        const ttft = performance.now() - streamStartTime.current;
        setTtftMs(ttft);
        setHasFirstDelta(true);
        console.log('[AskView] ⚡ TTFT:', ttft.toFixed(0), 'ms', ttft < 400 ? '✅' : '⚠️');
      }
      setResponse((prev) => prev + d);
    });
    handle.onDone(() => {
      setIsStreaming(false);
      setIsLoadingFirstToken(false);
      streamRef.current = null;
      console.log('[AskView] ✅ Stream completed');
    });
    handle.onError((e: any) => {
      setIsStreaming(false);
      setIsLoadingFirstToken(false);
      streamRef.current = null;
      
      // 🎯 TASK 2: Enhanced error handling with specific messages
      console.error('[AskView] ❌ Stream error:', e);
      
      const errorMsg = e?.message || String(e);
      const is401 = errorMsg.includes('401') || errorMsg.includes('Unauthorized');
      const isNetwork = errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('Failed to');
      
      if (is401) {
        showError('Authentication expired. Please reconnect.', true);
      } else if (isNetwork) {
        showError('Network connection lost. Reconnect?', true);
      } else if (errorMsg.includes('aborted')) {
        // User-initiated abort, no error needed
        console.log('[AskView] Stream aborted by user');
      } else {
        showError(`Request failed: ${errorMsg.substring(0, 50)}. Reconnect?`, true);
      }
    });

    setPrompt('');
  };

  const onAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    startStream();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        // Glass parity: Cmd+Enter captures screenshot
        startStream(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, isStreaming, language]);

  // Glass parity: IPC listener for insights → Ask prompt relay
  useEffect(() => {
    if (!(window as any).evia?.ipc) return;
    
    const handleSetPrompt = (receivedPrompt: string) => {
      console.log('[AskView] 📨 Received prompt via IPC:', receivedPrompt.substring(0, 50));
      setPrompt(receivedPrompt);
      // Auto-focus input
      setTimeout(() => {
        const input = document.querySelector('#textInput') as HTMLInputElement;
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }, 100);
    };

    (window as any).evia.ipc.on('ask:set-prompt', handleSetPrompt);
    
    // Note: Electron IPC doesn't provide removeListener easily, 
    // but since this is a singleton Ask window, it's acceptable
    return () => {
      console.log('[AskView] Cleaning up IPC listener');
    };
  }, []);

  const onAbort = () => {
    try {
      streamRef.current?.abort();
    } catch {}
    setIsStreaming(false);
    streamRef.current = null;
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '20px' }}>
      {/* 🎯 TASK 2: Error Toast with Reconnect button */}
      {errorToast && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          background: 'rgba(255, 59, 48, 0.95)',
          color: 'white',
          padding: '12px 20px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '13px',
          fontFamily: "'Helvetica Neue', sans-serif",
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          animation: 'slideDown 0.3s ease',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{errorToast.message}</span>
          {errorToast.canRetry && (
            <button
              onClick={retryLastRequest}
              style={{
                padding: '4px 12px',
                background: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: '500',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)')}
            >
              Reconnect
            </button>
          )}
          <button
            onClick={() => setErrorToast(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.8)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1L9 9M9 1L1 9" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
      
      {/* Close button - Glass parity */}
      <button 
        className="close-button" 
        onClick={() => (window as any).evia?.closeWindow?.('ask')}
        title="Close"
        style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 100 }}
      >
        <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>

      {/* Response display area - Glass parity */}
      {(response || isStreaming) && (
        <div style={{
          width: '800px',
          maxWidth: '90%',
          maxHeight: '60vh',
          overflowY: 'auto',
          background: 'rgba(0, 0, 0, 0.65)',
          borderRadius: '12px',
          padding: '16px',
          border: '1px solid rgba(255, 255, 255, 0.2)',
        }}>
          {/* 🎯 TASK 2: Spinner while waiting for first token */}
          {isLoadingFirstToken && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'rgba(255, 255, 255, 0.7)' }}>
              <div style={{
                width: '16px',
                height: '16px',
                border: '2px solid rgba(255, 255, 255, 0.3)',
                borderTopColor: 'white',
                borderRadius: '50%',
                animation: 'spin 0.6s linear infinite',
              }} />
              <span style={{ fontSize: '13px', fontFamily: "'Helvetica Neue', sans-serif" }}>Thinking...</span>
            </div>
          )}

          {/* Response text with line breaks */}
          {response && (
            <div style={{
              color: 'rgba(255, 255, 255, 0.95)',
              fontSize: '14px',
              fontFamily: "'Helvetica Neue', sans-serif",
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
            }}>
              {response}
            </div>
          )}

          {/* TTFT indicator */}
          {ttftMs !== null && (
            <div style={{
              marginTop: '12px',
              fontSize: '11px',
              color: ttftMs < 400 ? 'rgba(50, 205, 50, 0.8)' : 'rgba(255, 165, 0, 0.8)',
              fontFamily: 'monospace',
            }}>
              TTFT: {ttftMs.toFixed(0)}ms {ttftMs < 400 ? '✅' : '⚠️'}
            </div>
          )}

          {/* Abort button */}
          {isStreaming && (
            <button
              onClick={onAbort}
              style={{
                marginTop: '12px',
                padding: '6px 12px',
                background: 'rgba(255, 59, 48, 0.8)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontFamily: "'Helvetica Neue', sans-serif",
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 59, 48, 1)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 59, 48, 0.8)')}
            >
              Abort
            </button>
          )}
        </div>
      )}

      {/* Input form */}
      <form
        onSubmit={onAsk}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          background: 'rgba(0, 0, 0, 0.65)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '600px',
          border: '1px solid rgba(255, 255, 255, 0.2)',
        }}
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={i18n.t('overlay.ask.placeholder')}
          id="textInput"
          disabled={isStreaming}
          style={{
            flex: 1,
            padding: '10px 14px',
            background: 'rgba(0, 0, 0, 0.45)',
            borderRadius: '12px',
            outline: 'none',
            border: 'none',
            color: 'rgba(255, 255, 255, 0.97)',
            fontSize: '14px',
            fontFamily: "'Helvetica Neue', sans-serif",
            fontWeight: 400,
            opacity: isStreaming ? 0.5 : 1,
          }}
        />
        <button
          type="submit"
          disabled={isStreaming || !prompt.trim()}
          className="submit-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'transparent',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            fontFamily: "'Helvetica Neue', sans-serif",
            fontWeight: 500,
            cursor: (isStreaming || !prompt.trim()) ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
            height: '32px',
            padding: '0 10px',
            marginLeft: '8px',
            opacity: (isStreaming || !prompt.trim()) ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isStreaming && prompt.trim()) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
            }
          }}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ marginRight: '8px', display: 'flex', alignItems: 'center', height: '100%' }}>{i18n.t('overlay.ask.submit')}</span>
          <span
            style={{
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '13%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '18px',
              height: '18px',
            }}
          >
            ↵
          </span>
        </button>
      </form>

      {/* Spinner and Toast keyframes */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @keyframes slideDown {
          from { 
            opacity: 0;
            transform: translate(-50%, -20px);
          }
          to { 
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>
    </div>
  );
};

export default AskView;