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
    if (!token) {
      setResponse('Missing auth.');
      return;
    }

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
    try {
      streamRef.current?.abort();
    } catch {}
    setIsStreaming(false);
    streamRef.current = null;
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Close button - Glass parity */}
      <button 
        className="close-button" 
        onClick={() => (window as any).evia?.closeWindow?.('ask')}
        title="Close"
      >
        <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <form
        onSubmit={onAsk}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          background: 'rgba(0, 0, 0, 0.65)', // Slightly lighter background
          borderRadius: '12px',
          width: '800px',
          maxWidth: '90%',
          margin: '0 auto',
          border: '1px solid rgba(255, 255, 255, 0.2)', // Slightly more visible border
        }}
      >
      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask about your screen or audio"
        id="textInput"
        style={{
          flex: 1,
          padding: '10px 14px',
          background: 'rgba(0, 0, 0, 0.45)', // Slightly lighter input background
          borderRadius: '12px',
          outline: 'none',
          border: 'none',
          color: 'rgba(255, 255, 255, 0.97)', // Slightly brighter text color
          fontSize: '14px',
          fontFamily: "'Helvetica Neue', sans-serif",
          fontWeight: 400,
        }}
      />
      <button
        type="submit"
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.2)', // Slightly lighter button background
          color: 'rgba(255, 255, 255, 0.97)', // Slightly brighter text color
          border: 'none',
          borderRadius: '6px',
          fontSize: '13px',
          fontFamily: "'Helvetica Neue', sans-serif",
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'background 0.15s',
          height: '40px',
          padding: '0 16px',
        }}
      >
        <span style={{ marginRight: '8px' }}>Submit</span>
        <span
          style={{
            background: 'rgba(255,255,255,0.3)', // Slightly lighter icon background
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
    </div>
  );
};

export default AskView;