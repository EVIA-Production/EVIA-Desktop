/**
 * `devicechange` fires far more often than the thing worth reporting. If the
 * diff is loose, the event becomes noise nobody reads; if it is too tight, the
 * AirPods switch that changes the acoustic path under AEC goes unrecorded -
 * which is the state this was built to end.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  snapshotDevices,
  diffDevices,
  EMPTY_SNAPSHOT,
} = require('../dist/main/audio-device-watch.js');

const dev = (kind, deviceId, label) => ({ kind, deviceId, label, groupId: 'g' });

test('the default entry is preferred, because it names the real device', () => {
  const snap = snapshotDevices([
    dev('audioinput', 'abc123', 'MacBook Pro Microphone'),
    dev('audioinput', 'default', 'Default - MacBook Pro Microphone'),
    dev('audiooutput', 'default', 'Default - MacBook Pro Speakers'),
  ]);
  assert.equal(snap.inputId, 'default');
  assert.equal(snap.inputLabel, 'Default - MacBook Pro Microphone');
  assert.equal(snap.outputLabel, 'Default - MacBook Pro Speakers');
});

test('an empty label is reported empty, not invented', () => {
  // Labels are blank until a getUserMedia grant lands. "unknown" in the data is
  // honest; a guessed device name is not.
  const snap = snapshotDevices([dev('audioinput', 'default', '')]);
  assert.equal(snap.inputLabel, '');
  assert.equal(snap.outputId, '', 'no output present is not an error');
});

test('the first reading is the starting hardware, not a change', () => {
  const current = snapshotDevices([
    dev('audioinput', 'default', 'Default - MacBook Pro Microphone'),
  ]);
  assert.deepEqual(diffDevices(EMPTY_SNAPSHOT, current), [],
    'reporting this would make every call look like the rep swapped devices at the start');
});

test('switching to AirPods mid-call is reported', () => {
  const before = snapshotDevices([
    dev('audioinput', 'default', 'Default - MacBook Pro Microphone'),
    dev('audiooutput', 'default', 'Default - MacBook Pro Speakers'),
  ]);
  const after = snapshotDevices([
    dev('audioinput', 'default', 'Default - Bene’s AirPods Pro'),
    dev('audiooutput', 'default', 'Default - Bene’s AirPods Pro'),
  ]);
  const changes = diffDevices(before, after);
  assert.equal(changes.length, 2, 'input and output both moved');
  const input = changes.find((c) => c.device_type === 'input');
  assert.match(input.device_name, /AirPods/);
  assert.match(input.previous_device_name, /MacBook Pro Microphone/);
});

test('plugging in something that does not become active is not a change', () => {
  // devicechange fires for a monitor with speakers, a webcam, a hub. A call
  // whose audio path did not move has nothing to report.
  const devices = [
    dev('audioinput', 'default', 'Default - MacBook Pro Microphone'),
    dev('audiooutput', 'default', 'Default - MacBook Pro Speakers'),
  ];
  const before = snapshotDevices(devices);
  const after = snapshotDevices([...devices, dev('audiooutput', 'monitor1', 'DELL U2720Q')]);
  assert.deepEqual(diffDevices(before, after), []);
});

test('a device disappearing mid-read does not fabricate a change', () => {
  const before = snapshotDevices([dev('audioinput', 'default', 'Default - MacBook Pro Microphone')]);
  assert.deepEqual(diffDevices(before, EMPTY_SNAPSHOT), [],
    'an empty enumerate is a failed read, not a device swap');
});

test('the same device by a new id still counts', () => {
  // Chromium keeps 'default' stable while the label follows the hardware, so a
  // label-only move is the common case and must not be missed.
  const before = { inputId: 'default', inputLabel: 'Default - Speakers', outputId: '', outputLabel: '' };
  const after = { inputId: 'default', inputLabel: 'Default - AirPods', outputId: '', outputLabel: '' };
  const changes = diffDevices(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].device_name, 'Default - AirPods');
});

test('an unchanged snapshot reports nothing', () => {
  const snap = snapshotDevices([
    dev('audioinput', 'default', 'Default - MacBook Pro Microphone'),
    dev('audiooutput', 'default', 'Default - MacBook Pro Speakers'),
  ]);
  assert.deepEqual(diffDevices(snap, snap), []);
});
