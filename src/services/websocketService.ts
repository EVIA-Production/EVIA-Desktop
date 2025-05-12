
// This file has been simplified by removing websocket functionality

// Empty interface to maintain type safety for other parts of the app
interface WebSocketMessage {
  type: string;
  content?: any;
  transcript?: string;
  suggestion?: string;
  error?: string;
}

export class ChatWebSocket {
  private chatId: string;

  constructor(chatId: string) {
    this.chatId = chatId;
    console.log('WebSocket functionality has been disabled');
  }

  connect() {
    // WebSocket functionality has been removed
    console.log('WebSocket connect method called, but functionality has been removed');
  }

  sendMessage(message: WebSocketMessage) {
    // WebSocket functionality has been removed
    console.log('WebSocket sendMessage called, but functionality has been removed:', message);
  }

  onMessage(handler: (message: WebSocketMessage) => void) {
    // WebSocket functionality has been removed
    console.log('WebSocket onMessage called, but functionality has been removed');
    return () => {
      // No-op cleanup function
    };
  }

  onConnectionChange(handler: (connected: boolean) => void) {
    // WebSocket functionality has been removed
    console.log('WebSocket onConnectionChange called, but functionality has been removed');
    // Always report as disconnected since functionality is removed
    handler(false);
    return () => {
      // No-op cleanup function
    };
  }

  disconnect() {
    // WebSocket functionality has been removed
    console.log('WebSocket disconnect called, but functionality has been removed');
  }

  isConnected(): boolean {
    // Always return false as WebSocket functionality is removed
    return false;
  }
}

// Singleton instance (simplified)
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
