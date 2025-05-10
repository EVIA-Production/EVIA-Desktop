
import React from 'react';
import { Mic, Square, Lightbulb, RotateCcw, Monitor } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAudioProcessor } from '@/hooks/useAudioProcessor';
import { useTranscriptionWebSocket } from '@/hooks/useTranscriptionWebSocket';

interface RecordingControlsProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSuggest: () => void;
  onResetContext: () => void;
  isConnected: boolean;
  onTranscriptUpdate?: (text: string) => void;
  onSuggestionReceived?: (suggestion: string) => void;
  websocketUrl?: string;
}

const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  onSuggest,
  onResetContext,
  isConnected,
  onTranscriptUpdate,
  onSuggestionReceived,
  websocketUrl = 'ws://localhost:8000/ws/transcribe'
}) => {
  const { toast } = useToast();
  
  // Set up the WebSocket connection
  const {
    isConnected: wsConnected,
    connect: connectWs,
    disconnect: disconnectWs,
    sendAudioData,
    requestSuggestion,
    resetContext: resetWsContext
  } = useTranscriptionWebSocket({
    autoConnect: false,
    websocketUrl,
    onTranscriptUpdate: (segment) => {
      console.log('Transcript update:', segment);
      if (onTranscriptUpdate && segment.text) {
        onTranscriptUpdate(segment.text);
      }
    },
    onSuggestionReceived: (suggestion) => {
      console.log('Suggestion received:', suggestion);
      if (onSuggestionReceived) {
        onSuggestionReceived(suggestion);
      }
    },
    onStatusUpdate: (status) => {
      console.log('WebSocket status update:', status);
    },
    onError: (error) => {
      console.error('WebSocket error:', error);
    }
  });
  
  // Set up audio processing that sends data to the WebSocket
  const { startProcessing, stopProcessing } = useAudioProcessor({
    onAudioData: (audioData) => {
      return sendAudioData(audioData);
    }
  });
  
  const handleStartRecording = async () => {
    console.log('Starting recording process...');
    
    // First connect to WebSocket
    connectWs();
    
    // Then start audio processing
    const success = await startProcessing();
    if (success) {
      console.log('Successfully started audio processing');
      onStartRecording();
      toast({
        description: "Microphone and screen capture access granted. Recording started.",
      });
    } else {
      console.error('Failed to start audio processing');
      disconnectWs();
    }
  };
  
  const handleStopRecording = () => {
    console.log('Stopping recording process...');
    stopProcessing();
    disconnectWs();
    onStopRecording();
    toast({
      description: "Recording stopped",
    });
  };
  
  const handleSuggest = () => {
    console.log('Requesting suggestion...');
    const success = requestSuggestion();
    if (success) {
      onSuggest();
    } else {
      toast({
        title: "Error",
        description: "Could not request suggestion. Not connected to server.",
        variant: "destructive"
      });
    }
  };
  
  const handleResetContext = () => {
    console.log('Resetting context...');
    const success = resetWsContext();
    if (success) {
      onResetContext();
    } else {
      toast({
        title: "Error",
        description: "Could not reset context. Not connected to server.",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="flex flex-wrap gap-4 justify-center">
      {!isRecording ? (
        <button
          className="recording-btn bg-evia-green hover:bg-opacity-80"
          onClick={handleStartRecording}
          disabled={!isConnected}
        >
          <Mic className="mr-1" size={20} />
          <Monitor className="mr-1" size={20} />
          Start Recording
        </button>
      ) : (
        <button
          className="recording-btn bg-evia-red hover:bg-opacity-80"
          onClick={handleStopRecording}
        >
          <Square className="mr-1" size={20} />
          Stop Recording
        </button>
      )}

      <button
        className="recording-btn bg-evia-pink hover:bg-opacity-80"
        onClick={handleSuggest}
        disabled={!isConnected || !isRecording}
      >
        <Lightbulb className="mr-1" size={20} />
        Suggest
      </button>

      <button
        className="recording-btn bg-evia-gold hover:bg-opacity-80"
        onClick={handleResetContext}
        disabled={!isConnected || !isRecording}
      >
        <RotateCcw className="mr-1" size={20} />
        Reset Context
      </button>
    </div>
  );
};

export default RecordingControls;
