import { useState, useCallback } from 'react';
import { useAudioCapture } from './useAudioCapture';
import { useWebSocketMessages } from './useWebSocketMessages';
import { getWebSocketInstance } from '@/services/websocketService';

interface TranscriptSegment {
  speaker: number;
  text: string;
  show_speaker_label: boolean;
  is_new_speaker_turn: boolean;
}

export const useRecording = () => {
  const {
    transcriptLines,
    renderedLines,
    speakerLabels,
    labelOverrides,
    suggestion,
    suggestionsDisabled,
    fullHistory,
    connectionStatus,
    errorMessage,
    handleWebSocketMessage,
    handleSuggest,
    handleResetContext,
    requestHistory,
    setSuggestion,
    setTranscriptLines,
    applyLabelToAll,
    applyLabelToLine,
    loadSpeakerLabels,
  } = useWebSocketMessages();

  const {
    isRecording,
    isConnected,
    handleStartRecording,
    handleStopRecording,
    setIsConnected
  } = useAudioCapture(handleWebSocketMessage);

  const [isRecordingState, setIsRecordingState] = useState(isRecording);

  return {
    isRecording,
    transcriptLines,
    renderedLines,
    speakerLabels,
    labelOverrides,
    suggestion,
    suggestionsDisabled,
    fullHistory,
    connectionStatus,
    errorMessage,
    isConnected,
    handleStartRecording,
    handleStopRecording,
    handleSuggest,
    handleResetContext,
    requestHistory,
    setSuggestion,
    setIsConnected,
    setTranscriptLines,
    applyLabelToAll,
    applyLabelToLine,
    loadSpeakerLabels,
  };
};

export default useRecording;