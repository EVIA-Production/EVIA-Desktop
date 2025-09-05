import React, { useState, useEffect } from 'react';

interface SimpleListenViewProps {
  isListening: boolean;
  language: 'de' | 'en';
  onClose: () => void;
}

interface TranscriptSegment {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  is_final: boolean;
}

export const SimpleListenView: React.FC<SimpleListenViewProps> = ({
  isListening,
  language,
  onClose
}) => {
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);

  // Mock transcript data
  useEffect(() => {
    if (isListening) {
      const interval = setInterval(() => {
        const newSegment: TranscriptSegment = {
          id: Date.now().toString(),
          speaker: 'Speaker 1',
          text: language === 'de' 
            ? 'Das ist ein Test der Live-Transkription auf Deutsch.'
            : 'This is a test of live transcription in English.',
          timestamp: Date.now(),
          is_final: true
        };
        setTranscript(prev => [...prev, newSegment]);
      }, 3000);

      return () => clearInterval(interval);
    }
  }, [isListening, language]);

  const getSpeakerColor = (speaker: string) => {
    const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500'];
    const index = speaker.charCodeAt(0) % colors.length;
    return colors[index];
  };

  return (
    <div className="glass-window glass-overlay w-96 h-80 p-4 rounded-lg shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">
          {language === 'de' ? 'Live Transkription' : 'Live Transcription'}
        </h2>
        <button
          onClick={onClose}
          className="text-white/60 hover:text-white text-xl"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto mb-4 space-y-3">
        {transcript.length === 0 ? (
          <div className="text-center text-white/60 py-8">
            <p>🎤 {language === 'de' ? 'Noch keine Transkription' : 'No transcription yet'}</p>
            <p className="text-sm">
              {language === 'de' 
                ? 'Starte das Zuhören um Live-Transkription zu sehen'
                : 'Start listening to see live transcription'
              }
            </p>
          </div>
        ) : (
          transcript.map((segment) => (
            <div
              key={segment.id}
              className={`p-3 rounded-lg bg-white/10 border border-white/20 ${
                segment.is_final ? 'opacity-100' : 'opacity-80'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white ${getSpeakerColor(segment.speaker)}`}>
                  {segment.speaker.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-white/80">
                      {segment.speaker}
                    </span>
                    {!segment.is_final && (
                      <div className="flex space-x-1">
                        <div className="w-1 h-1 bg-white/60 rounded-full animate-pulse"></div>
                        <div className="w-1 h-1 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                        <div className="w-1 h-1 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                      </div>
                    )}
                  </div>
                  <p className={`text-white ${segment.is_final ? '' : 'opacity-80'}`}>
                    {segment.text}
                  </p>
                  <span className="text-xs text-white/50 mt-1">
                    {new Date(segment.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-3 py-1 rounded text-xs ${
              autoScroll ? 'bg-white/20 text-white' : 'bg-white/10 text-white/60'
            }`}
          >
            {language === 'de' ? 'Auto-Scroll' : 'Auto-Scroll'}
          </button>
          <button
            onClick={() => setTranscript([])}
            className="px-3 py-1 rounded text-xs bg-white/10 text-white/60 hover:bg-white/20"
          >
            {language === 'de' ? 'Löschen' : 'Clear'}
          </button>
        </div>
        <button
          onClick={() => {/* Toggle listening */}}
          className={`px-4 py-2 rounded-md font-medium transition-colors ${
            isListening
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {isListening ? '⏹️ Stop' : '▶️ Start'}
        </button>
      </div>
    </div>
  );
};

export default SimpleListenView;
