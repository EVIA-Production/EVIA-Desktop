
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getWebSocketInstance, closeWebSocketInstance } from '@/services/websocketService';

export const useRecording = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const { toast } = useToast();
  
  const addDebugLog = (message: string, setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    setDebugLog(prev => [...prev, `[${new Date().toISOString()}] ${message}`]);
    console.log(`DEBUG: ${message}`);
  };

  const handleStartRecording = async (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleStartRecording called');
    
    try {
      // Request both audio and screen capture permissions
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { 
          displaySurface: "monitor" 
        },
        audio: true 
      });
      
      // Combine the streams
      const combinedStream = new MediaStream();
      
      // Add audio tracks
      audioStream.getAudioTracks().forEach(track => {
        combinedStream.addTrack(track);
      });
      
      // Add video tracks from display capture
      displayStream.getVideoTracks().forEach(track => {
        combinedStream.addTrack(track);
      });
      
      setMediaStream(combinedStream);
      
      // If we get here, permissions were granted
      setIsRecording(true);
      addDebugLog('Permissions granted. Recording started.', setDebugLog);
      
      // Connect to WebSocket with current chat ID
      const chatId = localStorage.getItem('current_chat_id') || 'default';
      const ws = getWebSocketInstance(chatId);
      ws.connect();
      
      // Set up WebSocket message handler for transcription and suggestions
      const removeMessageListener = ws.onMessage((message) => {
        console.log('Received WebSocket message:', message);
        
        // Handle transcript segments
        if (message.type === 'transcript_segment' && message.data) {
          if (message.data.is_final) {
            // Add final transcript segment to the full transcript
            setTranscript(prev => {
              const speaker = message.data?.speaker ? `Speaker ${message.data.speaker}: ` : '';
              return prev + (prev ? '\n' : '') + speaker + message.data!.text;
            });
          }
          // For non-final segments, we could show them in a different way if needed
        }
        
        // Handle suggestions
        if (message.type === 'suggestion' && message.content) {
          setSuggestion(message.content);
          toast({
            description: "New suggestion received",
          });
        }
        
        // Handle errors
        if (message.type === 'error') {
          toast({
            title: "Error",
            description: message.error || "An error occurred",
            variant: "destructive"
          });
        }
      });
      
      // Setup audio processing for WebSocket
      // This would be where you'd process the audio stream to send to WebSocket
      // Simplified implementation
      if (combinedStream.getAudioTracks().length > 0) {
        // In a real implementation, you would:
        // 1. Create AudioContext
        // 2. Create MediaStreamSource
        // 3. Process audio data
        // 4. Send to WebSocket
        addDebugLog('Audio stream ready for WebSocket transmission', setDebugLog);
      }
      
      // Clean up function to stop tracks and disconnect when recording is stopped
      return () => {
        removeMessageListener();
        if (combinedStream) {
          combinedStream.getTracks().forEach(track => track.stop());
        }
        closeWebSocketInstance();
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
    
    // Stop all media tracks
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
    }
    
    // Close WebSocket connection
    closeWebSocketInstance();
    
    toast({
      description: "Recording stopped",
    });
  };

  const handleSuggest = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleSuggest called');
    addDebugLog('Suggestion requested', setDebugLog);
    
    // Get the WebSocket instance and send a suggest command
    const chatId = localStorage.getItem('current_chat_id') || 'default';
    const ws = getWebSocketInstance(chatId);
    
    // Check if connected first
    if (ws.isConnected()) {
      ws.sendMessage({ type: 'command', content: 'suggest' });
      toast({
        description: "Requesting suggestion...",
      });
    } else {
      toast({
        title: "Connection Error",
        description: "Cannot request suggestion. WebSocket is not connected.",
        variant: "destructive"
      });
    }
  };

  const handleResetContext = (setDebugLog: React.Dispatch<React.SetStateAction<string[]>>) => {
    console.log('handleResetContext called');
    
    // Send reset command via WebSocket if connected
    const chatId = localStorage.getItem('current_chat_id') || 'default';
    const ws = getWebSocketInstance(chatId);
    
    if (ws.isConnected()) {
      ws.sendMessage({ type: 'command', content: 'reset' });
    }
    
    // Clear local state regardless of connection status
    setTranscript('');
    setSuggestion('');
    addDebugLog('Context reset', setDebugLog);
    
    toast({
      description: 'Context has been reset',
    });
  };

  return {
    isRecording,
    transcript,
    suggestion,
    handleStartRecording,
    handleStopRecording,
    handleSuggest,
    handleResetContext,
    setTranscript,
    setSuggestion
  };
};
