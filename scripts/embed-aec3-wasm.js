#!/usr/bin/env node
/**
 * Freeze the AEC3 WebAssembly binary into a source file the renderer can import.
 *
 * WHY NOT JUST LET EMSCRIPTEN LOAD THE .wasm
 * ------------------------------------------
 * Emscripten fetches its .wasm relative to the script URL. In a packaged
 * Electron app the renderer runs from file://, where fetch is blocked, so that
 * load fails at runtime - in production only, after passing every test in dev.
 * The Speex module this replaces solved the same problem the same way (it is an
 * emscripten SINGLE_FILE build with the wasm base64'd inside), so this is the
 * pattern already proven in this app.
 *
 * Run after changing the @ennuicastr/webrtcaec3.js version:
 *
 *     node scripts/embed-aec3-wasm.js
 *
 * `tools/aec-bench.cjs` checks the generated file still matches the installed
 * package, so a forgotten regeneration fails the gate instead of shipping a
 * canceller built from different bytes than the one that was measured.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const pkgDir = path.join(__dirname, '..', 'node_modules', '@ennuicastr', 'webrtcaec3.js');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const wasmPath = path.join(pkgDir, 'dist', `webrtcaec3-${pkg.version}.wasm`);
const outPath = path.join(__dirname, '..', 'src', 'renderer', 'aec3', 'wasm-binary.ts');

const wasm = fs.readFileSync(wasmPath);
const sha256 = crypto.createHash('sha256').update(wasm).digest('hex');
const base64 = wasm.toString('base64');

const source = `/**
 * GENERATED FILE - do not edit. Regenerate with:
 *
 *     node scripts/embed-aec3-wasm.js
 *
 * WebRTC AEC3 compiled to WebAssembly, from @ennuicastr/webrtcaec3.js@${pkg.version}
 * (BSD-3-Clause, from the WebRTC project). Embedded rather than loaded from disk
 * because a packaged Electron renderer runs from file://, where emscripten's
 * fetch of a sibling .wasm fails.
 */

/** sha256 of the .wasm these bytes decode to. The bench pins this. */
export const AEC3_WASM_SHA256 = '${sha256}';

/** Version of the npm package this was taken from. */
export const AEC3_WASM_VERSION = '${pkg.version}';

const AEC3_WASM_BASE64 =
  '${base64}';

/** Decode once and reuse; the array is a little over ${Math.round(wasm.length / 1024)}KB. */
let cached: Uint8Array | null = null;

export function aec3WasmBinary(): Uint8Array {
  if (cached) return cached;
  const binary = atob(AEC3_WASM_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  cached = bytes;
  return bytes;
}
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, source);
console.log(`wrote ${path.relative(process.cwd(), outPath)}`);
console.log(`  package @ennuicastr/webrtcaec3.js@${pkg.version}`);
console.log(`  wasm    ${wasm.length} bytes, sha256 ${sha256.slice(0, 16)}...`);
