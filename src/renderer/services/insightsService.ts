// Insights service for fetching and managing insights
// Glass format: {summary: [], topic: {header, bullets}, actions: []}
export interface Insight {
  summary: string[];
  topic: {
    header: string;
    bullets: string[];
  };
  actions: string[];
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
}: FetchInsightsParams): Promise<Insight | null> {
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
    console.log('[Insights] Received Glass format:', {
      summaryCount: data.summary?.length || 0,
      topicHeader: data.topic?.header,
      actionsCount: data.actions?.length || 0
    });
    return data as Insight;
  } catch (error) {
    console.error('[Insights] Fetch failed:', error);
    // Return null on error
    return null;
  }
}

