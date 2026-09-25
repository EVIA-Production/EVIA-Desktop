/**
 * What the trial ran out of, in words the rep can act on.
 *
 * Until 2026-09-22 a trial limit reached the rep as a bare "HTTP 402" in Ask
 * (later "Request failed. Reconnect?", which a retry could never fix), and as
 * nothing at all in Listen: insights and the transcript simply stopped. The
 * backend now names each limit with a stable code; this module turns it into
 * one sentence and an Upgrade link.
 *
 *   suggestion_limit_reached  the trial's suggestions (Ask) are used up
 *   meeting_limit_reached     the trial's meeting minutes are used up
 *   trial_expired             the trial window is over
 *   trial_usage_limit_reached the provider-call guard tripped (should not happen)
 */
export type TrialLimitCode =
  | 'suggestion_limit_reached'
  | 'meeting_limit_reached'
  | 'trial_expired'
  | 'trial_usage_limit_reached';

export interface TrialLimitNotice {
  code: TrialLimitCode;
  upgradeUrl: string;
  /** Meeting minutes in this trial, when the server said so. */
  minutes?: number;
}

/**
 * Where "Upgrade" goes. A trial user already has a subscription, so /checkout
 * would send them straight back; the billing page ends the trial and starts
 * the paid plan. The server's own URL wins when it sends one.
 */
export const DEFAULT_UPGRADE_URL = 'https://app.taylos.ai/settings/billing?upgrade=now';

const CODE_ALIASES: Record<string, TrialLimitCode> = {
  suggestion_limit_reached: 'suggestion_limit_reached',
  meeting_limit_reached: 'meeting_limit_reached',
  limit_reached: 'meeting_limit_reached',
  trial_expired: 'trial_expired',
  trial_usage_limit_reached: 'trial_usage_limit_reached',
  // The provider guard's class code, as sent in a stream event.
  trial_limit_reached: 'trial_usage_limit_reached',
};

const COPY_KEYS: Record<TrialLimitCode, string> = {
  suggestion_limit_reached: 'overlay.trial.suggestionLimit',
  meeting_limit_reached: 'overlay.trial.meetingLimit',
  trial_expired: 'overlay.trial.expired',
  trial_usage_limit_reached: 'overlay.trial.usageLimit',
};

const DEFAULT_TRIAL_MINUTES = 120;

function normalizeCode(raw: unknown): TrialLimitCode | null {
  if (typeof raw !== 'string') return null;
  return CODE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

function safeUpgradeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_UPGRADE_URL;
  try {
    const url = new URL(raw);
    // Only ever open our own web app from a server-sent value.
    if (url.protocol === 'https:' && (url.hostname === 'taylos.ai' || url.hostname.endsWith('.taylos.ai'))) {
      return url.toString();
    }
  } catch {
    /* not a URL */
  }
  return DEFAULT_UPGRADE_URL;
}

/**
 * Reads a trial limit out of whatever the server sent: an HTTP error body
 * (`{detail: {code, upgrade_url, limits}}`), its `detail`, a stream event's
 * `meta`, or a websocket error's `data`. Anything else is not a trial limit.
 */
export function trialLimitFrom(payload: unknown): TrialLimitNotice | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, any>;
  const inner = record.detail && typeof record.detail === 'object' ? record.detail : record;
  const code = normalizeCode(inner.code);
  if (!code) return null;
  const maxSeconds = Number(inner?.limits?.max_meeting_seconds);
  return {
    code,
    upgradeUrl: safeUpgradeUrl(inner.upgrade_url),
    minutes: Number.isFinite(maxSeconds) && maxSeconds > 0 ? Math.round(maxSeconds / 60) : undefined,
  };
}

export function isTrialLimitCode(raw: unknown): boolean {
  return normalizeCode(raw) !== null;
}

type Translate = (key: string) => string;

/** The one sentence the rep sees; `t` is the app's i18n lookup. */
export function trialLimitMessage(notice: TrialLimitNotice, t: Translate): string {
  const minutes = String(notice.minutes ?? DEFAULT_TRIAL_MINUTES);
  return t(COPY_KEYS[notice.code]).replace('{{minutes}}', minutes);
}

export function upgradeLabel(t: Translate): string {
  return t('overlay.trial.upgrade');
}

export function openUpgrade(notice: Pick<TrialLimitNotice, 'upgradeUrl'>): void {
  const url = safeUpgradeUrl(notice.upgradeUrl);
  const shell = (window as any).evia?.shell;
  try {
    if (shell?.openExternal) {
      void shell.openExternal(url);
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, '_blank', 'noopener');
}

/** Error text a stream handler can carry through an Error object. */
export const TRIAL_LIMIT_ERROR_PREFIX = 'TRIAL_LIMIT:';

export function trialLimitError(notice: TrialLimitNotice): Error & { trialLimit: TrialLimitNotice } {
  const error = new Error(`${TRIAL_LIMIT_ERROR_PREFIX}${notice.code}`) as Error & { trialLimit: TrialLimitNotice };
  error.trialLimit = notice;
  return error;
}

export function trialLimitFromError(error: unknown): TrialLimitNotice | null {
  if (!error || typeof error !== 'object') return null;
  const attached = (error as { trialLimit?: TrialLimitNotice }).trialLimit;
  if (attached && normalizeCode(attached.code)) return attached;
  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string' && message.startsWith(TRIAL_LIMIT_ERROR_PREFIX)) {
    const code = normalizeCode(message.slice(TRIAL_LIMIT_ERROR_PREFIX.length));
    return code ? { code, upgradeUrl: DEFAULT_UPGRADE_URL } : null;
  }
  return null;
}

/*
 * The limit currently in force in this window. Listen learns about it from two
 * places (an insights 402 and the call stream's error), and both must stop the
 * work that caused it: repeated requests the server will refuse again.
 */
let activeNotice: TrialLimitNotice | null = null;
const listeners = new Set<(notice: TrialLimitNotice | null) => void>();

export function currentTrialLimit(): TrialLimitNotice | null {
  return activeNotice;
}

export function reportTrialLimit(notice: TrialLimitNotice): void {
  if (activeNotice?.code === notice.code && activeNotice.upgradeUrl === notice.upgradeUrl) return;
  activeNotice = notice;
  listeners.forEach((listener) => listener(notice));
}

export function clearTrialLimit(): void {
  if (!activeNotice) return;
  activeNotice = null;
  listeners.forEach((listener) => listener(null));
}

export function onTrialLimit(listener: (notice: TrialLimitNotice | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Limits that stop live work (insights, transcription), unlike the suggestion limit. */
export function stopsLiveWork(notice: TrialLimitNotice | null): boolean {
  return Boolean(notice && notice.code !== 'suggestion_limit_reached');
}
