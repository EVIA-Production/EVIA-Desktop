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
    marked.setOptions({
      highlight(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      }
    });
  }, []);

  const rendered = useMemo(() => {
    const html = marked.parse(answer || '');
    return { __html: DOMPurify.sanitize(html) };
  }, [answer]);

  const onAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setAnswer('');
    setLoading(true);
    try {
      onSubmitPrompt?.(prompt);
      // streaming JSONL will append to setAnswer in future step
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel evia-glass" style={{ width: 560, height: 520 }}>
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
