/**
 * Pure canonical state machine for one realtime transcript session.
 *
 * This module deliberately has no Electron, React, network, or wall-clock
 * dependency. Transport code normalizes provider messages into the event shape
 * below; every consumer then derives visible transcript and model context from
 * the same canonical sequence.
 */

export type TranscriptSource = 'mic' | 'system';

export interface NormalizedTranscriptWord {
  text: string;
  /** Start on the capture session's monotonic timeline. */
  startMs: number;
  /** End on the same timeline. */
  endMs: number;
}

export interface NormalizedRealtimeTranscriptEvent {
  chatId: string;
  sessionId: string;
  source: TranscriptSource;
  captureGeneration: number;
  streamGeneration: number;
  utteranceId: string;
  /** Preferred transport identity. Null is supported for legacy events. */
  eventId: string | null;
  /** Monotonically increasing within the composite utterance identity. */
  seq: number;
  captureStartMs: number;
  captureEndMs: number;
  words: NormalizedTranscriptWord[];
  /** False means provider offsets could not be mapped to the capture clock. */
  clockDomainValid: boolean;
  text: string;
  isFinal: boolean;
}

export interface CanonicalTranscriptRow extends NormalizedRealtimeTranscriptEvent {
  /** Full collision-resistant identity, including both generations. */
  tupleKey: string;
  /** Stable preferred identity selected when the row was first accepted. */
  identityKey: string;
  /** Every event id that has been validated as an alias for this tuple. */
  eventIds: string[];
}

export interface RealtimeTranscriptState {
  /** A state instance is locked to the first accepted chat/session pair. */
  chatId: string | null;
  sessionId: string | null;
  rows: CanonicalTranscriptRow[];
  /** eventId -> tupleKey. Prevents a transport id from crossing identities. */
  eventTuples: Readonly<Record<string, string>>;
  prospectRevision: number;
  sellerRevision: number;
}

export interface CanonicalProjectionRow {
  key: string;
  source: TranscriptSource;
  role: 'seller' | 'prospect';
  text: string;
  isFinal: boolean;
  captureStartMs: number;
  captureEndMs: number;
}

export interface RealtimeTranscriptProjection {
  /** Authoritative sequence from which both following projections are made. */
  sequence: CanonicalTranscriptRow[];
  visibleRows: CanonicalProjectionRow[];
  contextLines: CanonicalProjectionRow[];
  context: string;
  contextHash: string;
}

export interface DownstreamResultIdentity {
  prospectRevision: number;
  contextHash: string;
}

export type TranscriptTransitionReason =
  | 'accepted'
  | 'invalid-event'
  | 'invalid-clock-domain'
  | 'different-session'
  | 'event-id-collision'
  | 'stale-seq'
  | 'finalized-row';

export interface RealtimeTranscriptTransition {
  state: RealtimeTranscriptState;
  accepted: boolean;
  reason: TranscriptTransitionReason;
}

export function createRealtimeTranscriptState(): RealtimeTranscriptState {
  return {
    chatId: null,
    sessionId: null,
    rows: [],
    eventTuples: Object.freeze({}),
    prospectRevision: 0,
    sellerRevision: 0,
  };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function requiredString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeWords(value: unknown): NormalizedTranscriptWord[] | null {
  if (!Array.isArray(value)) return null;
  const words: NormalizedTranscriptWord[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') return null;
    const word = candidate as Record<string, unknown>;
    const text = requiredString(word.text);
    if (
      text === null ||
      !finiteNumber(word.startMs) ||
      !finiteNumber(word.endMs)
    ) {
      return null;
    }
    // Order and sign are repaired, not fatal. The backend applies max(start,
    // end) to the PROVIDER times but copies the mapped capture times through
    // untouched, so a zero-width or inverted capture interval reaches us intact.
    // Deepgram emits start == end routinely for short words. Killing the whole
    // utterance over one of them is what emptied the transcript before.
    const startMs = Math.max(word.startMs, 0);
    words.push({ text, startMs, endMs: Math.max(word.endMs, startMs) });
  }
  return words;
}

/**
 * Validate and normalize an unknown transport payload.
 *
 * Invalid clock-domain events remain representable so the reducer can reject
 * them with a precise reason; malformed shapes return null.
 */
export function normalizeRealtimeTranscriptEvent(
  input: unknown,
): NormalizedRealtimeTranscriptEvent | null {
  return normalizeRealtimeTranscriptEventWithReason(input).event;
}

/**
 * Same gate, but it says which predicate refused.
 *
 * `normalizeRealtimeTranscriptEvent` returning bare null covers seventeen
 * different rejections. On 2026-08-13 every live mic segment failed here and
 * the console could only report `invalid-normalized-event`, which names the
 * function rather than the fault. A gate that drops user speech has to be able
 * to say what it objected to.
 */
export function normalizeRealtimeTranscriptEventWithReason(
  input: unknown,
): { event: NormalizedRealtimeTranscriptEvent | null; reason: string | null } {
  const no = (reason: string) => ({ event: null, reason });
  if (!input || typeof input !== 'object') return no('not-an-object');
  const raw = input as Record<string, unknown>;
  const chatId = requiredString(raw.chatId);
  const sessionId = requiredString(raw.sessionId);
  const utteranceId = requiredString(raw.utteranceId);
  const text = requiredString(raw.text);
  const words = normalizeWords(raw.words);
  const captureStartMs = raw.captureStartMs;
  const captureEndMs = raw.captureEndMs;
  const eventId = raw.eventId === null || raw.eventId === undefined
    ? null
    : requiredString(raw.eventId);

  if (chatId === null) return no('chatId-not-a-nonempty-string');
  if (sessionId === null) return no('sessionId-not-a-nonempty-string');
  if (utteranceId === null) return no('utteranceId-not-a-nonempty-string');
  if (text === null) return no('text-not-a-nonempty-string');
  if (words === null) return no('words-malformed-or-word-end-before-start');
  if (raw.eventId !== null && raw.eventId !== undefined && eventId === null) {
    return no('eventId-present-but-not-a-nonempty-string');
  }
  if (raw.source !== 'mic' && raw.source !== 'system') return no('source-not-mic-or-system');
  if (!nonNegativeInteger(raw.captureGeneration)) return no('captureGeneration-not-a-non-negative-integer');
  if (!nonNegativeInteger(raw.streamGeneration)) return no('streamGeneration-not-a-non-negative-integer');
  if (!nonNegativeInteger(raw.seq)) return no('seq-not-a-non-negative-integer');
  if (!finiteNumber(captureStartMs)) return no('captureStartMs-not-finite');
  if (!finiteNumber(captureEndMs)) return no('captureEndMs-not-finite');
  if (captureStartMs < 0) return no(`captureStartMs-negative (${captureStartMs})`);
  if (captureEndMs < captureStartMs) {
    return no(`captureEnd-before-captureStart (${captureStartMs}..${captureEndMs})`);
  }
  if (typeof raw.clockDomainValid !== 'boolean') return no('clockDomainValid-not-a-boolean');
  if (typeof raw.isFinal !== 'boolean') return no('isFinal-not-a-boolean');

  // Words outside the utterance window are REPAIRED, not fatal.
  //
  // The utterance interval is the proven quantity: the backend maps it against
  // the capture ledger and fails closed if it cannot. Per-word capture times
  // are derived from the same ledger word by word, so a boundary word can land
  // a millisecond outside the interval its own utterance proved. Discarding the
  // turn for that is the identical defect already fixed once on the backend in
  // abcb62da - one bad word must not delete everything spoken alongside it.
  //
  // Clamping keeps the proven window authoritative and loses no dialogue. It
  // costs at most a few ms of word-level position on the boundary word, which
  // is invisible in a transcript and strictly better than the row not existing.
  const repaired = words.map(word => {
    const startMs = Math.min(Math.max(word.startMs, captureStartMs), captureEndMs);
    const endMs = Math.min(Math.max(word.endMs, startMs), captureEndMs);
    return startMs === word.startMs && endMs === word.endMs
      ? word
      : { text: word.text, startMs, endMs };
  });

  return { reason: null, event: {
    chatId,
    sessionId,
    source: raw.source,
    captureGeneration: raw.captureGeneration,
    streamGeneration: raw.streamGeneration,
    utteranceId,
    eventId,
    seq: raw.seq,
    captureStartMs,
    captureEndMs,
    words: repaired,
    clockDomainValid: raw.clockDomainValid,
    text,
    isFinal: raw.isFinal,
  } };
}

/** Full source identity. Provider utterance ids alone are not globally unique. */
export function transcriptTupleKey(
  event: Pick<NormalizedRealtimeTranscriptEvent,
    'sessionId' | 'source' | 'captureGeneration' | 'streamGeneration' | 'utteranceId'>,
): string {
  return JSON.stringify([
    event.sessionId,
    event.source,
    event.captureGeneration,
    event.streamGeneration,
    event.utteranceId,
  ]);
}

function preferredIdentityKey(event: NormalizedRealtimeTranscriptEvent, tupleKey: string): string {
  return event.eventId ? `event:${event.eventId}` : `tuple:${tupleKey}`;
}

function compareCanonicalRows(left: CanonicalTranscriptRow, right: CanonicalTranscriptRow): number {
  return (
    left.captureStartMs - right.captureStartMs ||
    left.captureEndMs - right.captureEndMs ||
    left.tupleKey.localeCompare(right.tupleKey)
  );
}

function withEventAlias(
  row: CanonicalTranscriptRow,
  eventId: string | null,
): CanonicalTranscriptRow {
  if (!eventId || row.eventIds.includes(eventId)) return row;
  return { ...row, eventIds: [...row.eventIds, eventId] };
}

function findRowIndex(
  state: RealtimeTranscriptState,
  event: NormalizedRealtimeTranscriptEvent,
  tupleKey: string,
): number {
  // Prefer the transport event id after proving that it belongs to this tuple.
  if (event.eventId && state.eventTuples[event.eventId] === tupleKey) {
    const eventIndex = state.rows.findIndex(row => row.eventIds.includes(event.eventId as string));
    if (eventIndex >= 0) return eventIndex;
  }
  return state.rows.findIndex(row => row.tupleKey === tupleKey);
}

function isStaleShorterInterim(current: string, incoming: string): boolean {
  return incoming.length < current.length && current.startsWith(incoming);
}

function incrementRevision(
  state: RealtimeTranscriptState,
  source: TranscriptSource,
): Pick<RealtimeTranscriptState, 'sellerRevision' | 'prospectRevision'> {
  return source === 'system'
    ? { sellerRevision: state.sellerRevision, prospectRevision: state.prospectRevision + 1 }
    : { sellerRevision: state.sellerRevision + 1, prospectRevision: state.prospectRevision };
}

/** Apply one normalized event without mutating the previous state. */
export function applyRealtimeTranscriptEvent(
  state: RealtimeTranscriptState,
  input: NormalizedRealtimeTranscriptEvent | unknown,
): RealtimeTranscriptTransition {
  const event = normalizeRealtimeTranscriptEvent(input);
  if (!event) return { state, accepted: false, reason: 'invalid-event' };
  if (!event.clockDomainValid) {
    return { state, accepted: false, reason: 'invalid-clock-domain' };
  }
  if (
    (state.chatId !== null && state.chatId !== event.chatId) ||
    (state.sessionId !== null && state.sessionId !== event.sessionId)
  ) {
    return { state, accepted: false, reason: 'different-session' };
  }

  const tupleKey = transcriptTupleKey(event);
  if (event.eventId) {
    const boundTuple = state.eventTuples[event.eventId];
    if (boundTuple !== undefined && boundTuple !== tupleKey) {
      return { state, accepted: false, reason: 'event-id-collision' };
    }
  }

  const rowIndex = findRowIndex(state, event, tupleKey);
  const existing = rowIndex >= 0 ? state.rows[rowIndex] : undefined;
  if (existing) {
    if (existing.isFinal) {
      return { state, accepted: false, reason: 'finalized-row' };
    }
    if (event.seq <= existing.seq) {
      return { state, accepted: false, reason: 'stale-seq' };
    }
  }

  const eventTuples = event.eventId && state.eventTuples[event.eventId] === undefined
    ? Object.freeze({ ...state.eventTuples, [event.eventId]: tupleKey })
    : state.eventTuples;

  let nextRow: CanonicalTranscriptRow;
  let meaningfulFinalMutation = false;
  if (!existing) {
    nextRow = {
      ...event,
      tupleKey,
      identityKey: preferredIdentityKey(event, tupleKey),
      eventIds: event.eventId ? [event.eventId] : [],
    };
    meaningfulFinalMutation = event.isFinal;
  } else if (!event.isFinal && isStaleShorterInterim(existing.text, event.text)) {
    // Advance transport identity/sequence, but never make visible text shrink.
    nextRow = withEventAlias({ ...existing, seq: event.seq }, event.eventId);
  } else {
    // A final replaces only this exact tuple's partial. A divergent higher-seq
    // interim is a real provider correction, even when it is shorter.
    nextRow = withEventAlias({
      ...event,
      tupleKey,
      identityKey: existing.identityKey,
      eventIds: existing.eventIds,
    }, event.eventId);
    meaningfulFinalMutation = event.isFinal;
  }

  const rows = existing
    ? state.rows.map((row, index) => index === rowIndex ? nextRow : row).sort(compareCanonicalRows)
    : [...state.rows, nextRow].sort(compareCanonicalRows);
  const revisions = meaningfulFinalMutation
    ? incrementRevision(state, event.source)
    : { sellerRevision: state.sellerRevision, prospectRevision: state.prospectRevision };

  return {
    accepted: true,
    reason: 'accepted',
    state: {
      chatId: state.chatId ?? event.chatId,
      sessionId: state.sessionId ?? event.sessionId,
      rows,
      eventTuples,
      ...revisions,
    },
  };
}

export function reduceRealtimeTranscriptState(
  state: RealtimeTranscriptState,
  event: NormalizedRealtimeTranscriptEvent | unknown,
): RealtimeTranscriptState {
  return applyRealtimeTranscriptEvent(state, event).state;
}

/** Only canonical, clock-mapped rows participate in any ordered projection. */
export function canonicalTranscriptSequence(
  state: RealtimeTranscriptState,
): CanonicalTranscriptRow[] {
  return state.rows
    .filter(row => (
      row.clockDomainValid &&
      Number.isFinite(row.captureStartMs) &&
      Number.isFinite(row.captureEndMs) &&
      row.captureStartMs >= 0 &&
      row.captureEndMs >= row.captureStartMs &&
      row.text.trim().length > 0
    ))
    .slice()
    .sort(compareCanonicalRows);
}

function roleOf(source: TranscriptSource): 'seller' | 'prospect' {
  return source === 'mic' ? 'seller' : 'prospect';
}

function comparableTokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
}

function timedWordsMatchText(row: CanonicalTranscriptRow): boolean {
  const fromWords = comparableTokens(row.words.map(word => word.text).join(' '));
  const fromText = comparableTokens(row.text);
  return (
    fromWords.length > 0 &&
    fromWords.length === fromText.length &&
    fromWords.every((token, index) => token === fromText[index])
  );
}

function projectionRows(sequence: CanonicalTranscriptRow[]): CanonicalProjectionRow[] {
  type ProjectionAtom = CanonicalProjectionRow & { order: number };
  const atoms: ProjectionAtom[] = [];
  let order = 0;

  for (const row of sequence) {
    if (row.words.length > 0 && timedWordsMatchText(row)) {
      row.words.forEach((word, wordIndex) => {
        atoms.push({
          key: `${row.identityKey}:word:${wordIndex}`,
          source: row.source,
          role: roleOf(row.source),
          text: word.text.trim(),
          isFinal: row.isFinal,
          captureStartMs: word.startMs,
          captureEndMs: word.endMs,
          order: order++,
        });
      });
      continue;
    }

    // Fail closed when provider words no longer exactly represent the accepted
    // text (for example after a correction or bleed filter). Keep the row
    // atomic rather than manufacturing, duplicating, or dropping words.
    atoms.push({
      key: row.identityKey,
      source: row.source,
      role: roleOf(row.source),
      text: row.text,
      isFinal: row.isFinal,
      captureStartMs: row.captureStartMs,
      captureEndMs: row.captureEndMs,
      order: order++,
    });
  }

  atoms.sort((left, right) => (
    left.captureStartMs - right.captureStartMs ||
    left.captureEndMs - right.captureEndMs ||
    left.order - right.order
  ));

  const projected: CanonicalProjectionRow[] = [];
  for (const atom of atoms) {
    if (!atom.text) continue;
    const tail = projected[projected.length - 1];
    if (tail && tail.source === atom.source) {
      tail.text = `${tail.text} ${atom.text}`.trim();
      tail.captureEndMs = Math.max(tail.captureEndMs, atom.captureEndMs);
      tail.isFinal = tail.isFinal && atom.isFinal;
      tail.key = `${tail.key}|${atom.key}`;
      continue;
    }
    const { order: _order, ...row } = atom;
    projected.push(row);
  }
  return projected;
}

/** Stable dependency-free FNV-1a hash for downstream revision contracts. */
function hashContext(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

export function projectRealtimeTranscriptState(
  state: RealtimeTranscriptState,
): RealtimeTranscriptProjection {
  const sequence = canonicalTranscriptSequence(state);
  const sharedRows = projectionRows(sequence);
  const context = sharedRows
    .map(row => `${row.role === 'seller' ? 'Seller' : 'Prospect'}: ${row.text}`)
    .join('\n');
  const hashInput = JSON.stringify(sharedRows.map(row => [
    row.key,
    row.source,
    row.text,
    row.isFinal,
    row.captureStartMs,
    row.captureEndMs,
  ]));

  return {
    sequence,
    visibleRows: sharedRows,
    contextLines: sharedRows,
    context,
    contextHash: hashContext(hashInput),
  };
}

export function currentDownstreamIdentity(
  state: RealtimeTranscriptState,
): DownstreamResultIdentity {
  return {
    prospectRevision: state.prospectRevision,
    contextHash: projectRealtimeTranscriptState(state).contextHash,
  };
}

export function isDownstreamResultApplicable(
  state: RealtimeTranscriptState,
  result: DownstreamResultIdentity,
): boolean {
  const current = currentDownstreamIdentity(state);
  return (
    result.prospectRevision === current.prospectRevision &&
    result.contextHash === current.contextHash
  );
}
