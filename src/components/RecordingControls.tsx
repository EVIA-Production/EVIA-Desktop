
import React from 'react';
import { Mic, Square, Lightbulb, RotateCcw, Monitor } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAudioProcessor } from '@/hooks/useAudioProcessor';

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
  const { toast } = useToast();
  const { startProcessing, stopProcessing } = useAudioProcessor();
  
  const handleStartRecording = async () => {
    const success = await startProcessing();
    if (success) {
      onStartRecording();
      toast({
        description: "Microphone and screen capture access granted. Recording started.",
      });
    }
  };
  
  const handleStopRecording = () => {
    stopProcessing();
    onStopRecording();
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
