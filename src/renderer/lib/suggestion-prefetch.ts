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
 * the click. Safety lives on the backend: the parked answer is keyed by the
 * transcript fingerprint, so a suggestion generated against a different
 * conversation can never be served. The worst case is a wasted generation,
 * never a stale line in a live call.
 *
 * ── Why this was rewritten ──────────────────────────────────────────────────
 *
 * Production from 2026-08-21T05:38Z: 6 parked, 6 interactive clicks, 0 hits.
 * The dominant cause was that the click and the prefetch built different
 * strings; that is fixed in ListenView. This file governs the other half -
 * WHEN to speculate - and three defects here were proven by executable tests
 * against this module (tests/prefetch-state-machine.test.cjs):
 *
 *   1. A failed attempt recorded its transcript as "already prefetched" before
 *      the request and never undid it, so one network blip permanently
 *      disabled prefetch for the exact context the seller was sitting on.
 *   2. An older in-flight generation vetoed the newest turn. Only the newest
 *      context can ever be claimed, so this dropped the one thing worth having.
 *   3. The opener stamped the rate limit, so the first real turn of the call -
 *      precisely when a seller reaches for a line - was inside the cooldown and
 *      discarded.
 *
 * The policy therefore changed from "fire immediately, then suppress" to
 * "settle, then fire the latest". A click lands in a PAUSE - in the measured
 * sessions the click came 57s after the last final - so the valuable generation
 * is the one covering the newest context once the turn has stopped moving.
 *
 * The rate limit now DEFERS rather than DROPS. Dropping the newest final to
 * respect a cost guard spends nothing and also guarantees the next click
 * misses; deferring costs the same and keeps the context claimable.
 */

/**
 * Speculative prefetch is OFF.
 *
 * Measured in production on 2026-08-23 and 2026-08-24: 100 suggestions parked,
 * 0 ever claimed. 101 of 119 /ask calls - 85% of provider spend on that
 * endpoint - went to work no user ever received.
 *
 * It is not a tuning problem. One context was both parked and clicked:
 *
 *   20:21:18.611  MISS   click on fingerprint 9da146b7a07a
 *   20:21:21.541  PREFETCH parked 59 chars for 9da146b7a07a
 *
 * The speculative generation for the exact context the seller clicked on
 * finished 2.9 SECONDS AFTER the click. This file arms on a transcript FINAL;
 * the seller clicks when the prospect stops speaking; the final lands a second
 * or two later. The click wins that race by construction, so the parked answer
 * is always for a context the call has already left.
 *
 * The BACKEND is authoritative - it refuses speculative generation regardless
 * of what any client sends, because installed builds will keep sending
 * `prefetch: true` for months. This flag only stops THIS build from making the
 * request at all, which saves the round trip too.
 *
 * Nothing here is deleted. A redesigned trigger - armed from interim
 * transcripts, or a click that joins a generation starting after it - needs
 * exactly this code.
 */
const SPECULATIVE_PREFETCH_ENABLED = false

const PREFETCH_MIN_TRANSCRIPT_CHARS = 40
/** How long a turn must stop moving before it is worth generating against. */
const PREFETCH_QUIET_MS = 700
/** Floor between two generations. A rate limit, never a reason to drop a turn. */
const PREFETCH_MIN_INTERVAL_MS = 4000

let lastPrefetchedTranscript = ''
let lastPrefetchAt = 0
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let pendingInput: PrefetchInput | null = null
let inFlight: AbortController | null = null
let inFlightTranscript = ''

export function resetSuggestionPrefetch(): void {
  lastPrefetchedTranscript = ''
  lastPrefetchAt = 0
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = null
  pendingInput = null
  abortInFlight()
}

function abortInFlight(): void {
  if (inFlight) {
    try { inFlight.abort() } catch { /* already settled */ }
  }
  inFlight = null
  inFlightTranscript = ''
}

export type PrefetchInput = {
  baseUrl: string
  chatId: number
  token: string
  transcript: string
  language: 'de' | 'en'
  question: string
}

function askBody(input: Omit<PrefetchInput, 'transcript'> & { transcript: string }) {
  return JSON.stringify({
    chat_id: input.chatId,
    prompt: input.transcript,
    prompt_override: input.question,
    transcript: input.transcript,
    language: input.language,
    session_state: 'during',
    stream: true,
    prefetch: true,
    query_source: 'quick_action',
  })
}

/**
 * Issue the speculative call and READ IT TO THE END.
 *
 * The previous version awaited `fetch()` and dropped the response. `fetch`
 * resolves when the headers arrive, not when generation finishes, so the
 * in-flight flag was cleared while the model was still working, and nothing
 * ever consumed the stream - leaving the backend writing into a body no one
 * read, to be cancelled whenever the handle was collected. Draining it is what
 * makes "in flight" mean what it says and what guarantees the answer is
 * actually parked before we consider the work done.
 */
async function issue(input: PrefetchInput, controller: AbortController): Promise<'sent' | 'skipped'> {
  const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/ask`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json',
    },
    body: askBody(input),
    signal: controller.signal,
  })
  const body = (response as any)?.body
  if (body?.getReader) {
    const reader = body.getReader()
    // Discard the bytes; the value is the parked entry the backend writes when
    // the stream completes, not anything shown here.
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
  }
  return 'sent'
}

/**
 * Arm the opener before the call has a transcript.
 *
 * The first click of a call is the one click guaranteed to have no prospect
 * turn behind it. An empty transcript is a legitimate context - it is exactly
 * what the before-call opener path expects - so it gets its own entry point
 * rather than being filtered out by the minimum-length guard.
 *
 * It deliberately does NOT stamp the rate limit. The opener and the first real
 * turn are different contexts, and charging the first turn for the opener's
 * generation discarded the turn a seller is most likely to click on.
 */
export async function prefetchOpener(
  input: Omit<PrefetchInput, 'transcript'>,
): Promise<'sent' | 'skipped'> {
  if (!SPECULATIVE_PREFETCH_ENABLED) return 'skipped'
  if (!input.chatId || !input.token) return 'skipped'
  if (inFlight) return 'skipped'
  const controller = new AbortController()
  inFlight = controller
  inFlightTranscript = ''
  lastPrefetchedTranscript = ''
  try {
    const result = await issue({ ...input, transcript: '' }, controller)
    console.log('[Prefetch] opener armed before the first word')
    return result
  } catch {
    return 'skipped'
  } finally {
    if (inFlight === controller) abortInFlight()
  }
}

/**
 * Register the latest context. Never throws, never blocks, never retries.
 *
 * Returns 'scheduled' when the turn has been accepted and will be generated
 * against once it stops moving, 'skipped' when it is not worth paying for.
 */
export function prefetchSuggestion(input: PrefetchInput): 'scheduled' | 'skipped' {
  if (!SPECULATIVE_PREFETCH_ENABLED) return 'skipped'
  const transcript = (input.transcript || '').trim()

  // Nothing to ground a suggestion in yet.
  if (transcript.length < PREFETCH_MIN_TRANSCRIPT_CHARS) return 'skipped'
  // Already parked for exactly this context: the backend holds the answer.
  if (transcript === lastPrefetchedTranscript) return 'skipped'
  if (!input.chatId || !input.token) return 'skipped'
  // Already generating this exact context.
  if (inFlight && inFlightTranscript === transcript) return 'skipped'

  // The newest context supersedes anything older. A generation for a transcript
  // the conversation has already moved past can never be claimed, so continuing
  // to pay for it buys nothing.
  if (inFlight && inFlightTranscript !== transcript) abortInFlight()

  pendingInput = { ...input, transcript }
  if (pendingTimer) clearTimeout(pendingTimer)

  // Wait for the turn to settle, and never start two generations closer
  // together than the floor. Deferring past the floor keeps the newest context
  // claimable; dropping it, as this used to, did not.
  const sinceLast = Date.now() - lastPrefetchAt
  const wait = Math.max(PREFETCH_QUIET_MS, PREFETCH_MIN_INTERVAL_MS - sinceLast)
  pendingTimer = setTimeout(() => { void fire() }, wait)
  return 'scheduled'
}

async function fire(): Promise<void> {
  pendingTimer = null
  const input = pendingInput
  pendingInput = null
  if (!input) return
  if (input.transcript === lastPrefetchedTranscript) return

  const previousTranscript = lastPrefetchedTranscript
  const previousAt = lastPrefetchAt
  const controller = new AbortController()
  inFlight = controller
  inFlightTranscript = input.transcript
  lastPrefetchedTranscript = input.transcript
  lastPrefetchAt = Date.now()
  try {
    await issue(input, controller)
    console.log('[Prefetch] parked a suggestion for the current transcript')
  } catch {
    // A failed attempt must not look like a successful one. Recording the
    // transcript before the request and leaving it there on failure meant a
    // single blip permanently suppressed retry for the context the seller was
    // sitting on - measured as a live defect, not a hypothetical one.
    if (lastPrefetchedTranscript === input.transcript) {
      lastPrefetchedTranscript = previousTranscript
      lastPrefetchAt = previousAt
    }
  } finally {
    if (inFlight === controller) { inFlight = null; inFlightTranscript = '' }
  }
}

/** Test seam: run any scheduled generation now instead of on its timer. */
export async function flushPendingPrefetchForTest(): Promise<void> {
  if (pendingTimer) clearTimeout(pendingTimer)
  await fire()
}
