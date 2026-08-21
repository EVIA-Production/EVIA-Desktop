/**
 * Do the two channels agree on WHEN a sound happened?
 *
 * compareCanonicalRows sorts mic rows and system rows against each other on one
 * field, capture_start_ms. That field is produced two different ways:
 *
 *   mic     startPerformanceMs - originPerformanceMs   (renderer MONOTONIC clock)
 *   system  capturedAtUnixMs   - epochUnixMs           (WALL clock, helper PTS)
 *
 * Reported 2026-08-20: "mein Satz wurde über dem des Prospects angezeigt,
 * obwohl als Antwort darauf gesagt."
 *
 * This decides it without a live call: feed both constructors audio captured at
 * the SAME real instant and compare what they emit. No hardware, no permissions,
 * deterministic - which is what the fix needs before anyone touches the clock.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { CaptureSessionTimeline } = require('../dist/main/capture-timeline.js');

const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BYTES = 2;
/** 20 ms of PCM, the system-audio frame size. */
const SAMPLES = SAMPLE_RATE * 0.02;
const shape = {
  sampleRate: SAMPLE_RATE,
  channelCount: CHANNELS,
  bytesPerSample: BYTES,
  byteLength: SAMPLES * CHANNELS * BYTES,
};

function timelineAt(epochUnixMs, originPerformanceMs) {
  return new CaptureSessionTimeline({
    id: '11111111-2222-4333-8444-555555555555',
    generation: 1,
    epochUnixMs,
    originPerformanceMs,
  });
}

test('with clocks in lockstep, both channels agree on the same instant', () => {
  // The ideal case the design assumes: Date.now() and performance.now() were
  // sampled together and have not drifted since.
  const EPOCH = 1_700_000_000_000;
  const ORIGIN = 5_000;
  const t = timelineAt(EPOCH, ORIGIN);

  const AT_MS = 1000;   // one second into the call, both channels
  const mic = t.createFromMonotonicInterval({
    ...shape, source: 'mic',
    startPerformanceMs: ORIGIN + AT_MS,
    endPerformanceMs: ORIGIN + AT_MS + 20,
  });
  const sys = t.createSystemFromEpochPts({
    ...shape,
    capturedAtUnixMs: EPOCH + AT_MS,
    observedAtUnixMs: EPOCH + AT_MS + 5,
    observedAtPerformanceMs: ORIGIN + AT_MS + 5,
  });

  assert.equal(mic.capture_start_ms, sys.capture_start_ms,
    'aligned clocks must place the same instant at the same offset');
});

test('the two clocks CAN disagree, and nothing reconciles them', () => {
  // READ THIS BEFORE TRUSTING IT.
  //
  // This demonstrates that the two constructors place the "same" moment at
  // different offsets, and that nothing in the pipeline reconciles them. It
  // does NOT prove the inversion the user reported, and an earlier version of
  // this comment claimed it did.
  //
  // The skew DIRECTION here was chosen by me. On the monotonic timeline - the
  // only one both channels share an origin on - the seller in this construction
  // genuinely does speak first, so sorting them this way is correct. Flip the
  // sign and the order flips with it.
  //
  // What decides which way production actually skews is a real session:
  // log both channels' capture_start_ms against one shared clock, at session
  // start and again at 60 s. Until that exists, a "fix" here is a coin toss
  // dressed as engineering.
  //
  // A large step is separately rejected - maxClockDomainSkewMs (250) throws
  // "foreign clock domains" - so that guard does real work and should stay.
  const EPOCH = 1_700_000_000_000;
  const ORIGIN = 5_000;
  const SKEW = 200;               // inside the 250 ms the guard permits
  const t = timelineAt(EPOCH, ORIGIN);

  const AT_MS = 1000;
  // The prospect speaks. Its PTS carries the accepted skew.
  const prospect = t.createSystemFromEpochPts({
    ...shape,
    capturedAtUnixMs: EPOCH + AT_MS + SKEW,
    observedAtUnixMs: EPOCH + AT_MS + SKEW + 5,
    observedAtPerformanceMs: ORIGIN + AT_MS + SKEW + 5,
  });

  // The seller answers 150 ms later - genuinely after, on a real clock.
  // The seller answers 150 ms later on the SAME real clock. The mic path has
  // no equivalent offset - that asymmetry is the whole bug.
  const REPLY_AFTER = 150;
  const seller = t.createFromMonotonicInterval({
    ...shape, source: 'mic',
    startPerformanceMs: ORIGIN + AT_MS + REPLY_AFTER,
    endPerformanceMs: ORIGIN + AT_MS + REPLY_AFTER + 20,
  });

  // compareCanonicalRows sorts on exactly this field.
  // The only honest claim: the offsets differ by the skew, unreconciled.
  assert.notEqual(
    prospect.capture_start_ms - seller.capture_start_ms, REPLY_AFTER,
    'the gap between the rows is not the real gap between the utterances',
  );
  assert.equal(
    prospect.capture_start_ms - seller.capture_start_ms, SKEW - REPLY_AFTER,
    'it is off by exactly the unreconciled skew, in whichever direction it runs',
  );
});

test('the skew guard does not bound the drift being sorted on', () => {
  // maxClockDomainSkewMs (250) checks that ONE observation is self-consistent.
  // It says nothing about how far the two timelines have drifted apart, which
  // is what the comparator actually sorts. A 400 ms skew passes it, because the
  // observation pair is internally consistent.
  const EPOCH = 1_700_000_000_000;
  const ORIGIN = 5_000;
  const t = timelineAt(EPOCH, ORIGIN);
  assert.doesNotThrow(() => {
    t.createSystemFromEpochPts({
      ...shape,
      capturedAtUnixMs: EPOCH + 1400,
      observedAtUnixMs: EPOCH + 1405,
      observedAtPerformanceMs: ORIGIN + 1405,
    });
  }, 'a large capture-time offset is accepted; only the observation pair is checked');
});
