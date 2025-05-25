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
    transcript,
    transcriptSegments,
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
    setTranscriptSegments
  } = useWebSocketMessages();

  const {
    isRecording,
    isConnected,
    handleStartRecording,
    handleStopRecording,
    setIsConnected
  } = useAudioCapture(handleWebSocketMessage);

  const [isRecordingState, setIsRecordingState] = useState(isRecording);
  const [transcriptState, setTranscriptState] = useState(transcript);
  const [transcriptSegmentsState, setTranscriptSegmentsState] = useState<TranscriptSegment[]>(transcriptSegments);
  const [suggestionState, setSuggestionState] = useState(suggestion);
  const [suggestionsDisabledState, setSuggestionsDisabledState] = useState(suggestionsDisabled);
  const [fullHistoryState, setFullHistoryState] = useState<any[]>(fullHistory);
  const [connectionStatusState, setConnectionStatusState] = useState(connectionStatus);
  const [isConnectedState, setIsConnectedState] = useState(isConnected);

  return {
    isRecording,
    transcript,
    transcriptSegments,
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
    setTranscriptSegments
  };
};

export default useRecording;