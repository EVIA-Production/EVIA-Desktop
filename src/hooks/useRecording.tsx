import { useAudioCapture } from './useAudioCapture';
import { useWebSocketMessages } from './useWebSocketMessages';

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
    setSuggestion
  } = useWebSocketMessages();

  const {
    isRecording,
    isConnected,
    handleStartRecording,
    handleStopRecording,
    setIsConnected
  } = useAudioCapture(handleWebSocketMessage);

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
    setIsConnected
  };
};