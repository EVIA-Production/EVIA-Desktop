const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  createRealtimeTranscriptState,
  currentDownstreamIdentity,
  isDownstreamResultApplicable,
  reduceRealtimeTranscriptState,
  projectRealtimeTranscriptState,
} = require('../dist/main/realtime-transcript-state.js')

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures/realtime-full-duplex-script.json'),
  'utf8',
))

function materialize(item) {
  return {
    chatId: fixture.chatId,
    sessionId: fixture.sessionId,
    captureGeneration: fixture.captureGeneration,
    clockDomainValid: true,
    ...item.event,
  }
}

function jitterFor(run, index) {
  // Stable, non-random adversarial jitter. It changes cross-source arrival
  // order while preserving each provider utterance's legal seq progression.
  return ((run * 47 + index * 71) % 181) - 90
}

function scheduleFor(run) {
  return fixture.events
    .map((item, index) => ({
      ...item,
      deliveredAtMs: item.deliveryBaseMs + jitterFor(run, index),
      sourceIndex: index,
    }))
    .sort((left, right) => (
      left.deliveredAtMs - right.deliveredAtMs || left.sourceIndex - right.sourceIndex
    ))
}

function percentile(values, quantile) {
  const sorted = values.slice().sort((a, b) => a - b)
  const index = Math.ceil(quantile * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]
}

function replay(run) {
  let state = createRealtimeTranscriptState()
  const firstAcceptedInterimByTuple = new Map()
  const finalLatencies = []
  let staleStamp = null

  for (const scheduled of scheduleFor(run)) {
    const event = materialize(scheduled)
    const previousProspectRevision = state.prospectRevision
    state = reduceRealtimeTranscriptState(state, event)

    if (!event.isFinal) {
      const tuple = `${event.source}:${event.streamGeneration}:${event.utteranceId}`
      if (!firstAcceptedInterimByTuple.has(tuple)) {
        firstAcceptedInterimByTuple.set(tuple, scheduled.deliveredAtMs - event.captureEndMs)
      }
    } else {
      finalLatencies.push(scheduled.deliveredAtMs - event.captureEndMs)
    }

    if (state.prospectRevision > previousProspectRevision && state.prospectRevision === 1) {
      staleStamp = currentDownstreamIdentity(state)
    }
  }

  const projection = projectRealtimeTranscriptState(state)
  return {
    state,
    projection,
    staleStamp,
    firstPartialLatencies: [...firstAcceptedInterimByTuple.values()],
    finalLatencies,
  }
}

test('20 deterministic full-duplex replays preserve words, speaker and spoken order', () => {
  const partialLatencies = []
  const finalLatencies = []

  for (let run = 0; run < 20; run += 1) {
    const result = replay(run)
    const visible = result.projection.visibleRows.map(row => [row.role, row.text])
    const context = result.projection.contextLines.map(row => [row.role, row.text])

    assert.deepEqual(visible, fixture.expectedProjection, `visible projection run ${run}`)
    assert.deepEqual(context, visible, `context must equal visible transcript run ${run}`)
    assert.equal(result.state.rows.filter(row => row.isFinal).length, 7)
    assert.equal(new Set(result.state.rows.map(row => row.tupleKey)).size, result.state.rows.length)
    assert.equal(result.state.rows.filter(row => row.source === 'mic' && /Weber Praezisionstechnik/.test(row.text)).length, 0)
    assert.equal(result.state.rows.filter(row => row.text === 'Ja.').length, 2)
    assert.equal(result.state.rows.filter(row => row.streamGeneration === 2 && row.utteranceId === '0').length, 1)
    assert.ok(result.staleStamp)
    assert.equal(isDownstreamResultApplicable(result.state, result.staleStamp), false)

    partialLatencies.push(...result.firstPartialLatencies)
    finalLatencies.push(...result.finalLatencies)
  }

  // These are deterministic transport/render schedule gates. They intentionally
  // do not claim provider or physical capture latency; the physical gate is run
  // separately with real audio after the automated suite passes.
  assert.ok(percentile(partialLatencies, 0.50) <= 300)
  assert.ok(percentile(partialLatencies, 0.95) <= 500)
  assert.ok(percentile(finalLatencies, 0.95) <= 900)
})

test('finalized rows remain immutable under replayed late mutations', () => {
  const result = replay(7)
  const before = JSON.stringify(result.state.rows)
  const finalized = result.state.rows.find(row => row.eventId === 'fixture:system:1:0')
  assert.ok(finalized?.isFinal)

  const after = reduceRealtimeTranscriptState(result.state, {
    ...finalized,
    text: 'MUTATED',
    words: [{ text: 'MUTATED', startMs: 500, endMs: 600 }],
    captureEndMs: 600,
    seq: finalized.seq + 100,
  })
  assert.equal(JSON.stringify(after.rows), before)
})
