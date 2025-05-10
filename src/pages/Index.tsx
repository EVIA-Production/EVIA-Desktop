
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import EviaLogo from '@/components/EviaLogo';
import RecordingControls from '@/components/RecordingControls';
import TranscriptPanel from '@/components/TranscriptPanel';
import StatusIndicator from '@/components/StatusIndicator';
import useSpeechRecognition from '@/hooks/useSpeechRecognition';
import { useToast } from '@/hooks/use-toast';

const Index = () => {
  const [isConnected, setIsConnected] = useState(true);
  const [hasAccessToken, setHasAccessToken] = useState(true);
  const [suggestion, setSuggestion] = useState('');
  const { toast } = useToast();
  
  const { 
    isRecording, 
    transcript, 
    startRecording, 
    stopRecording, 
    resetTranscript,
    isSupported
  } = useSpeechRecognition({
    onResult: (text) => {
      // Optional callback when new transcript is available
    },
    onEnd: () => {
      // Optional callback when recording ends
    }
  });

  useEffect(() => {
    // Check if browser supports speech recognition
    if (!isSupported) {
      setIsConnected(false);
      toast({
        title: 'Speech recognition not supported',
        description: 'Your browser does not support the Speech Recognition API',
        variant: 'destructive'
      });
    }
  }, [isSupported, toast]);

  const handleStartRecording = () => {
    resetTranscript();
    setSuggestion('');
    startRecording();
  };

  const handleSuggest = () => {
    if (transcript) {
      // In a real app, this would call an AI service to get suggestions
      setSuggestion(`Here's a suggestion based on your speech: "${transcript.substring(0, 50)}..."`);
    } else {
      toast({
        description: 'Speak first before requesting suggestions',
      });
    }
  };

  const handleResetContext = () => {
    resetTranscript();
    setSuggestion('');
    toast({
      description: 'Context has been reset',
    });
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="p-4 flex justify-between items-center border-b border-gray-800">
        <EviaLogo />
        <Button variant="default" className="bg-evia-pink hover:bg-pink-700">
          Get started
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-3xl md:text-4xl font-bold text-center mb-8">
          EVIA Live Transcription & Suggestions
        </h1>

        {/* Controls */}
        <div className="mb-8">
          <RecordingControls
            isRecording={isRecording}
            onStartRecording={handleStartRecording}
            onStopRecording={stopRecording}
            onSuggest={handleSuggest}
            onResetContext={handleResetContext}
            isConnected={isConnected}
          />
        </div>

        {/* Status */}
        <StatusIndicator 
          isConnected={isConnected} 
          hasAccessToken={hasAccessToken} 
        />

        {/* Transcription & Suggestion Panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-80">
          <TranscriptPanel 
            title="Live Transcript" 
            content={transcript}
            placeholder="Waiting for speech..."
          />
          <TranscriptPanel 
            title="Suggestion" 
            content={suggestion}
            placeholder="Click 'Suggest' after speaking..."
          />
        </div>
      </main>
    </div>
  );
};

export default Index;
