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

import posthog from 'posthog-js';

// ============================================================================
// INITIALIZATION (Call once at app start)
// ============================================================================

const POSTHOG_KEY = 'phc_I09s0hYqFHpZv2okGU4hwd2Lth0ktSM5eSp3bRJOJXc';
const POSTHOG_HOST = 'https://eu.i.posthog.com';

let initialized = false;

type AnalyticsProperties = Record<string, unknown>;

const ANALYTICS_SCHEMA_VERSION = 1;
const ANALYTICS_CALL_ID_KEY = 'taylos_analytics_call_id';
const MAX_QUEUED_EVENTS = 200;
const queuedEvents: Array<{ eventName: string; properties: AnalyticsProperties }> = [];

// Product analytics must never become a second transcript store. This denylist
// protects every event, including older helpers that predate the privacy rule.
const SENSITIVE_PROPERTY_KEYS = new Set([
  'chat_id',
  'context',
  'device_name',
  'email',
  'error_message',
  'insight_hash',
  'insight_text',
  'insight_text_hash',
  'insight_text_preview',
  'name',
  'preset_name',
  'response_hash',
  'user_id',
  'username',
]);

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
    if (SENSITIVE_PROPERTY_KEYS.has(key) || value === undefined || value === null) continue;
    if (typeof value === 'string') {
      sanitized[key] = value.slice(0, 80);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      sanitized[key] = value
        .filter(item => ['string', 'number', 'boolean'].includes(typeof item))
        .slice(0, 20)
        .map(item => typeof item === 'string' ? item.slice(0, 80) : item);
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

    // Session replay is the fastest way to diagnose real Desktop usage, but the
    // overlay contains customer calls. Record layout, timing and interaction
    // only: every text node/input is masked; media, canvas, network payloads and
    // console output are excluded. Structured events below carry the useful
    // non-content details that a fully masked replay cannot show.
    disable_session_recording: false,
    enable_recording_console_log: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
      blockSelector: 'img, video, canvas, svg',
      collectFonts: false,
      recordCrossOriginIframes: false,
      recordHeaders: false,
      recordBody: false,
      captureCanvas: { recordCanvas: false },
      maskCapturedNetworkRequestFn: () => null,
    },
    disable_surveys: true,

    // Replay configuration and the recorder extension are obtained through the
    // PostHog remote-config path. Analytics still initializes after first paint
    // and never blocks capture startup.
    advanced_disable_decide: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
  } as any);
  
  initialized = true;
    posthog.startSessionRecording({ sampling: true });
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
  const speechLower = userSpeech.toLowerCase();
  
  for (const insight of recentInsightClicks) {
    // Skip if too old or different chat
    if (now - insight.clicked_at > IMPLEMENTATION_WINDOW_MS) continue;
    if (insight.chat_id !== chat_id) continue;
    
    // Simple keyword matching (can be enhanced with NLP)
    const keywords = extractKeywords(insight.insight_text);
    const matchCount = keywords.filter(kw => speechLower.includes(kw)).length;
    const matchRatio = keywords.length > 0 ? matchCount / keywords.length : 0;
    
    if (matchRatio >= 0.3) { // 30% keyword match threshold
      trackInsightImplemented({
        chat_id,
        insight_type: insight.insight_type,
        insight_hash: insight.insight_hash,
        implementation_method: 'speech',
        time_since_click_ms: now - insight.clicked_at,
        confidence_score: Math.round(matchRatio * 100),
      });
      
      // Remove from tracking (implemented)
      const idx = recentInsightClicks.indexOf(insight);
      if (idx > -1) recentInsightClicks.splice(idx, 1);
    }
  }
}

function extractKeywords(text: string): string[] {
  // Simple keyword extraction: nouns and verbs (words > 4 chars)
  const stopWords = ['the', 'and', 'that', 'have', 'for', 'not', 'with', 'you', 'this', 'but', 'his', 'from', 'they', 'say', 'she', 'will', 'one', 'all', 'would', 'there', 'their', 'what', 'about', 'which', 'when', 'make', 'like', 'time', 'just', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'use'];
  
  return text
    .toLowerCase()
    .replace(/[^a-zäöüß\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 4 && !stopWords.includes(word))
    .slice(0, 10); // Max 10 keywords
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

export function trackDesktopAppLaunched(properties: {
  version: string;
  os_version?: string;
  is_first_launch?: boolean;
}) {
  const platform = (window as any)?.platformInfo?.isWindows ? 'windows' : 'macos';
  sendDesktopEvent('desktop_app_launched', {
    ...properties,
    platform,
    source: 'desktop',
  });
}

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
  trackDesktopAppLaunched,
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
