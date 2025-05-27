import { API_BASE_URL } from '../config/config';

interface ChatResponse {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string;
  user_id: string;
}

interface Transcript {
  id: number;
  chat_id: number;
  content: string;
  created_at: string;
  updated_at: string;
}

export const chatService = {
  /**
   * Creates a new chat session
   * @returns A promise that resolves to the chat ID
   */
  async createChat(): Promise<number> {
    try {
      const token = localStorage.getItem('auth_token');
      const tokenType = localStorage.getItem('token_type') || 'Bearer';
      
      if (!token) {
        throw new Error('No authentication token found');
      }
      
      const response = await fetch(`${API_BASE_URL}/chat/`, {
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
      localStorage.setItem('selectedChatId', String(chat.id));
      
      return chat.id;
    } catch (error) {
      console.error('Error creating chat:', error);
      throw error;
    }
  },

  /**
   * Gets all chats for the current user
   * @returns A promise that resolves to an array of chats
   */
  async getAllChats(): Promise<ChatResponse[]> {
    try {
      const token = localStorage.getItem('auth_token');
      const tokenType = localStorage.getItem('token_type') || 'Bearer';
      
      if (!token) {
        throw new Error('No authentication token found');
      }
      
      const response = await fetch(`${API_BASE_URL}/chat/`, {
        headers: {
          'Authorization': `${tokenType} ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to fetch chats:', errorText);
        throw new Error(`Failed to fetch chats: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching chats:', error);
      throw error;
    }
  },

  /**
   * Gets a specific chat by ID
   * @param chatId The ID of the chat to fetch
   * @returns A promise that resolves to the chat
   */
  async getChat(chatId: string): Promise<ChatResponse> {
    try {
      const token = localStorage.getItem('auth_token');
      const tokenType = localStorage.getItem('token_type') || 'Bearer';
      
      if (!token) {
        throw new Error('No authentication token found');
      }
      
      const response = await fetch(`${API_BASE_URL}/chat/${chatId}/`, {
        headers: {
          'Authorization': `${tokenType} ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to fetch chat:', errorText);
        throw new Error(`Failed to fetch chat: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching chat:', error);
      throw error;
    }
  },
  
  /**
   * Gets the current chat ID from localStorage
   * @returns The current chat ID or null if not found
   */
  getCurrentChatId(): string | null {
    return localStorage.getItem('selectedChatId');
  },

  /**
   * Updates the last_used_at timestamp for a chat
   * @param chatId The ID of the chat to update
   */
  async updateLastUsed(chatId: string): Promise<void> {
    try {
      const token = localStorage.getItem('auth_token');
      const tokenType = localStorage.getItem('token_type') || 'Bearer';
      
      if (!token) {
        throw new Error('No authentication token found');
      }
      
      const response = await fetch(`${API_BASE_URL}/chat/${chatId}/update-last-used/`, {
        method: 'PUT',
        headers: {
          'Authorization': `${tokenType} ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to update chat last used:', errorText);
        throw new Error(`Failed to update chat last used: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error updating chat last used:', error);
      throw error;
    }
  },

  /**
   * Gets transcripts for a specific chat
   * @param chatId The ID of the chat to fetch transcripts for
   * @returns A promise that resolves to an array of transcripts
   */
  async getChatTranscripts(chatId: string): Promise<Transcript[]> {
    try {
      const token = localStorage.getItem('auth_token');
      const tokenType = localStorage.getItem('token_type') || 'Bearer';
      
      if (!token) {
        throw new Error('No authentication token found');
      }
      
      const response = await fetch(`${API_BASE_URL}/chat/${chatId}/transcripts/`, {
        headers: {
          'Authorization': `${tokenType} ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to fetch transcripts:', errorText);
        throw new Error(`Failed to fetch transcripts: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching transcripts:', error);
      throw error;
    }
  },

  /**
   * Updates the name of a chat
   * @param chatId The ID of the chat to update
   * @param name The new name for the chat
   */
  async updateChatName(chatId: string, name: string): Promise<void> {
    try {
      const token = localStorage.getItem('auth_token');
      const tokenType = localStorage.getItem('token_type') || 'Bearer';
      
      if (!token) {
        throw new Error('No authentication token found');
      }
      
      const response = await fetch(`${API_BASE_URL}/chat/${chatId}/update-name/?name=${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: {
          'Authorization': `${tokenType} ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to update chat name:', errorText);
        throw new Error(`Failed to update chat name: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error updating chat name:', error);
      throw error;
    }
  },

  /**
   * Deletes a chat
   * @param chatId The ID of the chat to delete
   */
  async deleteChat(chatId: string): Promise<void> {
    try {
      const token = localStorage.getItem('auth_token');
      const tokenType = localStorage.getItem('token_type') || 'Bearer';
      
      if (!token) {
        throw new Error('No authentication token found');
      }
      
      const response = await fetch(`${API_BASE_URL}/chat/${chatId}/`, {
        method: 'DELETE',
        headers: {
          'Authorization': `${tokenType} ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to delete chat:', errorText);
        throw new Error(`Failed to delete chat: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error deleting chat:', error);
      throw error;
    }
  }
};
