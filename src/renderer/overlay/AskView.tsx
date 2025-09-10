import React, { useEffect, useMemo, useRef, useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

interface AskViewProps {
  language: 'de' | 'en';
  onClose?: () => void;
  onSubmitPrompt?: (prompt: string) => void; // placeholder hook
}

const AskView: React.FC<AskViewProps> = ({ language, onClose, onSubmitPrompt }) => {
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // After answer renders, highlight any code blocks
    if (!scrollRef.current) return;
    const codes = scrollRef.current.querySelectorAll('pre code');
    codes.forEach((el) => {
      try { hljs.highlightElement(el as HTMLElement); } catch {}
    });
  }, [answer]);

  const rendered = useMemo(() => {
    const html = marked.parse(answer || '') as string; // marked is sync here
    return { __html: DOMPurify.sanitize(html) };
  }, [answer]);

  const onAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setAnswer('');
    setLoading(true);
    try {
      onSubmitPrompt?.(prompt);
      // JSONL streaming from backend /ask (dev wiring)
      const token = window.localStorage.getItem('auth_token');
      const chatId = window.localStorage.getItem('chat_id') || '1';
      const backend = (window as any).EVIA_BACKEND_HTTP || 'http://localhost:8000';
      const resp = await fetch(`${backend}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ chat_id: Number(chatId), prompt, language })
      });
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split(/\n+/)) {
          const s = line.trim();
          if (!s) continue;
          try {
            const obj = JSON.parse(s) as { delta?: string; done?: boolean };
            if (obj.delta) setAnswer(prev => prev + obj.delta);
          } catch {}
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel evia-glass" style={{ width: 560, height: 520, pointerEvents: 'auto' }}>
      <div className="glass-topbar drag-zone">
        <div className="glass-topbar-title">Ask</div>
        <div className="glass-controls no-drag">
          {onClose && (
            <button className="glass-button" onClick={onClose}>✕</button>
          )}
        </div>
      </div>
      <div className="glass-scroll" ref={scrollRef}>
        {answer ? (
          <div dangerouslySetInnerHTML={rendered} />
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.6)', fontStyle: 'italic', padding: 12 }}>
            {loading ? (language === 'de' ? 'Warten auf Antwort…' : 'Waiting for response…') : (language === 'de' ? 'Antwort erscheint hier…' : 'The answer will appear here…')}
          </div>
        )}
      </div>
      <form onSubmit={onAsk} className="no-drag" style={{ display: 'flex', gap: 8, padding: 12 }}>
        <input
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={language === 'de' ? 'Frage eingeben…' : 'Enter question…'}
          style={{ flex: 1, borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: 'var(--text-color)', padding: '10px 12px' }}
        />
        <button type="submit" className="glass-button" style={{ background: 'rgba(255,255,255,0.15)' }}>
          {loading ? (language === 'de' ? 'Senden…' : 'Sending…') : (language === 'de' ? 'Senden' : 'Send')}
        </button>
      </form>
    </div>
  );
};

export default AskView;
