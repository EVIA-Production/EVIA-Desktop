
import React, { useState } from 'react';
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
  websocketUrl = 'ws://localhost:5001/ws/transcribe'
}) => {
  const { toast } = useToast();
  const [permissionRequesting, setPermissionRequesting] = useState(false);
  const [permissionStep, setPermissionStep] = useState<'idle' | 'mic' | 'screen'>('idle');
  
  // Set up the WebSocket connection
  const {
    isConnected: wsConnected,
    isConnecting: wsConnecting,
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
      toast({
        title: 'Connection Error',
        description: error,
        variant: 'destructive'
      });
    }
  });
  
  // Set up audio processing that sends data to the WebSocket
  const { startProcessing, stopProcessing } = useAudioProcessor({
    onAudioData: (audioData) => {
      return sendAudioData(audioData);
    }
  });
  
  // Request microphone permissions first
  const requestMicrophonePermission = async (): Promise<boolean> => {
    try {
      setPermissionRequesting(true);
      setPermissionStep('mic');
      console.log('Requesting microphone permissions...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Just to check if we have permission, we can stop tracks right after
      stream.getTracks().forEach(track => track.stop());
      toast({
        description: "Microphone access granted.",
      });
      return true;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      toast({
        title: "Permission Denied",
        description: "Microphone access was denied. Recording cannot start.",
        variant: "destructive"
      });
      return false;
    }
  };
  
  // Request screen sharing permissions
  const requestScreenPermission = async (): Promise<boolean> => {
    try {
      setPermissionStep('screen');
      console.log('Requesting screen sharing permissions...');
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      // Just to check if we have permission, we can stop tracks right after
      stream.getTracks().forEach(track => track.stop());
      toast({
        description: "Screen sharing access granted.",
      });
      return true;
    } catch (error) {
      console.error('Error accessing screen sharing:', error);
      toast({
        title: "Permission Denied",
        description: "Screen sharing access was denied. Recording cannot start.",
        variant: "destructive"
      });
      return false;
    } finally {
      setPermissionRequesting(false);
      setPermissionStep('idle');
    }
  };
  
  const handleStartRecording = async () => {
    try {
      // First request microphone permissions
      setPermissionRequesting(true);
      const micPermissionGranted = await requestMicrophonePermission();
      if (!micPermissionGranted) {
        setPermissionRequesting(false);
        setPermissionStep('idle');
        return;
      }
      
      // Then request screen sharing permissions
      const screenPermissionGranted = await requestScreenPermission();
      if (!screenPermissionGranted) {
        setPermissionRequesting(false);
        setPermissionStep('idle');
        return;
      }
      
      console.log('Starting recording process...');
      
      // Then connect to WebSocket
      await connectWs();
      
      // Small delay to ensure WebSocket connection is established
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Then start audio processing
      const success = await startProcessing();
      if (success) {
        console.log('Successfully started audio processing');
        onStartRecording();
        toast({
          description: "Recording started successfully.",
        });
      } else {
        console.error('Failed to start audio processing');
        disconnectWs();
        toast({
          title: "Error",
          description: "Failed to start recording. Please try again.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error during recording setup:', error);
      disconnectWs();
      setPermissionRequesting(false);
      setPermissionStep('idle');
      toast({
        title: "Error",
        description: "Failed to set up recording. Please try again.",
        variant: "destructive"
      });
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

  // Get the appropriate button label based on the current permission requesting step
  const getStartButtonLabel = () => {
    if (!permissionRequesting) return 'Start Recording';
    
    switch (permissionStep) {
      case 'mic':
        return 'Requesting Microphone...';
      case 'screen':
        return 'Requesting Screen Access...';
      default:
        return 'Requesting Permission...';
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4 justify-center">
        {!isRecording ? (
          <button
            className="recording-btn bg-evia-green hover:bg-opacity-80 disabled:opacity-50"
            onClick={handleStartRecording}
            disabled={!isConnected || permissionRequesting}
          >
            <Mic className="mr-1" size={20} />
            <Monitor className="mr-1" size={20} />
            {getStartButtonLabel()}
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
    </div>
  );
};

export default RecordingControls;
