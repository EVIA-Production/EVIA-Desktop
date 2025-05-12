
// WebSocket service for real-time communication

// Interface to maintain type safety for messages
interface WebSocketMessage {
  type: string;
  content?: any;
  transcript?: string;
  suggestion?: string;
  error?: string;
}

export class ChatWebSocket {
  private chatId: string;
  private ws: WebSocket | null = null;
  private isConnectedFlag: boolean = false;

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

      this.ws.onclose = () => {
        console.log('WebSocket connection closed');
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
          const message = JSON.parse(event.data) as WebSocketMessage;
          console.log('WebSocket message received:', message);
          // Notify any message listeners
          this.messageHandlers.forEach(handler => handler(message));
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
      this.ws.close();
      this.ws = null;
      this.isConnectedFlag = false;
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
