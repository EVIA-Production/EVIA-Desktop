import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getWebSocketInstance } from '@/services/websocketService';
import { chatService } from '@/services/chatService';

interface TranscriptLine {
  speaker: number;
  text: string; // accumulated text for this contiguous speaker block
  isInterim?: boolean; // indicates the latest portion is interim (for rendering only)
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
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [suggestion, setSuggestion] = useState('');
  const [suggestionsDisabled, setSuggestionsDisabled] = useState(false);
  const [fullHistory, setFullHistory] = useState<HistoryItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [speakerLabels, setSpeakerLabels] = useState<Record<string, string>>({}); // persisted mapping
  const [labelOverrides, setLabelOverrides] = useState<Record<number, string>>({}); // per line index
  const { toast } = useToast();

  // Helper: sanitize text spacing
  const normalizeAppend = (prev: string, addition: string) => {
    if (!prev) return addition.trim();
    const a = addition.trim();
    if (!a) return prev;
    return /[\s]$/.test(prev) ? prev + a : prev + ' ' + a;
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
          // Do NOT default null to 0; use -1 as unknown so we can detect diarization/fallbacks
          const sp = (transcriptData.speaker);
          speaker = (typeof sp === 'number') ? sp : -1;
          text = (transcriptData.text || '').trim();

          if (!text) {
            return; // Don't add empty segments
          }

          setTranscriptLines(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (transcriptData.is_final) {
              // Finalized text: append to same speaker line if same speaker as last line; otherwise create new line
              if (last && last.speaker === speaker) {
                last.text = normalizeAppend(last.text, text);
                last.isInterim = false;
              } else {
                updated.push({ speaker, text, isInterim: false });
              }
            } else {
              // Interim: show live without committing formatting changes later
              if (last && last.speaker === speaker) {
                // append interim tail visually (not mutating historical text beyond adding a temp tail)
                last.text = normalizeAppend(last.text, text);
                last.isInterim = true;
              } else {
                // new speaker interim becomes a new line immediately as per spec
                updated.push({ speaker, text, isInterim: true });
              }
            }
            return updated;
          });
          break;
        }

        case 'suggestion': {
          console.log('Received Suggestion:', msgData);
          if (typeof msgData === 'string' && msgData.startsWith('Error')) {
            errorMsg = msgData;
            setErrorMessage(errorMsg);
            toast({ title: "Suggestion Error", description: errorMsg, variant: "destructive" });
            setSuggestion(errorMsg); // Show in panel
            break;
          }
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
          setSuggestion(errorMsg); // Add this to update UI
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

  // Speaker label helpers
  const applyLabelToAll = useCallback(async (chatId: string, speakerNumber: number, newLabel: string) => {
    try {
      const next = { ...speakerLabels, [String(speakerNumber)]: newLabel };
      setSpeakerLabels(next);
      await chatService.setSpeakerLabels(chatId, next);
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to save speaker label', variant: 'destructive' });
    }
  }, [speakerLabels, toast]);

  const applyLabelToLine = useCallback((lineIndex: number, newLabel: string) => {
    setLabelOverrides(prev => ({ ...prev, [lineIndex]: newLabel }));
  }, []);

  const loadSpeakerLabels = useCallback(async (chatId: string) => {
    try {
      const mapping = await chatService.getSpeakerLabels(chatId);
      setSpeakerLabels(mapping || {});
    } catch (_) {
      // ignore; default mapping will be used
    }
  }, []);

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
    setTranscriptLines([]); // Clear lines
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

  // Build structured lines for rendering with labels
  const renderedLines = transcriptLines.map((line, idx) => {
    // Default mapping: local (1) => You, system (0) => Prospect, else fallback mapping
    let baseLabel: string;
    if (line.speaker === 1) baseLabel = 'You';
    else if (line.speaker === 0) baseLabel = 'Prospect';
    else baseLabel = speakerLabels[String(line.speaker)] ?? (line.speaker >= 0 ? `Speaker ${line.speaker}` : 'Unknown');
    const label = labelOverrides[idx] ?? baseLabel;
    return { label, text: line.text, lineIndex: idx, speaker: line.speaker, isInterim: !!line.isInterim };
  });

  return {
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
  };
};