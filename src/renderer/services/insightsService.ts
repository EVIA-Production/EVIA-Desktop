// Insights service for fetching and normalizing insights payloads.
import { BACKEND_URL } from '../config/config';

export interface InsightActionItem {
  label: string;
  icon?: string;
}

export interface Insight {
  summary: string[];
  prospect_info?: string[];
  sales_analysis?: string[];
  meeting_title?: string;
  topic: {
    header: string;
    bullets: string[];
  };
  actions: string[];
  action_items?: InsightActionItem[];
  followUps?: string[];
  session_state?: 'before' | 'during' | 'after';
  stub?: boolean;
}

interface FetchInsightsParams {
  chatId: number;
  k?: number;
  language?: string;
  token: string;
  baseUrl?: string;
  sessionState?: 'before' | 'during' | 'after'; // CRITICAL FIX: Add session state
}

export async function fetchInsights({
  chatId,
  k = 3,
  language = 'de',
  token,
  baseUrl,
  sessionState = 'during',
}: FetchInsightsParams): Promise<Insight | null> {
  const url = baseUrl || BACKEND_URL;
  
  // CRITICAL FIX: Retry logic for transient network errors
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff
  
  const inferIcon = (label: string): string => {
    if (label.startsWith('💬')) return 'chat';
    if (label.startsWith('❓')) return 'question';
    if (label.startsWith('✨')) return 'sparkle';
    if (label.startsWith('📧')) return 'mail';
    if (label.startsWith('📞')) return 'phone';
    if (label.startsWith('📊')) return 'chart';
    return 'sparkle';
  };

  const normalizeInsightPayload = (data: any): Insight => {
    const summary = Array.isArray(data?.prospect_info)
      ? data.prospect_info
      : Array.isArray(data?.summary)
      ? data.summary
      : [];
    const salesAnalysis = Array.isArray(data?.sales_analysis)
      ? data.sales_analysis
      : Array.isArray(data?.topic?.bullets)
      ? data.topic.bullets
      : [];
    const actionItems: InsightActionItem[] = Array.isArray(data?.action_items)
      ? data.action_items
          .filter((item: any) => item && typeof item.label === 'string' && item.label.trim())
          .map((item: any) => ({
            label: item.label.trim(),
            icon: typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim() : inferIcon(item.label.trim()),
          }))
      : Array.isArray(data?.actions)
      ? data.actions
          .filter((label: any) => typeof label === 'string' && label.trim())
          .map((label: string) => ({
            label: label.trim(),
            icon: inferIcon(label.trim()),
          }))
      : [];

    return {
      ...data,
      summary,
      prospect_info: summary,
      sales_analysis: salesAnalysis,
      meeting_title: typeof data?.meeting_title === 'string' ? data.meeting_title.trim() : '',
      topic: {
        header:
          typeof data?.topic?.header === 'string' && data.topic.header.trim()
            ? data.topic.header.trim()
            : language === 'en'
            ? 'Sales Analysis'
            : 'Sales Analyse',
        bullets: salesAnalysis,
      },
      actions: actionItems.map((item) => item.label),
      action_items: actionItems,
      followUps: Array.isArray(data?.followUps) ? data.followUps.filter((item: any) => typeof item === 'string') : [],
      session_state: data?.session_state,
      stub: data?.stub === true,
    };
  };

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

      const normalized = normalizeInsightPayload(data);

      console.log('[Insights] ✅ Received Glass format with follow-ups:', {
        meetingTitle: normalized.meeting_title,
        prospectInfoCount: normalized.prospect_info?.length || 0,
        salesAnalysisCount: normalized.sales_analysis?.length || 0,
        actionsCount: normalized.actions?.length || 0,
        stub: normalized.stub === true,
      });
      return normalized;
    } catch (error) {
      // CRITICAL FIX: Retry on network errors
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
