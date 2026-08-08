/**
 * Canonical transcript ordering and context assembly.
 *
 * Pure, dependency-free logic shared by the renderer and covered by
 * `tests/transcript-order.test.cjs`. It lives here because `src/main` is the
 * only tree tsc compiles to `dist/`, which is what the node test runner loads.
 *
 * Why this exists
 * ---------------
 * Mic and system audio arrive over two independent WebSocket connections that
 * flush on different schedules (provider endpointing force-flush on one side, a
 * local inactivity fallback on the other). Arrival order is therefore not
 * dialogue order, and the error is routinely larger than a conversational turn.
 * The backend now stamps each event with `audio_start_ms` - the absolute time
 * the words were spoken - and that is the only trustworthy ordering key.
 */

export interface OrderedTranscriptLine {
  speaker: number | null;
  text: string;
  isFinal?: boolean;
  isPartial?: boolean;
  /** Arrival time in the renderer. Fallback key for pre-audio-clock events. */
  timestamp?: number;
  utteranceId?: string;
  /** Absolute epoch ms the words were spoken, from provider audio offsets. */
  audioStartMs?: number;
}

/**
 * Rows older than this (relative to the newest row) are frozen in place.
 *
 * Without a bound, a very late event could reshuffle history that the user has
 * already read and scrolled past. Corrections land well inside this window;
 * anything later is treated as history and appended where it arrived.
 */
export const REORDER_WINDOW_MS = 20_000;

/**
 * How stale an in-flight partial may be before a suggestion stops trusting it.
 *
 * A final only exists once the provider endpoints the utterance and the server
 * accumulator flushes it, so for roughly the first second after someone stops
 * speaking their words exist only as a partial.
 */
export const LIVE_PARTIAL_MAX_AGE_MS = 15_000;

/** Canonical ordering key. Falls back to arrival time for legacy events. */
export function orderingKeyOf(entry: OrderedTranscriptLine): number {
  const spoken = entry.audioStartMs;
  if (typeof spoken === 'number' && Number.isFinite(spoken) && spoken > 0) return spoken;
  return entry.timestamp ?? 0;
}

/**
 * Sort rows into the order the words were actually spoken.
 *
 * Only the tail within `REORDER_WINDOW_MS` of the newest row participates, and
 * the sort is stable, so equal keys keep insertion order and settled history
 * never moves. Mixing audio-clock rows with legacy arrival-time rows is safe:
 * both are epoch milliseconds on the same scale.
 */
export function inSpokenOrder(
  rows: OrderedTranscriptLine[],
  windowMs: number = REORDER_WINDOW_MS,
): OrderedTranscriptLine[] {
  if (rows.length < 2) return rows;

  let newest = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const key = orderingKeyOf(row);
    if (key > newest) newest = key;
  }
  const cutoff = newest - windowMs;

  // The frozen head is the longest prefix entirely older than the cutoff.
  let head = 0;
  while (head < rows.length && orderingKeyOf(rows[head]) < cutoff) head += 1;
  if (head >= rows.length - 1) return rows;

  const tail = rows
    .slice(head)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const delta = orderingKeyOf(a.entry) - orderingKeyOf(b.entry);
      return delta !== 0 ? delta : a.index - b.index;
    })
    .map(({ entry }) => entry);

  let moved = false;
  for (let i = 0; i < tail.length; i += 1) {
    if (tail[i] !== rows[head + i]) {
      moved = true;
      break;
    }
  }
  if (!moved) return rows;

  return [...rows.slice(0, head), ...tail];
}

/**
 * The freshest turn a suggestion may rely on while it is still being spoken.
 * Returns undefined when no partial is recent and substantive enough.
 */
export function selectEligiblePartial(
  rows: OrderedTranscriptLine[],
  now: number = Date.now(),
  maxAgeMs: number = LIVE_PARTIAL_MAX_AGE_MS,
): OrderedTranscriptLine | undefined {
  let best: OrderedTranscriptLine | undefined;
  for (const entry of rows) {
    if (entry.isFinal || !entry.isPartial) continue;
    if (!(entry.text || '').trim()) continue;
    if (entry.timestamp && now - entry.timestamp > maxAgeMs) continue;
    if (!best || orderingKeyOf(entry) >= orderingKeyOf(best)) best = entry;
  }
  return best;
}

export function speakerLabelOf(speaker: number | null | undefined): string {
  if (speaker === 1) return 'User';
  if (speaker === 0) return 'Prospect';
  return 'Unknown';
}

/**
 * Build the conversation context sent with a suggestion request.
 *
 * Includes the in-flight turn when it is newer than every finalized turn, so a
 * suggestion triggered the moment the prospect stops talking answers *that*
 * turn rather than the previous topic. The unfinished turn is marked so the
 * model does not mistake a half sentence for a completed one.
 */
export function buildTranscriptContext(
  rows: OrderedTranscriptLine[],
  options: {
    maxChars?: number;
    now?: number;
    includeLivePartial?: boolean;
    partialSuffix?: string;
  } = {},
): string {
  const {
    maxChars = 40_000,
    now = Date.now(),
    includeLivePartial = true,
    partialSuffix = '(spricht gerade noch)',
  } = options;

  const ordered = inSpokenOrder(rows);
  const stable = ordered.filter(
    (entry) => Boolean((entry.text || '').trim()) && entry.isFinal === true && entry.isPartial !== true,
  );

  const lines = stable.map((entry) => `${speakerLabelOf(entry.speaker)}: ${(entry.text || '').trim()}`);

  if (includeLivePartial) {
    const live = selectEligiblePartial(ordered, now);
    if (live) {
      const lastStableKey = stable.length
        ? orderingKeyOf(stable[stable.length - 1])
        : Number.NEGATIVE_INFINITY;
      if (orderingKeyOf(live) >= lastStableKey) {
        lines.push(
          `${speakerLabelOf(live.speaker)}: ${(live.text || '').trim()} ${partialSuffix}`,
        );
      }
    }
  }

  // Keep the most recent turns when the budget is tight - the current moment
  // matters more than the opening of the call.
  const kept: string[] = [];
  let charCount = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const projected = charCount + lines[i].length + 1;
    if (projected > maxChars) break;
    kept.unshift(lines[i]);
    charCount = projected;
  }
  return kept.join('\n');
}
