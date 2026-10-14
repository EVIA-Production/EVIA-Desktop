/** Keep operational events and replay layout without sending customer content. */
export const DESKTOP_REPLAY_OPTIONS = {
  maskAllInputs: true,
  maskTextSelector: '*',
  maskInputOptions: { password: true },
  collectFonts: true,
  recordCrossOriginIframes: false,
  recordHeaders: false,
  recordBody: false,
  blockSelector: '[data-telemetry-secret], img, video, canvas, iframe, a[href]',
  captureCanvas: { recordCanvas: false },
};

const CONTENT_KEYS = new Set([
  '$el_text', '$elements', '$elements_chain', 'elements_chain',
  'transcript', 'transcript_excerpt', 'suggestion', 'question', 'answer',
  'insight_text', 'goal_text', 'response', 'query', 'title', 'summary',
  'evidence_summary', 'summary_text', 'preset_content', 'preset_description',
  'preset_name', 'preset_context', 'prepared_suggestion', 'evidence',
  'reasoning', 'rationale', 'old_title', 'new_title', 'chat_title', 'call_title',
  'document_name', 'file_name', 'filename', 'prompt', 'prompt_text',
  'content', 'text', 'notes', 'website_text', 'error_message', 'error_stack',
  'error_signature', 'context',
]);

export function stripAnalyticsContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAnalyticsContent);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    const isContent = CONTENT_KEYS.has(lower)
      || /_(text|content|transcript|excerpt)$/.test(lower);
    if (isContent && entry != null && !['boolean', 'number'].includes(typeof entry)) {
      try {
        output[`${key}_chars`] = typeof entry === 'string' ? entry.length : JSON.stringify(entry).length;
      } catch { /* an unserialisable property must not discard the event */ }
    } else {
      output[key] = stripAnalyticsContent(entry);
    }
  }
  return output;
}
