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

  const startStream = async (captureScreenshot: boolean = false) => {
    if (!prompt.trim() || isStreaming) return;
    const baseUrl = (window as any).EVIA_BACKEND_URL || (window as any).API_BASE_URL || 'http://localhost:8000';
    
    // 🔐 FIX: Get token from secure keytar storage (not localStorage!)
    console.log('[AskView] Getting auth token from keytar...');
    const eviaAuth = (window as any).evia?.auth as { getToken: () => Promise<string | null> } | undefined;
    const token = await eviaAuth?.getToken();
    if (!token) {
      console.error('[AskView] No auth token found. Please login first.');
      setResponse('Missing auth. Please login first.');
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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        chatId = Number(data?.id);
        if (chatId && !Number.isNaN(chatId)) {
          try {
            localStorage.setItem('current_chat_id', String(chatId));
          } catch {}
        } else {
          throw new Error('Invalid chat id');
        }
      } catch (e) {
        setResponse('Failed to create chat.');
        return;
      }
    }

    // Glass parity: Capture screenshot if requested (Cmd+Enter or explicit call)
    let screenshotRef: string | undefined;
    if (captureScreenshot) {
      try {
        const result = await (window as any).evia?.capture?.takeScreenshot?.();
        if (result?.ok && result?.base64) {
          screenshotRef = result.base64;
          console.log('[AskView] 📸 Screenshot captured:', result.width, 'x', result.height);
        }
      } catch (err) {
        console.error('[AskView] Screenshot capture failed:', err);
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
      streamRef.current = null;
      console.log('[AskView] ✅ Stream completed');
    });
    handle.onError((e) => {
      setIsStreaming(false);
      streamRef.current = null;
      console.error('[AskView] ❌ Stream error:', e);
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
          {/* Spinner while waiting for first token */}
          {isStreaming && !hasFirstDelta && (
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
          width: '800px',
          maxWidth: '90%',
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

      {/* Spinner keyframes */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default AskView;