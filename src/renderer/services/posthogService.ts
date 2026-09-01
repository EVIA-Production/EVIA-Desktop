/**
 * PostHog Analytics Service for Taylos Desktop
 * 
 * This is the Desktop (Electron renderer) version of the PostHog service.
 * It mirrors the Frontend service but includes Desktop-specific events.
 * 
 * Key differences from Frontend:
 * - Source is always 'desktop'
 * - Includes Desktop app lifecycle events
 * - Includes Desktop-specific settings events
 * - Includes insight click → implementation tracking
 * 
 * Event Taxonomy: See /docs/POSTHOG_METRICS_TAXONOMY_V3.md
 */

// Bundle the recorder with the Desktop build. Loading it from PostHog at
// runtime made the most important diagnostic surface depend on a second
// network request that could be blocked while ordinary analytics still worked.
import posthog from 'posthog-js/dist/module.full.no-external';
// The implementation verdict lives in main/ so it can be unit-tested from
// Node. It is the number that claims the product works, which is exactly the
// number that must not rest on assertions about source text.
import { judgeImplementation } from '../../main/insight-implementation';

// ============================================================================
// INITIALIZATION (Call once at app start)
// ============================================================================

const POSTHOG_KEY = 'phc_I09s0hYqFHpZv2okGU4hwd2Lth0ktSM5eSp3bRJOJXc';
const POSTHOG_HOST = 'https://eu.i.posthog.com';

let initialized = false;
// The recorder starts later than this check used to look.
//
// Measured 2026-09-01: 45 health events in one day ALL reported
// recording_started=false / status=lazy_loading, while PostHog held a real
// recording from the same session. The check gave up 21.5s in and reported a
// failure that had not happened - which is how replay came to look broken when
// it was working. `lazy_loading` means posthog-js has not processed the /flags
// response yet, not that recording is off; the terminal negative is "disabled".
//
// A health signal that is always red is worse than none: it gets ignored, or it
// sends someone chasing a fault that is not there. Both happened.
const REPLAY_HEALTH_DELAYS_MS = [1_500, 5_000, 15_000, 45_000, 120_000] as const;

type AnalyticsProperties = Record<string, unknown>;

const ANALYTICS_SCHEMA_VERSION = 1;
const ANALYTICS_CALL_ID_KEY = 'taylos_analytics_call_id';
const MAX_QUEUED_EVENTS = 200;
const queuedEvents: Array<{ eventName: string; properties: AnalyticsProperties }> = [];

// Product analytics must never become a second transcript store. This denylist
// protects every event, including older helpers that predate the privacy rule.
// Pre-launch these accounts trade their data for free access, and the
// suggestion-quality work needs the real values: which chat, which preset, the
// suggestion text itself, who the rep is. The previous version dropped exactly
// those keys and cut every string at 80 characters, so an event proved a click
// happened and told us nothing about what was clicked.
//
// The cap that remains is PostHog's ingestion limit, not a privacy rule - an
// oversized property gets the whole event rejected, and a rejected event is
// worth less than a truncated one.
const MAX_PROPERTY_CHARS = 20000;

function currentView(): string {
  if (typeof window === 'undefined') return 'unknown';
  return new URLSearchParams(window.location.search).get('view') || 'header';
}

function currentAppVersion(): string {
  if (typeof window === 'undefined') return 'unknown';
  return new URLSearchParams(window.location.search).get('appVersion') || 'unknown';
}

function sanitizeAnalyticsProperties(properties: AnalyticsProperties): AnalyticsProperties {
  const sanitized: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      sanitized[key] = value.length > MAX_PROPERTY_CHARS ? value.slice(0, MAX_PROPERTY_CHARS) : value;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
      continue;
    }
    // Objects and arrays travel whole - a suggestion's context is the point.
    try {
      const encoded = JSON.stringify(value);
      sanitized[key] = encoded.length > MAX_PROPERTY_CHARS
        ? JSON.parse(encoded.slice(0, MAX_PROPERTY_CHARS) + (encoded.startsWith('[') ? ']' : '}'))
        : value;
    } catch {
      // Unserialisable (circular, DOM node): skip rather than lose the event.
    }
  }
  return sanitized;
}


function commonProperties(): AnalyticsProperties {
  const platform = (window as any)?.platformInfo?.isWindows ? 'windows'
    : (window as any)?.platformInfo?.isMac ? 'macos'
      : 'unknown';
  return {
    analytics_call_id: getAnalyticsCallId(),
    analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
    app_version: currentAppVersion(),
    platform,
    source: 'desktop',
    window_view: currentView(),
  };
}

function sendDesktopEvent(eventName: string, properties: AnalyticsProperties = {}): void {
  const payload = {
    ...sanitizeAnalyticsProperties(properties),
    ...commonProperties(),
  };
  if (!initialized) {
    if (queuedEvents.length < MAX_QUEUED_EVENTS) queuedEvents.push({ eventName, properties: payload });
    return;
  }
  try {
    posthog.capture(eventName, payload);
  } catch (error) {
    console.warn('[PostHog] Event capture failed:', eventName, error);
  }
}

function flushQueuedEvents(): void {
  const pending = queuedEvents.splice(0, queuedEvents.length);
  for (const event of pending) posthog.capture(event.eventName, event.properties);
}

function replayStatus(): string {
  const status = (posthog as any)?.sessionRecording?.status;
  return typeof status === 'string' ? status : 'unknown';
}

function verifyReplayRecording(attempt = 0): void {
  try {
    // `true` overrides sampling, linked-flag and trigger controls. Recording is
    // still governed by the project-level enable switch returned by PostHog.
    posthog.startSessionRecording(true);
  } catch (error) {
    console.error('[PostHog] Replay start failed:', error);
  }

  const delay = REPLAY_HEALTH_DELAYS_MS[Math.min(attempt, REPLAY_HEALTH_DELAYS_MS.length - 1)];
  setTimeout(() => {
    const recordingStarted = posthog.sessionRecordingStarted();
    const status = replayStatus();
    const isLastAttempt = attempt + 1 >= REPLAY_HEALTH_DELAYS_MS.length;
    // Only a terminal answer is worth alerting on. Anything still mid-handshake
    // is a timing report, and reading it as a fault is what produced a year of
    // false negatives.
    const verdict = recordingStarted ? 'recording'
      : status === 'disabled' ? 'disabled'
        : isLastAttempt ? 'never_started' : 'pending';
    sendDesktopEvent('desktop_replay_health', {
      attempt: attempt + 1,
      attempts_total: REPLAY_HEALTH_DELAYS_MS.length,
      elapsed_ms: REPLAY_HEALTH_DELAYS_MS.slice(0, attempt + 1).reduce((a, b) => a + b, 0),
      recording_started: recordingStarted,
      replay_status: status,
      verdict,
      is_terminal: recordingStarted || status === 'disabled' || isLastAttempt,
      posthog_session_id: posthog.get_session_id(),
    });

    if (!recordingStarted && status !== 'disabled' && !isLastAttempt) {
      verifyReplayRecording(attempt + 1);
    }
  }, delay);
}

export function beginAnalyticsCall(): string {
  const callId = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(ANALYTICS_CALL_ID_KEY, callId);
  return callId;
}

export function getAnalyticsCallId(): string | undefined {
  return localStorage.getItem(ANALYTICS_CALL_ID_KEY) || undefined;
}

/**
 * Initialize PostHog (call from overlay-entry.tsx or main.ts)
 */
export function initPostHog() {
  if (initialized || typeof window === 'undefined') {
    console.log('[PostHog] Already initialized or no window, skipping');
    return;
  }
  
  try {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: false, // Manual control for Electron
    capture_pageleave: false,
    autocapture: false, // Electron doesn't need autocapture
    persistence: 'localStorage',
    bootstrap: {
      distinctID: localStorage.getItem('posthog_distinct_id') || undefined,
    },

    // FULL-FIDELITY CAPTURE - deliberate, and a product decision, not an
    // oversight.
    //
    // Pre-launch these accounts are free in exchange for their data, and the
    // suggestion quality work needs the actual words: what the prospect said,
    // what Taylos proposed, and whether the rep used it. A masked replay shows
    // that a rep read something and moved on, which answers nothing.
    //
    // The transcript on screen belongs to a call whose OTHER side did not
    // agree to this. Keep the PostHog DPA and the customer terms ahead of it.
    disable_session_recording: false,
    enable_recording_console_log: true,
    session_recording: {
      maskAllInputs: false,
      maskTextSelector: undefined,
      blockSelector: undefined,
      collectFonts: true,
      recordCrossOriginIframes: false,
      recordHeaders: true,
      recordBody: true,
      captureCanvas: { recordCanvas: false },
      maskCapturedNetworkRequestFn: (request: any) => request,
    },
    disable_surveys: true,

    // Replay enablement is obtained through PostHog remote config. The recorder
    // implementation itself is bundled above, so a blocked asset request cannot
    // silently remove every Desktop replay.
    advanced_disable_decide: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
  } as any);
  
  initialized = true;
    // No sampling or trigger gates: a session we did not record is a user test
    // we cannot diagnose. The health event proves whether the recorder actually
    // started instead of merely proving that init() returned.
    verifyReplayRecording();
    console.log('[PostHog] ✅ Initialized for Desktop with key:', POSTHOG_KEY.substring(0, 10) + '...');
    
    flushQueuedEvents();
    sendDesktopEvent('desktop_analytics_ready');
    if (currentView() === 'header') {
      sendDesktopEvent('desktop_app_launched');
    }
  } catch (error) {
    console.error('[PostHog] ❌ Failed to initialize:', error);
  }
}

// ============================================================================
// TYPES
// ============================================================================

export type SessionState = 'before' | 'during' | 'after';
export type InsightType = 'summary' | 'topic' | 'action' | 'followup';

// ============================================================================
// USER IDENTIFICATION
// ============================================================================

export function identifyUser(userId: string, properties?: {
  email?: string;
  name?: string;
  username?: string;
  is_admin?: boolean;
}) {
  if (!initialized) initPostHog();
  console.log('[PostHog] 🔑 Identifying authenticated Desktop user');
  // Identity enables per-user funnels, but profile properties are deliberately
  // excluded: email/name/username are not required to measure product health.
  posthog.identify(userId, { source: 'desktop' });
  localStorage.setItem('posthog_distinct_id', userId);
  sendDesktopEvent('desktop_user_identified', {
    profile_properties_omitted: Boolean(properties),
  });
  console.log('[PostHog] ✅ User identified');
}

export function resetUser() {
  posthog.reset();
  localStorage.removeItem('posthog_distinct_id');
}

// ============================================================================
// SESSION STATE EVENTS
// ============================================================================

export function trackSessionStateChanged(properties: {
  from_state: SessionState;
  to_state: SessionState;
  chat_id?: number;
  trigger: 'recording_start' | 'recording_stop' | 'session_close' | 'manual';
}) {
  sendDesktopEvent('session_state_changed', properties);
}

export function trackSessionStarted(properties: {
  chat_id: number;
  language: string;
  preset_name?: string;
  preset_id?: number;
}) {
  sendDesktopEvent('session_started', {
    ...properties,
    source: 'desktop',
    timestamp: new Date().toISOString(),
  });
}

export function trackSessionEnded(properties: {
  chat_id: number;
  duration_seconds: number;
  transcript_count: number;
  suggestion_count: number;
  language: string;
}) {
  sendDesktopEvent('session_ended', properties);
}

export function trackSessionClosed(properties: {
  chat_id: number;
  final_duration_seconds: number;
  total_asks: number;
  total_insights_clicked: number;
}) {
  sendDesktopEvent('session_closed', properties);
}

// ============================================================================
// ASK FEATURE EVENTS
// ============================================================================

export function trackAskSubmitted(properties: {
  chat_id?: number;
  question_length: number;
  session_state: SessionState;
  is_typed: boolean;
  language: string;
  query_source?: string;
  has_transcript_context?: boolean;
  delivery?: 'interactive' | 'prepared';
}) {
  const eventName = `ask_submitted_${properties.session_state}_call`;
  sendDesktopEvent(eventName, properties);
}

export function trackAskResponseReceived(properties: {
  chat_id?: number;
  response_length: number;
  latency_ms: number;
  ttft_ms?: number;
  session_state: SessionState;
  query_source?: string;
  delivery?: 'interactive' | 'prepared';
}) {
  sendDesktopEvent('ask_response_received', properties);
}

export function trackAskRequestReady(properties: {
  session_state: SessionState;
  query_source: string;
  has_transcript_context: boolean;
  context_preparation_ms: number;
}) {
  sendDesktopEvent('ask_request_ready', properties);
}

export function trackAskFailed(properties: {
  session_state: SessionState;
  query_source: string;
  stage: 'authentication' | 'chat_resolution' | 'stream' | 'backend';
  reason: 'authentication' | 'network' | 'rate_limit' | 'unavailable' | 'aborted' | 'unknown';
  latency_ms: number;
}) {
  sendDesktopEvent('ask_failed', properties);
}

export function trackAskResponseImplemented(properties: {
  chat_id: number;
  response_hash: string;
  implementation_method: 'speech' | 'typed' | 'copied';
  time_to_implement_ms: number;
}) {
  sendDesktopEvent('ask_response_implemented', properties);
}

// ============================================================================
// INSIGHTS FEATURE EVENTS - CRITICAL FOR DESKTOP
// ============================================================================

export function trackInsightsViewed(properties: {
  chat_id?: number;
  session_state: SessionState;
  trigger: 'manual' | 'auto';
  transcript_count: number;
}) {
  sendDesktopEvent('insights_viewed', properties);
}

/**
 * The whole picture behind one suggestion: what Taylos proposed, the
 * conversation it was generated from, and the preset that shaped it.
 *
 * The counter events above answer "did a suggestion appear". This answers
 * "was it the right one", which is the question the quality work actually
 * needs and the reason these accounts are free pre-launch.
 */
export function trackSuggestionContext(properties: {
  chat_id?: number;
  surface: 'insights' | 'ask';
  suggestion?: unknown;
  transcript?: unknown;
  transcript_line_count?: number;
  preset_name?: string | null;
  preset_id?: number | null;
  preset_unusable?: boolean;
  session_state?: SessionState;
  language?: string;
  question?: string;
}) {
  sendDesktopEvent('suggestion_context', properties as AnalyticsProperties);
}

export function trackInsightsLoaded(properties: {
  chat_id?: number;
  load_time_ms: number;
  summary_count: number;
  topic_count: number;
  action_count: number;
  followup_count: number;
  session_state?: SessionState;
  trigger?: 'manual' | 'auto';
  attempts?: number;
}) {
  sendDesktopEvent('insights_loaded', properties);
}

export function trackInsightsRequested(properties: {
  session_state: SessionState;
  trigger: 'manual' | 'auto';
  transcript_count: number;
}) {
  sendDesktopEvent('insights_requested', properties);
}

export function trackInsightsFailed(properties: {
  session_state: SessionState;
  trigger: 'manual' | 'auto';
  reason: 'authentication' | 'network' | 'rate_limit' | 'stub' | 'stale' | 'empty' | 'unknown';
  load_time_ms: number;
  attempts: number;
}) {
  sendDesktopEvent('insights_failed', properties);
}

/**
 * Track insight click - CRITICAL EVENT
 * Call this from ListenView when user clicks summary/topic/action/followup
 */
export function trackInsightClicked(properties: {
  chat_id: number;
  insight_type: InsightType;
  insight_text: string;
  insight_index: number;
  session_state: SessionState;
}) {
  console.log('[PostHog] 📊 Tracking insight_clicked:', properties.insight_type, properties.insight_index);
  sendDesktopEvent('insight_clicked', {
    ...properties,
    source: 'desktop',
    clicked_at: Date.now(),
  });
  
  // Store for implementation tracking
  storeClickedInsight(properties);
}

/**
 * Track insight implementation - OUTCOME EVENT
 */
export function trackInsightImplemented(properties: {
  chat_id: number;
  insight_type: InsightType;
  insight_hash: string;
  implementation_method: 'speech' | 'typed' | 'copied';
  time_since_click_ms: number;
  confidence_score?: number;
}) {
  sendDesktopEvent('insight_implemented', properties);
}

export function trackInsightImplementationRate(properties: {
  chat_id: number;
  total_clicked: number;
  total_implemented: number;
  implementation_rate: number;
}) {
  sendDesktopEvent('insight_implementation_rate', properties);
}

export function trackInsightsCopied(properties: {
  chat_id: number;
  content_length: number;
  sections_included: string[];
}) {
  sendDesktopEvent('insights_copied', properties);
}

// ============================================================================
// IMPLEMENTATION TRACKING HELPERS
// ============================================================================

interface ClickedInsight {
  chat_id: number;
  insight_type: InsightType;
  insight_text: string;
  insight_hash: string;
  clicked_at: number;
}

const recentInsightClicks: ClickedInsight[] = [];
const IMPLEMENTATION_WINDOW_MS = 60000; // 60 seconds to implement

function storeClickedInsight(insight: {
  chat_id: number;
  insight_type: InsightType;
  insight_text: string;
  insight_index: number;
  session_state: SessionState;
}) {
  const clickedInsight: ClickedInsight = {
    chat_id: insight.chat_id,
    insight_type: insight.insight_type,
    insight_text: insight.insight_text,
    insight_hash: hashText(insight.insight_text),
    clicked_at: Date.now(),
  };
  
  // Keep only recent clicks (last 60 seconds)
  const now = Date.now();
  const recentOnly = recentInsightClicks.filter(
    c => now - c.clicked_at < IMPLEMENTATION_WINDOW_MS
  );
  recentOnly.push(clickedInsight);
  recentInsightClicks.length = 0;
  recentInsightClicks.push(...recentOnly);
}

/**
 * Check if user speech contains similar content to clicked insights
 * Call this after each final transcript from speaker 1 (user)
 */
export function checkForInsightImplementation(
  chat_id: number,
  userSpeech: string
): void {
  if (!userSpeech || recentInsightClicks.length === 0) return;

  const now = Date.now();
  // Collected first, removed after. Splicing inside a `for...of` over the same
  // array shifts the remaining elements under the iterator and silently skips
  // the next one, so two suggestions delivered in one breath reported as one.
  const implemented: ClickedInsight[] = [];

  for (const insight of recentInsightClicks) {
    if (now - insight.clicked_at > IMPLEMENTATION_WINDOW_MS) continue;
    if (insight.chat_id !== chat_id) continue;

    const verdict = judgeImplementation(insight.insight_text, userSpeech);
    if (!verdict.implemented) continue;

    trackInsightImplemented({
      chat_id,
      insight_type: insight.insight_type,
      insight_hash: insight.insight_hash,
      implementation_method: 'speech',
      time_since_click_ms: now - insight.clicked_at,
      confidence_score: verdict.confidence,
    });
    implemented.push(insight);
  }

  for (const insight of implemented) {
    const index = recentInsightClicks.indexOf(insight);
    if (index > -1) recentInsightClicks.splice(index, 1);
  }
}


// ============================================================================
// RECORDING EVENTS
// ============================================================================

export function trackRecordingStarted(properties: {
  chat_id?: number;
  source: 'mic' | 'system' | 'both';
  language: string;
  system_audio_available?: boolean;
  system_audio_status?: string;
}) {
  sendDesktopEvent('recording_started', properties);
}

export function trackRecordingStopped(properties: {
  chat_id?: number;
  duration_seconds: number;
  transcript_count: number;
  final_count?: number;
  mic_count?: number;
  system_count?: number;
  message_count?: number;
  rejected_count?: number;
  partial_latency_p50_ms?: number;
  partial_latency_p95_ms?: number;
  final_latency_p50_ms?: number;
  final_latency_p95_ms?: number;
}) {
  sendDesktopEvent('recording_stopped', properties);
}

export function trackTranscriptFirstVisible(properties: {
  kind: 'first_partial' | 'first_final';
  audio_source: 'mic' | 'system';
  capture_to_render_ms: number;
}) {
  sendDesktopEvent('transcript_first_visible', properties);
}

// ============================================================================
// TRANSCRIPT EVENTS
// ============================================================================

export function trackTranscriptCopied(properties: {
  chat_id: number;
  line_count: number;
  speaker_count: number;
}) {
  sendDesktopEvent('transcript_copied', properties);
}

export function trackTranscriptViewToggled(properties: {
  chat_id: number;
  from_mode: 'transcript' | 'insights';
  to_mode: 'transcript' | 'insights';
  session_state: SessionState;
}) {
  sendDesktopEvent('transcript_view_toggled', properties);
}

// ============================================================================
// PRESET EVENTS
// ============================================================================

export function trackPresetActivated(properties: {
  preset_id: number;
  preset_name: string;
  previous_preset_id?: number;
}) {
  sendDesktopEvent('preset_activated', {
    ...properties,
    source: 'desktop',
    activation_source: 'desktop_settings',
  });
}

export function trackPresetDeactivated(properties: {
  preset_id: number;
}) {
  sendDesktopEvent('preset_deactivated', properties);
}

// ============================================================================
// SETTINGS EVENTS (Desktop-specific)
// ============================================================================

export function trackSettingsOpened(properties: {
  from_view?: string;
}) {
  console.log('[PostHog] 📊 Tracking settings_opened:', properties);
  sendDesktopEvent('settings_opened', properties);
}

export function trackLanguageChanged(properties: {
  from_language: string;
  to_language: string;
}) {
  console.log('[PostHog] 📊 Tracking language_changed:', properties);
  sendDesktopEvent('language_changed', {
    ...properties,
    source: 'desktop_settings',
  });
}

export function trackAutoUpdateToggled(properties: {
  new_state: boolean;
}) {
  sendDesktopEvent('settings_auto_update_toggled', properties);
}

export function trackInvisibilityToggled(properties: {
  new_state: boolean;
}) {
  sendDesktopEvent('settings_invisibility_toggled', properties);
}

export function trackWindowMoved(properties: {
  direction: 'left' | 'right';
  distance_px?: number;
}) {
  sendDesktopEvent('settings_window_moved', properties);
}

// ============================================================================
// DESKTOP APP LIFECYCLE EVENTS
// ============================================================================

// trackDesktopAppLaunched used to live here and was deleted, not wired.
//
// `desktop_app_launched` is already emitted directly from initPostHog for the
// header view, and PostHog confirms it arriving. Wiring the tracker as well
// would have double-counted every launch. Its extra properties were no loss:
// commonProperties already attaches app_version and platform to every event,
// and os_version / is_first_launch are not known at that point anyway.
//
// This is what the rest of KNOWN_UNWIRED needs before anything is wired to it -
// checking whether the EVENT is already arriving from somewhere else, rather
// than assuming a tracker with no call sites is a missing measurement.

export function trackDesktopAppClosed(properties: {
  session_duration_seconds: number;
  sessions_completed: number;
}) {
  sendDesktopEvent('desktop_app_closed', properties);
}

export function trackShortcutUsed(properties: {
  shortcut_name: 'show_hide' | 'ask' | 'scroll_up' | 'scroll_down';
  source_view?: string;
}) {
  sendDesktopEvent('desktop_shortcut_used', properties);
}

export function trackPermissionStatus(properties: {
  permission_type: 'mic' | 'screen' | 'accessibility';
  status: 'granted' | 'denied' | 'prompt';
}) {
  sendDesktopEvent('desktop_permission_status', properties);
}

export function trackAudioDeviceChanged(properties: {
  device_type: 'input' | 'output';
  device_name: string;
}) {
  sendDesktopEvent('desktop_audio_device_changed', properties);
}

// ============================================================================
// VIEW CHANGE EVENTS
// ============================================================================

export function trackViewChanged(properties: {
  from_view: string;
  to_view: string;
  trigger: 'click' | 'shortcut' | 'auto';
}) {
  sendDesktopEvent('view_changed', properties);
}

// ============================================================================
// ERROR EVENTS
// ============================================================================

export function trackError(properties: {
  error_type: string;
  error_message: string;
  chat_id?: number;
  context?: string;
}) {
  console.log('[PostHog] 📊 Tracking error_occurred:', properties.error_type, properties.context);
  sendDesktopEvent('error_occurred', {
    ...properties,
    source: 'desktop',
    timestamp: new Date().toISOString(),
  });
}

// ============================================================================
// UNCAUGHT FAILURES
// ============================================================================
//
// `trackError` above only fires where someone predicted the failure - two hand
// placed call sites, both in capture start. Nothing watched the failures nobody
// predicted, and that is the expensive class.
//
// v1.0.98 through v1.0.102 shipped a `finally` block referencing five
// identifiers scoped inside its `try`. Every insights request threw
// `ReferenceError: analyticsOutcomeTracked is not defined` before the line
// clearing the in-flight flag, so post-meeting insights could not generate at
// all. It survived five releases and four days, and it surfaced only because one
// person pasted a console log. Nothing in the product had any idea.
//
// PostHog's own `capture_exceptions` does NOT close this. It lazy-loads
// `exception-autocapture` from PostHog's CDN - `module.full.no-external` bundles
// the session recorder but contains no `$exception` code at all, verified by
// grep. Turning it on would restore the boot-time remote fetch that
// `fix(privacy,startup)` removed, and would silently do nothing on a network
// that blocks PostHog. These handlers use the already-bundled capture transport
// instead, so they work where the CDN does not.
//
// Reports are deduplicated by signature and capped per window: a throw inside a
// React render or an animation frame repeats forever, and a firehose that gets
// rate-limited away is the same blindness in a different costume.

const MAX_UNCAUGHT_REPORTS_PER_WINDOW = 25;
const MAX_ERROR_MESSAGE_CHARS = 500;
const MAX_STACK_CHARS = 4000;

let uncaughtReportCount = 0;
let globalErrorReportingInstalled = false;
const seenErrorSignatures = new Set<string>();

function reportUncaughtFailure(
  errorType: 'uncaught_exception' | 'unhandled_rejection',
  value: unknown,
  extra: AnalyticsProperties = {},
): void {
  try {
    const error = value instanceof Error ? value : undefined;
    const name = error?.name || (value === undefined ? 'undefined' : typeof value);
    const rawMessage = error?.message ?? (typeof value === 'string' ? value : safeStringify(value));
    const message = (rawMessage || '').slice(0, MAX_ERROR_MESSAGE_CHARS);
    const stack = (error?.stack || '').slice(0, MAX_STACK_CHARS);

    // The first frame is what distinguishes two different bugs with the same
    // message; the rest of the stack varies with async context and would defeat
    // the dedupe.
    const firstFrame = stack.split('\n').find((line) => /:\d+:\d+/.test(line))?.trim() || '';
    const signature = `${errorType}|${name}|${message}|${firstFrame}`;
    if (seenErrorSignatures.has(signature)) return;
    if (uncaughtReportCount >= MAX_UNCAUGHT_REPORTS_PER_WINDOW) return;
    seenErrorSignatures.add(signature);
    uncaughtReportCount += 1;

    console.error(`[PostHog] 🚨 Reporting ${errorType}:`, name, message);
    sendDesktopEvent('error_occurred', {
      ...extra,
      error_type: errorType,
      error_name: name,
      error_message: message,
      error_stack: stack,
      error_signature: signature,
      unique_errors_this_window: seenErrorSignatures.size,
      handled: false,
      timestamp: new Date().toISOString(),
    });
  } catch (reportingFailure) {
    // Reporting a crash must never become the crash.
    console.warn('[PostHog] Failed to report an uncaught failure:', reportingFailure);
  }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'object' ? JSON.stringify(value) ?? String(value) : String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * Install once per renderer window, as early as the entry module runs.
 *
 * Deliberately independent of `initPostHog()`, which the privacy fix deferred to
 * requestIdleCallback: `sendDesktopEvent` queues until init and flushes after,
 * so a throw during startup is still reported. Installing this at import time
 * rather than after React mounts is the point - a crash while rendering is
 * exactly the crash nobody sees.
 */
export function installGlobalErrorReporting(): void {
  if (globalErrorReportingInstalled || typeof window === 'undefined') return;
  globalErrorReportingInstalled = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    reportUncaughtFailure('uncaught_exception', event.error ?? event.message, {
      error_source: event.filename || 'unknown',
      error_line: event.lineno ?? -1,
      error_column: event.colno ?? -1,
    });
  });

  // The insights outage was exactly this: an async function whose rejection
  // nobody awaited. `window.onerror` never sees it.
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportUncaughtFailure('unhandled_rejection', event.reason, {
      error_source: 'promise',
    });
  });

  console.log('[PostHog] 🛡️ Global error reporting installed');
}

/** Test seam: the counters are per-window and otherwise unreachable. */
export function __resetGlobalErrorReportingForTests(): void {
  uncaughtReportCount = 0;
  seenErrorSignatures.clear();
  globalErrorReportingInstalled = false;
}

// ============================================================================
// PERFORMANCE EVENTS
// ============================================================================

export function trackTimeToFirstSuggestion(properties: {
  chat_id: number;
  ttfs_ms: number;
  language: string;
}) {
  sendDesktopEvent('time_to_first_suggestion', properties);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

// ============================================================================
// EXPORT DEFAULT
// ============================================================================

export default {
  // Init
  initPostHog,
  beginAnalyticsCall,
  getAnalyticsCallId,
  
  // User
  identifyUser,
  resetUser,
  
  // Session
  trackSessionStateChanged,
  trackSessionStarted,
  trackSessionEnded,
  trackSessionClosed,
  
  // Ask
  trackAskSubmitted,
  trackAskRequestReady,
  trackAskResponseReceived,
  trackAskFailed,
  trackAskResponseImplemented,
  
  // Insights
  trackInsightsViewed,
  trackInsightsLoaded,
  trackInsightsRequested,
  trackInsightsFailed,
  trackInsightClicked,
  trackInsightImplemented,
  trackInsightImplementationRate,
  trackInsightsCopied,
  checkForInsightImplementation,
  
  // Recording
  trackRecordingStarted,
  trackRecordingStopped,
  trackTranscriptFirstVisible,
  
  // Transcript
  trackTranscriptCopied,
  trackTranscriptViewToggled,
  
  // Presets
  trackPresetActivated,
  trackPresetDeactivated,
  
  // Settings
  trackSettingsOpened,
  trackLanguageChanged,
  trackAutoUpdateToggled,
  trackInvisibilityToggled,
  trackWindowMoved,
  
  // Desktop lifecycle
  trackDesktopAppClosed,
  trackShortcutUsed,
  trackPermissionStatus,
  trackAudioDeviceChanged,
  
  // View changes
  trackViewChanged,
  
  // Error & Performance
  trackError,
  trackTimeToFirstSuggestion,
};
