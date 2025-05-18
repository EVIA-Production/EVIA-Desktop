import { useState, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getWebSocketInstance, closeWebSocketInstance } from '@/services/websocketService';

interface TranscriptSegment {
  speaker: number | null;
  text: string;
  show_speaker_label?: boolean;
  is_new_speaker_turn?: boolean;
}

export const useAudioProcessing = () => {
  // State management
  const [isRecording, setIsRecording] = useState(false);
  const [suggestionsDisabled, setSuggestionsDisabled] = useState(false);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [latestSuggestion, setLatestSuggestion] = useState('');
  const [fullHistory, setFullHistory] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [errorMessage, setErrorMessage] = useState('');
  const { toast } = useToast();

  // WebSocket message handler
  const handleWebSocketMessage = useCallback((message: any) => {
    console.log('Received WebSocket message:', message);
    
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message;
      const msgType = data.type;
      const msgData = data.data;

      switch (msgType) {
        case 'transcript_segment':
          if (!msgData || typeof msgData !== 'object') {
            console.warn('Ignoring non-object transcript_segment data:', msgData);
            return;
          }

          // Only process final segments for persistent display
          if (!msgData.is_final) return;

          // Default speaker to 0 if null/missing
          const speaker = msgData.speaker ?? 0;
          const text = (msgData.text || '').trim();
          if (!text) return; // Don't add empty segments

          // Determine if the speaker label should be shown
          const isFirstSegment = transcriptSegments.length === 0;
          let showLabel = true;
          if (!isFirstSegment) {
            const lastSegment = transcriptSegments[transcriptSegments.length - 1];
            if (lastSegment.speaker === speaker) {
              showLabel = false; // Don't show label if same speaker
            }
          }

          // Determine if this segment starts a new speaker's turn
          const isNewSpeakerTurn = showLabel && !isFirstSegment;

          // Append the new segment
          setTranscriptSegments(prev => [...prev, {
            speaker,
            text,
            show_speaker_label: showLabel,
            is_new_speaker_turn: isNewSpeakerTurn
          }]);
          break;

        case 'suggestion':
          console.log('Received Suggestion:', msgData);
          setLatestSuggestion(msgData);
          setSuggestionsDisabled(false);
          break;

        case 'history':
          console.log('Received History:', msgData);
          setFullHistory(msgData);
          break;

        case 'status':
          setConnectionStatus(`Status: ${msgData}`);
          break;

        case 'error':
          setErrorMessage(`Backend Error: ${msgData}`);
          console.error('Backend Error Message:', msgData);
          toast({
            title: "Error",
            description: msgData,
            variant: "destructive"
          });
          break;

        default:
          console.log('Received unknown message type:', msgType);
      }
    } catch (error) {
      setErrorMessage('Error processing message: ' + (error as Error).message);
      console.error('Error processing message:', error);
    }
  }, [transcriptSegments, toast]);

  // WebSocket event handlers
  const handleOpen = useCallback(() => {
    setConnectionStatus('Connected');
    setIsRecording(true);
    setSuggestionsDisabled(false);
    setErrorMessage('');
    setTranscriptSegments([]);
    console.log('WebSocket Opened');
  }, []);

  const handleClose = useCallback(() => {
    setConnectionStatus('Disconnected');
    setIsRecording(false);
    console.log('WebSocket Closed');
  }, []);

  const handleError = useCallback((error: string) => {
    setConnectionStatus('Error');
    setErrorMessage(`WebSocket error: ${error}`);
    setIsRecording(false);
    console.error('WebSocket Error:', error);
  }, []);

  // Set up WebSocket connection and handlers
  useEffect(() => {
    const ws = getWebSocketInstance('');
    
    // Set up message handler
    const removeMessageHandler = ws.onMessage(handleWebSocketMessage);
    
    // Set up connection change handler
    const removeConnectionHandler = ws.onConnectionChange((connected) => {
      if (connected) {
        handleOpen();
      } else {
        handleClose();
      }
    });

    // Cleanup on unmount
    return () => {
      removeMessageHandler();
      removeConnectionHandler();
      closeWebSocketInstance();
    };
  }, [handleWebSocketMessage, handleOpen, handleClose]);

  // Command sending helper
  const sendCommand = useCallback((commandData: any) => {
    const ws = getWebSocketInstance('');
    if (ws.isConnected()) {
      console.log('Sending command:', commandData);
      ws.sendMessage(commandData);
    } else {
      console.error('WebSocket not connected');
      setErrorMessage('WebSocket not connected');
    }
  }, []);

  // Action handlers
  const requestSuggestion = useCallback(() => {
    console.log('Requesting suggestion...');
    setLatestSuggestion('Requesting...');
    setSuggestionsDisabled(true);
    sendCommand({ command: 'suggest' });
  }, [sendCommand]);

  const resetContext = useCallback(() => {
    console.log('Requesting context reset...');
    setTranscriptSegments([]);
    setLatestSuggestion('');
    setSuggestionsDisabled(false);
    setFullHistory([]);
    setConnectionStatus('Resetting context...');
    sendCommand({ command: 'reset' });
  }, [sendCommand]);

  const requestHistory = useCallback(() => {
    console.log('Requesting history...');
    sendCommand({ command: 'history' });
  }, [sendCommand]);

  // Process audio data
  const processAudioData = useCallback((data: Int16Array) => {
    const ws = getWebSocketInstance('');
    if (ws.isConnected()) {
      ws.sendBinaryData(data.buffer);
    }
  }, []);

  return {
    // State
    isRecording,
    suggestionsDisabled,
    transcriptSegments,
    latestSuggestion,
    fullHistory,
    connectionStatus,
    errorMessage,

    // Actions
    requestSuggestion,
    resetContext,
    requestHistory,
    processAudioData,

    // WebSocket handlers
    handleWebSocketMessage,
    handleOpen,
    handleClose,
    handleError
  };
}; 