// Insights service for fetching and managing insights
// Glass format: {summary: [], topic: {header, bullets}, actions: [], followUps: []}
import { BACKEND_URL } from '../config/config';

export interface Insight {
  summary: string[];
  topic: {
    header: string;
    bullets: string[];
  };
  actions: string[];
  followUps?: string[]; // 🔧 FIX #3: Follow-up actions shown after recording completes
  session_state?: 'before' | 'during' | 'after'; // 🔥 CRITICAL: Session state when insights were generated
}

interface FetchInsightsParams {
  chatId: number;
  k?: number;
  language?: string;
  token: string;
  baseUrl?: string;
  sessionState?: 'before' | 'during' | 'after'; // 🔥 CRITICAL FIX: Add session state
}

export async function fetchInsights({
  chatId,
  k = 3,
  language = 'de',
  token,
  baseUrl,
  sessionState = 'before', // 🔥 Default to 'before' if not provided
}: FetchInsightsParams): Promise<Insight | null> {
  const url = baseUrl || BACKEND_URL;
  
  // 🔥 CRITICAL FIX: Retry logic for transient network errors
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`[Insights] Fetching insights for chat ${chatId} (attempt ${attempt + 1}/${MAX_RETRIES}) session_state: ${sessionState}`);
      const response = await fetch(`${url.replace(/\/$/, '')}/insights`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chat_id: chatId, k, language, session_state: sessionState }),
      });

      if (!response.ok) {
        // Only retry on 5xx errors (server issues), not 4xx (client errors)
        if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
          console.warn(`[Insights] ⚠️ Server error ${response.status}, retrying in ${RETRY_DELAYS[attempt]}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
    
    // 🔧 FIX #3: Add default follow-up actions (Glass parity)
    // These are shown after recording completes, providing next-step options
    const followUps = language === 'en' 
      ? ['✉️ Draft a follow-up email', '✅ Generate action items', '📝 Show summary']
      : ['✉️ Verfasse eine Follow-up E-Mail', '✅ Generiere Aktionspunkte', '📝 Zeige Zusammenfassung'];
    
    const insightWithFollowUps = {
      ...data,
      followUps
    };
    
      console.log('[Insights] ✅ Received Glass format with follow-ups:', {
        summaryCount: data.summary?.length || 0,
        topicHeader: data.topic?.header,
        actionsCount: data.actions?.length || 0,
        followUpsCount: followUps.length
      });
      return insightWithFollowUps as Insight;
    } catch (error) {
      // 🔥 CRITICAL FIX: Retry on network errors
      const isNetworkError = error instanceof TypeError || 
                             (error instanceof Error && error.message.includes('Failed to fetch'));
      
      if (isNetworkError && attempt < MAX_RETRIES - 1) {
        console.warn(`[Insights] ⚠️ Network error, retrying in ${RETRY_DELAYS[attempt]}ms...`, error);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
        continue;
      }
      
      console.error(`[Insights] ❌ Fetch failed after ${attempt + 1} attempts:`, error);
      // Return null on error (graceful degradation)
      return null;
    }
  }
  
  // Should never reach here, but TypeScript requires it
  return null;
}

