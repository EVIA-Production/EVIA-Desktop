const assert = require('node:assert/strict')
const test = require('node:test')

const {
  orderingKeyOf,
  inSpokenOrder,
  selectEligiblePartial,
  buildTranscriptContext,
  findLivePartialByUtteranceIdentity,
  projectTranscriptTimeline,
  groupIntoBlocks,
  REORDER_WINDOW_MS,
} = require('../dist/main/transcript-order.js')

// Shared absolute audio epoch, matching the backend's audio clock.
const BASE = 1_760_000_000_000

const seller = (text, audioStartMs, extra = {}) => ({
  speaker: 1,
  text,
  isFinal: true,
  isPartial: false,
  timestamp: audioStartMs,
  audioStartMs,
  ...extra,
})

const prospect = (text, audioStartMs, extra = {}) => ({
  speaker: 0,
  text,
  isFinal: true,
  isPartial: false,
  timestamp: audioStartMs,
  audioStartMs,
  ...extra,
})

const textsOf = (rows) => rows.map((r) => r.text)

// ── Fixture 1: interleaving ──────────────────────────────────────────────────

test('seller/prospect/seller keeps its spoken order despite arrival order', () => {
  // The mic source flushed late, so "Hallo" arrived after the prospect's "Hi".
  const arrived = [
    prospect('Hi', BASE + 600),
    seller('Hallo', BASE + 0),
    seller("Wie geht's?", BASE + 1100),
  ]
  assert.deepEqual(textsOf(inSpokenOrder(arrived)), ['Hallo', 'Hi', "Wie geht's?"])
})

test('already-correct order is returned unchanged (identity, not a copy)', () => {
  const rows = [seller('Hallo', BASE), prospect('Hi', BASE + 600)]
  assert.equal(inSpokenOrder(rows), rows)
})

test('ordering is stable for equal keys', () => {
  const rows = [
    seller('erste', BASE + 500),
    prospect('zweite', BASE + 500),
    seller('dritte', BASE + 500),
  ]
  assert.deepEqual(textsOf(inSpokenOrder(rows)), ['erste', 'zweite', 'dritte'])
})

test('sorting is idempotent', () => {
  const rows = [prospect('Hi', BASE + 600), seller('Hallo', BASE)]
  const once = inSpokenOrder(rows)
  assert.deepEqual(textsOf(inSpokenOrder(once)), textsOf(once))
})

test('legacy rows without an audio clock fall back to arrival time', () => {
  const rows = [
    { speaker: 1, text: 'zuerst', isFinal: true, timestamp: BASE + 100 },
    { speaker: 0, text: 'danach', isFinal: true, timestamp: BASE + 50 },
  ]
  assert.deepEqual(textsOf(inSpokenOrder(rows)), ['danach', 'zuerst'])
})

test('audio-clock rows and legacy rows sort on one shared scale', () => {
  const rows = [
    { speaker: 0, text: 'legacy-spaet', isFinal: true, timestamp: BASE + 900 },
    seller('audio-frueh', BASE + 100),
  ]
  assert.deepEqual(textsOf(inSpokenOrder(rows)), ['audio-frueh', 'legacy-spaet'])
})

test('a zero or negative audio timestamp is not treated as a real key', () => {
  assert.equal(orderingKeyOf({ text: 'x', speaker: 1, audioStartMs: 0, timestamp: 42 }), 42)
  assert.equal(orderingKeyOf({ text: 'x', speaker: 1, audioStartMs: NaN, timestamp: 42 }), 42)
})

// ── Bounded reorder window ───────────────────────────────────────────────────

test('history older than the reorder window is never reshuffled', () => {
  const rows = [
    seller('alt-b', BASE + 2000),
    seller('alt-a', BASE + 1000), // out of order, but far in the past
    prospect('jetzt', BASE + 2000 + REORDER_WINDOW_MS + 5000),
  ]
  // The two stale rows keep their arrival order; only the tail may move.
  assert.deepEqual(textsOf(inSpokenOrder(rows)), ['alt-b', 'alt-a', 'jetzt'])
})

test('a correction inside the window still lands in the right place', () => {
  const rows = [
    seller('eins', BASE + 1000),
    prospect('drei', BASE + 3000),
    seller('zwei', BASE + 2000), // late arrival, well inside the window
  ]
  assert.deepEqual(textsOf(inSpokenOrder(rows)), ['eins', 'zwei', 'drei'])
})

test('empty and single-row inputs are handled', () => {
  assert.deepEqual(inSpokenOrder([]), [])
  const one = [seller('nur eine', BASE)]
  assert.equal(inSpokenOrder(one), one)
})

// ── Fixture 3/4: the suggestion must see the current turn ────────────────────

const partial = (speaker, text, audioStartMs, timestamp) => ({
  speaker,
  text,
  isFinal: false,
  isPartial: true,
  timestamp: timestamp ?? audioStartMs,
  audioStartMs,
})

test('context includes the in-flight prospect turn, explicitly marked', () => {
  const now = BASE + 5000
  const rows = [
    seller('Wir hätten da ein Recruiting-System.', BASE + 1000),
    partial(0, 'Wir haben schon Agenturen probiert', BASE + 4000, now - 200),
  ]
  const context = buildTranscriptContext(rows, { now })
  assert.match(context, /Prospect: Wir haben schon Agenturen probiert/)
  assert.match(context, /spricht gerade noch/)
})

test('topic shift: the newest turn is the last line of the context', () => {
  const now = BASE + 9000
  const rows = [
    prospect('Erzählen Sie mir was zum Preis.', BASE + 1000),
    seller('Das System startet bei 3.990 Euro.', BASE + 3000),
    prospect('Und wie lange dauert die Einarbeitung?', BASE + 7000),
  ]
  const lines = buildTranscriptContext(rows, { now }).split('\n')
  assert.equal(lines[lines.length - 1], 'Prospect: Und wie lange dauert die Einarbeitung?')
})

test('a stale partial is not presented as the current turn', () => {
  const now = BASE + 100_000
  const rows = [
    seller('Guten Tag.', BASE + 1000),
    partial(0, 'ähm', BASE + 2000, BASE + 2000), // ~98s old
  ]
  const context = buildTranscriptContext(rows, { now })
  assert.doesNotMatch(context, /spricht gerade noch/)
})

test('a partial older than the newest final is not appended after it', () => {
  const now = BASE + 6000
  const rows = [
    partial(0, 'halbe Silbe', BASE + 1000, now - 100),
    seller('Vollständiger späterer Satz.', BASE + 4000),
  ]
  const context = buildTranscriptContext(rows, { now })
  assert.doesNotMatch(context, /spricht gerade noch/)
})

test('context order is spoken order, not arrival order', () => {
  const now = BASE + 5000
  const rows = [
    prospect('Hi', BASE + 600),
    seller('Hallo', BASE + 0),
    seller("Wie geht's?", BASE + 1100),
  ]
  assert.equal(
    buildTranscriptContext(rows, { now }),
    ['User: Hallo', 'Prospect: Hi', "User: Wie geht's?"].join('\n'),
  )
})

test('speaker labels map mic to User and system to Prospect', () => {
  const now = BASE + 2000
  const context = buildTranscriptContext(
    [seller('ich', BASE), prospect('du', BASE + 500), { speaker: null, text: '?', isFinal: true, timestamp: BASE + 900, audioStartMs: BASE + 900 }],
    { now },
  )
  assert.equal(context, 'User: ich\nProspect: du\nUnknown: ?')
})

test('the character budget keeps the most recent turns', () => {
  const now = BASE + 10_000
  const rows = [
    seller('AAAA', BASE + 1000),
    prospect('BBBB', BASE + 2000),
    seller('CCCC', BASE + 3000),
  ]
  const context = buildTranscriptContext(rows, { now, maxChars: 24 })
  assert.doesNotMatch(context, /AAAA/)
  assert.match(context, /CCCC/)
})

test('partials can be excluded when a caller needs finalized text only', () => {
  const now = BASE + 3000
  const rows = [seller('fertig', BASE + 1000), partial(0, 'noch nicht', BASE + 2000, now - 100)]
  const context = buildTranscriptContext(rows, { now, includeLivePartial: false })
  assert.equal(context, 'User: fertig')
})

test('empty transcript yields empty context, never a placeholder', () => {
  assert.equal(buildTranscriptContext([], { now: BASE }), '')
  assert.equal(buildTranscriptContext([{ speaker: 1, text: '   ', isFinal: true }], { now: BASE }), '')
})

// ── Partial selection ────────────────────────────────────────────────────────

test('the newest eligible partial wins', () => {
  const now = BASE + 5000
  const rows = [
    partial(1, 'alt', BASE + 1000, now - 300),
    partial(0, 'neu', BASE + 4000, now - 100),
  ]
  assert.equal(selectEligiblePartial(rows, now).text, 'neu')
})

test('finalized rows are never selected as the in-flight turn', () => {
  const now = BASE + 5000
  assert.equal(selectEligiblePartial([seller('fertig', BASE + 4000)], now), undefined)
})

test('blank partials are ignored', () => {
  const now = BASE + 5000
  assert.equal(selectEligiblePartial([partial(0, '   ', BASE + 4000, now)], now), undefined)
})

// ── provider utterance identity ─────────────────────────────────────────────

test('divergent interim rewrites with the same utterance id own one row', () => {
  const rows = [
    { ...partial(0, 'its own? And I think that is the structural problem', BASE, BASE + 100), utteranceId: '6' },
  ]
  assert.equal(
    findLivePartialByUtteranceIdentity(rows, 0, '6'),
    0,
    'a text rewrite must update the existing provider utterance, not append a duplicate',
  )
})

test('different utterance ids remain different turns', () => {
  const rows = [
    { ...partial(0, 'first turn', BASE, BASE + 100), utteranceId: '6' },
  ]
  assert.equal(findLivePartialByUtteranceIdentity(rows, 0, '7'), -1)
})

test('the same utterance id on the other source is not matched', () => {
  const rows = [
    { ...partial(0, 'prospect', BASE, BASE + 100), utteranceId: '0' },
  ]
  assert.equal(findLivePartialByUtteranceIdentity(rows, 1, '0'), -1)
})

test('a finalized row is never reopened by utterance identity', () => {
  const rows = [
    { ...prospect('finished', BASE), utteranceId: '6' },
  ]
  assert.equal(findLivePartialByUtteranceIdentity(rows, 0, '6'), -1)
})

const timedWords = (tokens, starts) => tokens.map((text, index) => ({
  text,
  startMs: BASE + starts[index],
  endMs: BASE + starts[index] + 80,
}))

test('one provider utterance is split around a real cross-source interruption', () => {
  // Arrival order is intentionally wrong. The system provider keeps one
  // utterance open even though the rep speaks in its middle.
  const rows = [
    seller('What blocks new reps today?', BASE + 2200, {
      audioEndMs: BASE + 2780,
      words: timedWords(
        ['What', 'blocks', 'new', 'reps', 'today?'],
        [2200, 2300, 2400, 2500, 2700],
      ),
      utteranceId: 'mic:3',
    }),
    prospect('From first day to quarter. Onboarding currently takes 30 days.', BASE + 1000, {
      audioEndMs: BASE + 3800,
      words: timedWords(
        ['From', 'first', 'day', 'to', 'quarter.', 'Onboarding', 'currently', 'takes', '30', 'days.'],
        [1000, 1100, 1200, 1300, 1400, 1500, 1700, 1900, 3300, 3700],
      ),
      utteranceId: 'system:4',
    }),
  ]

  const projected = projectTranscriptTimeline(rows)
  assert.deepEqual(
    projected.map(({ speaker, text }) => ({ speaker, text })),
    [
      { speaker: 0, text: 'From first day to quarter. Onboarding currently takes' },
      { speaker: 1, text: 'What blocks new reps today?' },
      { speaker: 0, text: '30 days.' },
    ],
  )
  assert.equal(
    projected.filter((row) => row.speaker === 0).map((row) => row.text).join(' '),
    rows[1].text,
    'projection must neither duplicate nor truncate authoritative provider text',
  )
  assert.match(buildTranscriptContext(rows), /Prospect: From first day[\s\S]*User: What blocks[\s\S]*Prospect: 30 days\./)
  assert.deepEqual(groupIntoBlocks(rows).map(({ speaker, text }) => ({ speaker, text })), [
    { speaker: 0, text: 'From first day to quarter. Onboarding currently takes' },
    { speaker: 1, text: 'What blocks new reps today?' },
    { speaker: 0, text: '30 days.' },
  ])
})

test('timeline projection is idempotent', () => {
  const rows = [
    prospect('Before after', BASE, {
      words: timedWords(['Before', 'after'], [0, 2000]),
    }),
    seller('Interrupt', BASE + 1000, {
      words: timedWords(['Interrupt'], [1000]),
    }),
  ]
  const once = projectTranscriptTimeline(rows)
  assert.deepEqual(projectTranscriptTimeline(once), once)
})

test('word/text mismatch fails closed without changing authoritative text', () => {
  const mismatched = prospect('Provider corrected this final.', BASE, {
    words: timedWords(['Older', 'partial'], [0, 100]),
  })
  const interruption = seller('Exactly.', BASE + 500, {
    words: timedWords(['Exactly.'], [500]),
  })
  const projected = projectTranscriptTimeline([mismatched, interruption])
  assert.deepEqual(textsOf(projected), ['Provider corrected this final.', 'Exactly.'])
  assert.equal(
    projected.filter((row) => row.speaker === 0).map((row) => row.text).join(' '),
    mismatched.text,
    'a word/text mismatch must preserve the authoritative provider text verbatim',
  )
})

// ── a bubble must never visibly shrink ───────────────────────────────────────

const { shouldReplacePartialText } = require('../dist/main/transcript-order.js')

test('growth is always accepted', () => {
  assert.equal(shouldReplacePartialText('Welcome back', 'Welcome back to your'), true)
  assert.equal(shouldReplacePartialText('', 'Welcome'), true)
})

test('a stale shorter prefix is refused', () => {
  // The exact flicker: a newer interim is already shown, an older one arrives.
  assert.equal(
    shouldReplacePartialText('Welcome back to your favorite podcast.', 'Welcome back to'),
    false,
  )
})

test('a genuine revision of similar length is accepted', () => {
  // "gink" -> "geek" is the provider correcting itself, not a regression.
  assert.equal(
    shouldReplacePartialText('You look like a gink.', 'You look like a geek.'),
    true,
  )
})

test('a shorter but genuinely different revision is accepted', () => {
  // Not a prefix of what is shown, so the provider rewrote the wording.
  assert.equal(shouldReplacePartialText('Having a hard time getting', 'Having trouble'), true)
})

test('identical text is not re-rendered', () => {
  assert.equal(shouldReplacePartialText('Keine Zeit.', 'Keine Zeit.'), false)
})

test('empty incoming never clears a bubble', () => {
  assert.equal(shouldReplacePartialText('Keine Zeit.', ''), false)
  assert.equal(shouldReplacePartialText('Keine Zeit.', '   '), false)
})

test('replaying a full interim sequence never shrinks the bubble', () => {
  // Property: whatever order interims arrive in, visible length never drops.
  const arrivals = [
    'Welcome', 'Welcome back to your favorite podcast.', 'Welcome back',
    'Welcome back to your favorite podcast. It is the', 'Welcome back to your',
  ]
  let shown = ''
  for (const incoming of arrivals) {
    if (shouldReplacePartialText(shown, incoming)) {
      assert.ok(
        incoming.trim().length >= shown.trim().length || !shown.startsWith(incoming.trim()),
        `bubble shrank from ${shown.length} to ${incoming.length}`,
      )
      shown = incoming
    }
  }
  assert.equal(shown, 'Welcome back to your favorite podcast. It is the')
})

// ── one scale only: spoken time never competes with arrival time ─────────────

test('an unkeyed partial stays beside its neighbours, not below them', () => {
  // The reported symptom: unfinished bubbles formed a second list underneath
  // the finished ones, because arrival time is ~1s later than spoken time.
  const spokenBase = BASE
  const arrivalOfSecond = BASE + 1200 // a real turn, but only arrival is known
  const rows = [
    seller('erste', spokenBase + 0),
    { speaker: 0, text: 'zweite (kein Audio-Key)', isPartial: true, timestamp: arrivalOfSecond },
    seller('dritte', spokenBase + 4000),
  ]
  // Without one scale, "zweite" (1200) would sort before "dritte" (4000) only
  // by luck; with a larger arrival lag it would land after it.
  assert.deepEqual(
    textsOf(inSpokenOrder(rows)),
    ['erste', 'zweite (kein Audio-Key)', 'dritte'],
  )
})

test('an unkeyed row cannot overtake a later keyed one', () => {
  const rows = [
    seller('gesprochen zuerst', BASE + 0),
    // Arrival is far in the future relative to spoken time - the exact way
    // arrival-keyed rows used to sink below everything.
    { speaker: 0, text: 'unmittelbar danach', isPartial: true, timestamp: BASE + 90_000 },
    seller('gesprochen danach', BASE + 1000),
  ]
  assert.deepEqual(
    textsOf(inSpokenOrder(rows)),
    ['gesprochen zuerst', 'unmittelbar danach', 'gesprochen danach'],
  )
})

test('several consecutive unkeyed rows keep their arrival order', () => {
  const rows = [
    seller('anker', BASE),
    { speaker: 1, text: 'a', isPartial: true, timestamp: BASE + 50_000 },
    { speaker: 1, text: 'b', isPartial: true, timestamp: BASE + 10_000 },
    { speaker: 1, text: 'c', isPartial: true, timestamp: BASE + 70_000 },
  ]
  assert.deepEqual(textsOf(inSpokenOrder(rows)), ['anker', 'a', 'b', 'c'])
})

test('rows before any keyed row fall back to arrival time', () => {
  const rows = [
    { speaker: 1, text: 'spaeter', isPartial: true, timestamp: BASE + 900 },
    { speaker: 0, text: 'frueher', isPartial: true, timestamp: BASE + 100 },
  ]
  assert.deepEqual(textsOf(inSpokenOrder(rows)), ['frueher', 'spaeter'])
})

test('all-keyed input is unaffected by the one-scale mapping', () => {
  const rows = [prospect('Hi', BASE + 600), seller('Hallo', BASE), seller('Und?', BASE + 1100)]
  assert.deepEqual(textsOf(inSpokenOrder(rows)), ['Hallo', 'Hi', 'Und?'])
})
