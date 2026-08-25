/**
 * Deciding whether a prepared answer may be shown for THIS click.
 *
 * The rule is one line - the transcript must not have moved - and the reason
 * this is its own module is that the last two attempts at exactly this rule
 * failed the same way twice.
 *
 * WHY THIS COMPARES STRINGS AND NOT HASHES
 *
 * Speculative prefetch keyed a cache on `_context_fingerprint(...)` computed
 * in Python, and the client decided what to send from a string it derived
 * separately. Two derivations of one value: the server appended no `⁇`
 * markers, the client did, and the two never once agreed. Measured in
 * production: 6 parked, 6 clicks, 0 hits - a structural 100% miss that a
 * source comment claimed was impossible.
 *
 * Re-deriving the fingerprint here, in TypeScript, against a hash the backend
 * computes in Python, would rebuild that same defect across a language
 * boundary where it is even harder to see.
 *
 * So the client never recomputes anything. It keeps the exact transcript
 * string it SENT with the insights request, and compares it to the exact
 * string it WOULD send now. Both come from `transcriptContextFromState`, one
 * function, one derivation. If those two strings are equal then the request
 * `/ask` would make right now is byte-identical to the one the prepared
 * answer was generated for, which is the only property that matters.
 *
 * `context_fingerprint` still travels with the answer, but only so a hit can
 * be matched to its generation in the logs. It is never the deciding value.
 */

/** The prepared fields the backend may attach to action #1. All optional. */
export interface PreparedSuggestionFields {
  prepared_suggestion?: string
  context_fingerprint?: string
  suggestion_id?: string
  generated_at?: string
  provider?: string
  model?: string
}

/** An insights snapshot, plus the transcript that was sent to produce it. */
export interface PreparedSnapshot {
  /** Exactly what was sent as `transcript` on the insights request. */
  requestTranscript: string
  fields: PreparedSuggestionFields
}

export type PreparedOutcome =
  | { kind: 'prepared_hit'; text: string; suggestionId: string; fingerprint: string }
  | { kind: 'prepared_miss'; reason: PreparedMissReason }

export type PreparedMissReason =
  | 'no_snapshot'
  | 'not_canonical_action'
  | 'no_prepared_suggestion'
  | 'context_moved'
  | 'empty_after_trim'

/** The two labels that can ever carry a prepared answer. */
export const CANONICAL_LIVE_ACTIONS = [
  '💬 Was soll ich als Nächstes sagen?',
  '💬 What should I say next?',
] as const

export function isCanonicalLiveAction(label: string | undefined): boolean {
  const normalized = (label || '').trim()
  return (CANONICAL_LIVE_ACTIONS as readonly string[]).includes(normalized)
}

/**
 * May this click be served from the prepared answer?
 *
 * `currentTranscript` must be produced by `transcriptContextFromState` on the
 * live state - the same call the insights request used. Anything else
 * reintroduces the second derivation this module exists to prevent.
 */
export function decidePrepared(
  label: string | undefined,
  snapshot: PreparedSnapshot | null,
  currentTranscript: string,
): PreparedOutcome {
  if (!isCanonicalLiveAction(label)) {
    return { kind: 'prepared_miss', reason: 'not_canonical_action' }
  }
  if (!snapshot) {
    return { kind: 'prepared_miss', reason: 'no_snapshot' }
  }
  const text = (snapshot.fields.prepared_suggestion || '').trim()
  if (!snapshot.fields.prepared_suggestion) {
    return { kind: 'prepared_miss', reason: 'no_prepared_suggestion' }
  }
  if (!text) {
    return { kind: 'prepared_miss', reason: 'empty_after_trim' }
  }
  // The whole safety property. Not a similarity score, not a prefix check:
  // one more word from either speaker and the answer was written for a
  // conversation that no longer exists.
  if (snapshot.requestTranscript !== currentTranscript) {
    return { kind: 'prepared_miss', reason: 'context_moved' }
  }
  return {
    kind: 'prepared_hit',
    text,
    suggestionId: snapshot.fields.suggestion_id || '',
    fingerprint: snapshot.fields.context_fingerprint || '',
  }
}
