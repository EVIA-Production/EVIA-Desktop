
import { useState, useRef, useCallback } from 'react';
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
      
      // Create a new WebSocket with the Binary type set to 'arraybuffer'
      socketRef.current = new WebSocket(websocketUrl);
      socketRef.current.binaryType = 'arraybuffer'; // Crucial for binary audio data
      
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
        console.log('WebSocket message received:', typeof event.data);
        
        try {
          // Check if data is a string (JSON) or binary
          if (typeof event.data === 'string') {
            const data = JSON.parse(event.data);
            console.log('Parsed WebSocket message:', data);
            
            // Log the exact structure to help debug
            console.log('Message type:', data.type);
            console.log('Message data:', data.data);
            
            // Process different message types from backend
            switch (data.type) {
              case 'transcript_segment':
                console.log('Transcript segment received:', data.data);
                if (onTranscriptUpdate) onTranscriptUpdate(data.data);
                break;
                
              case 'suggestion':
                console.log('Suggestion received:', data.data);
                if (onSuggestionReceived) {
                  // Check if suggestion is a string or wrapped in an object
                  const suggestionText = typeof data.data === 'string' ? data.data : data.data.suggestion;
                  onSuggestionReceived(suggestionText);
                }
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
                // Try to handle untyped messages or other formats
                handleUnstructuredMessage(data);
            }
          } else if (event.data instanceof ArrayBuffer) {
            // Handle binary data if needed
            console.log('Received binary data from server, length:', event.data.byteLength);
          } else {
            console.warn('Received unhandled data type:', typeof event.data);
          }
        } catch (error) {
          console.error('Error processing WebSocket message', error, 'Raw message:', event.data);
          
          // Try to handle plain text or unstructured messages
          if (typeof event.data === 'string') {
            handleUnstructuredMessage(event.data);
          }
        }
      };
      
      // Helper function to handle unstructured or non-standard messages
      const handleUnstructuredMessage = (data: any) => {
        try {
          // If it's an object with a 'text' property, treat as transcript
          if (data && (data.text !== undefined || data.transcript !== undefined)) {
            console.log('Processing as unstructured transcript data');
            if (onTranscriptUpdate) {
              onTranscriptUpdate({
                text: data.text || data.transcript || '',
                speaker: data.speaker || null,
                is_final: data.is_final !== undefined ? data.is_final : true
              });
            }
          } 
          // If it's a string, try to parse as JSON or treat as plain text
          else if (typeof data === 'string') {
            if (data.trim().startsWith('{') || data.trim().startsWith('[')) {
              try {
                const jsonData = JSON.parse(data);
                console.log('Parsed plain JSON message:', jsonData);
                
                // Check for common transcript patterns
                if (jsonData.text || jsonData.transcript) {
                  console.log('Found text/transcript in JSON, treating as transcript');
                  if (onTranscriptUpdate) {
                    onTranscriptUpdate({
                      text: jsonData.text || jsonData.transcript || '',
                      speaker: jsonData.speaker || null,
                      is_final: jsonData.is_final !== undefined ? jsonData.is_final : true
                    });
                  }
                }
              } catch (jsonError) {
                console.log('Not valid JSON, treating as plain text');
                if (onTranscriptUpdate && data.trim()) {
                  onTranscriptUpdate({
                    text: data,
                    speaker: null,
                    is_final: true
                  });
                }
              }
            } else if (data.trim()) {
              console.log('Treating as plain text transcript');
              if (onTranscriptUpdate) {
                onTranscriptUpdate({
                  text: data,
                  speaker: null,
                  is_final: true
                });
              }
            }
          }
        } catch (e) {
          console.error('Error in handleUnstructuredMessage:', e);
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
      // Send as binary data - CRUCIAL for Deepgram compatibility
      console.log(`Sending audio data: ${audioData.byteLength} bytes as binary`);
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
  }, [toast]);

  const requestSuggestion = useCallback(() => {
    return sendCommand('suggest');
  }, [sendCommand]);

  const resetContext = useCallback(() => {
    return sendCommand('reset');
  }, [sendCommand]);

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
