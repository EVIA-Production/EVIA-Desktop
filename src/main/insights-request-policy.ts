export type InsightsSessionState = 'before' | 'during' | 'after'

export type InsightsFetchIntent = {
  sessionState: InsightsSessionState
  fullReplace: boolean
  manual: boolean
}

const SESSION_PRIORITY: Record<InsightsSessionState, number> = {
  before: 0,
  during: 1,
  after: 2,
}

export function mergeInsightsFetchIntent(
  current: InsightsFetchIntent | null,
  incoming: InsightsFetchIntent,
): InsightsFetchIntent {
  if (!current) return incoming

  const sessionState = SESSION_PRIORITY[incoming.sessionState] >= SESSION_PRIORITY[current.sessionState]
    ? incoming.sessionState
    : current.sessionState

  return {
    sessionState,
    fullReplace: current.fullReplace || incoming.fullReplace || sessionState === 'after',
    manual: current.manual || incoming.manual,
  }
}

export function shouldPreemptInsightsRequest(
  active: InsightsFetchIntent | null,
  incoming: InsightsFetchIntent,
): boolean {
  return active?.sessionState === 'during' && incoming.sessionState === 'after'
}

export function shouldCoalesceAutomaticLiveInsightsRequest(
  active: InsightsFetchIntent | null,
  incoming: InsightsFetchIntent,
): boolean {
  return active !== null && incoming.sessionState === 'during' && !incoming.manual
}

export function isInsightsResultCurrent(
  requestedSessionState: InsightsSessionState,
  currentSessionState: InsightsSessionState,
  transcriptIdentityMatches: boolean,
): boolean {
  return requestedSessionState === currentSessionState && transcriptIdentityMatches
}

const POST_MEETING_RETRY_DELAYS_MS = [300, 1_000, 3_000, 6_000, 12_000, 30_000]

export const LIVE_INSIGHTS_MIN_INTERVAL_MS = 12_000
export const LIVE_INSIGHTS_SETTLE_MS = 450

export function liveInsightsRefreshDelayMs(
  lastRequestStartedAtMs: number,
  nowMs: number = Date.now(),
): number {
  if (!Number.isFinite(lastRequestStartedAtMs) || lastRequestStartedAtMs <= 0) {
    return LIVE_INSIGHTS_SETTLE_MS
  }

  const elapsedMs = Math.max(0, nowMs - lastRequestStartedAtMs)
  return Math.max(LIVE_INSIGHTS_SETTLE_MS, LIVE_INSIGHTS_MIN_INTERVAL_MS - elapsedMs)
}

export function postMeetingRetryDelayMs(attempt: number, rateLimitRemainingMs = 0): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0
  const backoff = POST_MEETING_RETRY_DELAYS_MS[
    Math.min(safeAttempt, POST_MEETING_RETRY_DELAYS_MS.length - 1)
  ]
  const rateLimitDelay = Number.isFinite(rateLimitRemainingMs)
    ? Math.max(0, Math.ceil(rateLimitRemainingMs))
    : 0

  return Math.max(backoff, rateLimitDelay)
}
