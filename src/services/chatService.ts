
interface ChatResponse {
  id: string;
  created_at: string;
  user_id: string;
}

export const chatService = {
  /**
   * Creates a new chat session
   * @returns A promise that resolves to the chat ID
   */
  async createChat(): Promise<string> {
    try {
      const token = localStorage.getItem('auth_token');
      const tokenType = localStorage.getItem('token_type') || 'Bearer';
      
      if (!token) {
        throw new Error('No authentication token found');
      }
      
      const response = await fetch('http://localhost:5001/chat/', {
        method: 'POST',
        headers: {
          'Authorization': `${tokenType} ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to create chat:', errorText);
        throw new Error(`Failed to create chat: ${response.status} ${response.statusText}`);
      }
      
      const chat: ChatResponse = await response.json();
      console.log('Chat created successfully:', chat);
      
      // Store the chat ID in localStorage for easy access
      localStorage.setItem('current_chat_id', chat.id);
      
      return chat.id;
    } catch (error) {
      console.error('Error creating chat:', error);
      throw error;
    }
  },
  
  /**
   * Gets the current chat ID from localStorage
   * @returns The current chat ID or null if not found
   */
  getCurrentChatId(): string | null {
    return localStorage.getItem('current_chat_id');
  }
};
