const test = require('node:test')
const assert = require('node:assert/strict')

const {
  applyRealtimeTranscriptEvent,
  canonicalTranscriptSequence,
  createRealtimeTranscriptState,
  currentDownstreamIdentity,
  isDownstreamResultApplicable,
  projectRealtimeTranscriptState,
  reduceRealtimeTranscriptState,
  transcriptTupleKey,
} = require('../dist/main/realtime-transcript-state.js')

const base = (overrides = {}) => ({
  chatId: 'chat-1',
  sessionId: 'session-1',
  source: 'system',
  captureGeneration: 3,
  streamGeneration: 7,
  utteranceId: 'utterance-1',
  eventId: 'event-1',
  seq: 1,
  captureStartMs: 1000,
  captureEndMs: 1400,
  words: [{ text: 'Hallo', startMs: 1000, endMs: 1400 }],
  clockDomainValid: true,
  text: 'Hallo',
  isFinal: false,
  ...overrides,
})

const apply = (state, event) => reduceRealtimeTranscriptState(state, event)
const texts = state => canonicalTranscriptSequence(state).map(row => row.text)

test('composite identity includes session, source and both generations', () => {
  const first = base()
  assert.notEqual(transcriptTupleKey(first), transcriptTupleKey({ ...first, source: 'mic' }))
  assert.notEqual(transcriptTupleKey(first), transcriptTupleKey({ ...first, captureGeneration: 4 }))
  assert.notEqual(transcriptTupleKey(first), transcriptTupleKey({ ...first, streamGeneration: 8 }))
  assert.notEqual(transcriptTupleKey(first), transcriptTupleKey({ ...first, sessionId: 'session-2' }))
})

test('event id is preferred only after validating the full tuple', () => {
  let state = apply(createRealtimeTranscriptState(), base())
  const collision = applyRealtimeTranscriptEvent(state, base({
    source: 'mic',
    utteranceId: 'other',
    seq: 2,
  }))
  assert.equal(collision.accepted, false)
  assert.equal(collision.reason, 'event-id-collision')
  assert.equal(collision.state, state)

  state = apply(state, base({ eventId: 'event-alias', seq: 2, text: 'Hallo Welt', captureEndMs: 1600,
    words: [{ text: 'Hallo', startMs: 1000, endMs: 1200 }, { text: 'Welt', startMs: 1200, endMs: 1600 }] }))
  assert.deepEqual(state.rows[0].eventIds, ['event-1', 'event-alias'])
})

test('only increasing seq is accepted and a stale shorter interim cannot shrink', () => {
  let state = apply(createRealtimeTranscriptState(), base({ text: 'Wir haben bereits Agenturen probiert' }))
  const before = state
  const staleSeq = applyRealtimeTranscriptEvent(state, base({ seq: 1, text: 'Anders' }))
  assert.equal(staleSeq.reason, 'stale-seq')
  assert.equal(staleSeq.state, before)

  state = apply(state, base({ seq: 2, text: 'Wir haben bereits' }))
  assert.equal(state.rows[0].text, 'Wir haben bereits Agenturen probiert')
  assert.equal(state.rows[0].seq, 2, 'transport seq still advances')
})

test('a divergent higher-seq correction may replace a partial', () => {
  let state = apply(createRealtimeTranscriptState(), base({ text: 'Wir suchen eine Agentur' }))
  state = apply(state, base({ seq: 2, text: 'Wir suchen Personal' }))
  assert.equal(state.rows[0].text, 'Wir suchen Personal')
})

test('final replaces only its exact partial and is immutable and idempotent', () => {
  let state = apply(createRealtimeTranscriptState(), base())
  state = apply(state, base({ seq: 2, text: 'Hallo final', isFinal: true }))
  assert.equal(state.rows.length, 1)
  assert.equal(state.rows[0].text, 'Hallo final')
  assert.equal(state.rows[0].isFinal, true)
  assert.equal(state.prospectRevision, 1)

  const frozen = state
  const duplicate = applyRealtimeTranscriptEvent(state, base({ seq: 2, text: 'Hallo final', isFinal: true }))
  assert.equal(duplicate.state, frozen)
  assert.equal(duplicate.reason, 'finalized-row')
  const mutation = applyRealtimeTranscriptEvent(state, base({ seq: 3, text: 'Mutated', isFinal: true }))
  assert.equal(mutation.state, frozen)
  assert.equal(state.prospectRevision, 1)
})

test('same utterance id in a new stream generation is a distinct row', () => {
  let state = apply(createRealtimeTranscriptState(), base({ isFinal: true }))
  state = apply(state, base({
    eventId: 'event-generation-8',
    streamGeneration: 8,
    seq: 1,
    captureStartMs: 2000,
    captureEndMs: 2300,
    words: [{ text: 'Wieder', startMs: 2000, endMs: 2300 }],
    text: 'Wieder',
    isFinal: true,
  }))
  assert.equal(state.rows.length, 2)
  assert.equal(state.prospectRevision, 2)
})

test('genuine identical Ja from seller and prospect are both retained', () => {
  let state = apply(createRealtimeTranscriptState(), base({ text: 'Ja', isFinal: true }))
  state = apply(state, base({
    source: 'mic',
    eventId: 'seller-ja',
    utteranceId: 'seller-ja',
    captureStartMs: 1500,
    captureEndMs: 1700,
    words: [{ text: 'Ja', startMs: 1500, endMs: 1700 }],
    text: 'Ja',
    isFinal: true,
  }))
  assert.deepEqual(state.rows.map(row => [row.source, row.text]), [['system', 'Ja'], ['mic', 'Ja']])
  assert.equal(state.prospectRevision, 1)
  assert.equal(state.sellerRevision, 1)
})

test('invalid or unmapped clock events never enter canonical projection', () => {
  const initial = createRealtimeTranscriptState()
  const invalid = applyRealtimeTranscriptEvent(initial, base({ clockDomainValid: false }))
  assert.equal(invalid.reason, 'invalid-clock-domain')
  assert.equal(invalid.state, initial)
  assert.deepEqual(canonicalTranscriptSequence(invalid.state), [])

  const malformed = applyRealtimeTranscriptEvent(initial, base({ captureEndMs: 900 }))
  assert.equal(malformed.reason, 'invalid-event')
  assert.equal(malformed.state, initial)
})

test('prospect and seller revisions change only on meaningful canonical finals', () => {
  let state = createRealtimeTranscriptState()
  state = apply(state, base())
  state = apply(state, base({ seq: 2, text: 'Hallo Welt', captureEndMs: 1600,
    words: [{ text: 'Hallo', startMs: 1000, endMs: 1200 }, { text: 'Welt', startMs: 1200, endMs: 1600 }] }))
  assert.deepEqual([state.prospectRevision, state.sellerRevision], [0, 0])
  state = apply(state, base({ seq: 3, text: 'Hallo Welt', captureEndMs: 1600,
    words: [{ text: 'Hallo', startMs: 1000, endMs: 1200 }, { text: 'Welt', startMs: 1200, endMs: 1600 }], isFinal: true }))
  assert.deepEqual([state.prospectRevision, state.sellerRevision], [1, 0])

  state = apply(state, base({ source: 'mic', utteranceId: 'seller', eventId: 'seller', seq: 1,
    captureStartMs: 2000, captureEndMs: 2200, words: [{ text: 'Okay', startMs: 2000, endMs: 2200 }],
    text: 'Okay', isFinal: false }))
  assert.deepEqual([state.prospectRevision, state.sellerRevision], [1, 0])
  state = apply(state, base({ source: 'mic', utteranceId: 'seller', eventId: 'seller', seq: 2,
    captureStartMs: 2000, captureEndMs: 2200, words: [{ text: 'Okay', startMs: 2000, endMs: 2200 }],
    text: 'Okay', isFinal: true }))
  assert.deepEqual([state.prospectRevision, state.sellerRevision], [1, 1])
})

test('visible and context projections use the exact same canonical sequence', () => {
  let state = apply(createRealtimeTranscriptState(), base({ isFinal: true }))
  state = apply(state, base({ source: 'mic', eventId: 'seller-1', utteranceId: 'seller-1',
    captureStartMs: 1500, captureEndMs: 1800, words: [{ text: 'Danke', startMs: 1500, endMs: 1800 }],
    text: 'Danke', isFinal: true }))
  const projection = projectRealtimeTranscriptState(state)
  assert.deepEqual(
    projection.visibleRows.map(row => row.key),
    projection.contextLines.map(row => row.key),
  )
  assert.equal(projection.context, 'Prospect: Hallo\nSeller: Danke')
})

test('downstream result requires exact prospect revision and context hash', () => {
  let state = apply(createRealtimeTranscriptState(), base({ isFinal: true }))
  const stamp = currentDownstreamIdentity(state)
  assert.equal(isDownstreamResultApplicable(state, stamp), true)
  assert.equal(isDownstreamResultApplicable(state, { ...stamp, prospectRevision: 0 }), false)
  assert.equal(isDownstreamResultApplicable(state, { ...stamp, contextHash: 'wrong' }), false)

  state = apply(state, base({ source: 'mic', eventId: 'seller-later', utteranceId: 'seller-later',
    captureStartMs: 2000, captureEndMs: 2200, words: [{ text: 'Okay', startMs: 2000, endMs: 2200 }],
    text: 'Okay', isFinal: true }))
  assert.equal(state.prospectRevision, stamp.prospectRevision)
  assert.equal(isDownstreamResultApplicable(state, stamp), false, 'context hash also guards seller changes')
})

test('reversed arrival is projected in capture order', () => {
  const lateSeller = base({ source: 'mic', eventId: 'seller-first', utteranceId: 'seller-first',
    captureStartMs: 100, captureEndMs: 300, words: [{ text: 'Start', startMs: 100, endMs: 300 }],
    text: 'Start', isFinal: true })
  const earlyProspectArrival = base({ eventId: 'prospect-second', utteranceId: 'prospect-second',
    captureStartMs: 500, captureEndMs: 900, words: [{ text: 'Hallo', startMs: 500, endMs: 900 }],
    text: 'Hallo', isFinal: true })
  let state = apply(createRealtimeTranscriptState(), earlyProspectArrival)
  state = apply(state, lateSeller)
  assert.deepEqual(texts(state), ['Start', 'Hallo'])
})

test('a final without a preceding partial creates exactly one immutable row', () => {
  const final = base({ isFinal: true })
  let state = apply(createRealtimeTranscriptState(), final)
  assert.equal(state.rows.length, 1)
  assert.equal(state.prospectRevision, 1)
  state = apply(state, final)
  assert.equal(state.rows.length, 1)
  assert.equal(state.prospectRevision, 1)
})

test('events from another chat or session cannot leak into this state', () => {
  const state = apply(createRealtimeTranscriptState(), base({ isFinal: true }))
  const otherChat = applyRealtimeTranscriptEvent(state, base({ chatId: 'other', eventId: 'other', seq: 2 }))
  const otherSession = applyRealtimeTranscriptEvent(state, base({ sessionId: 'other', eventId: 'other-2', seq: 2 }))
  assert.equal(otherChat.reason, 'different-session')
  assert.equal(otherSession.reason, 'different-session')
  assert.equal(otherChat.state, state)
  assert.equal(otherSession.state, state)
})

test('timed partials remain one stable visible bubble while text grows', () => {
  const words = [
    { text: 'This', startMs: 1000, endMs: 1100 },
    { text: 'is', startMs: 1100, endMs: 1180 },
    { text: 'one', startMs: 1180, endMs: 1280 },
    { text: 'live', startMs: 1280, endMs: 1400 },
    { text: 'turn', startMs: 1400, endMs: 1520 },
  ]
  let state = apply(createRealtimeTranscriptState(), base({
    text: 'This is one',
    captureEndMs: 1280,
    words: words.slice(0, 3),
  }))
  const first = projectRealtimeTranscriptState(state).visibleRows
  state = apply(state, base({ seq: 2, text: 'This is one live turn', captureEndMs: 1520, words }))
  const second = projectRealtimeTranscriptState(state).visibleRows

  assert.equal(first.length, 1)
  assert.equal(second.length, 1)
  assert.equal(first[0].key, second[0].key)
  assert.doesNotMatch(second[0].key, /:word:/)
})

test('a proven opposite-source interruption splits only at its clean timed-word gap', () => {
  let state = apply(createRealtimeTranscriptState(), base({
    eventId: 'prospect-long',
    utteranceId: 'prospect-long',
    captureStartMs: 1000,
    captureEndMs: 3800,
    text: 'This takes thirty seconds',
    words: [
      { text: 'This', startMs: 1000, endMs: 1200 },
      { text: 'takes', startMs: 1800, endMs: 1980 },
      { text: 'thirty', startMs: 3300, endMs: 3500 },
      { text: 'seconds', startMs: 3500, endMs: 3780 },
    ],
    isFinal: true,
  }))
  state = apply(state, base({
    source: 'mic',
    eventId: 'seller-interruption',
    utteranceId: 'seller-interruption',
    captureStartMs: 2200,
    captureEndMs: 2780,
    text: 'One question',
    words: [
      { text: 'One', startMs: 2200, endMs: 2400 },
      { text: 'question', startMs: 2400, endMs: 2780 },
    ],
    isFinal: true,
  }))

  const rows = projectRealtimeTranscriptState(state).visibleRows
  assert.deepEqual(rows.map(row => [row.source, row.text]), [
    ['system', 'This takes'],
    ['mic', 'One question'],
    ['system', 'thirty seconds'],
  ])
  assert.equal(rows.some(row => row.key.includes(':word:')), false)
})
