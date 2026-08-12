const assert = require('node:assert/strict')
const test = require('node:test')

const {
  CaptureSessionController,
} = require('../dist/main/capture-session-controller.js')

function controller() {
  let now = 1_000
  return new CaptureSessionController(() => ++now)
}

test('fresh process is always idle regardless of stale external state', () => {
  const session = controller()
  assert.equal(session.getSnapshot().state, 'idle')
})

test('successful capture follows the only valid lifecycle', () => {
  const session = controller()
  const start = session.beginStart()
  assert.equal(start.snapshot.state, 'starting')
  assert.equal(session.confirmStarted(start.snapshot.generation).snapshot.state, 'recording')
  assert.equal(session.beginStop().snapshot.state, 'stopping')
  assert.equal(session.confirmStopped(start.snapshot.generation).snapshot.state, 'review')
  assert.equal(session.complete(start.snapshot.generation).snapshot.state, 'idle')
})

test('paused backend sessions can restore review without resurrecting capture', () => {
  const session = controller()
  const restored = session.restoreReview()

  assert.equal(restored.accepted, true)
  assert.equal(restored.snapshot.state, 'review')
  assert.equal(restored.snapshot.reason, 'backend_review_recovered')
  assert.equal(session.complete(restored.snapshot.generation).snapshot.state, 'idle')
})

test('backend review recovery cannot replace active capture state', () => {
  const session = controller()
  session.beginStart()

  const restored = session.restoreReview()
  assert.equal(restored.accepted, false)
  assert.equal(restored.snapshot.state, 'starting')
})

test('rapid duplicate start and stop requests are idempotent', () => {
  const session = controller()
  const start = session.beginStart()
  const duplicateStart = session.beginStart()
  assert.equal(duplicateStart.accepted, true)
  assert.equal(duplicateStart.changed, false)
  assert.equal(duplicateStart.snapshot.generation, start.snapshot.generation)

  session.confirmStarted(start.snapshot.generation)
  const stop = session.beginStop()
  const duplicateStop = session.beginStop()
  assert.equal(duplicateStop.accepted, true)
  assert.equal(duplicateStop.changed, false)
  assert.equal(duplicateStop.snapshot.state, 'stopping')
  assert.equal(stop.snapshot.generation, start.snapshot.generation)
})

test('failed capture start rolls back to Listen/idle', () => {
  const session = controller()
  const start = session.beginStart()
  const transitions = []
  session.subscribe((current) => transitions.push(current.state))
  const failed = session.failStart(start.snapshot.generation, 'permission_denied')
  assert.deepEqual(transitions, ['error', 'idle'])
  assert.equal(failed.snapshot.state, 'idle')
  assert.equal(failed.snapshot.errorCode, 'permission_denied')
})

test('stale generation confirmations cannot invert current state', () => {
  const session = controller()
  const first = session.beginStart()
  session.failStart(first.snapshot.generation)
  const second = session.beginStart()
  assert.notEqual(first.snapshot.generation, second.snapshot.generation)
  assert.equal(session.confirmStarted(first.snapshot.generation).accepted, false)
  assert.equal(session.getSnapshot().state, 'starting')
})

test('renderer capture loss always reconciles to idle', () => {
  const session = controller()
  const start = session.beginStart()
  session.confirmStarted(start.snapshot.generation)
  assert.equal(session.reconcileNoCapture().snapshot.state, 'idle')
})

test('failed stop remains recording without a contradictory error-state flash', () => {
  const session = controller()
  const start = session.beginStart()
  session.confirmStarted(start.snapshot.generation)
  session.beginStop()

  const transitions = []
  session.subscribe((current) => transitions.push(current.state))
  const failed = session.failStop(start.snapshot.generation, 'recorder_busy')

  assert.deepEqual(transitions, ['recording'])
  assert.equal(failed.snapshot.state, 'recording')
  assert.equal(failed.snapshot.errorCode, 'recorder_busy')
})
