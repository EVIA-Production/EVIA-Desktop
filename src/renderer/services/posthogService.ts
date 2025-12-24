/**
 * PostHog Analytics Service for EVIA Desktop
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
    });
    
    initialized = true;
    console.log('[PostHog] ✅ Initialized for Desktop with key:', POSTHOG_KEY.substring(0, 10) + '...');
    
    // Test capture to verify connection
    posthog.capture('desktop_posthog_initialized', { test: true, timestamp: Date.now() });
    console.log('[PostHog] ✅ Sent test event: desktop_posthog_initialized');
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
  console.log('[PostHog] 🔑 Identifying user:', userId, properties);
  posthog.identify(userId, { ...properties, source: 'desktop' });
  localStorage.setItem('posthog_distinct_id', userId);
  
  // Send a test event to confirm identification works
  posthog.capture('desktop_user_identified', { 
    user_id: userId,
    timestamp: Date.now(),
  });
  console.log('[PostHog] ✅ User identified and test event sent');
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
  posthog.capture('session_state_changed', { ...properties, source: 'desktop' });
}

export function trackSessionStarted(properties: {
  chat_id: number;
  language: string;
  preset_name?: string;
  preset_id?: number;
}) {
  posthog.capture('session_started', {
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
  posthog.capture('session_ended', { ...properties, source: 'desktop' });
}

export function trackSessionClosed(properties: {
  chat_id: number;
  final_duration_seconds: number;
  total_asks: number;
  total_insights_clicked: number;
}) {
  posthog.capture('session_closed', { ...properties, source: 'desktop' });
}

// ============================================================================
// ASK FEATURE EVENTS
// ============================================================================

export function trackAskSubmitted(properties: {
  chat_id: number;
  question_length: number;
  session_state: SessionState;
  is_typed: boolean;
  language: string;
}) {
  const eventName = `ask_submitted_${properties.session_state}_call`;
  posthog.capture(eventName, { ...properties, source: 'desktop' });
}

export function trackAskResponseReceived(properties: {
  chat_id: number;
  response_length: number;
  latency_ms: number;
  ttft_ms?: number;
  session_state: SessionState;
}) {
  posthog.capture('ask_response_received', { ...properties, source: 'desktop' });
}

export function trackAskResponseImplemented(properties: {
  chat_id: number;
  response_hash: string;
  implementation_method: 'speech' | 'typed' | 'copied';
  time_to_implement_ms: number;
}) {
  posthog.capture('ask_response_implemented', { ...properties, source: 'desktop' });
}

// ============================================================================
// INSIGHTS FEATURE EVENTS - CRITICAL FOR DESKTOP
// ============================================================================

export function trackInsightsViewed(properties: {
  chat_id: number;
  session_state: SessionState;
  trigger: 'manual' | 'auto';
  transcript_count: number;
}) {
  posthog.capture('insights_viewed', { ...properties, source: 'desktop' });
}

export function trackInsightsLoaded(properties: {
  chat_id: number;
  load_time_ms: number;
  summary_count: number;
  topic_count: number;
  action_count: number;
  followup_count: number;
}) {
  posthog.capture('insights_loaded', { ...properties, source: 'desktop' });
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
  posthog.capture('insight_clicked', {
    ...properties,
    source: 'desktop',
    insight_text_hash: hashText(properties.insight_text),
    insight_text_preview: properties.insight_text.substring(0, 50),
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
  posthog.capture('insight_implemented', { ...properties, source: 'desktop' });
}

export function trackInsightImplementationRate(properties: {
  chat_id: number;
  total_clicked: number;
  total_implemented: number;
  implementation_rate: number;
}) {
  posthog.capture('insight_implementation_rate', { ...properties, source: 'desktop' });
}

export function trackInsightsCopied(properties: {
  chat_id: number;
  content_length: number;
  sections_included: string[];
}) {
  posthog.capture('insights_copied', { ...properties, source: 'desktop' });
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
  chat_id: number;
  source: 'mic' | 'system' | 'both';
  language: string;
}) {
  posthog.capture('recording_started', { ...properties, source: 'desktop' });
}

export function trackRecordingStopped(properties: {
  chat_id: number;
  duration_seconds: number;
  transcript_count: number;
}) {
  posthog.capture('recording_stopped', { ...properties, source: 'desktop' });
}

// ============================================================================
// TRANSCRIPT EVENTS
// ============================================================================

export function trackTranscriptCopied(properties: {
  chat_id: number;
  line_count: number;
  speaker_count: number;
}) {
  posthog.capture('transcript_copied', { ...properties, source: 'desktop' });
}

export function trackTranscriptViewToggled(properties: {
  chat_id: number;
  from_mode: 'transcript' | 'insights';
  to_mode: 'transcript' | 'insights';
  session_state: SessionState;
}) {
  posthog.capture('transcript_view_toggled', { ...properties, source: 'desktop' });
}

// ============================================================================
// PRESET EVENTS
// ============================================================================

export function trackPresetActivated(properties: {
  preset_id: number;
  preset_name: string;
  previous_preset_id?: number;
}) {
  posthog.capture('preset_activated', {
    ...properties,
    source: 'desktop',
    activation_source: 'desktop_settings',
  });
}

export function trackPresetDeactivated(properties: {
  preset_id: number;
}) {
  posthog.capture('preset_deactivated', { ...properties, source: 'desktop' });
}

// ============================================================================
// SETTINGS EVENTS (Desktop-specific)
// ============================================================================

export function trackSettingsOpened(properties: {
  from_view?: string;
}) {
  console.log('[PostHog] 📊 Tracking settings_opened:', properties);
  posthog.capture('settings_opened', { ...properties, source: 'desktop' });
}

export function trackLanguageChanged(properties: {
  from_language: string;
  to_language: string;
}) {
  console.log('[PostHog] 📊 Tracking language_changed:', properties);
  posthog.capture('language_changed', {
    ...properties,
    source: 'desktop_settings',
  });
}

export function trackAutoUpdateToggled(properties: {
  new_state: boolean;
}) {
  posthog.capture('settings_auto_update_toggled', { ...properties, source: 'desktop' });
}

export function trackInvisibilityToggled(properties: {
  new_state: boolean;
}) {
  posthog.capture('settings_invisibility_toggled', { ...properties, source: 'desktop' });
}

export function trackWindowMoved(properties: {
  direction: 'left' | 'right';
  distance_px?: number;
}) {
  posthog.capture('settings_window_moved', { ...properties, source: 'desktop' });
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
  posthog.capture('desktop_app_launched', {
    ...properties,
    platform,
    source: 'desktop',
  });
}

export function trackDesktopAppClosed(properties: {
  session_duration_seconds: number;
  sessions_completed: number;
}) {
  posthog.capture('desktop_app_closed', { ...properties, source: 'desktop' });
}

export function trackShortcutUsed(properties: {
  shortcut_name: 'show_hide' | 'ask' | 'scroll_up' | 'scroll_down';
  source_view?: string;
}) {
  posthog.capture('desktop_shortcut_used', { ...properties, source: 'desktop' });
}

export function trackPermissionStatus(properties: {
  permission_type: 'mic' | 'screen' | 'accessibility';
  status: 'granted' | 'denied' | 'prompt';
}) {
  posthog.capture('desktop_permission_status', { ...properties, source: 'desktop' });
}

export function trackAudioDeviceChanged(properties: {
  device_type: 'input' | 'output';
  device_name: string;
}) {
  posthog.capture('desktop_audio_device_changed', { ...properties, source: 'desktop' });
}

// ============================================================================
// VIEW CHANGE EVENTS
// ============================================================================

export function trackViewChanged(properties: {
  from_view: string;
  to_view: string;
  trigger: 'click' | 'shortcut' | 'auto';
}) {
  posthog.capture('view_changed', { ...properties, source: 'desktop' });
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
  posthog.capture('error_occurred', {
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
  posthog.capture('time_to_first_suggestion', { ...properties, source: 'desktop' });
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
  trackAskResponseReceived,
  trackAskResponseImplemented,
  
  // Insights
  trackInsightsViewed,
  trackInsightsLoaded,
  trackInsightClicked,
  trackInsightImplemented,
  trackInsightImplementationRate,
  trackInsightsCopied,
  checkForInsightImplementation,
  
  // Recording
  trackRecordingStarted,
  trackRecordingStopped,
  
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

