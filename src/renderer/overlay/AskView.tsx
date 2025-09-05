import React, { useState, useEffect } from 'react';
import { X, Send, Loader2, Copy, Check } from 'lucide-react';

interface AskViewProps {
  language: 'de' | 'en';
  onClose: () => void;
}

interface AIAnswer {
  answer: string;
  citations: string[];
  latency: number;
}

const AskView: React.FC<AskViewProps> = ({
  language,
  onClose
}) => {
  const [prompt, setPrompt] = useState('');
  const [aiAnswer, setAiAnswer] = useState<AIAnswer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);
    setAiAnswer(null);

    try {
      // Mock API call - replace with real backend integration
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const mockAnswer: AIAnswer = {
        answer: language === 'de' 
          ? `Das ist eine KI-Antwort auf: "${prompt}". Die Antwort wurde generiert und enthält relevante Informationen zu deiner Frage.`
          : `This is an AI answer to: "${prompt}". The answer was generated and contains relevant information about your question.`,
        citations: [
          'https://example.com/source1',
          'https://example.com/source2'
        ],
        latency: 1200
      };

      setAiAnswer(mockAnswer);
    } catch (error) {
      console.error('Error getting AI answer:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (aiAnswer) {
      await navigator.clipboard.writeText(aiAnswer.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        width: '500px',
        height: '600px',
        background: 'rgba(0, 0, 0, 0.1)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span style={{ color: 'white', fontWeight: '600' }}>
          {language === 'de' ? 'EVIA Ask' : 'EVIA Ask'}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            padding: '4px'
          }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* AI Answer */}
        {aiAnswer && (
          <div
            style={{
              padding: '16px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              flex: 1,
              overflowY: 'auto'
            }}
          >
            <div
              style={{
                color: 'white',
                fontSize: '14px',
                lineHeight: '1.6',
                marginBottom: '16px'
              }}
            >
              {aiAnswer.answer}
            </div>

            {/* Citations */}
            {aiAnswer.citations.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div
                  style={{
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontSize: '12px',
                    marginBottom: '8px',
                    fontWeight: '600'
                  }}
                >
                  {language === 'de' ? 'Quellen:' : 'Sources:'}
                </div>
                {aiAnswer.citations.map((citation, index) => (
                  <div
                    key={index}
                    style={{
                      color: '#3b82f6',
                      fontSize: '12px',
                      marginBottom: '4px',
                      textDecoration: 'underline',
                      cursor: 'pointer'
                    }}
                    onClick={() => window.open(citation, '_blank')}
                  >
                    {citation}
                  </div>
                ))}
              </div>
            )}

            {/* Copy Button */}
            <button
              onClick={handleCopy}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                color: 'white',
                padding: '8px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px'
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied 
                ? (language === 'de' ? 'Kopiert!' : 'Copied!')
                : (language === 'de' ? 'Kopieren' : 'Copy')
              }
            </button>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div
            style={{
              padding: '40px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white'
            }}
          >
            <Loader2 size={32} className="animate-spin" />
            <div style={{ marginTop: '12px', fontSize: '14px' }}>
              {language === 'de' ? 'KI generiert Antwort...' : 'AI generating answer...'}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!aiAnswer && !isLoading && (
          <div
            style={{
              padding: '40px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255, 255, 255, 0.6)',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '16px', marginBottom: '8px' }}>
              {language === 'de' ? 'Frage EVIA' : 'Ask EVIA'}
            </div>
            <div style={{ fontSize: '14px' }}>
              {language === 'de' 
                ? 'Stelle eine Frage und erhalte intelligente Antworten'
                : 'Ask a question and get intelligent answers'
              }
            </div>
          </div>
        )}
      </div>

      {/* Input Form */}
      <div
        style={{
          padding: '16px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)'
        }}
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={language === 'de' ? 'Frage eingeben...' : 'Enter question...'}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              fontSize: '14px'
            }}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!prompt.trim() || isLoading}
            style={{
              padding: '12px',
              borderRadius: '8px',
              border: 'none',
              background: prompt.trim() && !isLoading ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              cursor: prompt.trim() && !isLoading ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
      </div>
    </div>
  );
};

export { AskView };
export default AskView;
