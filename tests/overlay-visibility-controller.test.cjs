const assert = require('node:assert/strict')
const test = require('node:test')

const {
  OverlayVisibilityController,
} = require('../dist/main/overlay-visibility-controller.js')

test('Show/Hide preserves the desired Transcript/Insights window', () => {
  const visibility = new OverlayVisibilityController()
  visibility.set({ listen: true })
  assert.deepEqual(visibility.hideUi(), ['listen'])
  assert.deepEqual(visibility.showUi(), ['listen'])
  assert.deepEqual(visibility.getDesiredVisibility(), { listen: true })
})

test('intentional Done/hide clears desired visibility', () => {
  const visibility = new OverlayVisibilityController()
  visibility.set({ listen: true, ask: true })
  visibility.set({})
  assert.deepEqual(visibility.showUi(), [])
})

test('transient settings changes do not erase the desired Listen window', () => {
  const visibility = new OverlayVisibilityController()
  visibility.show('listen')
  visibility.show('settings')
  visibility.hide('settings')

  assert.equal(visibility.isDesired('listen'), true)
  assert.equal(visibility.isDesired('settings'), false)
  assert.deepEqual(visibility.getDesiredVisibility(), { listen: true })
})
