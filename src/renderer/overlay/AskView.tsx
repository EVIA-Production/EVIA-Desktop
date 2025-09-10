import React, { useState } from 'react';
import './overlay-tokens.css';
import './overlay-glass.css';

interface AskViewProps {
  language: 'de' | 'en';
  onClose?: () => void;
  onSubmitPrompt?: (prompt: string) => void;
}

const AskView: React.FC<AskViewProps> = ({ language, onClose, onSubmitPrompt }) => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');

  const onAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmitPrompt) onSubmitPrompt(prompt);
    setResponse('Streaming response...');
    setPrompt('');
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
          <button type="submit" className="ask-button">Ask</button>
        </form>
        <div className="response-area">{response}</div>
      </div>
    </div>
  );
};

export default AskView;
