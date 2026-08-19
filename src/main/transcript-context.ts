/**
 * The exact transcript string that goes to the model, derived from one state.
 *
 * Why this is its own pure module rather than a `useMemo` in ListenView:
 *
 * The speculative prefetch fires inside the transcript event handler, right
 * after `setCanonicalTranscriptState(transition.state)`. It used to read the
 * context off a ref that is assigned during RENDER:
 *
 *     prefetchTranscriptRef.current = filteredTranscriptContext   // render
 *     ...
 *     setCanonicalTranscriptState(transition.state)               // async
 *     prefetchSuggestion({ transcript: prefetchTranscriptRef.current })
 *
 * React state updates are not applied during the handler that schedules them,
 * so at the moment the prefetch was sent, the ref still held the transcript
 * from BEFORE the final that triggered it. The seller's later click sends the
 * transcript WITH that final. The backend keys the prefetch cache on
 * `_context_fingerprint(session_state, transcript, question)`, so the two
 * never matched: every prefetch was a wasted generation and no click was ever
 * served from cache.
 *
 * Deriving the string from a state value - which the handler already holds,
 * fully updated, as `transition.state` - removes the ordering question
 * entirely. Both callers run the same code over the same input.
 */

import { dropBledMicRows, farEndTextOf } from './transcript-order'
import {
  projectRealtimeTranscriptState,
  type RealtimeTranscriptState,
} from './realtime-transcript-state'

export interface ContextRow {
  speaker: number
  text: string
  uncertainWords?: string[]
}

/** Escape a word for use inside a RegExp. */
function escapeForRegExp(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Rows -> the prompt copy of the transcript.
 *
 * Words the recogniser was unsure of are marked for the MODEL only. The
 * visible transcript stays clean: a screen peppered with markers is worse than
 * one that is occasionally wrong, and the seller can hear what was said.
 * Taylos cannot, so it gets the warning.
 */
export function buildTranscriptContext(rows: readonly ContextRow[]): string {
  return rows
    .filter((row) => (row.text || '').trim())
    .map((row) => {
      let text = row.text.trim()
      for (const uncertain of row.uncertainWords || []) {
        text = text.replace(new RegExp(`\\b${escapeForRegExp(uncertain)}\\b`), `${uncertain}⁇`)
      }
      return `${row.speaker === 1 ? 'Seller' : 'Prospect'}: ${text}`
    })
    .join('\n')
}

/** The visible rows for a state, with far-end speech swept off the mic side. */
export function rowsFromState(state: RealtimeTranscriptState): ContextRow[] {
  const rows = projectRealtimeTranscriptState(state).visibleRows.map((row: any) => ({
    speaker: row.source === 'mic' ? 1 : 0,
    text: row.text,
    isFinal: row.isFinal,
    isPartial: !row.isFinal,
    timestamp: row.captureStartMs,
    updatedAt: row.captureEndMs,
    audioStartMs: row.captureStartMs,
    audioEndMs: row.captureEndMs,
    utteranceId: row.key,
    uncertainWords: row.uncertainWords,
  }))
  return dropBledMicRows(rows as any, farEndTextOf(rows as any)) as unknown as ContextRow[]
}

/**
 * One state in, the exact string the model receives out. This is what the
 * prefetch must send so that its fingerprint can match the click's.
 */
export function transcriptContextFromState(state: RealtimeTranscriptState): string {
  return buildTranscriptContext(rowsFromState(state))
}
