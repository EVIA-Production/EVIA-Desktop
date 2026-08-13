/**
 * The backend wire contract, validated in one testable place.
 *
 * This lived inside ListenView.tsx as a local const, which meant the single
 * gate deciding whether a transcript row is ever shown could not be imported,
 * could not be tested, and could only be observed by reading a DevTools console
 * during a live call. On 2026-08-13 it rejected 100% of segments and the suite
 * stayed green, because the tests exercise the reducer downstream of here and
 * nothing exercised the seam itself.
 *
 * Rejecting is deliberate and must stay that way: arrival time cannot
 * reconstruct order across the independent mic and system streams, so an event
 * without a provable capture clock is worse than no event. What was wrong was
 * not the strictness - it was that the strictness was unobservable and
 * untested.
 */
import {
  normalizeRealtimeTranscriptEventWithReason,
  type NormalizedRealtimeTranscriptEvent,
} from './realtime-transcript-state';

export type TranscriptAdapterResult =
  | {
      event: NormalizedRealtimeTranscriptEvent;
      reason: null;
      captureEndEpochMs: number;
      providerReceivedAtMs: number | null;
      serverSentAtMs: number | null;
    }
  | { event: null; reason: string };

const nonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Adapt the backend wire contract without inventing identity or timing.
 *
 * Every rejection returns a named `reason`. Callers must surface it as text -
 * logging the object alone renders as "Object" in a console and hides the one
 * fact that matters.
 */
export const adaptServerTranscriptEvent = (
  message: unknown,
  chatId: string | null,
): TranscriptAdapterResult => {
  if (!message || typeof message !== 'object') return { event: null, reason: 'invalid-message' };
  const envelope = message as Record<string, unknown>;
  if (envelope.type !== 'transcript_segment') return { event: null, reason: 'not-transcript' };
  if (!envelope.data || typeof envelope.data !== 'object') return { event: null, reason: 'missing-data' };
  if (!chatId) return { event: null, reason: 'missing-chat-id' };

  const data = envelope.data as Record<string, unknown>;
  const source = data.source;
  const forwardedSource = envelope._source;
  if (source !== 'mic' && source !== 'system') return { event: null, reason: 'invalid-source' };
  if (forwardedSource !== undefined && forwardedSource !== source) {
    return { event: null, reason: 'source-mismatch' };
  }
  if (data.clock_domain_valid !== true) return { event: null, reason: 'invalid-clock-domain' };

  const sessionId = typeof data.capture_session_id === 'string' ? data.capture_session_id.trim() : '';
  const utteranceId = data.utterance_id === undefined || data.utterance_id === null
    ? ''
    : String(data.utterance_id).trim();
  const eventId = typeof data.event_id === 'string' ? data.event_id.trim() : '';
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!sessionId || !utteranceId || !eventId || !text) {
    return { event: null, reason: 'missing-canonical-identity-or-text' };
  }
  if (
    !nonNegativeInteger(data.capture_generation) ||
    !nonNegativeInteger(data.stream_generation) ||
    !nonNegativeInteger(data.seq) ||
    !finiteNumber(data.session_epoch_ms) ||
    !finiteNumber(data.capture_start_ms) ||
    !finiteNumber(data.capture_end_ms)
  ) {
    return { event: null, reason: 'invalid-canonical-metadata' };
  }
  if (!Array.isArray(data.words)) return { event: null, reason: 'missing-timed-words' };

  const words = [] as Array<{ text: string; startMs: number; endMs: number }>;
  for (const candidate of data.words) {
    if (!candidate || typeof candidate !== 'object') return { event: null, reason: 'invalid-word' };
    const word = candidate as Record<string, unknown>;
    const wordText = typeof word.text === 'string' ? word.text.trim() : '';
    if (
      !wordText ||
      !finiteNumber(word.capture_start_ms) ||
      !finiteNumber(word.capture_end_ms)
    ) {
      return { event: null, reason: 'unmapped-word-clock' };
    }
    words.push({
      text: wordText,
      startMs: word.capture_start_ms,
      endMs: word.capture_end_ms,
    });
  }

  const normalized = normalizeRealtimeTranscriptEventWithReason({
    chatId,
    sessionId,
    source,
    captureGeneration: data.capture_generation,
    streamGeneration: data.stream_generation,
    utteranceId,
    eventId,
    seq: data.seq,
    captureStartMs: data.capture_start_ms,
    captureEndMs: data.capture_end_ms,
    words,
    clockDomainValid: true,
    text,
    isFinal: data.is_final === true,
  });
  const event = normalized.event;
  // Carry the specific predicate. "invalid-normalized-event" names the function
  // that refused, not the fault, and that is all the console could say while
  // every live mic segment was being dropped.
  if (!event) return { event: null, reason: `invalid-normalized-event: ${normalized.reason}` };

  const trace = data.trace && typeof data.trace === 'object'
    ? data.trace as Record<string, unknown>
    : null;
  return {
    event,
    reason: null,
    captureEndEpochMs: data.session_epoch_ms + event.captureEndMs,
    providerReceivedAtMs: finiteNumber(trace?.provider_received_at_ms)
      ? trace.provider_received_at_ms
      : null,
    serverSentAtMs: finiteNumber(trace?.server_sent_at_ms)
      ? trace.server_sent_at_ms
      : null,
  };
};
