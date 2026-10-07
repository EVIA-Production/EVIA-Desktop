// The launch marker is the only trace a native main-process crash during setup
// leaves (installed Windows 1.0.124 exited with 0xFFFF7003 before any handler
// ran). Another process's marker means that run died during setup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOnboardingLaunchMarker, crashDumpsSince } = require(path.join(__dirname, '..', 'dist', 'main', 'onboarding-launch-marker.js'));

test('a marker from another process is an unfinished setup; this process never reports itself', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taylos-marker-'));
  const crashed = createOnboardingLaunchMarker(dir, () => 1000, 41);
  crashed.begin('1.0.124', 1);
  assert.equal(crashed.previousUnfinished(), null);
  const next = createOnboardingLaunchMarker(dir, () => 2000, 42);
  assert.deepEqual(next.previousUnfinished(), { version: '1.0.124', pid: 41, startedAt: 1000, attempts: 1 });
  next.clear();
  assert.equal(next.previousUnfinished(), null);
});

test('a missing or damaged marker is not an unfinished setup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taylos-marker-'));
  const marker = createOnboardingLaunchMarker(dir, () => 1, 7);
  assert.equal(marker.previousUnfinished(), null);
  fs.writeFileSync(marker.file, '{not json');
  assert.equal(marker.previousUnfinished(), null);
  marker.clear(); marker.clear();
});

test('crash dumps are listed by name only, newest run only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taylos-dumps-'));
  fs.mkdirSync(path.join(dir, 'reports'));
  const old = path.join(dir, 'reports', 'old.dmp');
  fs.writeFileSync(old, ''); fs.utimesSync(old, 1, 1);
  fs.writeFileSync(path.join(dir, 'reports', 'new.dmp'), '');
  fs.writeFileSync(path.join(dir, 'reports', 'notes.txt'), '');
  assert.deepEqual(crashDumpsSince(dir, 10_000), ['new.dmp']);
  assert.deepEqual(crashDumpsSince(path.join(dir, 'missing'), 0), []);
});
