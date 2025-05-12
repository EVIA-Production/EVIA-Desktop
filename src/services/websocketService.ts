interface WebSocketMessage {
  type: string;
  content?: any;
  transcript?: string;
  suggestion?: string;
  error?: string;
}

export class ChatWebSocket {
  private ws: WebSocket | null = null;
  private chatId: string;
  private reconnectInterval: number = 3000;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private intentionalDisconnect: boolean = false;
  private serverUrl: string;
  private messageHandlers: ((message: WebSocketMessage) => void)[] = [];
  private connectionHandlers: ((connected: boolean) => void)[] = [];

  constructor(chatId: string) {
    this.chatId = chatId;
    
    // Hardcode the WebSocket URL for now
    this.serverUrl = "ws://localhost:5001";
    
    console.log('WebSocket server URL:', this.serverUrl);
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    this.intentionalDisconnect = false;
    
    try {
      // Get authentication details from localStorage
      const token = localStorage.getItem('auth_token') || '';
      const tokenType = localStorage.getItem('token_type') || 'Bearer';
      
      if (!token) {
        console.error('No authentication token available for WebSocket connection');
        this.connectionHandlers.forEach(handler => handler(false));
        return;
      }
      
      // Instead of trying to use cookies for cross-origin WebSocket authentication,
      // we'll include the token as a URL parameter which is more reliable for WebSockets
      const wsUrl = `${this.serverUrl}/ws/?chat_id=${this.chatId}&token=${encodeURIComponent(`${tokenType} ${token}`)}`;
      console.log('Connecting to WebSocket URL:', wsUrl);
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Connected to chat WebSocket');
        this.reconnectAttempts = 0;
        this.connectionHandlers.forEach(handler => handler(true));
      };

      this.ws.onmessage = (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          console.log('Received WebSocket message:', data);
          this.messageHandlers.forEach(handler => handler(data));
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.connectionHandlers.forEach(handler => handler(false));
      };

      this.ws.onclose = (event) => {
        console.log('Disconnected from WebSocket', event.code, event.reason);
        this.connectionHandlers.forEach(handler => handler(false));
        
        // Implement reconnection logic
        if (!this.intentionalDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          console.log(`Attempting to reconnect (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})...`);
          setTimeout(() => {
            this.reconnectAttempts++;
            this.connect();
          }, this.reconnectInterval);
        }
      };
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      this.connectionHandlers.forEach(handler => handler(false));
    }
  }

  sendMessage(message: WebSocketMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket not connected. Cannot send message.');
    }
  }

  onMessage(handler: (message: WebSocketMessage) => void) {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
    };
  }

  onConnectionChange(handler: (connected: boolean) => void) {
    this.connectionHandlers.push(handler);
    return () => {
      this.connectionHandlers = this.connectionHandlers.filter(h => h !== handler);
    };
  }

  disconnect() {
    this.intentionalDisconnect = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// Singleton instance to be shared across the application
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
