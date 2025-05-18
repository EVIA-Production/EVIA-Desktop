import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getWebSocketInstance, closeWebSocketInstance } from '@/services/websocketService';

export const useAudioProcessing = () => {
  const [transcript, setTranscript] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [finalSegments, setFinalSegments] = useState<{ speaker: number | null; text: string }[]>([]);
  const [currentInterimSegment, setCurrentInterimSegment] = useState<{ speaker: number | null; text: string } | null>(null);
  const { toast } = useToast();

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback((message: any) => {
    console.log('Received WebSocket message:', message);
    
    switch (message.type) {
      case 'transcript_utterance': // New type from backend for final utterances
        const { text, speaker } = message.data || {}; // speaker is "Speaker X"
        // Check condition for processing (text must be truthy, speaker must be a number)
        console.log('[Transcript] Checking utterance condition: text && typeof speaker === \'number\'', { text, speaker, conditionResult: text && typeof speaker === 'number' });

        if (text && typeof speaker === 'number') {
          console.log('[Transcript] Processing final utterance:', { speaker, text });
          // Add the finalized utterance to the list of final segments
          setFinalSegments(prevSegments => [...prevSegments, { speaker, text }]);
          // Clear the current interim segment
          setCurrentInterimSegment(null);
        } else {
          console.warn('[Transcript] Skipping final utterance due to condition (text falsy or speaker not a number):', { text, speaker });
        }
        break;

      case 'transcript_interim': // New type for interim, fast updates
        const { text: interimText, speaker: interimSpeaker } = message.data || {};
        // Log raw interim data received
        console.log('[Transcript] Received interim data:', { interimText, interimSpeaker });

        // Update the current interim segment
        setCurrentInterimSegment(interimText ? { speaker: interimSpeaker ?? null, text: interimText } : null);
        
        if (interimText) {
          console.log('[Transcript] Processing interim segment:', { interimSpeaker, interimText });
          const speakerLabel = interimSpeaker ? `${interimSpeaker}: ` : ''; // interimSpeaker might be null or "Speaker X"
          console.log(`Interim: ${interimSpeaker ? interimSpeaker + ':' : ''} ${interimText}`);
        } else {
           console.log('[Transcript] Skipping interim segment due to missing text:', { interimText, interimSpeaker });
        }
        break;

      case 'transcript_segment': // Handle both interim and final segments
        const { text: segmentText, speaker: segmentSpeaker, is_final } = message.data || {};
        
        // Log raw segment data received
        console.log('[Transcript] Received segment data:', { text: segmentText, speaker: segmentSpeaker, is_final });

        // Check condition for processing (segmentText must be truthy, segmentSpeaker must be a number)
        console.log('[Transcript] Checking segment condition: segmentText && typeof segmentSpeaker === \'number\'', { segmentText, segmentSpeaker, conditionResult: segmentText && typeof segmentSpeaker === 'number' });

        if (segmentText && typeof segmentSpeaker === 'number') {
          console.log(`[Transcript] Processing ${is_final ? 'FINAL' : 'INTERIM'} segment:`, { speaker: segmentSpeaker, text: segmentText });
          if (is_final) {
            // For final segments, append to the transcript
            setTranscript(prevTranscript => {
              const lines = prevTranscript.split('\n');
              if (lines.length > 0 && !lines[lines.length - 1].endsWith('\n')) {
                lines.pop(); // Remove interim line if present
              }
              return lines.join('\n') + `${segmentSpeaker}: ${segmentText}\n`;
            });
          } else {
            // For interim segments, update the last line
            setTranscript(prevTranscript => {
              const lines = prevTranscript.split('\n');
              if (lines.length > 0 && !lines[lines.length - 1].endsWith('\n')) {
                lines.pop(); // Remove previous interim line
              }
              return lines.join('\n') + `${segmentSpeaker}: ${segmentText}`;
            });
          }
        } else {
          console.log('[Transcript] Skipping segment due to condition (text falsy or speaker not a number):', { text: segmentText, speaker: segmentSpeaker });
        }
        break;
      
      case 'suggestion':
        if (typeof message.data === 'string') {
          setSuggestion(message.data);
        } else if (message.data && typeof message.data.toString === 'function') {
          setSuggestion(message.data.toString());
        } else if (message.suggestion) { // Legacy
          setSuggestion(message.suggestion);
        }
        break;
      
      case 'error':
        console.error('Server error:', message.error || (message.data?.error));
        toast({
          title: "Error",
          description: message.error || (message.data?.error) || "An unknown error occurred",
          variant: "destructive"
        });
        break;

      default:
        // Handle direct transcript/suggestion fields if backend sends them (legacy or other message types)
        if (message.transcript && typeof message.transcript === 'string') {
          setTranscript(message.transcript); // Replace entire transcript
        }
        if (message.suggestion && typeof message.suggestion === 'string') {
          setSuggestion(message.suggestion);
        }
        break;
    }
  }, [toast]);

  const startProcessing = (chatId: string | null, setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (!chatId) return;

    const ws = getWebSocketInstance(chatId);
    ws.connect();
    
    // Register message handler
    const removeMessageHandler = ws.onMessage(handleWebSocketMessage);
    
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] WebSocket connection initiated`]);
    
    return () => {
      removeMessageHandler();
      closeWebSocketInstance();
      setDebugLog(prev => [...prev, `[${new Date().toISOString()}] WebSocket connection closed`]);
    };
  };

  const stopProcessing = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    closeWebSocketInstance();
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] WebSocket connection closed`]);
  };

  const handleSuggest = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleSuggest called');
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] Suggestion requested`]);
    toast({
      description: "Requesting suggestion...",
    });
    
    const ws = getWebSocketInstance("");
    if (ws.isConnected()) {
      ws.sendMessage({
        command: "suggest"
      });
      console.log('Suggestion request sent with command format');
    } else {
      // Fallback for when WebSocket is not connected
      setTimeout(() => {
        setSuggestion('This is a sample suggestion based on your transcript. In a real application, this would be generated by an AI based on the recorded speech.');
      }, 1000);
    }
  };

  const handleResetContext = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleResetContext called');
    setTranscript('');
    setSuggestion('');
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] Context reset`]);
    
    const ws = getWebSocketInstance("");
    if (ws.isConnected()) {
      ws.sendMessage({
        command: "reset"
      });
      console.log('Reset command sent to server');
    }
    
    toast({
      description: 'Context has been reset',
    });
  };

  const processAudioData = (data: Int16Array) => {
    const ws = getWebSocketInstance("");
    if (ws.isConnected()) {
      ws.sendBinaryData(data.buffer);
    }
  };

  return {
    transcript,
    suggestion,
    isConnected,
    setIsConnected,
    startProcessing,
    stopProcessing,
    handleSuggest,
    handleResetContext,
    processAudioData,
    setTranscript,
    setSuggestion
  };
}; 