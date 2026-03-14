// Insights service for fetching and normalizing insights payloads.
import { BACKEND_URL } from '../config/config';

export interface InsightActionItem {
  label: string;
  icon?: string;
  prompt?: string;
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
  followUpActions?: InsightActionItem[];
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

const getCanonicalAfterActions = (language: string): Record<string, InsightActionItem> =>
  language === 'en'
    ? {
        follow_up_email: {
          label: '📧 Follow-up Email',
          icon: 'mail',
          prompt: 'Write ONLY a send-ready follow-up email based on the meeting. No CRM, no summary, no action items.',
        },
        follow_up_plan: {
          label: '📞 Plan follow-up',
          icon: 'phone',
          prompt: 'Create ONLY a follow-up plan with goal, next contact, owner, date, and risks. No email, no CRM, no summary.',
        },
        action_items: {
          label: '📋 Action Items',
          icon: 'check',
          prompt: 'List ONLY the explicit action items, commitments, and next steps from the meeting. No email, no CRM, no summary.',
        },
        crm_update: {
          label: '📊 Update CRM',
          icon: 'chart',
          prompt: 'Create ONLY a CRM update in field format from the meeting. No email, no summary.',
        },
        summary: {
          label: '📝 Summary',
          icon: 'note',
          prompt: 'Create ONLY a compact meeting summary with key outcome and next step. No CRM, no email, no action items.',
        },
      }
    : {
        follow_up_email: {
          label: '📧 Follow-up E-Mail',
          icon: 'mail',
          prompt: 'Schreibe NUR eine versandfertige Follow-up E-Mail auf Basis des Gesprächs. Kein CRM, keine Zusammenfassung, keine Action Items.',
        },
        follow_up_plan: {
          label: '📞 Follow-up planen',
          icon: 'phone',
          prompt: 'Erstelle NUR einen Follow-up-Plan mit Ziel, nächstem Kontakt, Verantwortlichen, Datum und Risiken. Keine E-Mail, kein CRM, keine Zusammenfassung.',
        },
        action_items: {
          label: '📋 Action Items',
          icon: 'check',
          prompt: 'Liste NUR die expliziten Action Items, Zusagen und nächsten Schritte aus dem Gespräch auf. Keine E-Mail, kein CRM, keine Zusammenfassung.',
        },
        crm_update: {
          label: '📊 CRM aktualisieren',
          icon: 'chart',
          prompt: 'Erstelle NUR einen CRM-Eintrag im Feldformat auf Basis des Gesprächs. Keine E-Mail, keine Zusammenfassung.',
        },
        summary: {
          label: '📝 Zusammenfassung',
          icon: 'note',
          prompt: 'Erstelle NUR eine kompakte Gesprächszusammenfassung mit Kernergebnis und nächstem Schritt. Kein CRM, keine E-Mail, keine Action Items.',
        },
      };

const AFTER_ACTION_ORDER = ['follow_up_email', 'follow_up_plan', 'action_items', 'crm_update', 'summary'] as const;

const classifyAfterAction = (label: string): (typeof AFTER_ACTION_ORDER)[number] | null => {
  const lowered = (label || '').trim().toLowerCase();
  if (!lowered) return null;
  if (
    lowered.includes('recap') ||
    (lowered.includes('follow') && lowered.includes('mail')) ||
    (lowered.includes('follow') && lowered.includes('email'))
  ) {
    return 'follow_up_email';
  }
  if (lowered.includes('crm')) return 'crm_update';
  if (lowered.includes('action item')) return 'action_items';
  if (lowered.includes('zusammenfassung') || lowered.includes('summary')) return 'summary';
  if (lowered.includes('follow-up') || lowered.includes('follow up') || lowered.includes('termin') || lowered.includes('plan')) {
    return 'follow_up_plan';
  }
  return null;
};

const normalizePostMeetingActionItems = (
  primary: InsightActionItem[],
  secondary: InsightActionItem[],
  language: string,
): InsightActionItem[] => {
  const canonical = getCanonicalAfterActions(language);
  const selected = new Map<(typeof AFTER_ACTION_ORDER)[number], InsightActionItem>();

  [...primary, ...secondary].forEach((item) => {
    const key = classifyAfterAction(item?.label || '');
    if (key && !selected.has(key)) {
      selected.set(key, canonical[key]);
    }
  });

  return AFTER_ACTION_ORDER.map((key) => selected.get(key) || canonical[key]);
};

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
    const normalizedSessionState =
      data?.session_state === 'before' || data?.session_state === 'after' || data?.session_state === 'during'
        ? data.session_state
        : sessionState;
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
            prompt: typeof item.prompt === 'string' && item.prompt.trim() ? item.prompt.trim() : item.label.trim(),
          }))
      : Array.isArray(data?.actions)
      ? data.actions
          .filter((label: any) => typeof label === 'string' && label.trim())
          .map((label: string) => ({
            label: label.trim(),
            icon: inferIcon(label.trim()),
            prompt: label.trim(),
          }))
      : [];
    const followUpActions: InsightActionItem[] = Array.isArray(data?.followUpActions)
      ? data.followUpActions
          .filter((item: any) => item && typeof item.label === 'string' && item.label.trim())
          .map((item: any) => ({
            label: item.label.trim(),
            icon: typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim() : inferIcon(item.label.trim()),
            prompt: typeof item.prompt === 'string' && item.prompt.trim() ? item.prompt.trim() : item.label.trim(),
          }))
      : [];
    const mergedAfterActions =
      normalizedSessionState === 'after'
        ? normalizePostMeetingActionItems(actionItems, followUpActions, language)
        : actionItems;

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
      actions: mergedAfterActions.map((item) => item.label),
      action_items: mergedAfterActions,
      followUpActions: normalizedSessionState === 'after' ? [] : followUpActions,
      followUps: Array.isArray(data?.followUps) ? data.followUps.filter((item: any) => typeof item === 'string') : [],
      session_state: normalizedSessionState,
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
        prospectInfoCount: normalized.prospect_info?.length || 0,
        salesAnalysisCount: normalized.sales_analysis?.length || 0,
        actionsCount: normalized.actions?.length || 0,
        followUpActionsCount: normalized.followUpActions?.length || 0,
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
