
import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

interface TranscriptSegment {
  text: string;
  speaker: string | null;
  is_final: boolean;
}

interface SuggestionData {
  suggestion: string;
}

interface UseTranscriptionWebSocketProps {
  onTranscriptUpdate?: (segment: TranscriptSegment) => void;
  onSuggestionReceived?: (suggestion: string) => void;
  onStatusUpdate?: (status: string) => void;
  onError?: (error: string) => void;
  autoConnect?: boolean;
  websocketUrl?: string;
}

export const useTranscriptionWebSocket = ({
  onTranscriptUpdate,
  onSuggestionReceived,
  onStatusUpdate,
  onError,
  autoConnect = false,
  websocketUrl = 'ws://localhost:8000/ws/transcribe'
}: UseTranscriptionWebSocketProps = {}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  
  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    try {
      console.log(`Connecting to WebSocket at ${websocketUrl}`);
      setIsConnecting(true);
      
      socketRef.current = new WebSocket(websocketUrl);
      
      socketRef.current.onopen = () => {
        console.log('WebSocket connection established');
        setIsConnected(true);
        setIsConnecting(false);
        toast({
          description: "Connected to transcription service",
        });
        if (onStatusUpdate) onStatusUpdate('connected');
      };
      
      socketRef.current.onmessage = (event) => {
        console.log('WebSocket message received');
        try {
          const data = JSON.parse(event.data);
          console.log('Parsed WebSocket message:', data);
          
          switch (data.type) {
            case 'transcript_segment':
              console.log('Transcript segment received:', data.data);
              if (onTranscriptUpdate) onTranscriptUpdate(data.data);
              break;
              
            case 'suggestion':
              console.log('Suggestion received:', data.data);
              if (onSuggestionReceived) onSuggestionReceived(data.data);
              break;
              
            case 'status':
              console.log('Status update received:', data.data);
              if (onStatusUpdate) onStatusUpdate(data.data);
              break;
              
            case 'error':
              console.error('Error from server:', data.data);
              if (onError) onError(data.data);
              toast({
                title: 'Server Error',
                description: data.data,
                variant: 'destructive'
              });
              break;
              
            default:
              console.warn('Unknown message type:', data.type);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message', error);
        }
      };
      
      socketRef.current.onclose = (event) => {
        console.log('WebSocket connection closed', event.code, event.reason);
        setIsConnected(false);
        setIsConnecting(false);
        if (onStatusUpdate) onStatusUpdate('disconnected');
        
        if (event.code !== 1000) { // Not a normal closure
          toast({
            title: 'Connection Closed',
            description: `WebSocket closed: ${event.reason || 'Unknown reason'}`,
          });
        }
      };
      
      socketRef.current.onerror = (event) => {
        console.error('WebSocket error:', event);
        setIsConnected(false);
        setIsConnecting(false);
        toast({
          title: 'Connection Error',
          description: 'Failed to connect to transcription service',
          variant: 'destructive'
        });
        if (onError) onError('WebSocket connection error');
        if (onStatusUpdate) onStatusUpdate('error');
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setIsConnected(false);
      setIsConnecting(false);
      toast({
        title: 'Connection Error',
        description: 'Failed to create WebSocket connection',
        variant: 'destructive'
      });
      if (onError) onError('Failed to create WebSocket connection');
      if (onStatusUpdate) onStatusUpdate('error');
    }
  }, [websocketUrl, onTranscriptUpdate, onSuggestionReceived, onStatusUpdate, onError, toast]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      console.log('Closing WebSocket connection');
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  const sendAudioData = useCallback((audioData: ArrayBuffer) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      console.log(`Sending audio data: ${audioData.byteLength} bytes`);
      socketRef.current.send(audioData);
      return true;
    } else {
      console.error('Cannot send audio: WebSocket is not connected');
      return false;
    }
  }, []);

  const sendCommand = useCallback((command: string, data: any = {}) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({
        command,
        ...data
      });
      console.log(`Sending command: ${payload}`);
      socketRef.current.send(payload);
      return true;
    } else {
      console.error('Cannot send command: WebSocket is not connected');
      toast({
        description: 'Cannot send command: not connected to server',
        variant: 'destructive'
      });
      return false;
    }
  }, [toast]);

  const requestSuggestion = useCallback(() => {
    return sendCommand('suggest');
  }, [sendCommand]);

  const resetContext = useCallback(() => {
    return sendCommand('reset');
  }, [sendCommand]);

  // Auto-connect on mount if enabled
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    
    // Clean up on unmount
    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    isConnected,
    isConnecting,
    connect,
    disconnect,
    sendAudioData,
    requestSuggestion,
    resetContext
  };
};
