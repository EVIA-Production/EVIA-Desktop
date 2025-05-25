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
            className="recording-btn bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleStartRecording}
          >
            <Mic className="mr-1" size={20} />
            Start Recording
          </Button>
        ) : (
          <Button
            className="recording-btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleStopRecording}
          >
            <Square className="mr-1" size={20} />
            Stop Recording
          </Button>
        )}

        <Button
          className="recording-btn bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleSuggest}
          disabled={!isRecording}
        >
          <Lightbulb className="mr-1" size={20} />
          Suggest
        </Button>

        <Button
          className="recording-btn bg-secondary text-secondary-foreground hover:bg-secondary/90"
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
