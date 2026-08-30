const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isInsightsResultCurrent,
  mergeInsightsFetchIntent,
  postMeetingRetryDelayMs,
  shouldPreemptInsightsRequest,
} = require('../dist/main/insights-request-policy.js');

test('a queued post-meeting request supersedes a live request', () => {
  const queued = mergeInsightsFetchIntent(
    { sessionState: 'during', fullReplace: false, manual: false },
    { sessionState: 'after', fullReplace: true, manual: false },
  );

  assert.deepEqual(queued, {
    sessionState: 'after',
    fullReplace: true,
    manual: false,
  });
});

test('a later live request cannot downgrade a queued post-meeting request', () => {
  const queued = mergeInsightsFetchIntent(
    { sessionState: 'after', fullReplace: true, manual: false },
    { sessionState: 'during', fullReplace: false, manual: true },
  );

  assert.deepEqual(queued, {
    sessionState: 'after',
    fullReplace: true,
    manual: true,
  });
});

test('post-meeting work preempts live work, but live work never preempts post-meeting work', () => {
  const during = { sessionState: 'during', fullReplace: false, manual: false };
  const after = { sessionState: 'after', fullReplace: true, manual: false };

  assert.equal(shouldPreemptInsightsRequest(during, after), true);
  assert.equal(shouldPreemptInsightsRequest(after, during), false);
  assert.equal(shouldPreemptInsightsRequest(after, after), false);
  assert.equal(shouldPreemptInsightsRequest(null, after), false);
});

test('a response is rejected when the meeting phase changed in flight', () => {
  assert.equal(isInsightsResultCurrent('during', 'after', true), false);
  assert.equal(isInsightsResultCurrent('after', 'after', false), false);
  assert.equal(isInsightsResultCurrent('after', 'after', true), true);
});

test('post-meeting retry backoff is bounded and respects rate limits', () => {
  assert.equal(postMeetingRetryDelayMs(0), 300);
  assert.equal(postMeetingRetryDelayMs(4), 12_000);
  assert.equal(postMeetingRetryDelayMs(99), 30_000);
  assert.equal(postMeetingRetryDelayMs(1, 31_250), 31_250);
});
