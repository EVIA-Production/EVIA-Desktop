
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import EviaLogo from '@/components/EviaLogo';
import RecordingControls from '@/components/RecordingControls';
import TranscriptPanel from '@/components/TranscriptPanel';
import StatusIndicator from '@/components/StatusIndicator';
import { useToast } from '@/hooks/use-toast';
import { LogIn } from 'lucide-react';

const Index = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [hasAccessToken, setHasAccessToken] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const { toast } = useToast();
  
  useEffect(() => {
    console.log('Index component mounted');
  }, []);

  // Add a debug logging function
  const addDebugLog = (message: string) => {
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] ${message}`]);
    console.log(`DEBUG: ${message}`);
  };

  const handleStartRecording = () => {
    console.log('handleStartRecording called');
    setIsRecording(true);
    addDebugLog('Recording started');
  };

  const handleStopRecording = () => {
    console.log('handleStopRecording called');
    setIsRecording(false);
    addDebugLog('Recording stopped');
    toast({
      description: "Recording stopped",
    });
  };

  const handleSuggest = () => {
    console.log('handleSuggest called');
    addDebugLog('Suggestion requested');
    toast({
      description: "Requesting suggestion...",
    });
  };

  const handleResetContext = () => {
    console.log('handleResetContext called');
    setTranscript('');
    setSuggestion('');
    addDebugLog('Context reset');
    toast({
      description: 'Context has been reset',
    });
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-b from-black to-gray-900 text-white flex flex-col">
      {/* Header */}
      <header className="p-4 flex justify-between items-center border-b border-gray-800 bg-black bg-opacity-60 backdrop-blur-md">
        <EviaLogo className="text-white" />
        <div className="flex gap-3">
          <Link to="/login">
            <Button variant="outline" className="border-gray-600 hover:bg-gray-800 text-white">
              <LogIn className="mr-2 h-4 w-4" /> Sign In
            </Button>
          </Link>
          <Link to="/register">
            <Button variant="default" className="bg-evia-pink hover:bg-pink-700">
              Sign Up
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-3xl md:text-4xl font-bold text-center mb-8 text-gradient-to-r from-pink-500 to-evia-pink">
          EVIA Live Transcription & Suggestions
        </h1>

        {/* Controls */}
        <div className="mb-8">
          <RecordingControls
            isRecording={isRecording}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[500px]">
          <TranscriptPanel 
            title="Live Transcript" 
            content={transcript}
            placeholder="Waiting for speech..."
            className="bg-gray-900 bg-opacity-50 border border-gray-800 shadow-lg"
          />
          <TranscriptPanel 
            title="Suggestion" 
            content={suggestion}
            placeholder="Click 'Suggest' after speaking..."
            className="bg-gray-900 bg-opacity-50 border border-gray-800 shadow-lg"
          />
        </div>
      </main>
      
      {/* Footer */}
      <footer className="py-6 border-t border-gray-800 bg-black bg-opacity-60 backdrop-blur-md mt-8">
        <div className="container mx-auto text-center text-gray-400 text-sm">
          <p>© {new Date().getFullYear()} EVIA Voice Assistant. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
