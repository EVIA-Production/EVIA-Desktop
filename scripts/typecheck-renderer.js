#!/usr/bin/env node
/**
 * The renderer ships through `vite build`, which transpiles without ever
 * type-checking. On 2026-08-30 that let v1.0.102 ship a `finally` block whose
 * five identifiers were scoped inside the `try`: the bundle threw
 * `ReferenceError: analyticsOutcomeTracked is not defined` before
 * `insightsRequestInFlightRef` was cleared, so every later insights request -
 * including the post-call snapshot - was queued behind a request that had
 * already finished. Post-meeting insights were dead for the whole app session.
 *
 * `tsconfig.json` excludes `src/renderer/**`, so `npm run typecheck` never saw
 * it. This gate closes that hole for the errors that actually produce a broken
 * bundle: an identifier that does not exist at runtime. Errors of other kinds
 * are reported but do not fail the build, so the existing type debt in the
 * renderer does not block a release.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');

// Codes where the emitted JS references a binding that is not in scope. Each of
// these throws on the line it appears, not at build time.
const FATAL = new Map([
  ['TS2304', "Cannot find name"],
  ['TS2552', "Cannot find name (misspelling)"],
  ['TS2448', "Block-scoped variable used before its declaration"],
  ['TS2454', "Variable used before being assigned"],
  ['TS2451', "Cannot redeclare block-scoped variable"],
]);

const result = spawnSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.renderer.json'],
  { cwd: REPO, encoding: 'utf8' },
);

const output = `${result.stdout || ''}${result.stderr || ''}`;
const lines = output.split('\n').filter((line) => /error TS\d+:/.test(line));

const fatal = lines.filter((line) => [...FATAL.keys()].some((code) => line.includes(`error ${code}:`)));
const other = lines.filter((line) => !fatal.includes(line));

if (other.length) {
  console.log(`[typecheck:renderer] ${other.length} non-fatal type error(s) (not blocking):`);
  for (const line of other) console.log(`  ${line}`);
}

if (fatal.length) {
  console.error('');
  console.error('[typecheck:renderer] FATAL - these identifiers do not exist at runtime.');
  console.error('[typecheck:renderer] The bundle would throw where they are referenced.');
  console.error('');
  for (const line of fatal) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
}

console.log(`[typecheck:renderer] OK - no out-of-scope identifiers (${other.length} non-fatal error(s)).`);
