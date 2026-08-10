const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lab = require('../tools/aec-lab.cjs');

const RATE = 24_000;
const CHUNK = 2_400;
const STARTUP_SAMPLES = RATE / 2;
const DELAY_SAMPLES = Math.round(0.060 * RATE);
const SESSION_SAMPLES = RATE * 8;
const ANALYSER = path.resolve(__dirname, '../tools/aec-analyse-session.cjs');

function deterministicReference() {
  const random = lab.makeRandom(0xaec3);
  const out = new Float32Array(SESSION_SAMPLES);
  for (let i = STARTUP_SAMPLES; i < out.length; i += 1) {
    out[i] = (random() * 2 - 1) * 0.35;
  }
  return lab.lowpass(lab.highpass(out, RATE, 250), RATE, 8_000);
}

function delayedEcho(reference) {
  const out = new Float32Array(reference.length);
  out.set(reference.subarray(0, reference.length - DELAY_SAMPLES), DELAY_SAMPLES);
  return out;
}

function writeSession(directory, name, { legacyReferenceShift = 0 } = {}) {
  const reference = deterministicReference();
  const micRaw = delayedEcho(reference);
  const processed = Float32Array.from(micRaw, (sample) => sample * 0.1);
  lab.writeWav(path.join(directory, `${name}_mic-raw.wav`), micRaw, RATE);
  lab.writeWav(path.join(directory, `${name}_mic.wav`), processed, RATE);
  lab.writeWav(
    path.join(directory, `${name}_reference.wav`),
    reference.subarray(legacyReferenceShift),
    RATE,
  );
}

function runAnalyser(directory) {
  return spawnSync(process.execPath, [ANALYSER, directory], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('the lab WAV writer records a readable data-chunk length', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taylos-aec-wav-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'round-trip.wav');
  const source = Float32Array.from({ length: CHUNK }, (_, i) => Math.sin(i / 17) * 0.25);
  lab.writeWav(file, source, RATE);

  const decoded = lab.readWav(file);
  assert.equal(decoded.rate, RATE);
  assert.equal(decoded.samples.length, source.length);
  assert.ok(Math.abs(decoded.samples[311] - source[311]) < 1 / 32767);
});

test('recovers the true echo delay when startup silence preserves the shared timeline', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taylos-aec-analyse-valid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  writeSession(directory, 'aligned');

  const result = runAnalyser(directory);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /echo delay\s+60\.0ms median/);
  assert.doesNotMatch(result.stdout, /TRACK LENGTH MISMATCH/);
});

test('rejects a legacy reference track shifted by two mic chunks', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taylos-aec-analyse-shifted-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  writeSession(directory, 'shifted', { legacyReferenceShift: 2 * CHUNK });

  const result = runAnalyser(directory);
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stdout, /TRACK LENGTH MISMATCH/);
  assert.match(result.stdout, /shifted by ~200ms/);
  assert.doesNotMatch(result.stdout, /echo delay/);
});
