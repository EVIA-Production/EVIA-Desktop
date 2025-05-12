
import React from 'react';
import { Mic, Square, Lightbulb, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

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

  const handleStartRecording = () => {
    console.log('Starting recording...');
    onStartRecording();
    toast({
      description: "Starting recording...",
    });
  };
  
  const handleStopRecording = () => {
    console.log('Stopping recording...');
    onStopRecording();
    toast({
      description: "Recording stopped",
    });
  };
  
  const handleSuggest = () => {
    console.log('Requesting suggestion...');
    onSuggest();
    toast({
      description: "Requesting suggestion...",
    });
  };
  
  const handleResetContext = () => {
    console.log('Resetting context...');
    onResetContext();
    toast({
      description: "Context reset",
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4 justify-center">
        {!isRecording ? (
          <Button
            className="recording-btn bg-evia-green hover:bg-opacity-80"
            onClick={handleStartRecording}
          >
            <Mic className="mr-1" size={20} />
            Start Recording
          </Button>
        ) : (
          <Button
            className="recording-btn bg-evia-red hover:bg-opacity-80"
            onClick={handleStopRecording}
          >
            <Square className="mr-1" size={20} />
            Stop Recording
          </Button>
        )}

        <Button
          className="recording-btn bg-evia-pink hover:bg-opacity-80"
          onClick={handleSuggest}
        >
          <Lightbulb className="mr-1" size={20} />
          Suggest
        </Button>

        <Button
          className="recording-btn bg-evia-gold hover:bg-opacity-80"
          onClick={handleResetContext}
        >
          <RotateCcw className="mr-1" size={20} />
          Reset Context
        </Button>
      </div>
    </div>
  );
};

export default RecordingControls;
