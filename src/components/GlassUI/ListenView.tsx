import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, Volume2, VolumeX, ArrowDown, Settings } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface TranscriptSegment {
  text: string;
  speaker: number | null;
  is_final: boolean;
  timestamp: string;
}

interface ListenViewProps {
  isListening: boolean;
  onToggleListening: () => void;
  onOpenSettings: () => void;
  transcript: TranscriptSegment[];
  isConnected: boolean;
  language: 'de' | 'en';
}

const ListenView: React.FC<ListenViewProps> = ({
  isListening,
  onToggleListening,
  onOpenSettings,
  transcript,
  isConnected,
  language
}) => {
  const [autoScroll, setAutoScroll] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();

  // Auto-scroll logic
  useEffect(() => {
    if (autoScroll && scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [transcript, autoScroll]);

  // Check if we need to show jump to latest button
  useEffect(() => {
    if (!autoScroll && scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        const isAtBottom = scrollElement.scrollTop + scrollElement.clientHeight >= scrollElement.scrollHeight - 10;
        setShowJumpToLatest(!isAtBottom);
      }
    }
  }, [transcript, autoScroll]);

  const handleJumpToLatest = () => {
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
        setShowJumpToLatest(false);
      }
    }
  };

  const getSpeakerColor = (speaker: number | null) => {
    if (speaker === null) return 'bg-gray-600';
    const colors = ['bg-blue-600', 'bg-green-600', 'bg-purple-600', 'bg-orange-600', 'bg-pink-600'];
    return colors[speaker % colors.length];
  };

  const getSpeakerLabel = (speaker: number | null) => {
    if (speaker === null) return 'System';
    if (speaker === 0) return user?.full_name || 'You';
    return `Speaker ${speaker}`;
  };

  return (
    <div className="flex flex-col h-full bg-black/20 backdrop-blur-md rounded-lg border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">Live Transcription</h2>
          <Badge variant={isConnected ? "default" : "destructive"}>
            {isConnected ? "Connected" : "Disconnected"}
          </Badge>
          <Badge variant="outline" className="border-white/20 text-white/80">
            {language.toUpperCase()}
          </Badge>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-white/80 hover:text-white ${autoScroll ? 'bg-white/10' : ''}`}
          >
            {autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          </Button>
          
          {showJumpToLatest && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleJumpToLatest}
              className="border-white/20 text-white hover:bg-white/10"
            >
              <ArrowDown className="h-4 w-4 mr-1" />
              Jump to Latest
            </Button>
          )}
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            className="text-white/80 hover:text-white"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Transcription Area */}
      <div className="flex-1 p-4">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          <div className="space-y-3">
            {transcript.length === 0 ? (
              <div className="text-center text-white/60 py-8">
                <Mic className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No transcription yet</p>
                <p className="text-sm">Start listening to see live transcription</p>
              </div>
            ) : (
              transcript.map((segment, index) => (
                <div
                  key={index}
                  className={`flex items-start gap-3 p-3 rounded-lg ${
                    segment.is_final ? 'bg-white/5' : 'bg-white/10'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white ${getSpeakerColor(segment.speaker)}`}>
                    {segment.speaker === 0 ? 'U' : segment.speaker || 'S'}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white/80">
                        {getSpeakerLabel(segment.speaker)}
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
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Control Bar */}
      <div className="p-4 border-t border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              onClick={onToggleListening}
              variant={isListening ? "destructive" : "default"}
              className={`${
                isListening 
                  ? 'bg-red-600 hover:bg-red-700' 
                  : 'bg-green-600 hover:bg-green-700'
              } text-white`}
            >
              {isListening ? (
                <>
                  <MicOff className="h-4 w-4 mr-2" />
                  Stop Listening
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4 mr-2" />
                  Start Listening
                </>
              )}
            </Button>
          </div>
          
          <div className="text-sm text-white/60">
            {transcript.length} segments • {isConnected ? 'Live' : 'Offline'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ListenView;
