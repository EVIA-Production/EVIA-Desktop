
// Interface for WebSocket messages
export interface WebSocketMessage {
  type: string;
  content?: any;
  transcript?: string;
  suggestion?: string;
  error?: string;
  data?: {
    text?: string;
    speaker?: string;
    is_final?: boolean;
  };
}

export class ChatWebSocket {
  private chatId: string;
  private socket: WebSocket | null = null;
  private isConnected = false;

  constructor(chatId: string) {
    this.chatId = chatId;
    console.log('WebSocket instance created for chat:', chatId);
  }

  connect() {
    try {
      console.log('Connecting to WebSocket server...');
      // Set up your WebSocket connection using the provided details
      this.socket = new WebSocket(`ws://localhost:5001/ws/transcribe`);
      
      this.socket.onopen = () => {
        console.log('WebSocket connection established');
        this.isConnected = true;
        this.dispatchConnectionEvent(true);
      };
      
      this.socket.onclose = () => {
        console.log('WebSocket connection closed');
        this.isConnected = false;
        this.dispatchConnectionEvent(false);
      };
      
      this.socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnected = false;
        this.dispatchConnectionEvent(false);
      };
      
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      this.isConnected = false;
      this.dispatchConnectionEvent(false);
    }
  }
  
  private connectionListeners: ((connected: boolean) => void)[] = [];
  
  private dispatchConnectionEvent(connected: boolean) {
    this.connectionListeners.forEach(listener => listener(connected));
  }

  sendMessage(message: WebSocketMessage) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket is not connected. Cannot send message:', message);
      return;
    }
    
    console.log('Sending message to WebSocket server:', message);
    this.socket.send(JSON.stringify(message));
  }
  
  // Send binary audio data to the WebSocket server
  sendAudioData(audioData: ArrayBuffer) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket is not connected. Cannot send audio data');
      return;
    }
    
    this.socket.send(audioData);
  }

  onMessage(handler: (message: WebSocketMessage) => void) {
    if (!this.socket) {
      console.warn('WebSocket is not initialized');
      return () => {};
    }
    
    const messageHandler = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        console.log('Received message from WebSocket server:', message);
        handler(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    this.socket.addEventListener('message', messageHandler);
    
    return () => {
      this.socket?.removeEventListener('message', messageHandler);
    };
  }

  onConnectionChange(handler: (connected: boolean) => void) {
    this.connectionListeners.push(handler);
    // Immediately invoke with current state
    handler(this.isConnected);
    
    return () => {
      const index = this.connectionListeners.indexOf(handler);
      if (index !== -1) {
        this.connectionListeners.splice(index, 1);
      }
    };
  }

  disconnect() {
    if (this.socket) {
      console.log('Disconnecting WebSocket...');
      this.socket.close();
      this.socket = null;
      this.isConnected = false;
    }
  }

  isConnected(): boolean {
    return this.isConnected;
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
