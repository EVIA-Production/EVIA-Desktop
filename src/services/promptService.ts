import { API_BASE_URL } from '../config/config';

export interface SystemPrompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type CreatePromptData = Omit<SystemPrompt, 'id' | 'created_at' | 'updated_at'>;

export const promptService = {
  async getPrompts(): Promise<SystemPrompt[]> {
    const token = localStorage.getItem("auth_token");
    const tokenType = localStorage.getItem("token_type");
    
    if (!token || !tokenType) {
      throw new Error("Not authenticated");
    }

    console.log('Debug Info:', {
      'window.location.origin': window.location.origin,
      'API_BASE_URL': API_BASE_URL,
      'Full URL': `${API_BASE_URL}/admin/prompts/`,
      'Headers': {
        "Authorization": `${tokenType} ${token}`,
        "Accept": "application/json",
        "Origin": window.location.origin
      }
    });

    const response = await fetch(`${API_BASE_URL}/admin/prompts/`, {
      headers: {
        "Authorization": `${tokenType} ${token}`,
        "Accept": "application/json",
        "Origin": window.location.origin
      },
      mode: 'cors'
    });

    if (!response.ok) {
      throw new Error("Failed to fetch prompts");
    }

    return response.json();
  },

  async deletePrompt(promptId: string): Promise<void> {
    const token = localStorage.getItem("auth_token");
    const tokenType = localStorage.getItem("token_type");
    
    if (!token || !tokenType) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(`${API_BASE_URL}/admin/prompts/${promptId}`, {
      method: 'DELETE',
      headers: {
        "Authorization": `${tokenType} ${token}`,
        "Accept": "application/json",
        "Origin": window.location.origin
      },
      mode: 'cors'
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Failed to delete prompt:", response.status, errorBody);
      throw new Error(`Failed to delete prompt: ${response.statusText}`);
    }
  },

  async updatePrompt(promptId: string, promptData: Partial<SystemPrompt>): Promise<SystemPrompt> {
    const token = localStorage.getItem("auth_token");
    const tokenType = localStorage.getItem("token_type");
    
    if (!token || !tokenType) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(`${API_BASE_URL}/admin/prompts/${promptId}`, {
      method: 'PUT',
      headers: {
        "Content-Type": "application/json",
        "Authorization": `${tokenType} ${token}`,
        "Accept": "application/json",
        "Origin": window.location.origin
      },
      mode: 'cors',
      body: JSON.stringify(promptData),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Failed to update prompt:", response.status, errorBody);
      throw new Error(`Failed to update prompt: ${response.statusText}`);
    }

    return response.json();
  },

  async setActiveStatus(promptId: string, isActive: boolean): Promise<SystemPrompt> {
    return this.updatePrompt(promptId, { is_active: isActive });
  },

  async createPrompt(promptData: CreatePromptData): Promise<SystemPrompt> {
    const token = localStorage.getItem("auth_token");
    const tokenType = localStorage.getItem("token_type");
    
    if (!token || !tokenType) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(`${API_BASE_URL}/admin/prompts/`, {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        "Authorization": `${tokenType} ${token}`,
        "Accept": "application/json",
        "Origin": window.location.origin
      },
      mode: 'cors',
      body: JSON.stringify(promptData),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Failed to create prompt:", response.status, errorBody);
      throw new Error(`Failed to create prompt: ${response.statusText}`);
    }

    return response.json();
  }
};