/**
 * Run the SHIPPED canceller over a recording made by aec-hardware-gate.py.
 *
 * Separate from the Python side only because the canceller is the real
 * `dist/main/aec3-canceller.js` - the point of the gate is that nothing here
 * is a reimplementation of what ships.
 *
 * Prints one line of JSON so the caller can read the number without parsing
 * prose.
 */
const path = require('node:path');
const lab = require('./aec-lab.cjs');
const { Aec3Canceller } = require(path.join(__dirname, '..', 'dist/main/aec3-canceller.js'));

const CHUNK = 2400; // 100ms at 24kHz, the production chunk

(async () => {
  const far = lab.readWav('/tmp/aecgate_far.wav').samples;
  const mic = lab.readWav('/tmp/aecgate_mic.wav').samples;
  const canceller = await Aec3Canceller.create({ streamRate: 24_000 });

  const before = [];
  const after = [];
  const limit = Math.min(far.length, mic.length);
  for (let i = 0; i + CHUNK <= limit; i += CHUNK) {
    const out = canceller.process(mic.subarray(i, i + CHUNK), far.subarray(i, i + CHUNK));
    before.push(mic.subarray(i, i + CHUNK));
    after.push(new Float32Array(out));
  }
  canceller.dispose();

  // Second half only: the filter needs time to converge, and including that
  // would understate a canceller that ends up working.
  const half = Math.floor(before.length / 2);
  const flatten = (rows) => {
    const out = new Float32Array(rows.length * CHUNK);
    rows.forEach((row, i) => out.set(row, i * CHUNK));
    return out;
  };
  const energy = (a) => {
    let sum = 0;
    for (const v of a) sum += v * v;
    return sum / Math.max(1, a.length);
  };
  const db = (v) => 10 * Math.log10(Math.max(v, 1e-20));

  const b = flatten(before.slice(half));
  const a = flatten(after.slice(half));
  console.log(JSON.stringify({
    chunks: before.length,
    beforeDb: Number(db(energy(b)).toFixed(1)),
    afterDb: Number(db(energy(a)).toFixed(1)),
    erleDb: Number((db(energy(b)) - db(energy(a))).toFixed(1)),
  }));
})();
