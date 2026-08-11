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
  /**
   * When this turn *started*. Ordering key of last resort, and deliberately
   * not refreshed as a turn grows: a turn still being spoken must not drift
   * past turns that began after it.
   */
  timestamp?: number;
  /**
   * When this row last received data. Separate from `timestamp` because the
   * two answer different questions: "where does this belong in the
   * conversation" versus "is this row still live". Collapsing them into one
   * field means whichever job loses is silently broken - keeping only the
   * start time made a partial unmatchable after 5s of continuous speech, so
   * every further interim spawned a new bubble.
   */
  updatedAt?: number;
  utteranceId?: string;
  /** Absolute epoch ms the words were spoken, from provider audio offsets. */
  audioStartMs?: number;
  /** Absolute epoch ms of the final word/sample in this provider snapshot. */
  audioEndMs?: number;
  /**
   * Absolute word timings from the shared mic/system audio clock.
   *
   * A provider utterance may span a real interruption from the other source.
   * These timings are what let us render that as Them -> Me -> Them without
   * guessing from the order two WebSockets happened to deliver updates.
   */
  words?: TimedTranscriptWord[];
}

export interface TimedTranscriptWord {
  text: string;
  startMs: number;
  endMs?: number;
}

function comparableTokens(value: string): string[] {
  return (value || '').toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
}

function timedWordsMatchText(words: TimedTranscriptWord[], text: string): boolean {
  const fromWords = comparableTokens(words.map(word => word.text).join(' '));
  const fromText = comparableTokens(text);
  if (fromWords.length !== fromText.length || fromWords.length === 0) return false;
  return fromWords.every((token, index) => token === fromText[index]);
}

/**
 * Project provider utterances onto the actual cross-source word timeline.
 *
 * Deepgram's utterance id belongs to one audio stream; it is not a dialogue
 * turn id. During short interruptions the same system utterance can contain
 * words spoken both before and after the user's reply. Flattening the two
 * streams onto their absolute word times is the only deterministic way to
 * reconstruct the visible order.
 *
 * The projection is deliberately fail-closed. If provider words do not match
 * the authoritative displayed text (for example after a correction/filter),
 * that row remains atomic and unchanged. We never manufacture, duplicate, or
 * silently drop words to obtain a prettier timeline.
 */
export function projectTranscriptTimeline(
  rows: OrderedTranscriptLine[],
): OrderedTranscriptLine[] {
  if (rows.length < 2 || !rows.some(row => (row.words?.length || 0) > 0)) return rows;

  type Atom = {
    speaker: number | null;
    text: string;
    startMs: number;
    endMs: number;
    timestamp: number;
    updatedAt: number;
    isFinal: boolean;
    isPartial: boolean;
    order: number;
  };

  const atoms: Atom[] = [];
  let atomOrder = 0;

  rows.forEach((row) => {
    const words = (row.words || []).filter(word =>
      Boolean((word.text || '').trim()) && Number.isFinite(word.startMs) && word.startMs > 0
    );
    const canProject = words.length > 0 && timedWordsMatchText(words, row.text || '');

    if (canProject) {
      words.forEach((word) => {
        const endMs = Number.isFinite(word.endMs) && (word.endMs as number) >= word.startMs
          ? word.endMs as number
          : word.startMs;
        atoms.push({
          speaker: row.speaker ?? null,
          text: word.text.trim(),
          startMs: word.startMs,
          endMs,
          timestamp: row.timestamp ?? word.startMs,
          updatedAt: row.updatedAt ?? row.timestamp ?? word.startMs,
          isFinal: row.isFinal === true,
          isPartial: row.isPartial === true && row.isFinal !== true,
          order: atomOrder++,
        });
      });
      return;
    }

    const startMs = hasAudioKey(row) ? row.audioStartMs as number : row.timestamp ?? 0;
    const endMs = typeof row.audioEndMs === 'number' && Number.isFinite(row.audioEndMs)
      ? Math.max(startMs, row.audioEndMs)
      : startMs;
    atoms.push({
      speaker: row.speaker ?? null,
      text: (row.text || '').trim(),
      startMs,
      endMs,
      timestamp: row.timestamp ?? startMs,
      updatedAt: row.updatedAt ?? row.timestamp ?? startMs,
      isFinal: row.isFinal === true,
      isPartial: row.isPartial === true && row.isFinal !== true,
      order: atomOrder++,
    });
  });

  atoms.sort((left, right) => {
    const byStart = left.startMs - right.startMs;
    if (byStart !== 0) return byStart;
    const byEnd = left.endMs - right.endMs;
    return byEnd !== 0 ? byEnd : left.order - right.order;
  });

  const projected: OrderedTranscriptLine[] = [];
  for (const atom of atoms) {
    if (!atom.text) continue;
    const tail = projected[projected.length - 1];
    if (tail && tail.speaker === atom.speaker) {
      tail.text = `${tail.text} ${atom.text}`.trim();
      tail.audioEndMs = Math.max(tail.audioEndMs ?? atom.endMs, atom.endMs);
      tail.updatedAt = Math.max(tail.updatedAt ?? 0, atom.updatedAt);
      tail.isFinal = tail.isFinal === true && atom.isFinal;
      tail.isPartial = tail.isFinal !== true && (tail.isPartial === true || atom.isPartial);
      continue;
    }
    projected.push({
      speaker: atom.speaker,
      text: atom.text,
      isFinal: atom.isFinal,
      isPartial: atom.isPartial,
      timestamp: atom.timestamp,
      updatedAt: atom.updatedAt,
      audioStartMs: atom.startMs,
      audioEndMs: atom.endMs,
      utteranceId: `timeline:${atom.speaker ?? 'unknown'}:${Math.round(atom.startMs)}`,
    });
  }

  return projected;
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

/**
 * Should this interim replace what a bubble already shows?
 *
 * The server emits a turn's accumulated text, so within one utterance the text
 * only ever grows. Anything arriving shorter is therefore a *stale* interim
 * that overtook a newer one - the renderer throttles partials and forwards them
 * through the main process, so ordering is not guaranteed end to end.
 *
 * Rendering it would make the visible sentence briefly shrink and then jump
 * back, which is what a viewer reports as flicker. Refusing shrinkage costs
 * nothing: the newer text has already been shown, and the next interim carries
 * everything this one had.
 *
 * Only applies within a single utterance. A new turn legitimately starts short,
 * and a final may be shorter than the partial it replaces because the tail
 * migrates to the next turn.
 */
export function shouldReplacePartialText(current: string, incoming: string): boolean {
  const existing = (current || '').trim();
  const next = (incoming || '').trim();
  if (!next) return false;
  if (!existing) return true;
  if (next === existing) return false;
  // A correction of the same length, or any growth, is real progress.
  if (next.length >= existing.length) return true;
  // Shorter: only accept when it is not simply a prefix of what is shown,
  // i.e. the provider genuinely revised the wording rather than regressing.
  return !existing.startsWith(next);
}

/**
 * Locate the one live row owned by a provider utterance.
 *
 * `utteranceId` is a stream identity, not a text-similarity hint: the backend
 * keeps it stable for every interim revision and advances it only after that
 * turn is finalized. Deepgram may substantially rewrite an interim while it
 * decodes more audio, so requiring a shared text prefix can create two visible
 * rows for one spoken turn. Exact identity therefore wins before any legacy
 * text/time heuristic is considered.
 */
export function findLivePartialByUtteranceIdentity(
  rows: OrderedTranscriptLine[],
  speaker: number | null,
  utteranceId: string | undefined,
): number {
  if (utteranceId === undefined) return -1;
  const normalizedId = String(utteranceId);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.speaker !== speaker) continue;
    if (!row.isPartial || row.isFinal) continue;
    if (row.utteranceId !== undefined && String(row.utteranceId) === normalizedId) {
      return index;
    }
  }
  return -1;
}

/** True when this row carries a real spoken-time key. */
export function hasAudioKey(entry: OrderedTranscriptLine): boolean {
  const spoken = entry.audioStartMs;
  return typeof spoken === 'number' && Number.isFinite(spoken) && spoken > 0;
}

/** Canonical ordering key. Falls back to arrival time for legacy events. */
export function orderingKeyOf(entry: OrderedTranscriptLine): number {
  if (hasAudioKey(entry)) return entry.audioStartMs as number;
  return entry.timestamp ?? 0;
}

/**
 * Give every row a key on the *same* scale before sorting.
 *
 * Spoken time and arrival time are both epoch milliseconds, which makes them
 * look comparable - but arrival is roughly a second later than the speech it
 * describes, because the provider has to endpoint and transcribe first. So a
 * row keyed by arrival sorts after everything keyed by speech from the same
 * moment, and if only some rows carry an audio key the two clocks interleave
 * wrongly. That is a whole class of ordering bug, not one case.
 *
 * Rather than convert between the scales - the offset is not constant, so any
 * conversion is a guess - an unkeyed row is pinned just after the last keyed
 * row that preceded it. It keeps the position it arrived in, relative to rows
 * that do know when they were spoken, and never competes on a foreign scale.
 */
function keysOnOneScale(rows: OrderedTranscriptLine[]): number[] {
  const keys = new Array<number>(rows.length);
  let lastKeyed = Number.NEGATIVE_INFINITY;
  let unkeyedRun = 0;

  for (let i = 0; i < rows.length; i += 1) {
    if (hasAudioKey(rows[i])) {
      lastKeyed = rows[i].audioStartMs as number;
      unkeyedRun = 0;
      keys[i] = lastKeyed;
      continue;
    }
    unkeyedRun += 1;
    keys[i] = lastKeyed === Number.NEGATIVE_INFINITY
      // Nothing keyed yet: fall back to arrival, which is all we have.
      ? (rows[i].timestamp ?? 0)
      // Just after the last keyed row, preserving arrival order among peers.
      : lastKeyed + unkeyedRun / 1000;
  }
  return keys;
}

/**
 * Sort rows into the order the words were actually spoken.
 *
 * Only the tail within `REORDER_WINDOW_MS` of the newest row participates, and
 * the sort is stable, so equal keys keep insertion order and settled history
 * never moves. Every row is first placed on a single scale by
 * `keysOnOneScale`, so a row that never received a spoken time cannot compete
 * against one that did.
 */
export function inSpokenOrder(
  rows: OrderedTranscriptLine[],
  windowMs: number = REORDER_WINDOW_MS,
): OrderedTranscriptLine[] {
  if (rows.length < 2) return rows;

  const keys = keysOnOneScale(rows);

  let newest = Number.NEGATIVE_INFINITY;
  for (const key of keys) {
    if (key > newest) newest = key;
  }
  const cutoff = newest - windowMs;

  // The frozen head is the longest prefix entirely older than the cutoff.
  let head = 0;
  while (head < rows.length && keys[head] < cutoff) head += 1;
  if (head >= rows.length - 1) return rows;

  const tail = rows
    .slice(head)
    .map((entry, index) => ({ entry, index, key: keys[head + index] }))
    .sort((a, b) => {
      const delta = a.key - b.key;
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

  const ordered = inSpokenOrder(projectTranscriptTimeline(rows));
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

/**
 * A speaker keeps the floor across this much silence.
 *
 * Deepgram's utterance boundaries come from endpointing, not from how people
 * talk - a rep pausing to think produces a new utterance mid-thought. Grouping
 * by utterance is what produced a wall of one-line bubbles. Two seconds is long
 * enough to survive a breath and short enough that a genuine handover still
 * starts a new block.
 */
export const TURN_BREAK_GAP_MS = 2_000;

/**
 * Sentences per rendered block.
 *
 * This is not only a reading-comfort number. A block is sealed once it holds
 * this many sentences and never changes again, so growth only ever happens in
 * the last block. That is what makes "text above the cursor never reflows" true
 * by construction rather than by careful re-rendering.
 */
export const MAX_SENTENCES_PER_BLOCK = 3;

export interface TranscriptBlock {
  speaker: number | null;
  text: string;
  /** True while this block still ends in speech the provider has not finalized. */
  isPartial: boolean;
  /** Stable across re-renders so React never remounts a settled block. */
  key: string;
  /** First row feeding this block, for scroll anchoring and click-to-suggest. */
  startedAt: number;
}

/**
 * Split on sentence-ending punctuation followed by the start of a new sentence.
 *
 * Requires whitespace and then a capital or digit, which leaves decimals ("3.5")
 * and mid-word punctuation alone. Trailing text with no terminator is a sentence
 * in progress and comes back as the final element.
 */
export function splitSentences(text: string): string[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  return trimmed
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9"'"„])/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function gapMs(previous: OrderedTranscriptLine, next: OrderedTranscriptLine): number {
  // A pause is the silence between one row ENDING and the next STARTING. Rows
  // carry only a start time, so the only quantity available here is
  //
  //     start(next) - start(previous) = duration(previous) + real pause
  //
  // which is dominated by how long the previous row was. A five second
  // utterance therefore looked like a five second pause and broke the turn,
  // with the result that every single utterance became its own block - the
  // one-sentence bubbles this grouping exists to prevent.
  //
  // Until rows carry an end time there is no evidence of a pause at all, and
  // inventing one splits turns that never paused. Speaker change and the
  // sentence limit do the work; both are exact.
  return 0;
}

/**
 * Group rows into the blocks the transcript actually renders.
 *
 * Mid-call the rep is glancing, not reading: the question is "what did they
 * just say", answered in one saccade. So the unit on screen is a turn, not a
 * provider utterance, and a long turn is broken into fixed blocks rather than
 * allowed to grow into a wall.
 *
 * The in-flight partial is never its own block. It is the unfinished tail of
 * the turn it belongs to, which is what stops a new bubble appearing for every
 * interim.
 */
export function groupIntoBlocks(rows: OrderedTranscriptLine[]): TranscriptBlock[] {
  const ordered = inSpokenOrder(projectTranscriptTimeline(rows)).filter((row) => (row.text || '').trim());
  const blocks: TranscriptBlock[] = [];

  let index = 0;
  while (index < ordered.length) {
    const first = ordered[index];
    const turn: OrderedTranscriptLine[] = [first];
    index += 1;

    while (index < ordered.length) {
      const candidate = ordered[index];
      if (candidate.speaker !== first.speaker) break;
      if (gapMs(turn[turn.length - 1], candidate) > TURN_BREAK_GAP_MS) break;
      turn.push(candidate);
      index += 1;
    }

    const finalText = turn
      .filter((row) => row.isFinal || !row.isPartial)
      .map((row) => (row.text || '').trim())
      .filter(Boolean)
      .join(' ');
    const partialText = turn
      .filter((row) => !row.isFinal && row.isPartial)
      .map((row) => (row.text || '').trim())
      .filter(Boolean)
      .join(' ');

    const sentences = splitSentences(finalText);
    const startedAt = orderingKeyOf(first);
    const turnKey = `${first.speaker}:${startedAt}`;

    for (let cursor = 0; cursor < sentences.length; cursor += MAX_SENTENCES_PER_BLOCK) {
      blocks.push({
        speaker: first.speaker,
        text: sentences.slice(cursor, cursor + MAX_SENTENCES_PER_BLOCK).join(' '),
        isPartial: false,
        key: `${turnKey}:${cursor}`,
        startedAt,
      });
    }

    if (partialText) {
      const tail = blocks[blocks.length - 1];
      const canExtend =
        tail !== undefined &&
        tail.key.startsWith(`${turnKey}:`) &&
        splitSentences(tail.text).length < MAX_SENTENCES_PER_BLOCK;
      if (canExtend) {
        // The tail block is not sealed yet, so the unfinished words belong in
        // it rather than in a block of their own.
        tail.text = `${tail.text} ${partialText}`.trim();
        tail.isPartial = true;
      } else {
        blocks.push({
          speaker: first.speaker,
          text: partialText,
          isPartial: true,
          key: `${turnKey}:${sentences.length}`,
          startedAt,
        });
      }
    }
  }

  return blocks;
}

/**
 * Is this microphone text the far end's speech arriving through the speakers?
 *
 * The two capture sockets do not merely cut the audio at different points, they
 * transcribe different words - the system hears "Build their businesses, they
 * have better ratings" where the mic hears "is they have better ratings". So
 * equality and containment both fail, which is why a containment-based check
 * fired once across an entire session while most of the transcript was bleed.
 *
 * What survives that difference is a contiguous run. Bleed reproduces a stretch
 * of the far end's word order; genuine speech about the same subject reuses
 * vocabulary but not order. Measured on a real capture: bled utterances shared
 * runs of 4, 5, 5, 10 and 13 consecutive words with the far end, while genuine
 * speech peaked at 3 - including an utterance on the identical topic.
 *
 * Deliberately takes no timestamps. Judging by arrival time is what let bled
 * rows survive: the far end's version of a sentence frequently arrives after
 * the microphone's, so at mic-arrival time the evidence does not exist yet.
 * This is re-run over the visible rows whenever new far-end text appears.
 */
export const BLED_MIN_RUN_WORDS = 4;
export const BLED_MIN_RUN_COVERAGE = 0.3;
export const BLED_MIN_WORDS = 8;

const BLED_WORD_RE = /[^\p{L}\p{N}\s]/gu;

function bledWords(value: string): string[] {
  return (value || '')
    .replace(BLED_WORD_RE, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Longest run of consecutive words `text` shares with `reference`. */
export function longestSharedWordRun(text: string, reference: string): number {
  const words = bledWords(text);
  const source = bledWords(reference);
  if (!words.length || !source.length) return 0;

  const positions = new Map<string, number[]>();
  source.forEach((word, index) => {
    const list = positions.get(word);
    if (list) list.push(index);
    else positions.set(word, [index]);
  });

  let best = 0;
  for (let i = 0; i < words.length; i += 1) {
    if (words.length - i <= best) break;
    for (const j of positions.get(words[i]) ?? []) {
      let run = 0;
      while (
        i + run < words.length &&
        j + run < source.length &&
        words[i + run] === source[j + run]
      ) {
        run += 1;
      }
      if (run > best) best = run;
    }
  }
  return best;
}

export function isBledFromFarEnd(micText: string, farEndText: string): boolean {
  const words = bledWords(micText);
  if (words.length < BLED_MIN_WORDS) return false;
  const run = longestSharedWordRun(micText, farEndText);
  return run >= BLED_MIN_RUN_WORDS && run / words.length >= BLED_MIN_RUN_COVERAGE;
}

/**
 * Remove every microphone row that is the far end's speech.
 *
 * Runs over all rows, final and partial alike, every time new far-end text
 * arrives - so a row displayed before the far end's version existed is removed
 * as soon as the evidence appears. That is what fixes the session-start rows,
 * which are always judged before any far-end text exists at all.
 */
export function dropBledMicRows<T extends OrderedTranscriptLine>(
  rows: T[],
  farEndText: string,
): T[] {
  if (!farEndText.trim()) return rows;
  return rows.filter(
    (row) => row.speaker !== 1 || !isBledFromFarEnd(row.text || '', farEndText),
  );
}

/** Everything the far end has said, for use as the comparison window. */
export function farEndTextOf(rows: OrderedTranscriptLine[]): string {
  return rows
    .filter((row) => row.speaker === 0 && (row.text || '').trim())
    .map((row) => row.text)
    .join(' ');
}
