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
  // Add other metrics as needed
}

interface UserMetrics {
  session_count?: number;
  avg_duration?: number;
  total_suggestions?: number;
  avg_suggestions?: number;
  // Add other metrics as needed
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