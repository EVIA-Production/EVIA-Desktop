import React from 'react';
import { Mic, Square, Lightbulb, RotateCcw } from 'lucide-react';

interface RecordingControlsProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSuggest: () => void;
  onResetContext: () => void;
  isConnected: boolean;
  disabled?: boolean;
}

const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  onSuggest,
  onResetContext,
  isConnected,
  disabled = false
}) => {
  return (
    <div className="flex flex-wrap gap-4 justify-center">
      {!isRecording ? (
        <button
          className="recording-btn bg-evia-green hover:bg-opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onStartRecording}
          disabled={disabled || !isConnected}
        >
          <Mic className="mr-1" size={20} />
          Start Recording
        </button>
      ) : (
        <button
          className="recording-btn bg-evia-red hover:bg-opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onStopRecording}
          disabled={disabled}
        >
          <Square className="mr-1" size={20} />
          Stop Recording
        </button>
      )}

      <button
        className="recording-btn bg-evia-pink hover:bg-opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={onSuggest}
        disabled={disabled || !isConnected || isRecording}
      >
        <Lightbulb className="mr-1" size={20} />
        Suggest
      </button>

      <button
        className="recording-btn bg-evia-gold hover:bg-opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={onResetContext}
        disabled={disabled || !isConnected}
      >
        <RotateCcw className="mr-1" size={20} />
        Reset Context
      </button>
    </div>
  );
};

export default RecordingControls;
