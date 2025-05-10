
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
  const { toast } = useToast();
  
  const handleStartRecording = async () => {
    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // Stop the tracks immediately as we only needed to request permission
      stream.getTracks().forEach(track => track.stop());
      
      // Now that we have permission, continue with recording
      onStartRecording();
      
      toast({
        description: "Microphone access granted. Recording started.",
      });
    } catch (error) {
      console.error('Error accessing microphone:', error);
      toast({
        title: 'Microphone access denied',
        description: 'You need to allow microphone access to use recording features.',
        variant: 'destructive'
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
          Start Recording
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
