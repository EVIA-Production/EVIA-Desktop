import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getWebSocketInstance, closeWebSocketInstance } from '@/services/websocketService';

export const useRecording = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const { toast } = useToast();
  
  // Refs to maintain audio processing objects between renders
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioFrameCountRef = useRef<number>(0);
  
  const addDebugLog = (message: string, setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] ${message}`]);
    console.log(`DEBUG: ${message}`);
  };

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback((message: any) => {
    console.log('Received WebSocket message:', message);
    
    switch (message.type) {
      case 'transcript_utterance': // New type from backend for final utterances
        const { text, speaker } = message.data || {}; // speaker is "Speaker X"
        // Log raw utterance data received
        console.log('[Transcript] Received utterance data:', { text, speaker });
        
        if (text && speaker) {
          console.log('[Transcript] Processing final utterance:', { speaker, text });
          // Append the new utterance directly.
          // Each utterance is a new paragraph.
          setTranscript(prevTranscript => {
            // Remove any interim text (last line if it doesn't end with newline)
            const lines = prevTranscript.split('\n');
            if (lines.length > 0 && !lines[lines.length - 1].endsWith('\n')) {
              lines.pop(); // Remove the last line if it's interim
            }
            return lines.join('\n') + `${speaker}: ${text}\n`;
          });
        } else {
          console.warn('[Transcript] Skipping final utterance due to missing data:', { text, speaker });
        }
        break;

      case 'transcript_interim': // New type for interim, fast updates
        const { text: interimText, speaker: interimSpeaker } = message.data || {};
        // Log raw interim data received
        console.log('[Transcript] Received interim data:', { interimText, interimSpeaker });

        if (interimText) {
          console.log('[Transcript] Processing interim segment:', { interimSpeaker, interimText });
          const speakerLabel = interimSpeaker ? `${interimSpeaker}: ` : ''; // interimSpeaker might be null or "Speaker X"
          // Update the transcript with interim text
          setTranscript(prevTranscript => {
            const lines = prevTranscript.split('\n');
            // Remove the last line if it's interim (doesn't end with newline)
            if (lines.length > 0 && !lines[lines.length - 1].endsWith('\n')) {
              lines.pop();
            }
            return lines.join('\n') + `${speakerLabel}${interimText}`;
          });
          console.log(`Interim: ${interimSpeaker ? interimSpeaker + ':' : ''} ${interimText}`);
        } else {
           console.log('[Transcript] Skipping interim segment due to missing text:', { interimText, interimSpeaker });
        }
        break;

      case 'transcript_segment': // Handle both interim and final segments
        const { text: segmentText, speaker: segmentSpeaker, is_final } = message.data || {};
        
        // Log raw segment data received
        console.log('[Transcript] Received segment data:', { text: segmentText, speaker: segmentSpeaker, is_final });

        // Check condition for processing
        console.log('[Transcript] Checking segment condition: segmentText && segmentSpeaker', { segmentText, segmentSpeaker, conditionResult: segmentText && segmentSpeaker });

        if (segmentText && segmentSpeaker) {
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
          console.log('[Transcript] Skipping segment due to condition (text or speaker falsy):', { text: segmentText, speaker: segmentSpeaker });
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
  }, [toast, setTranscript, setSuggestion]); // Ensure all state setters used are in dependency array

  const handleStartRecording = async (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>, chatId: string | null) => {
    console.log('handleStartRecording called');
    
    try {
      // Request both audio and screen capture permissions
      const audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { 
          displaySurface: "monitor" 
        },
        audio: true 
      });
      
      // Save stream to ref for later cleanup
      streamRef.current = audioStream;
      
      // If we get here, permissions were granted
      setIsRecording(true);
      addDebugLog('Permissions granted. Recording started.', setDebugLog);
      
      // Connect to WebSocket if we have a chatId
      if (chatId) {
        const ws = getWebSocketInstance(chatId);
        ws.connect();
        
        // Register message handler
        const removeMessageHandler = ws.onMessage(handleWebSocketMessage);
        
        addDebugLog('WebSocket connection initiated', setDebugLog);
        
        // Create audio context and processor
        const audioContext = new AudioContext({
          sampleRate: 16000 // Match server requirements
        });
        audioContextRef.current = audioContext;
        
        const source = audioContext.createMediaStreamSource(audioStream);
        sourceRef.current = source;
        
        // ScriptProcessorNode is deprecated but widely supported
        // Consider migrating to AudioWorklet in the future
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        
        // Process audio data and send to WebSocket
        processor.onaudioprocess = (e) => {
          if (ws.isConnected()) {
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Convert float32 to int16 (better compression for transmission)
            const int16Data = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              int16Data[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32767));
            }
            
            // Log audio frame count for debugging
            audioFrameCountRef.current += 1;
            if (audioFrameCountRef.current % 50 === 0) { // Log every 50 frames to avoid console spam
              console.log(`[Audio Logger] Processing audio frame #${audioFrameCountRef.current}, size: ${int16Data.length} samples`);
            }
            
            // Send audio data through WebSocket
            ws.sendBinaryData(int16Data.buffer);
          }
        };
        
        // Connect the audio processing nodes
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        addDebugLog('Audio processing pipeline established', setDebugLog);
        
        // Clean up function to remove message handler and stop audio processing when unmounted
        return () => {
          removeMessageHandler();
          
          if (processorRef.current && sourceRef.current && audioContextRef.current) {
            processorRef.current.disconnect();
            sourceRef.current.disconnect();
            audioContextRef.current.close().catch(console.error);
            processorRef.current = null;
            sourceRef.current = null;
            audioContextRef.current = null;
          }
          
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          }
          
          displayStream.getTracks().forEach(track => track.stop());
        };
      }
      
      // Clean up function to stop tracks when recording is stopped
      return () => {
        audioStream.getTracks().forEach(track => track.stop());
        displayStream.getTracks().forEach(track => track.stop());
      };
    } catch (error) {
      console.error('Error getting media permissions:', error);
      addDebugLog(`Permission error: ${error}`, setDebugLog);
      toast({
        title: "Permission Error",
        description: "Could not access microphone or screen. Please grant permissions and try again.",
        variant: "destructive"
      });
    }
  };

  const handleStopRecording = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleStopRecording called');
    setIsRecording(false);
    addDebugLog('Recording stopped', setDebugLog);
    
    // Clean up audio processing
    if (processorRef.current && sourceRef.current && audioContextRef.current) {
      processorRef.current.disconnect();
      sourceRef.current.disconnect();
      audioContextRef.current.close().catch(console.error);
      processorRef.current = null;
      sourceRef.current = null;
      audioContextRef.current = null;
    }
    
    // Stop all tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Close WebSocket connection when recording is stopped
    closeWebSocketInstance();
    addDebugLog('WebSocket connection closed', setDebugLog);
    
    toast({
      description: "Recording stopped",
    });
  };

  const handleSuggest = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleSuggest called');
    addDebugLog('Suggestion requested', setDebugLog);
    toast({
      description: "Requesting suggestion...",
    });
    
    // Updated: Send message with the correct format for suggestion requests
    const ws = getWebSocketInstance(""); // We already have a singleton instance
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
    addDebugLog('Context reset', setDebugLog);
    
    // Send reset command to the server using the same format as the suggest command
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
    isRecording,
    transcript,
    suggestion,
    isConnected,
    handleStartRecording,
    handleStopRecording,
    handleSuggest,
    handleResetContext,
    setTranscript,
    setSuggestion,
    setIsConnected
  };
};