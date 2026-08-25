const assert = require('node:assert/strict')
const test = require('node:test')

const {
  armComposedFirstPaintBarrier,
  WINDOWS_FIRST_PAINT_FAIL_OPEN_MS,
} = require('../dist/main/composed-first-paint.js')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createHarness(execution = deferred()) {
  let didFinishLoad
  let timeoutCallback
  const opacityCalls = []
  const clearedTimers = []
  const warnings = []

  const win = {
    setOpacity(value) {
      opacityCalls.push(value)
    },
    webContents: {
      once(event, listener) {
        assert.equal(event, 'did-finish-load')
        didFinishLoad = listener
      },
      executeJavaScript() {
        return execution.promise
      },
    },
  }

  const options = {
    setTimeoutFn(callback, delay) {
      assert.equal(delay, WINDOWS_FIRST_PAINT_FAIL_OPEN_MS)
      timeoutCallback = callback
      return 41
    },
    clearTimeoutFn(timer) {
      clearedTimers.push(timer)
    },
    warn(message) {
      warnings.push(message)
    },
  }

  return {
    execution,
    win,
    options,
    opacityCalls,
    clearedTimers,
    warnings,
    didFinishLoad: () => didFinishLoad?.(),
    timeout: () => timeoutCallback?.(),
    hasLoadListener: () => typeof didFinishLoad === 'function',
    hasTimeout: () => typeof timeoutCallback === 'function',
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

test('macOS is visible immediately and never depends on a hidden renderer frame', () => {
  const harness = createHarness()
  let completions = 0

  armComposedFirstPaintBarrier(
    harness.win,
    'header',
    () => { completions += 1 },
    { ...harness.options, platform: 'darwin' },
  )

  assert.equal(completions, 1)
  assert.deepEqual(harness.opacityCalls, [])
  assert.equal(harness.hasLoadListener(), false)
  assert.equal(harness.hasTimeout(), false)
})

test('Windows stays hidden until two renderer frames complete', async () => {
  const harness = createHarness()
  let completions = 0

  armComposedFirstPaintBarrier(
    harness.win,
    'header',
    () => { completions += 1 },
    { ...harness.options, platform: 'win32' },
  )

  assert.deepEqual(harness.opacityCalls, [0])
  assert.equal(completions, 0)
  harness.didFinishLoad()
  assert.equal(completions, 0)
  harness.execution.resolve(true)
  await flushPromises()

  assert.equal(completions, 1)
  assert.deepEqual(harness.clearedTimers, [41])
  assert.deepEqual(harness.warnings, [])
})

test('Windows fails open if hidden requestAnimationFrame never settles', async () => {
  const harness = createHarness()
  let completions = 0

  armComposedFirstPaintBarrier(
    harness.win,
    'listen',
    () => { completions += 1 },
    { ...harness.options, platform: 'win32' },
  )
  harness.didFinishLoad()
  harness.timeout()

  assert.equal(completions, 1)
  assert.match(harness.warnings[0], /timeout: listen/)

  harness.execution.resolve(true)
  await flushPromises()
  assert.equal(completions, 1, 'a late renderer frame must not reveal twice')
})

test('Windows fails open if navigation never finishes', () => {
  const harness = createHarness()
  let completions = 0

  armComposedFirstPaintBarrier(
    harness.win,
    'settings',
    () => { completions += 1 },
    { ...harness.options, platform: 'win32' },
  )
  harness.timeout()

  assert.equal(completions, 1)
  assert.match(harness.warnings[0], /timeout: settings/)
})

test('Windows fails open if renderer frame evaluation rejects', async () => {
  const harness = createHarness()
  let completions = 0

  armComposedFirstPaintBarrier(
    harness.win,
    'ask',
    () => { completions += 1 },
    { ...harness.options, platform: 'win32' },
  )
  harness.didFinishLoad()
  harness.execution.reject(new Error('renderer gone'))
  await flushPromises()

  assert.equal(completions, 1)
  assert.match(harness.warnings[0], /renderer-error: ask/)
  assert.deepEqual(harness.clearedTimers, [41])
})

test('Windows fails open if executeJavaScript throws synchronously', () => {
  const harness = createHarness()
  harness.win.webContents.executeJavaScript = () => {
    throw new Error('destroyed webContents')
  }
  let completions = 0

  armComposedFirstPaintBarrier(
    harness.win,
    'shortcuts',
    () => { completions += 1 },
    { ...harness.options, platform: 'win32' },
  )
  harness.didFinishLoad()

  assert.equal(completions, 1)
  assert.match(harness.warnings[0], /renderer-error: shortcuts/)
})
