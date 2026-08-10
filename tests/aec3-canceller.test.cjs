/**
 * Pins the things that were wrong, or nearly shipped wrong, about AEC3.
 *
 *     npm run build:main && node --test tests/aec3-canceller.test.cjs
 *
 * Each test here corresponds to a specific failure that passed every other
 * check at the time. They are cheap; the failures were not.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.setMaxListeners(0);

const { Aec3Canceller, AEC3_ALGORITHMIC_DELAY_SAMPLES } = require('../dist/main/aec3-canceller.js');

const RATE = 24_000;
const CHUNK = 2400;
const db = (x) => 10 * Math.log10(Math.max(x, 1e-20));
const energy = (a, from = 0) => {
  let s = 0;
  for (let i = from; i < a.length; i += 1) s += a[i] * a[i];
  return s / Math.max(1, a.length - from);
};

function runStream(canceller, mic, ref) {
  const out = new Float32Array(mic.length);
  for (let off = 0; off + CHUNK <= mic.length; off += CHUNK) {
    out.set(canceller.process(mic.subarray(off, off + CHUNK), ref.subarray(off, off + CHUNK)), off);
  }
  return out;
}

const tone = (n, hz = 210, amp = 0.2) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));

test('a silent reference leaves the microphone alone', async () => {
  // The single most valuable test there is. The canceller it replaced failed
  // this by 5.7dB on speech and 16.1dB on a tone, which is net harm: it made
  // the rep quieter without removing any of the far end, so the bleed became
  // relatively LOUDER in what the recogniser received.
  const canceller = await Aec3Canceller.create({ streamRate: RATE });
  try {
    const mic = tone(6 * RATE);
    const out = runStream(canceller, mic, new Float32Array(mic.length));
    const change = db(energy(out, mic.length / 3)) - db(energy(mic, mic.length / 3));
    assert.ok(Math.abs(change) <= 1, `silent reference changed the mic by ${change.toFixed(2)}dB`);
  } finally {
    canceller.dispose();
  }
});

test('output is sample-exact and delayed by exactly the known algorithmic delay', async () => {
  // Every alignment argument in aec-reference.ts assumes the canceller neither
  // adds nor drops samples. If that stopped being true, the reference would
  // walk away from the microphone over a call and nothing would say so.
  const canceller = await Aec3Canceller.create({ streamRate: RATE });
  try {
    const n = 4 * RATE;
    const mic = new Float32Array(n);
    mic[RATE] = 0.5;
    const out = runStream(canceller, mic, new Float32Array(n));

    assert.equal(out.length, n, 'output length must equal input length');
    let peakIndex = -1;
    let peak = 0;
    for (let i = 0; i < n; i += 1) {
      if (Math.abs(out[i]) > peak) { peak = Math.abs(out[i]); peakIndex = i; }
    }
    assert.equal(
      peakIndex - RATE, AEC3_ALGORITHMIC_DELAY_SAMPLES,
      `algorithmic delay moved to ${peakIndex - RATE} samples; telemetry and alignment assume ` +
      `${AEC3_ALGORITHMIC_DELAY_SAMPLES}`,
    );
  } finally {
    canceller.dispose();
  }
});

test('it cancels a real echo, and differently at different delays', async () => {
  // Identical results across delays is the signature of a filter that never
  // adapts - exactly what the previous canceller showed at every configuration.
  const erleAt = async (delayMs) => {
    const canceller = await Aec3Canceller.create({ streamRate: RATE });
    try {
      const n = 12 * RATE;
      let seed = 99;
      const far = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        far[i] = ((seed / 0x7fffffff) * 2 - 1) * 0.3;
      }
      const d = Math.round((delayMs / 1000) * RATE);
      const echo = new Float32Array(n);
      for (let i = d; i < n; i += 1) echo[i] = far[i - d] * 0.14;
      const out = runStream(canceller, echo, far);
      const from = Math.floor((n * 2) / 3);
      return db(energy(echo, from)) - db(energy(out, from));
    } finally {
      canceller.dispose();
    }
  };

  const at60 = await erleAt(60);
  assert.ok(at60 >= 10, `only ${at60.toFixed(1)}dB of cancellation at the measured 60ms path`);
  const at400 = await erleAt(400);
  assert.ok(
    Math.abs(at60 - at400) >= 0.5,
    `identical results at 60ms and 400ms (${at60.toFixed(1)} vs ${at400.toFixed(1)}dB) - ` +
    `the filter is not adapting to the reference`,
  );
});

test('mismatched or unaligned windows are refused, not silently mangled', async () => {
  const canceller = await Aec3Canceller.create({ streamRate: RATE });
  try {
    assert.throws(
      () => canceller.process(new Float32Array(2400), new Float32Array(1200)),
      /matched windows/,
    );
    assert.throws(
      () => canceller.process(new Float32Array(2401), new Float32Array(2401)),
      /multiple of/,
    );
  } finally {
    canceller.dispose();
  }
});

test('the embedded WASM still matches the installed package', () => {
  // The renderer runs bytes from src/renderer/aec3/wasm-binary.ts while the
  // bench measures bytes from node_modules. If a package upgrade lands without
  // `node scripts/embed-aec3-wasm.js`, the app would ship a canceller nobody
  // measured, and nothing else would notice.
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'aec3', 'wasm-binary.ts'), 'utf8',
  );
  const declared = /AEC3_WASM_SHA256 = '([0-9a-f]{64})'/.exec(source);
  const version = /AEC3_WASM_VERSION = '([^']+)'/.exec(source);
  assert.ok(declared && version, 'wasm-binary.ts is missing its sha256 or version marker');

  const pkgDir = path.join(__dirname, '..', 'node_modules', '@ennuicastr', 'webrtcaec3.js');
  const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
  assert.equal(version[1], installed,
    `wasm-binary.ts was generated from ${version[1]} but ${installed} is installed - ` +
    `run: node scripts/embed-aec3-wasm.js`);

  const wasm = fs.readFileSync(path.join(pkgDir, 'dist', `webrtcaec3-${installed}.wasm`));
  assert.equal(crypto.createHash('sha256').update(wasm).digest('hex'), declared[1],
    'embedded WASM differs from the installed package - run: node scripts/embed-aec3-wasm.js');

  const embedded = /AEC3_WASM_BASE64 =\s*'([A-Za-z0-9+/=]+)'/.exec(source);
  assert.ok(embedded, 'wasm-binary.ts is missing its base64 payload');
  assert.ok(Buffer.from(embedded[1], 'base64').equals(wasm),
    'embedded base64 does not decode to the installed WASM');
});

test("the port's `pre` option is still broken, so it stays unused", async () => {
  // Not paranoia: asking for `pre` costs 14dB of the real output, because it
  // fills that buffer with a second call to WebRTC's AudioBuffer::CopyTo, which
  // runs a STATEFUL resampler. Two calls per frame, one block of history.
  //
  // This test exists so that if a future version fixes it, we find out and can
  // take the free telemetry baseline back - and so nobody re-adds it on the
  // strength of the docs, which do not mention any of this.
  const WebRtcAec3 = require('@ennuicastr/webrtcaec3.js');
  const M = await WebRtcAec3();
  const aec = new M.AEC3(48_000, 1, 1);
  try {
    const FRAME = 240;
    const n = 4 * RATE;
    const mic = tone(n);
    const silence = new Float32Array(n);
    const out = new Float32Array(n);
    for (let off = 0; off + FRAME <= n; off += FRAME) {
      const frame = mic.subarray(off, off + FRAME);
      aec.analyze([silence.subarray(off, off + FRAME)], { sampleRateIn: RATE });
      const opts = { sampleRateIn: RATE, sampleRateOut: RATE, pre: [new Float32Array(FRAME)] };
      const buf = [new Float32Array(aec.processSize([frame], opts))];
      aec.process(buf, [frame], opts);
      out.set(buf[0], off);
    }
    const change = db(energy(out, n / 3)) - db(energy(mic, n / 3));
    assert.ok(
      change < -5,
      `\`pre\` no longer corrupts the output (${change.toFixed(2)}dB) - it may now be safe to ` +
      `use as the telemetry baseline. See src/main/aec3-canceller.ts.`,
    );
  } finally {
    aec.free();
  }
});
