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
  websocketUrl = 'ws://localhost:5001/ws/transcribe'
}: UseTranscriptionWebSocketProps = {}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const connectionAttemptsRef = useRef(0);
  const { toast } = useToast();
  
  const connect = useCallback(async () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }
    
    if (isConnecting) {
      console.log('WebSocket connection attempt already in progress');
      return;
    }

    try {
      console.log(`Connecting to WebSocket at ${websocketUrl}`);
      setIsConnecting(true);
      
      // Close any existing connection first
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      
      socketRef.current = new WebSocket(websocketUrl);
      
      // Track connection attempts
      connectionAttemptsRef.current++;
      console.log(`Connection attempt #${connectionAttemptsRef.current}`);
      
      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        if (socketRef.current && socketRef.current.readyState !== WebSocket.OPEN) {
          console.error('WebSocket connection timed out');
          socketRef.current.close();
          setIsConnecting(false);
          setIsConnected(false);
          toast({
            title: 'Connection Timeout',
            description: 'Timed out connecting to transcription service. Is your server running?',
            variant: 'destructive'
          });
          if (onError) onError('WebSocket connection timed out');
          if (onStatusUpdate) onStatusUpdate('timeout');
        }
      }, 5000); // 5 second timeout
      
      socketRef.current.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket connection established');
        setIsConnected(true);
        setIsConnecting(false);
        // Reset connection attempts counter on successful connection
        connectionAttemptsRef.current = 0;
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
        clearTimeout(connectionTimeout);
        console.log('WebSocket connection closed', event.code, event.reason);
        setIsConnected(false);
        setIsConnecting(false);
        if (onStatusUpdate) onStatusUpdate('disconnected');
        
        if (event.code !== 1000) { // Not a normal closure
          toast({
            title: 'Connection Closed',
            description: `WebSocket closed: ${event.reason || 'Server unavailable. Is your backend running?'}`,
          });
        }
      };
      
      socketRef.current.onerror = (event) => {
        clearTimeout(connectionTimeout);
        console.error('WebSocket error:', event);
        setIsConnected(false);
        setIsConnecting(false);
        
        // More helpful error message
        const errorMessage = connectionAttemptsRef.current > 1 ? 
          'Failed to connect to transcription service. Make sure your backend server is running.' : 
          'Failed to connect to transcription service. Check your network connection.';
        
        toast({
          title: 'Connection Error',
          description: errorMessage,
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
        description: 'Failed to create WebSocket connection. Make sure your backend server is running.',
        variant: 'destructive'
      });
      if (onError) onError('Failed to create WebSocket connection');
      if (onStatusUpdate) onStatusUpdate('error');
    }
  }, [websocketUrl, onTranscriptUpdate, onSuggestionReceived, onStatusUpdate, onError, toast, isConnecting]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      console.log('Closing WebSocket connection');
      socketRef.current.close();
      socketRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const sendAudioData = useCallback((audioData: ArrayBuffer) => {
    if (!socketRef.current) {
      console.error('Cannot send audio: WebSocket not initialized');
      return false;
    }
    
    if (socketRef.current.readyState === WebSocket.OPEN) {
      console.log(`Sending audio data: ${audioData.byteLength} bytes`);
      socketRef.current.send(audioData);
      return true;
    } else {
      console.error(`Cannot send audio: WebSocket is not connected (state: ${socketRef.current.readyState})`);
      if (socketRef.current.readyState === WebSocket.CONNECTING) {
        console.log('WebSocket is still connecting, waiting...');
      } else if (socketRef.current.readyState === WebSocket.CLOSING || socketRef.current.readyState === WebSocket.CLOSED) {
        console.log('WebSocket is closed or closing, attempting to reconnect...');
        connect(); // Try to reconnect
      }
      return false;
    }
  }, [connect]);

  const sendCommand = useCallback((command: string, data: any = {}) => {
    if (!socketRef.current) {
      console.error('Cannot send command: WebSocket not initialized');
      toast({
        description: 'Cannot send command: not connected to server',
        variant: 'destructive'
      });
      return false;
    }
    
    if (socketRef.current.readyState === WebSocket.OPEN) {
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
      
      // If socket is closed or closing, try to reconnect
      if (socketRef.current.readyState === WebSocket.CLOSED || socketRef.current.readyState === WebSocket.CLOSING) {
        connect();
      }
      return false;
    }
  }, [connect, toast]);

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

  // Expose connection state
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
