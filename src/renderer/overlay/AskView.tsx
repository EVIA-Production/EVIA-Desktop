import React, { useEffect, useRef, useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';
import { streamAsk } from '../lib/evia-ask-stream';

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
  const streamRef = useRef<{ abort: () => void } | null>(null);

  const startStream = async () => {
    if (!prompt.trim() || isStreaming) return;
    const baseUrl = (window as any).EVIA_BACKEND_URL || (window as any).API_BASE_URL || 'http://localhost:8000';
    const token = localStorage.getItem('auth_token') || '';
    if (!token) { setResponse('Missing auth.'); return }

    // Ensure there is a chat id; if missing, create a new chat
    let chatId = Number(localStorage.getItem('current_chat_id') || '0');
    if (!chatId || Number.isNaN(chatId)) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        chatId = Number(data?.id);
        if (chatId && !Number.isNaN(chatId)) {
          try { localStorage.setItem('current_chat_id', String(chatId)) } catch {}
        } else {
          throw new Error('Invalid chat id');
        }
      } catch (e) {
        setResponse('Failed to create chat.');
        return;
      }
    }

    if (onSubmitPrompt) onSubmitPrompt(prompt);

    setResponse('');
    setIsStreaming(true);
    setHasFirstDelta(false);

    const handle = streamAsk({ baseUrl, chatId, prompt, language, token });
    streamRef.current = handle;

    handle.onDelta((d) => {
      if (!hasFirstDelta) setHasFirstDelta(true);
      setResponse((prev) => prev + d);
    });
    handle.onDone(() => {
      setIsStreaming(false);
      streamRef.current = null;
    });
    handle.onError((_e) => {
      setIsStreaming(false);
      streamRef.current = null;
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
        startStream();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, isStreaming, language]);

  const onAbort = () => {
    try { streamRef.current?.abort() } catch {}
    setIsStreaming(false);
    streamRef.current = null;
  };

  return (
    <div className="glass-panel evia-glass" style={{ pointerEvents: 'auto' }}>
      <div className="glass-topbar drag-zone">
        <div className="glass-topbar-title">Ask</div>
        {onClose && (
          <button className="glass-button" onClick={onClose}>✕</button>
        )}
      </div>
      <div className="glass-scroll no-drag">
        <form onSubmit={onAsk}>
          <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Type your question..." className="ask-input" />
          <button type="submit" className="ask-button" disabled={isStreaming}>Ask</button>
          <button type="button" className="ask-button" onClick={onAbort} disabled={!isStreaming}>Abort</button>
        </form>
        <div className="response-area">
          {isStreaming && !hasFirstDelta ? (
            <span className="text-sm" style={{ opacity: 0.7 }}>Waiting for first tokens…</span>
          ) : null}
          {response}
        </div>
      </div>
    </div>
  );
};

export default AskView;
