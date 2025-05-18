import { useAudioCapture } from './useAudioCapture';
import { useWebSocketMessages } from './useWebSocketMessages';

export const useRecording = () => {
  const {
    transcript,
    suggestion,
    finalSegments,
    currentInterimSegment,
    handleWebSocketMessage,
    handleSuggest,
    handleResetContext,
    setTranscript,
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
    suggestion,
    isConnected,
    finalSegments,
    currentInterimSegment,
    handleStartRecording,
    handleStopRecording,
    handleSuggest,
    handleResetContext,
    handleWebSocketMessage,
    setTranscript,
    setSuggestion,
    setIsConnected
  };
};