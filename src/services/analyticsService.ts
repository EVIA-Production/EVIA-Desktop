// Helper function to get auth header
const getAuthHeader = () => {
  const token = localStorage.getItem('auth_token');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
};

interface Metrics {
  total_sessions?: number;
  avg_duration?: number;
  total_suggestions?: number;
  avg_suggestions?: number;
  total_errors?: number;
  avg_transcription_latency?: number;
  avg_suggestion_latency?: number;
  total_token_usage?: number;
  avg_sessions_per_week?: number;
  feature_usage?: Record<string, number>;
  avg_time_to_first?: number;
  avg_error_rate?: number;
  avg_deepgram_time?: number;
  avg_groq_time?: number;
  avg_tokens_per_suggestion?: number;
  retention_rate?: number;
  total_api_cost?: number;
  total_deepgram_calls?: number;
  total_groq_calls?: number;
}

interface UserMetrics {
  session_count?: number;
  avg_duration?: number;
  total_suggestions?: number;
  avg_suggestions?: number;
  total_errors?: number;
  avg_transcription_latency?: number;
  avg_suggestion_latency?: number;
  total_token_usage?: number;
  sessions_per_week?: number;
  feature_usage?: Record<string, number>;
  avg_time_to_first?: number;
  error_rate?: number;
  avg_deepgram_time?: number;
  avg_groq_time?: number;
  avg_tokens_per_suggestion?: number;
  total_api_cost?: number;
  deepgram_calls?: number;
  groq_calls?: number;
}

class AnalyticsService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
  }

  async getOverallMetrics(): Promise<Metrics> {
    try {
      const response = await fetch(`${this.baseUrl}/admin/metrics/`, {
        headers: {
          ...getAuthHeader()
        }
      });

      if (!response.ok) {
        throw new Error(`Error fetching metrics: ${response.status}`);
      }

      const data = await response.json();
      console.log('Overall metrics data:', data);
      return data;
    } catch (error) {
      console.error('Failed to fetch overall metrics:', error);
      throw error;
    }
  }

  async getUserMetrics(username: string): Promise<UserMetrics> {
    try {
      const response = await fetch(`${this.baseUrl}/admin/users/${username}/metrics/`, {
        headers: {
          ...getAuthHeader()
        }
      });

      if (!response.ok) {
        throw new Error(`Error fetching user metrics: ${response.status}`);
      }

      const data = await response.json();
      console.log(`Metrics data for user ${username}:`, data);
      return data;
    } catch (error) {
      console.error(`Failed to fetch metrics for user ${username}:`, error);
      throw error;
    }
  }
}

export default new AnalyticsService();