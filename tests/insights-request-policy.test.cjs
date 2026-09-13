const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isInsightsResultCurrent,
  liveInsightsRefreshDelayMs,
  mergeInsightsFetchIntent,
  postMeetingRetryDelayMs,
  shouldCoalesceAutomaticLiveInsightsRequest,
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

test('automatic live refreshes coalesce while manual and post-meeting work stay urgent', () => {
  const active = { sessionState: 'during', fullReplace: false, manual: false };

  assert.equal(shouldCoalesceAutomaticLiveInsightsRequest(active, {
    sessionState: 'during', fullReplace: false, manual: false,
  }), true);
  assert.equal(shouldCoalesceAutomaticLiveInsightsRequest(active, {
    sessionState: 'during', fullReplace: false, manual: true,
  }), false);
  assert.equal(shouldCoalesceAutomaticLiveInsightsRequest(active, {
    sessionState: 'after', fullReplace: true, manual: false,
  }), false);
});

test('live refresh delay is measured from request start even after an empty or stale result', () => {
  assert.equal(liveInsightsRefreshDelayMs(0, 20_000), 450);
  assert.equal(liveInsightsRefreshDelayMs(10_000, 10_250), 11_750);
  assert.equal(liveInsightsRefreshDelayMs(10_000, 21_900), 450);
  assert.equal(liveInsightsRefreshDelayMs(10_000, 22_500), 450);
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
