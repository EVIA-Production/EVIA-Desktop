// Backend Service for EVIA-Desktop
export class BackendService {
  private baseUrl: string;
  private wsUrl: string;
  private wsConnection: WebSocket | null = null;
  private isConnected: boolean = false;

  constructor(baseUrl: string = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
    this.wsUrl = baseUrl.replace('http', 'ws');
  }

  // WebSocket connection for transcription
  async connectWebSocket(source: 'mic' | 'system' = 'mic'): Promise<boolean> {
    try {
      const wsUrl = `${this.wsUrl}/ws/transcribe?source=${source}`;
      this.wsConnection = new WebSocket(wsUrl);
      
      this.wsConnection.onopen = () => {
        console.log('WebSocket connected to:', wsUrl);
        this.isConnected = true;
      };
      
      this.wsConnection.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Emit transcription data
          window.dispatchEvent(new CustomEvent('transcription:data', { detail: data }));
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      this.wsConnection.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnected = false;
      };
      
      this.wsConnection.onclose = () => {
        console.log('WebSocket disconnected');
        this.isConnected = false;
      };
      
      return true;
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      return false;
    }
  }

  // Disconnect WebSocket
  disconnectWebSocket(): void {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
      this.isConnected = false;
    }
  }

  // Send audio data to WebSocket
  sendAudioData(data: ArrayBuffer): void {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      this.wsConnection.send(data);
    }
  }

  // API call to /ask endpoint
  async askQuestion(question: string, language: string = 'de'): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          language,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('API call failed:', error);
      throw error;
    }
  }

  // Get user settings from backend
  async getSettings(): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/me/settings`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to get settings:', error);
      throw error;
    }
  }

  // Update user settings on backend
  async updateSettings(settings: any): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/me/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to update settings:', error);
      throw error;
    }
  }

  // Check backend health
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        timeout: 5000
      });
      return response.ok;
    } catch (error) {
      console.error('Backend health check failed:', error);
      return false;
    }
  }

  // Get connection status
  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

// Export singleton instance
export const backendService = new BackendService();
