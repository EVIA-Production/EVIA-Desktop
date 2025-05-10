
import React, { useState } from 'react';
import { Mic, Square, Lightbulb, RotateCcw, Monitor } from 'lucide-react';
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
      // Request microphone permission first
      const micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // Now request screen display permission
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      
      // Stop the tracks immediately as we only needed to request permissions
      micStream.getTracks().forEach(track => track.stop());
      displayStream.getTracks().forEach(track => track.stop());
      
      // Now that we have both permissions, continue with recording
      onStartRecording();
      
      toast({
        description: "Microphone and screen capture access granted. Recording started.",
      });
    } catch (error) {
      console.error('Error accessing media devices:', error);
      toast({
        title: 'Permission denied',
        description: 'You need to allow both microphone and screen capture access to use recording features.',
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
          <Monitor className="mr-1" size={20} />
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
