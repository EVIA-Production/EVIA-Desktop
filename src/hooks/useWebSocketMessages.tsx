import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getWebSocketInstance } from '@/services/websocketService';

interface TranscriptSegment {
  speaker: number;
  text: string;
  show_speaker_label: boolean;
  is_new_speaker_turn: boolean;
}

export const useWebSocketMessages = () => {
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [suggestion, setSuggestion] = useState('');
  const [suggestionsDisabled, setSuggestionsDisabled] = useState(false);
  const [fullHistory, setFullHistory] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const { toast } = useToast();

  const handleWebSocketMessage = useCallback((message: any) => {
    console.log('Received WebSocket message:', message);
    
    try {
      const msgType = message.type;
      const msgData = message.data;

      switch (msgType) {
        case 'transcript_segment':
          if (!msgData || typeof msgData !== 'object') {
            console.warn('Ignoring non-dict transcript_segment data:', msgData);
            return;
          }

          // Only process final segments for persistent display
          if (!msgData.is_final) {
            return;
          }

          // Default speaker to 0 if None/missing
          const speaker = msgData.speaker ?? 0;
          const text = (msgData.text || '').trim();
          
          if (!text) {
            return; // Don't add empty segments
          }

          setTranscriptSegments(prevSegments => {
            const isFirstSegment = prevSegments.length === 0;
            const showLabel = isFirstSegment || prevSegments[prevSegments.length - 1].speaker !== speaker;
            const isNewSpeakerTurn = showLabel && !isFirstSegment;

            return [...prevSegments, {
              speaker,
              text,
              show_speaker_label: showLabel,
              is_new_speaker_turn: isNewSpeakerTurn
            }];
          });
          break;

        case 'suggestion':
          console.log('Received Suggestion:', msgData);
          setSuggestion(msgData);
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
          const errorMsg = `Backend Error: ${msgData}`;
          setErrorMessage(errorMsg);
          console.error('Backend Error Message:', msgData);
          toast({
            title: "Error",
            description: errorMsg,
            variant: "destructive"
          });
          break;

        default:
          console.log('Received unknown message type:', msgType);
      }
    } catch (error) {
      const errorMsg = `Error processing message: ${error}`;
      setErrorMessage(errorMsg);
      console.error(errorMsg);
      toast({
        title: "Error",
        description: errorMsg,
        variant: "destructive"
      });
    }
  }, [toast]);

  const handleSuggest = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleSuggest called');
    setDebugLog(prev => [...prev, 'Suggestion requested']);
    setSuggestion('Requesting...'); // Immediate feedback
    setSuggestionsDisabled(true); // Disable button until suggestion is received
    
    const ws = getWebSocketInstance("");
    if (ws.isConnected()) {
      ws.sendMessage({
        command: "suggest"
      });
      console.log('Suggestion request sent with command format');
    } else {
      toast({
        description: "Not connected to server",
        variant: "destructive"
      });
    }
  };

  const handleResetContext = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleResetContext called');
    setTranscriptSegments([]); // Clear segments
    setSuggestion('');
    setSuggestionsDisabled(false); // Enable suggestion button
    setFullHistory([]);
    setConnectionStatus('Resetting context...');
    setDebugLog(prev => [...prev, 'Context reset']);
    
    const ws = getWebSocketInstance(""); 
    if (ws.isConnected()) {
      ws.sendMessage({
        command: "reset"
      });
      console.log('Reset command sent to server');
    } else {
      toast({
        description: "Not connected to server",
        variant: "destructive"
      });
    }
  };

  const requestHistory = () => {
    console.log('Requesting history...');
    const ws = getWebSocketInstance("");
    if (ws.isConnected()) {
      ws.sendMessage({
        command: "history"
      });
      console.log('History request sent');
    } else {
      toast({
        description: "Not connected to server",
        variant: "destructive"
      });
    }
  };

  // Format transcript for display
  const formattedTranscript = transcriptSegments.map((segment, index) => {
    const prefix = segment.show_speaker_label ? `Speaker ${segment.speaker}: ` : '';
    const newline = segment.is_new_speaker_turn ? '\n' : '';
    return `${newline}${prefix}${segment.text}`;
  }).join('');

  return {
    transcript: formattedTranscript,
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
  };
}; 