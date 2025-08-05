import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getWebSocketInstance } from '@/services/websocketService';

interface TranscriptSegment {
  speaker: number;
  text: string;
  show_speaker_label: boolean;
  is_new_speaker_turn: boolean;
  is_final: boolean;
}

interface WebSocketMessage {
  type: string;
  data: unknown;
}

interface TranscriptData {
  text: string;
  speaker: number | null;
  is_final: boolean;
}

interface HistoryItem {
  role: string;
  content: string;
}

export const useWebSocketMessages = () => {
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [suggestion, setSuggestion] = useState('');
  const [suggestionsDisabled, setSuggestionsDisabled] = useState(false);
  const [fullHistory, setFullHistory] = useState<HistoryItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const { toast } = useToast();
  const showSpeakerNames = true; // Toggle to show/hide speaker names

  // Helper function to split text into sentences
  const splitSentences = (text: string): string[] => {
    return text
      .split(/(?<=[.!?])\s+/)
      .filter(sentence => sentence.trim().length > 0);
  };

  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    console.log('Received WebSocket message:', message);
    
    try {
      const msgType = message.type;
      const msgData = message.data;

      // Variables that would be declared in case blocks
      let speaker: number;
      let text: string;
      let errorMsg: string;

      switch (msgType) {
        case 'transcript_segment': {
          if (!msgData || typeof msgData !== 'object') {
            console.warn('Ignoring non-dict transcript_segment data:', msgData);
            return;
          }

          const transcriptData = msgData as TranscriptData;
          speaker = transcriptData.speaker ?? 0;
          text = (transcriptData.text || '').trim();

          if (!text) {
            return; // Don't add empty segments
          }

          setTranscriptSegments(prevSegments => {
            const isFirstSegment = prevSegments.length === 0;
            let lastSegment = prevSegments.length > 0 ? prevSegments[prevSegments.length - 1] : null;
            let sameSpeaker = lastSegment && lastSegment.speaker === speaker;
            let showLabel = isFirstSegment || !sameSpeaker;
            let isNewSpeakerTurn = true; // Force new line for new utterances

            let updatedSegments = [...prevSegments];

            if (transcriptData.is_final) {
                if (sameSpeaker && lastSegment && !lastSegment.is_final) {
                    updatedSegments.pop(); // Remove pending interim
                    lastSegment = updatedSegments.length > 0 ? updatedSegments[updatedSegments.length - 1] : null;
                    sameSpeaker = lastSegment && lastSegment.speaker === speaker;
                    showLabel = updatedSegments.length === 0 || !sameSpeaker;
                    isNewSpeakerTurn = true;
                }

                const sentences = splitSentences(text);
                sentences.forEach((sentence, index) => {
                    const segmentShowLabel = index === 0 ? showLabel : false;
                    const segmentNewTurn = index === 0 ? isNewSpeakerTurn : false;
                    updatedSegments.push({
                        speaker,
                        text: sentence,
                        show_speaker_label: segmentShowLabel && showSpeakerNames,
                        is_new_speaker_turn: segmentNewTurn,
                        is_final: true
                    });
                });
                console.log('Appended new final segments from sentences, count:', sentences.length, ' total length:', updatedSegments.length);
                return updatedSegments;
            } else {
                // Existing interim logic remains
                const sameSpeaker = lastSegment && lastSegment.speaker === speaker;
                const showLabel = isFirstSegment || !sameSpeaker;
                const isNewSpeakerTurn = showLabel && !isFirstSegment;

                if (sameSpeaker && lastSegment && !lastSegment.is_final) {
                    // Update existing interim segment
                    const updatedSegments = [...prevSegments];
                    updatedSegments[updatedSegments.length - 1].text = text;
                    console.log('Updated existing interim segment, length:', updatedSegments.length);
                    return updatedSegments;
                } else {
                    // Add new interim segment
                    const updatedSegments = [...prevSegments, {
                      speaker,
                      text,
                      show_speaker_label: showLabel,
                      is_new_speaker_turn: isNewSpeakerTurn,
                      is_final: false
                    }];
                    console.log('Appended new interim segment, length:', updatedSegments.length);
                    return updatedSegments;
                }
            }
          });
          break;
        }

        case 'suggestion': {
          console.log('Received Suggestion:', msgData);
          setSuggestion(msgData as string);
          setSuggestionsDisabled(false);
          break;
        }

        case 'history': {
          console.log('Received History:', msgData);
          setFullHistory(msgData as HistoryItem[]);
          break;
        }

        case 'status': {
          setConnectionStatus(`Status: ${String(msgData)}`);
          break;
        }

        case 'error': {
          errorMsg = `Backend Error: ${String(msgData)}`;
          setErrorMessage(errorMsg);
          console.error('Backend Error Message:', msgData);
          toast({
            title: "Error",
            description: errorMsg,
            variant: "destructive"
          });
          break;
        }

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
    setSuggestion('Requesting suggestion ...'); // Immediate feedback
    setSuggestionsDisabled(true); // Disable button until suggestion is received
    
    const chatId = localStorage.getItem('selectedChatId');
    if (!chatId) {
      toast({
        description: "No chat selected",
        variant: "destructive"
      });
      return;
    }
    
    const ws = getWebSocketInstance(chatId);
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
    
    const chatId = localStorage.getItem('selectedChatId');
    if (!chatId) {
      toast({
        description: "No chat selected",
        variant: "destructive"
      });
      return;
    }
    
    const ws = getWebSocketInstance(chatId);
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
    const chatId = localStorage.getItem('selectedChatId');
    if (!chatId) {
      toast({
        description: "No chat selected",
        variant: "destructive"
      });
      return;
    }
    
    const ws = getWebSocketInstance(chatId);
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

  // Format transcript for display - exactly as in the original version but with space to prevent gluing
  const formattedTranscript = transcriptSegments.map((segment, index) => {
    const prefix = segment.show_speaker_label ? `Speaker ${segment.speaker}: ` : '';
    const newline = segment.is_new_speaker_turn ? '\n' : '';
    return `${newline}${prefix}${segment.text}`;
  }).join(' ');

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