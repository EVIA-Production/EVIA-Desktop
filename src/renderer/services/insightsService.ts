// Insights service for fetching and managing insights
export interface Insight {
  id: string;
  title: string;
  prompt: string;
  created_at: string;
}

interface FetchInsightsParams {
  chatId: number;
  k?: number;
  language?: string;
  token: string;
  baseUrl?: string;
}

export async function fetchInsights({
  chatId,
  k = 3,
  language = 'de',
  token,
  baseUrl,
}: FetchInsightsParams): Promise<Insight[]> {
  const url = baseUrl || (window as any).EVIA_BACKEND_URL || (window as any).API_BASE_URL || 'http://localhost:8000';
  
  try {
    console.log('[Insights] Fetching insights for chat', chatId);
    const response = await fetch(`${url.replace(/\/$/, '')}/insights`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ chat_id: chatId, k, language }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('[Insights] Received', data.length, 'insights');
    return data as Insight[];
  } catch (error) {
    console.error('[Insights] Fetch failed:', error);
    // Return empty array on error
    return [];
  }
}

