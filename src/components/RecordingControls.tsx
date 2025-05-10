
import React, { useState } from 'react';
import { Mic, Square, Lightbulb, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface RecordingControlsProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSuggest: () => void;
  onResetContext: () => void;
  isConnected: boolean;
}

const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  onSuggest,
  onResetContext,
  isConnected
}) => {
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const { toast } = useToast();

  const handleStartRecording = async () => {
    try {
      setIsRequestingPermission(true);
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });
      // Permission granted, start recording
      onStartRecording();
    } catch (error) {
      // Permission denied or error occurred
      toast({
        title: "Microphone access denied",
        description: "Please allow microphone access to use the recording feature.",
        variant: "destructive"
      });
      console.error('Error accessing microphone:', error);
    } finally {
      setIsRequestingPermission(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-4 justify-center">
      {!isRecording ? (
        <button
          className={`recording-btn ${isRequestingPermission ? 'bg-gray-500' : 'bg-evia-green hover:bg-opacity-80'}`}
          onClick={handleStartRecording}
          disabled={!isConnected || isRequestingPermission}
        >
          <Mic className="mr-1" size={20} />
          {isRequestingPermission ? 'Requesting Permission...' : 'Start Recording'}
        </button>
      ) : (
        <button
          className="recording-btn bg-evia-red hover:bg-opacity-80"
          onClick={onStopRecording}
        >
          <Square className="mr-1" size={20} />
          Stop Recording
        </button>
      )}

      <button
        className="recording-btn bg-evia-pink hover:bg-opacity-80"
        onClick={onSuggest}
        disabled={!isConnected}
      >
        <Lightbulb className="mr-1" size={20} />
        Suggest
      </button>

      <button
        className="recording-btn bg-evia-gold hover:bg-opacity-80"
        onClick={onResetContext}
        disabled={!isConnected}
      >
        <RotateCcw className="mr-1" size={20} />
        Reset Context
      </button>
    </div>
  );
};

export default RecordingControls;
