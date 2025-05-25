import React from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Mic, MicOff, Lightbulb, RotateCcw } from 'lucide-react';
import RecordingControls from '@/components/RecordingControls';
import TranscriptPanel from '@/components/TranscriptPanel';
import StatusIndicator from '@/components/StatusIndicator';

interface MainContentProps {
  isRecording: boolean;
  transcript: string;
  suggestion: string;
  isConnected: boolean;
  chatId: string | null;
  onStartRecording: () => Promise<() => void>;
  onStopRecording: () => void;
  onSuggest: () => void;
  onResetContext: () => void;
  hasAccessToken: boolean;
}

const MainContent: React.FC<MainContentProps> = ({
  isRecording,
  transcript,
  suggestion,
  onStartRecording,
  onStopRecording,
  onSuggest,
  onResetContext,
  isConnected,
  hasAccessToken
}) => {
  return (
    <div className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
      <h1 className="text-3xl md:text-4xl font-bold text-center mb-8 text-gradient-to-r from-pink-500 to-evia-pink">
        EVIA Live Transcription & Suggestions
      </h1>

      {/* Controls */}
      <div className="mb-8">
        <RecordingControls
          isRecording={isRecording}
          onStartRecording={onStartRecording}
          onStopRecording={onStopRecording}
          onSuggest={onSuggest}
          onResetContext={onResetContext}
          isConnected={isConnected}
        />
      </div>
      
      {/* Status indicators now positioned below the buttons */}
      <div className="mb-8">
        <StatusIndicator 
          isConnected={isRecording}
          hasAccessToken={hasAccessToken} 
        />
      </div>

      {/* Transcription & Suggestion Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[500px]">
        <TranscriptPanel 
          title="Live Transcript" 
          content={transcript}
          placeholder="Your transcript will appear here"
          className="bg-card border border-border shadow-lg"
        />
        <TranscriptPanel 
          title="Suggestion" 
          content={suggestion}
          placeholder="Suggestions will appear here"
          className="bg-card border border-border shadow-lg"
          isSuggestion={true}
        />
      </div>
    </div>
  );
};

export default MainContent;
