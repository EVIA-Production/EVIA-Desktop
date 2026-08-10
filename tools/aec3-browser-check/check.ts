/**
 * Does AEC3 actually work in the renderer, as opposed to in Node?
 *
 * The offline bench proves the algorithm. It cannot prove any of the things
 * that only exist in a packaged Electron renderer, each of which has a real
 * failure mode and each of which fails at runtime with everything else green:
 *
 *   - vite externalises `fs` and `path` for the browser; the emscripten glue
 *     references both
 *   - the glue contains one `eval()`, and the app's CSP allows
 *     'wasm-unsafe-eval' but NOT 'unsafe-eval'
 *   - the .wasm is decoded from embedded base64, because fetching a sibling
 *     file over file:// is blocked
 *   - WebAssembly instantiation itself has to be permitted by that CSP
 *
 * Build and open it:
 *
 *     npx vite build -c tools/aec3-browser-check/vite.config.ts
 *     open tools/aec3-browser-check/dist/index.html
 */
import { Aec3Canceller } from '../../src/main/aec3-canceller';
import { aec3WasmBinary, AEC3_WASM_VERSION, AEC3_WASM_SHA256 } from '../../src/renderer/aec3/wasm-binary';

const RATE = 24_000;
const CHUNK = 2400;
const lines: string[] = [];
const out = document.getElementById('out')!;

const say = (text: string, cls = '') => {
  lines.push(cls ? `<span class="${cls}">${text}</span>` : text);
  out.innerHTML = lines.join('\n');
  console.log(text.replace(/<[^>]+>/g, ''));
};
const db = (x: number) => 10 * Math.log10(Math.max(x, 1e-20));
const energy = (a: Float32Array, from = 0) => {
  let s = 0;
  for (let i = from; i < a.length; i += 1) s += a[i] * a[i];
  return s / Math.max(1, a.length - from);
};

function run(canceller: Aec3Canceller, mic: Float32Array, ref: Float32Array): Float32Array {
  const result = new Float32Array(mic.length);
  for (let off = 0; off + CHUNK <= mic.length; off += CHUNK) {
    result.set(canceller.process(mic.subarray(off, off + CHUNK), ref.subarray(off, off + CHUNK)), off);
  }
  return result;
}

(async () => {
  try {
    say(`package  @ennuicastr/webrtcaec3.js@${AEC3_WASM_VERSION}`);
    const wasm = aec3WasmBinary();
    say(`wasm     ${wasm.length} bytes decoded from embedded base64, sha256 ${AEC3_WASM_SHA256.slice(0, 16)}…`);
    say(`magic    ${[...wasm.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ')} ` +
      `${wasm[0] === 0x00 && wasm[1] === 0x61 && wasm[2] === 0x73 && wasm[3] === 0x6d ? '(valid \\0asm)' : '(NOT WASM)'}`);

    const started = performance.now();
    const canceller = await Aec3Canceller.create({ streamRate: RATE, wasmBinary: wasm });
    say(`loaded   in ${(performance.now() - started).toFixed(0)}ms — ` +
      `${canceller.internalRate}Hz internal, ${canceller.frameSamples}-sample frames`, 'pass');

    const n = 8 * RATE;

    // 1. Silent reference: nothing to cancel, so nothing may change.
    const tone = new Float32Array(n);
    for (let i = 0; i < n; i += 1) tone[i] = 0.2 * Math.sin((2 * Math.PI * 210 * i) / RATE);
    const quiet = run(canceller, tone, new Float32Array(n));
    const change = db(energy(quiet, n / 3)) - db(energy(tone, n / 3));
    say(`\nsilent reference   ${change >= 0 ? '+' : ''}${change.toFixed(2)} dB   ` +
      `${Math.abs(change) <= 1 ? 'PASS' : 'FAIL'}`, Math.abs(change) <= 1 ? 'pass' : 'fail');
    canceller.dispose();

    // 2. A real echo at the measured 60ms path.
    const fresh = await Aec3Canceller.create({ streamRate: RATE, wasmBinary: wasm });
    let seed = 12345;
    const far = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const env = 0.5 + 0.5 * Math.sin((2 * Math.PI * 1.7 * i) / RATE);
      far[i] = env * ((seed / 0x7fffffff) * 2 - 1) * 0.35;
    }
    const delay = Math.round(0.06 * RATE);
    const echo = new Float32Array(n);
    for (const [off, gain] of [[0, 1], [313, 0.35], [744, 0.18], [1320, 0.09]] as const) {
      for (let i = delay + off; i < n; i += 1) echo[i] += far[i - delay - off] * 0.14 * gain;
    }
    const cancelled = run(fresh, echo, far);
    const erle = db(energy(echo, (n * 2) / 3)) - db(energy(cancelled, (n * 2) / 3));
    say(`echo at 60ms       ${erle >= 0 ? '+' : ''}${erle.toFixed(1)} dB ERLE   ` +
      `${erle >= 10 ? 'PASS' : 'FAIL'}`, erle >= 10 ? 'pass' : 'fail');

    // 3. Cost, measured on this machine's browser engine rather than Node's.
    const t0 = performance.now();
    run(fresh, echo, far);
    const cpuMs = performance.now() - t0;
    const rtf = cpuMs / ((n / RATE) * 1000);
    say(`cost               ${(rtf * 100).toFixed(1)}% of one core ` +
      `(${(rtf * 100).toFixed(1)}ms per 100ms chunk)   ${rtf < 0.2 ? 'PASS' : 'FAIL'}`,
      rtf < 0.2 ? 'pass' : 'fail');
    fresh.dispose();

    say('\nAEC3 loads and cancels in the renderer environment.', 'pass');
  } catch (error) {
    say(`\nFAILED: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`, 'fail');
  }
})();
