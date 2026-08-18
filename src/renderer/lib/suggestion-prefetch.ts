/**
 * Ask for the next suggestion before the seller does.
 *
 * Measured 2026-08-18, Jakarta to the West Europe deployment, against /health
 * which does no work at all: 225ms on a warm connection, 777ms cold. That is
 * 11,000km at the speed of light in fibre. Model TTFT lands on top. So as long
 * as the generation STARTS at the click, a distant seller can never see a
 * sub-second suggestion, no matter how fast the backend gets.
 *
 * The fix is not to make the round trip faster, it is to have finished before
 * the click. When the prospect stops speaking, the seller is about to want a
 * line - that is the whole reason the button exists - so we generate it then.
 * If they click and the conversation has not moved, the backend serves the
 * parked answer from one Redis lookup.
 *
 * Safety lives on the backend: the parked answer is keyed by the transcript
 * fingerprint, so a suggestion generated against a different conversation can
 * never be served. One more prospect word and it misses. The worst case here
 * is a wasted generation, never a stale line in a live call.
 *
 * Coverage matters as much as the mechanism. Firing only on a PROSPECT turn
 * left two common clicks paying full price: the first click of a call, before
 * anyone has said anything, and a click right after the seller speaks, because
 * their own words change the transcript and therefore the fingerprint. So a
 * final from EITHER side arms it, and the session start arms the opener.
 *
 * Cost stays bounded by the same three guards: never twice for the same
 * transcript, one generation in flight, and a cooldown between them.
 */

const PREFETCH_MIN_TRANSCRIPT_CHARS = 40
const PREFETCH_COOLDOWN_MS = 4000

let lastPrefetchedTranscript = ''
let lastPrefetchAt = 0
let inFlight = false

export function resetSuggestionPrefetch(): void {
  lastPrefetchedTranscript = ''
  lastPrefetchAt = 0
  inFlight = false
}

/**
 * Arm the opener before the call has a transcript.
 *
 * The first click of a call is the one click guaranteed to have no prospect
 * turn behind it, so it was the one click that always paid the full round trip
 * plus generation. An empty transcript is a legitimate context - it is exactly
 * what the before-call opener path expects - so it gets its own entry point
 * rather than being filtered out by the minimum-length guard.
 */
export async function prefetchOpener(
  input: Omit<PrefetchInput, 'transcript'>,
): Promise<'sent' | 'skipped'> {
  if (!input.chatId || !input.token) return 'skipped'
  if (inFlight) return 'skipped'
  inFlight = true
  lastPrefetchedTranscript = ''
  lastPrefetchAt = Date.now()
  try {
    await fetch(`${input.baseUrl.replace(/\/$/, '')}/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        prompt: '',
        prompt_override: input.question,
        transcript: '',
        language: input.language,
        session_state: 'during',
        stream: true,
        prefetch: true,
        query_source: 'quick_action',
      }),
    })
    console.log('[Prefetch] opener armed before the first word')
    return 'sent'
  } catch {
    return 'skipped'
  } finally {
    inFlight = false
  }
}

export type PrefetchInput = {
  baseUrl: string
  chatId: number
  token: string
  transcript: string
  language: 'de' | 'en'
  question: string
}

/**
 * Fire a speculative generation. Never throws, never blocks, never retries.
 */
export async function prefetchSuggestion(input: PrefetchInput): Promise<'sent' | 'skipped'> {
  const transcript = (input.transcript || '').trim()
  const now = Date.now()

  // Nothing to ground a suggestion in yet.
  if (transcript.length < PREFETCH_MIN_TRANSCRIPT_CHARS) return 'skipped'
  // The transcript has not moved: the backend would already hold this answer.
  if (transcript === lastPrefetchedTranscript) return 'skipped'
  // One generation at a time, and not on every partial in a fast exchange.
  if (inFlight || now - lastPrefetchAt < PREFETCH_COOLDOWN_MS) return 'skipped'
  if (!input.chatId || !input.token) return 'skipped'

  inFlight = true
  lastPrefetchedTranscript = transcript
  lastPrefetchAt = now
  try {
    await fetch(`${input.baseUrl.replace(/\/$/, '')}/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        prompt: transcript,
        prompt_override: input.question,
        transcript,
        language: input.language,
        session_state: 'during',
        stream: true,
        prefetch: true,
        query_source: 'quick_action',
      }),
    })
    console.log('[Prefetch] parked a suggestion for the current transcript')
    return 'sent'
  } catch {
    // An optimisation that fails is not an error: the real click still runs
    // the normal path, which carries its own error handling.
    return 'skipped'
  } finally {
    inFlight = false
  }
}
