// The transcript is glanced at mid-call, not read. So the unit on screen is a
// turn, not a provider utterance - grouping by utterance is what produced the
// wall of one-line bubbles - and a long turn is cut into fixed blocks instead
// of growing without bound.
//
// The three-sentence block is load-bearing beyond reading comfort: a block is
// sealed once full and never changes again, so growth only ever happens in the
// last block. "Text above the cursor never reflows" is then true by
// construction rather than by careful re-rendering.

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  groupIntoBlocks,
  splitSentences,
  TURN_BREAK_GAP_MS,
} = require('../dist/main/transcript-order.js')

const BASE = 1_760_000_000_000

const row = (speaker, text, audioStartMs, opts = {}) => ({
  speaker,
  text,
  isFinal: !opts.partial,
  isPartial: !!opts.partial,
  timestamp: audioStartMs,
  audioStartMs,
})

test('consecutive utterances from one speaker become one block', () => {
  const blocks = groupIntoBlocks([
    row(1, 'Hey Brad.', BASE),
    row(1, 'How are you?', BASE + 500),
  ])
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].text, 'Hey Brad. How are you?')
})

test('a speaker change starts a new block', () => {
  const blocks = groupIntoBlocks([
    row(1, 'Hey Brad.', BASE),
    row(0, 'Just go back.', BASE + 500),
  ])
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].speaker, 1)
  assert.equal(blocks[1].speaker, 0)
})

test('start-to-start distance does NOT break a turn', () => {
  // Rows carry only a start time, so start(next) - start(previous) is
  // duration(previous) + pause, dominated by the duration. Treating it as a
  // pause made every utterance its own block - the exact symptom this grouping
  // exists to prevent. Speaker change and the sentence limit do the work.
  const blocks = groupIntoBlocks([
    row(1, 'Hey Brad.', BASE),
    row(1, 'Anyway.', BASE + TURN_BREAK_GAP_MS * 5),
  ])
  assert.equal(blocks.length, 1, 'a long previous utterance is not a pause')
})

test('consecutive utterances from one speaker stay one block', () => {
  const blocks = groupIntoBlocks([
    row(0, 'And so if you start to think about all of these things together.', BASE),
    row(0, 'Abundant where the incremental cost is close to zero.', BASE + 8000),
  ])
  assert.equal(blocks.length, 1)
})

test('a long turn is cut every three sentences', () => {
  const blocks = groupIntoBlocks([row(0, 'One. Two. Three. Four. Five.', BASE)])
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].text, 'One. Two. Three.')
  assert.equal(blocks[1].text, 'Four. Five.')
  assert.equal(blocks[1].speaker, 0)
})

test('a sealed block never changes as the turn continues', () => {
  const before = groupIntoBlocks([row(0, 'One. Two. Three.', BASE)])
  const after = groupIntoBlocks([row(0, 'One. Two. Three. Four.', BASE)])
  assert.equal(after[0].text, before[0].text, 'sealed text must be immutable')
  assert.equal(after[0].key, before[0].key, 'sealed key must be stable')
  assert.equal(after[1].text, 'Four.')
})

test('an interim is the tail of its turn, never its own bubble', () => {
  const blocks = groupIntoBlocks([
    row(1, 'Hey Brad.', BASE),
    row(1, 'How are', BASE + 400, { partial: true }),
  ])
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].text, 'Hey Brad. How are')
  assert.equal(blocks[0].isPartial, true)
})

test('an interim after a sealed block does not reopen it', () => {
  const blocks = groupIntoBlocks([
    row(0, 'One. Two. Three.', BASE),
    row(0, 'Four and', BASE + 400, { partial: true }),
  ])
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].isPartial, false)
  assert.equal(blocks[1].isPartial, true)
})

test('decimals are not sentence boundaries', () => {
  assert.deepEqual(splitSentences('Margin is 3.5 percent today.'), [
    'Margin is 3.5 percent today.',
  ])
})

test('the logged exchange renders as one block per speaker', () => {
  const blocks = groupIntoBlocks([
    row(1, "Hey, Brad. What's up? How are you?", BASE),
    row(0, 'Just go back to your product led growth roots, your.', BASE + 1200),
  ])
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].speaker, 1)
  assert.ok(blocks[0].text.startsWith('Hey, Brad.'))
})

test('rows without timings never invent a pause', () => {
  const blocks = groupIntoBlocks([
    { speaker: 1, text: 'Hey Brad.', isFinal: true },
    { speaker: 1, text: 'How are you?', isFinal: true },
  ])
  assert.equal(blocks.length, 1)
})

test('empty input and blank rows produce nothing', () => {
  assert.equal(groupIntoBlocks([]).length, 0)
  assert.equal(groupIntoBlocks([row(1, '   ', BASE)]).length, 0)
})
