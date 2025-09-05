import React, { useState, useEffect, useRef } from 'react';
import { X, ArrowDown, User, Bot } from 'lucide-react';

interface ListenViewProps {
  isListening: boolean;
  language: 'de' | 'en';
  onClose: () => void;
}

interface TranscriptSegment {
  id: string;
  text: string;
  speaker: 'user' | 'assistant';
  timestamp: string;
  confidence: number;
}

const ListenView: React.FC<ListenViewProps> = ({
  isListening,
  language,
  onClose
}) => {
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new transcript segments arrive
  useEffect(() => {
    if (isAutoScroll && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [transcript, isAutoScroll]);

  // Mock transcript generation
  useEffect(() => {
    if (!isListening) return;

    const interval = setInterval(() => {
      const newSegment: TranscriptSegment = {
        id: Date.now().toString(),
        text: language === 'de' 
          ? `Das ist ein Test-Transkript Segment ${transcript.length + 1}`
          : `This is a test transcript segment ${transcript.length + 1}`,
        speaker: transcript.length % 2 === 0 ? 'user' : 'assistant',
        timestamp: new Date().toLocaleTimeString(),
        confidence: 0.95
      };
      
      setTranscript(prev => [...prev, newSegment]);
    }, 3000);

    return () => clearInterval(interval);
  }, [isListening, transcript.length, language]);

  const handleJumpToLatest = () => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
      setIsAutoScroll(true);
    }
  };

  const handleScroll = () => {
    if (scrollAreaRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollAreaRef.current;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;
      setIsAutoScroll(isAtBottom);
    }
  };

  return (
    <div
      style={{
        width: '400px',
        height: '500px',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isListening ? '#ef4444' : '#6b7280'
            }}
          />
          <span style={{ color: 'white', fontWeight: '600' }}>
            {language === 'de' ? 'Live Transkription' : 'Live Transcription'}
          </span>
        </div>
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

      {/* Transcript Area */}
      <div
        ref={scrollAreaRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        {transcript.length === 0 ? (
          <div
            style={{
              color: 'rgba(255, 255, 255, 0.6)',
              textAlign: 'center',
              padding: '40px 20px',
              fontSize: '14px'
            }}
          >
            {language === 'de' 
              ? 'Warte auf Audio...' 
              : 'Waiting for audio...'}
          </div>
        ) : (
          transcript.map((segment) => (
            <div
              key={segment.id}
              style={{
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start'
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: segment.speaker === 'user' ? '#3b82f6' : '#10b981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                {segment.speaker === 'user' ? (
                  <User size={16} color="white" />
                ) : (
                  <Bot size={16} color="white" />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    color: 'white',
                    fontSize: '14px',
                    lineHeight: '1.5',
                    marginBottom: '4px'
                  }}
                >
                  {segment.text}
                </div>
                <div
                  style={{
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontSize: '12px'
                  }}
                >
                  {segment.timestamp} • {Math.round(segment.confidence * 100)}%
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '12px' }}>
          {transcript.length} {language === 'de' ? 'Segmente' : 'segments'}
        </div>
        {!isAutoScroll && (
          <button
            onClick={handleJumpToLatest}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px'
            }}
          >
            <ArrowDown size={14} />
            {language === 'de' ? 'Zum Neuesten' : 'Jump to Latest'}
          </button>
        )}
      </div>
    </div>
  );
};

export { ListenView };
export default ListenView;
