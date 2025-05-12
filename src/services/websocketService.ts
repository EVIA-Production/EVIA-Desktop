
// WebSocket service for real-time communication

// Interface to maintain type safety for messages
interface WebSocketMessage {
  type: string;
  data?: {
    text?: string;
    speaker?: number | null;
    is_final?: boolean;
  } | string; // Update: data can be string for suggestions
  content?: any;
  transcript?: string;
  suggestion?: string;
  error?: string;
}

export class ChatWebSocket {
  private chatId: string;
  private ws: WebSocket | null = null;
  private isConnectedFlag: boolean = false;
  private lastAudioLevel: number = 0;
  private silenceThreshold: number = 0.01;
  private audioDetected: boolean = false;

  constructor(chatId: string) {
    this.chatId = chatId;
    console.log('ChatWebSocket initialized with chatId:', chatId);
  }

  connect() {
    try {
      // Connect to the WebSocket server
      this.ws = new WebSocket('ws://localhost:5001/ws/transcribe');
      
      // Set up event handlers
      this.ws.onopen = () => {
        console.log('WebSocket connection established');
        this.isConnectedFlag = true;
        // Notify any connection change listeners
        this.connectionChangeHandlers.forEach(handler => handler(true));
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason || 'No reason provided');
        this.isConnectedFlag = false;
        // Notify any connection change listeners
        this.connectionChangeHandlers.forEach(handler => handler(false));
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnectedFlag = false;
        // Notify any connection change listeners
        this.connectionChangeHandlers.forEach(handler => handler(false));
      };

      this.ws.onmessage = (event) => {
        try {
          // Handle both text and binary messages
          if (typeof event.data === 'string') {
            const message = JSON.parse(event.data) as WebSocketMessage;
            console.log('WebSocket message received:', message);
            // Notify any message listeners
            this.messageHandlers.forEach(handler => handler(message));
          } else {
            console.log('Received binary data');
            // Currently we don't expect binary responses from the server,
            // but we could handle them here if needed
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      this.isConnectedFlag = false;
    }
  }

  private messageHandlers: ((message: WebSocketMessage) => void)[] = [];
  private connectionChangeHandlers: ((connected: boolean) => void)[] = [];

  sendMessage(message: WebSocketMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      console.log('Message sent:', message);
    } else {
      console.warn('WebSocket is not connected, cannot send message:', message);
    }
  }

  sendBinaryData(data: ArrayBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Check audio levels in the buffer to detect audio
      const int16Data = new Int16Array(data);
      const audioLevel = this.calculateAudioLevel(int16Data);
      
      // Detect if audio is present
      const hasAudio = audioLevel > this.silenceThreshold;
      
      // Log when audio state changes (from silence to sound or vice versa)
      if (hasAudio && !this.audioDetected) {
        console.log(`[Audio Logger] Audio detected - Level: ${audioLevel.toFixed(4)}`);
        this.audioDetected = true;
      } else if (!hasAudio && this.audioDetected) {
        console.log(`[Audio Logger] Audio ended - Level dropped to ${audioLevel.toFixed(4)}`);
        this.audioDetected = false;
      }
      
      // Update last audio level
      this.lastAudioLevel = audioLevel;
      
      // Send the data
      this.ws.send(data);
      console.log(`[Audio Logger] Audio data sent - Size: ${data.byteLength} bytes, Level: ${audioLevel.toFixed(4)}`);
    } else {
      console.warn('WebSocket is not connected, cannot send binary data');
    }
  }

  // Calculate audio level (RMS) from int16 audio buffer
  private calculateAudioLevel(buffer: Int16Array): number {
    let sum = 0;
    // Calculate sum of squares
    for (let i = 0; i < buffer.length; i++) {
      // Normalize to range -1 to 1
      const sample = buffer[i] / 32767;
      sum += sample * sample;
    }
    // Return RMS (root mean square)
    return Math.sqrt(sum / buffer.length);
  }

  onMessage(handler: (message: WebSocketMessage) => void) {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
    };
  }

  onConnectionChange(handler: (connected: boolean) => void) {
    this.connectionChangeHandlers.push(handler);
    // Immediately call with current status
    handler(this.isConnectedFlag);
    return () => {
      this.connectionChangeHandlers = this.connectionChangeHandlers.filter(h => h !== handler);
    };
  }

  disconnect() {
    if (this.ws) {
      console.log('Actively closing WebSocket connection');
      this.ws.close(1000, 'User stopped recording');
      this.ws = null;
      this.isConnectedFlag = false;
      // Notify any connection change listeners
      this.connectionChangeHandlers.forEach(handler => handler(false));
    }
  }

  isConnected(): boolean {
    return this.isConnectedFlag;
  }
}

// Singleton instance
let wsInstance: ChatWebSocket | null = null;

export const getWebSocketInstance = (chatId: string): ChatWebSocket => {
  if (!wsInstance && chatId) {
    wsInstance = new ChatWebSocket(chatId);
  }
  return wsInstance!;
};

export const closeWebSocketInstance = () => {
  if (wsInstance) {
    wsInstance.disconnect();
    wsInstance = null;
  }
};
