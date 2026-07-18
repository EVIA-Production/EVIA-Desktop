const assert = require('node:assert/strict')
const test = require('node:test')

const {
  centerWindowGroupX,
  centerWindowX,
  positionPopoverFromRightAnchor,
  resizeRectKeepingVisualAnchor,
} = require('../dist/main/window-anchor-geometry.js')

test('bar shrink preserves the current rendered visual center', () => {
  const current = { x: 500, y: 80, width: 900, height: 49 }
  const next = resizeRectKeepingVisualAnchor(
    current,
    { width: 500, height: 49 },
    450,
    250,
  )

  assert.deepEqual(next, { x: 700, y: 80, width: 500, height: 49 })
  assert.equal(current.x + 450, next.x + 250)
})

test('bar shrink preserves an asymmetric live visual anchor', () => {
  const current = { x: 210, y: 80, width: 900, height: 49 }
  const next = resizeRectKeepingVisualAnchor(
    current,
    { width: 534, height: 49 },
    438.5,
    252.5,
  )

  assert.equal(Math.abs((current.x + 438.5) - (next.x + 252.5)) <= 0.5, true)
})

test('single attached window centers within one pixel of live bar anchor', () => {
  const anchorX = 950
  const x = centerWindowX(anchorX, 640, 0, 1440)
  assert.equal(Math.abs((x + 320) - anchorX) <= 1, true)
})

test('attached window group centers together and keeps its gap', () => {
  const anchorX = 950
  const [listenX, askX] = centerWindowGroupX(anchorX, [400, 640], 8, 0, 1920)
  const groupLeft = listenX
  const groupRight = askX + 640

  assert.equal(askX - (listenX + 400), 8)
  assert.equal(Math.abs((groupLeft + groupRight) / 2 - anchorX) <= 1, true)
})

test('attached windows clamp as one group at a display edge', () => {
  const [listenX, askX] = centerWindowGroupX(30, [400, 640], 8, 0, 1440)
  assert.equal(listenX, 0)
  assert.equal(askX, 408)
})

test('settings popover follows the live settings button right edge', () => {
  const result = positionPopoverFromRightAnchor(
    980,
    140,
    { width: 240, height: 400 },
    { x: 0, y: 25, width: 1440, height: 875 },
    5,
  )

  assert.deepEqual(result, { x: 740, y: 145, width: 240, height: 400 })
})
