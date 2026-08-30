// Insights service for fetching and normalizing insights payloads.
import { BACKEND_URL } from '../config/config';

/**
 * Set when the server returns 429. Every caller checks this before spending a
 * request, so one rate limit pauses the whole app instead of each caller
 * discovering it separately - and expensively.
 */
let rateLimitedUntilMs = 0;

/** Is the server currently telling us to back off? */
export function insightsRateLimited(): boolean {
  return Date.now() < rateLimitedUntilMs;
}

export function insightsRateLimitRemainingMs(): number {
  return Math.max(0, rateLimitedUntilMs - Date.now());
}

export interface InsightActionItem {
  label: string;
  icon?: string;
  prompt?: string;
  // Present only on action #1, only during a live call, and only when the
  // backend could produce an answer that passed every production validator.
  // Absent is the normal case and means "use the interactive path".
  prepared_suggestion?: string;
  context_fingerprint?: string;
  suggestion_id?: string;
  generated_at?: string;
  provider?: string;
  model?: string;
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
  /**
   * Set when the active preset has no usable content - the untouched
   * onboarding template, or a stub. Measured 2026-08-26: 13 of 23 ACTIVE
   * presets were in that state, and a client ran a live call on one, so
   * every suggestion was generated with no product, no proof and no
   * objection answers. Optional: older backends never send it.
   */
  preset_unusable?: boolean;
  preset_warning?: string;
}

interface FetchInsightsParams {
  chatId: number;
  k?: number;
  language?: string;
  token: string;
  baseUrl?: string;
  sessionState?: 'before' | 'during' | 'after'; // CRITICAL FIX: Add session state
  /**
   * The exact string `/ask` would receive if the seller clicked right now,
   * from `transcriptContextFromState`. Sending it lets the backend prepare
   * action #1's answer for THIS context. The server cannot rebuild this
   * string from its own transcript rows - different speaker labels, no
   * uncertainty markers - so without it no answer can be prepared.
   */
  transcript?: string;
  /** Fire-and-forget report that a prepared answer was displayed. */
  preparedClaimed?: { suggestion_id: string; fingerprint: string; click_to_visible_ms: number } | null;
  /** Cancels obsolete live work when a post-meeting request takes priority. */
  signal?: AbortSignal;
  /** A provider or network failure must never hold the global insights lock forever. */
  requestTimeoutMs?: number;
}

const getCanonicalAfterActions = (language: string): Record<string, InsightActionItem> =>
  language === 'en'
    ? {
        follow_up_email: {
          label: '📧 Follow-up Email',
          icon: 'mail',
          prompt: 'Follow-up Email',
        },
        follow_up_plan: {
          label: '📞 Plan follow-up',
          icon: 'phone',
          prompt: 'Plan follow-up',
        },
        action_items: {
          label: '📋 Action Items',
          icon: 'check',
          prompt: 'Action Items',
        },
        crm_update: {
          label: '📊 Update CRM',
          icon: 'chart',
          prompt: 'Update CRM',
        },
        summary: {
          label: '📝 Summary',
          icon: 'note',
          prompt: 'Summary',
        },
      }
    : {
        follow_up_email: {
          label: '📧 Follow-up E-Mail',
          icon: 'mail',
          prompt: 'Follow-up E-Mail',
        },
        follow_up_plan: {
          label: '📞 Follow-up planen',
          icon: 'phone',
          prompt: 'Follow-up planen',
        },
        action_items: {
          label: '📋 Action Items',
          icon: 'check',
          prompt: 'Action Items',
        },
        crm_update: {
          label: '📊 CRM aktualisieren',
          icon: 'chart',
          prompt: 'CRM aktualisieren',
        },
        summary: {
          label: '📝 Zusammenfassung',
          icon: 'note',
          prompt: 'Zusammenfassung',
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
  transcript,
  preparedClaimed,
  signal,
  requestTimeoutMs = 15_000,
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
    // The request phase is authoritative. A cached live response must never
    // turn a post-meeting request back into during-call actions.
    const normalizedSessionState = sessionState;
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
            // Carried through verbatim. Never trimmed or reformatted: this is
            // the text the seller reads aloud, and it already passed the
            // server-side contract in exactly this form.
            ...(typeof item.prepared_suggestion === 'string' && item.prepared_suggestion.trim()
              ? {
                  prepared_suggestion: item.prepared_suggestion,
                  context_fingerprint: typeof item.context_fingerprint === 'string' ? item.context_fingerprint : undefined,
                  suggestion_id: typeof item.suggestion_id === 'string' ? item.suggestion_id : undefined,
                  generated_at: typeof item.generated_at === 'string' ? item.generated_at : undefined,
                  provider: typeof item.provider === 'string' ? item.provider : undefined,
                  model: typeof item.model === 'string' ? item.model : undefined,
                }
              : {}),
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
    if (signal?.aborted) {
      console.log('[Insights] Request cancelled before fetch');
      return null;
    }

    const requestController = new AbortController();
    let requestTimedOut = false;
    const forwardAbort = () => requestController.abort(signal?.reason);
    if (signal) signal.addEventListener('abort', forwardAbort, { once: true });
    const requestTimeout = setTimeout(() => {
      requestTimedOut = true;
      requestController.abort();
    }, requestTimeoutMs);

    try {
      console.log(`[Insights] Fetching insights for chat ${chatId} (attempt ${attempt + 1}/${MAX_RETRIES}) session_state: ${sessionState}`);
      const response = await fetch(`${url.replace(/\/$/, '')}/insights`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          k,
          language,
          session_state: sessionState,
          ...(transcript ? { transcript } : {}),
          ...(preparedClaimed ? { prepared_claimed: preparedClaimed } : {}),
        }),
        signal: requestController.signal,
      });

      if (!response.ok) {
        // Only retry on 5xx errors (server issues), not 4xx (client errors)
        // A rate limit is not a transient error - it is the server telling us to
        // stop. Retrying it is how a 20/min budget turned into a storm: the
        // client refreshed on every prospect utterance, each refresh retried
        // three times, and every 429 triggered three more. Measured 2026-08-20:
        // the live loop starved the POST-CALL insights fetch, so the rep got no
        // summary at all.
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('Retry-After') || '0');
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 30000;
          rateLimitedUntilMs = Date.now() + waitMs;
          console.warn(`[Insights] 🛑 Rate limited; pausing all insight fetches for ${Math.round(waitMs / 1000)}s`);
          return null;
        }
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
      if (signal?.aborted) {
        console.log('[Insights] Request cancelled because newer insights work took priority');
        return null;
      }
      if (requestTimedOut) {
        console.warn(`[Insights] Request timed out after ${requestTimeoutMs}ms; releasing the insights pipeline`);
        return null;
      }
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
    } finally {
      clearTimeout(requestTimeout);
      if (signal) signal.removeEventListener('abort', forwardAbort);
    }
  }
  
  // Should never reach here, but TypeScript requires it
  return null;
}
