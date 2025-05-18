import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

export const useWebSocketMessages = () => {
  const [transcript, setTranscript] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [finalSegments, setFinalSegments] = useState<{ speaker: number | null; text: string }[]>([]);
  const [currentInterimSegment, setCurrentInterimSegment] = useState<{ speaker: number | null; text: string } | null>(null);
  const { toast } = useToast();

  const handleWebSocketMessage = useCallback((message: any) => {
    console.log('Received WebSocket message:', message);
    
    switch (message.type) {
      case 'transcript_utterance':
        const { text, speaker } = message.data || {};
        console.log('[Transcript] Checking utterance condition: text && typeof speaker === \'number\'', { text, speaker, conditionResult: text && typeof speaker === 'number' });

        if (text && typeof speaker === 'number') {
          console.log('[Transcript] Processing final utterance:', { speaker, text });
          setFinalSegments(prevSegments => [...prevSegments, { speaker, text }]);
          setCurrentInterimSegment(null);
        } else {
          console.warn('[Transcript] Skipping final utterance due to condition (text falsy or speaker not a number):', { text, speaker });
        }
        break;

      case 'transcript_interim':
        const { text: interimText, speaker: interimSpeaker } = message.data || {};
        console.log('[Transcript] Received interim data:', { interimText, interimSpeaker });

        setCurrentInterimSegment(interimText ? { speaker: interimSpeaker ?? null, text: interimText } : null);
        
        if (interimText) {
          console.log('[Transcript] Processing interim segment:', { interimSpeaker, interimText });
          const speakerLabel = interimSpeaker ? `${interimSpeaker}: ` : '';
          console.log(`Interim: ${interimSpeaker ? interimSpeaker + ':' : ''} ${interimText}`);
        } else {
           console.log('[Transcript] Skipping interim segment due to missing text:', { interimText, interimSpeaker });
        }
        break;

      case 'transcript_segment':
        const { text: segmentText, speaker: segmentSpeaker, is_final } = message.data || {};
        console.log('[Transcript] Received segment data:', { text: segmentText, speaker: segmentSpeaker, is_final });
        console.log('[Transcript] Checking segment condition: segmentText && typeof segmentSpeaker === \'number\'', { segmentText, segmentSpeaker, conditionResult: segmentText && typeof segmentSpeaker === 'number' });

        if (segmentText && typeof segmentSpeaker === 'number') {
          console.log(`[Transcript] Processing ${is_final ? 'FINAL' : 'INTERIM'} segment:`, { speaker: segmentSpeaker, text: segmentText });
          if (is_final) {
            setTranscript(prevTranscript => {
              const lines = prevTranscript.split('\n');
              if (lines.length > 0 && !lines[lines.length - 1].endsWith('\n')) {
                lines.pop();
              }
              return lines.join('\n') + `${segmentSpeaker}: ${segmentText}\n`;
            });
          } else {
            setTranscript(prevTranscript => {
              const lines = prevTranscript.split('\n');
              if (lines.length > 0 && !lines[lines.length - 1].endsWith('\n')) {
                lines.pop();
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
        } else if (message.suggestion) {
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
        if (message.transcript && typeof message.transcript === 'string') {
          setTranscript(message.transcript);
        }
        if (message.suggestion && typeof message.suggestion === 'string') {
          setSuggestion(message.suggestion);
        }
        break;
    }
  }, [toast]);

  const handleSuggest = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleSuggest called');
    setDebugLog(prev => [...prev, 'Suggestion requested']);
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
      setTimeout(() => {
        setSuggestion('This is a sample suggestion based on your transcript. In a real application, this would be generated by an AI based on the recorded speech.');
      }, 1000);
    }
  };

  const handleResetContext = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleResetContext called');
    setTranscript('');
    setSuggestion('');
    setDebugLog(prev => [...prev, 'Context reset']);
    
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

  return {
    transcript,
    suggestion,
    finalSegments,
    currentInterimSegment,
    handleWebSocketMessage,
    handleSuggest,
    handleResetContext,
    setTranscript,
    setSuggestion
  };
}; 