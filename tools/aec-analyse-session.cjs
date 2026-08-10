/**
 * Measure a real call, offline.
 *
 *     touch ~/Desktop/Taylos_DEBUG_AUDIO      # then make a call, then stop it
 *     node tools/aec-analyse-session.cjs ~/Desktop/taylos-audio-debug
 *
 * The bench proves the canceller against a room response we invented. This
 * measures the room the user actually has, from the four tracks the debug
 * recorder writes, which are sample-aligned by construction:
 *
 *     <session>_mic-raw.wav     the microphone before cancellation
 *     <session>_mic.wav         what was sent to the recogniser
 *     <session>_reference.wav   the far end AS THE CANCELLER RECEIVED IT
 *     <session>_system.wav      the far end as sent to its own socket
 *
 * It answers the questions no amount of reasoning can:
 *
 *   1. Is the reference actually non-silent? A live log has shown ref=-120dBFS
 *      with refGap=0% - digital silence from inside the written range - and no
 *      offline model reproduces it. Comparing `reference` against `system`
 *      separates "the helper delivered nothing" from "the ring indexing
 *      returned nothing", which are completely different bugs.
 *   2. What is the real acoustic delay, and is it CAUSAL? A reference older
 *      than the mic by more than the delay cannot be cancelled by anything.
 *   3. How much do the two capture clocks drift? This has never been measured -
 *      the published 0.0ppm came from a rig with both ends on one CoreAudio
 *      clock, which is why it read exactly zero. Production pairs
 *      ScreenCaptureKit against getUserMedia and the answer is unknown.
 *   4. What is the real coherence, i.e. the ceiling on any linear canceller?
 *   5. What ERLE was actually achieved?
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const lab = require('./aec-lab.cjs');

const RATE = 24_000;
const dir = process.argv[2] || path.join(os.homedir(), 'Desktop', 'taylos-audio-debug');
const fmt = (x, w = 6) => (x >= 0 ? '+' : '') + x.toFixed(1).padStart(w);

function findSessions(directory) {
  if (!fs.existsSync(directory)) throw new Error(`no such directory: ${directory}`);
  const sessions = new Map();
  for (const file of fs.readdirSync(directory)) {
    const m = /^(.+?)_(mic-raw|mic|system|reference)\.wav$/.exec(file);
    if (!m) continue;
    if (!sessions.has(m[1])) sessions.set(m[1], {});
    sessions.get(m[1])[m[2]] = path.join(directory, file);
  }
  return [...sessions.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Delay in each slice of the session, so drift shows up as a trend.
 *
 * A constant delay is a healthy fixed alignment. A delay that walks in one
 * direction is the two capture clocks running at different rates, and its slope
 * in samples per second IS the drift in parts per million.
 */
function delayOverTime(reference, mic, slices = 8) {
  const maxLag = Math.round(0.5 * RATE);
  const sliceLen = Math.floor(Math.min(reference.length, mic.length) / slices);
  const out = [];
  for (let i = 0; i < slices; i += 1) {
    const from = i * sliceLen;
    const ref = reference.subarray(from, from + sliceLen);
    const cap = mic.subarray(from, from + sliceLen);
    if (lab.levelDb(ref) < -60 || lab.levelDb(cap) < -60) { out.push(null); continue; }
    out.push(lab.bestLag(ref, cap, maxLag, { window: sliceLen, stride: 4 }));
  }
  return out;
}

/** Least-squares slope of the delay trend, expressed as clock drift in ppm. */
function driftPpm(delays, sliceSeconds) {
  const points = delays.map((d, i) => [i * sliceSeconds, d]).filter(([, d]) => d !== null);
  if (points.length < 3) return null;
  const n = points.length;
  const sx = points.reduce((s, p) => s + p[0], 0);
  const sy = points.reduce((s, p) => s + p[1], 0);
  const sxy = points.reduce((s, p) => s + p[0] * p[1], 0);
  const sxx = points.reduce((s, p) => s + p[0] * p[0], 0);
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const slopeSamplesPerSecond = (n * sxy - sx * sy) / denom;
  return (slopeSamplesPerSecond / RATE) * 1e6;
}

function analyse(name, files) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);

  const need = ['mic-raw', 'reference'];
  const missing = need.filter((k) => !files[k]);
  if (missing.length) {
    console.log(`  \x1b[31mmissing ${missing.join(', ')}\x1b[0m - was this session recorded ` +
      `with a build that writes the reference track?`);
    return false;
  }

  const tracks = {
    'mic-raw': lab.readWav(files['mic-raw']),
    reference: lab.readWav(files.reference),
    mic: files.mic ? lab.readWav(files.mic) : null,
    system: files.system ? lab.readWav(files.system) : null,
  };
  const wrongRates = Object.entries(tracks)
    .filter(([, track]) => track && track.rate !== RATE)
    .map(([track, value]) => `${track}=${value.rate}Hz`);
  if (wrongRates.length) {
    console.log(`  \x1b[31mUNSUPPORTED SAMPLE RATE\x1b[0m  ${wrongRates.join(', ')}; expected ${RATE}Hz`);
    console.log('    Resample the tracks together before analysing them. Mixing rates makes');
    console.log('    every delay and drift result invalid.');
    return false;
  }

  const micRaw = tracks['mic-raw'].samples;
  const reference = tracks.reference.samples;
  const mic = tracks.mic?.samples ?? null;
  const system = tracks.system?.samples ?? null;

  const seconds = micRaw.length / RATE;
  console.log(`  ${seconds.toFixed(0)}s  mic-raw ${fmt(lab.levelDb(micRaw))}dBFS   ` +
    `reference ${fmt(lab.levelDb(reference))}dBFS` +
    (system ? `   system-as-sent ${fmt(lab.levelDb(system))}dBFS` : ''));

  // The delay below is only meaningful if these two tracks advance together.
  // The recorder appends one window of each per mic chunk, so equal lengths is
  // the invariant - and it has been broken once, by pushing the reference from
  // inside the "do we have a reference yet" guard while mic-raw was pushed
  // unconditionally. That drops one reference window per chunk cut before the
  // helper starts (~409ms on macOS, so ~2 chunks), which does NOT look like an
  // error: it silently ADDS that offset to the measured delay, and the reading
  // is exactly what section 5.2 uses to validate the assumed helper latency.
  // Refuse to report a delay off a mismatch rather than report a wrong one.
  const alignedTracks = [
    ['reference', reference.length],
    ...(mic ? [['mic', mic.length]] : []),
  ];
  const mismatched = alignedTracks.filter(([, length]) => length !== micRaw.length);
  if (mismatched.length) {
    const detail = [
      `mic-raw=${micRaw.length}`,
      ...alignedTracks.map(([track, length]) => `${track}=${length}`),
    ].join(', ');
    const referenceGapMs = ((micRaw.length - reference.length) / RATE) * 1000;
    console.log(`  \x1b[31mTRACK LENGTH MISMATCH\x1b[0m  ${detail}`);
    console.log('    The two tracks are not 1:1 per chunk, so every number below is');
    if (reference.length !== micRaw.length) {
      console.log(`    shifted by ~${Math.abs(referenceGapMs).toFixed(0)}ms. The delay would read that much too high.`);
    }
    console.log('    Fix the recorder before trusting this; do not "correct" the');
    console.log('    assumed helper latency from a session that printed this line.');
    return false;
  }

  // 1. Is there a reference at all, and whose fault is it if not?
  if (lab.levelDb(reference) < -60) {
    console.log('  \x1b[31mTHE REFERENCE IS SILENT\x1b[0m - no canceller of any design can work.');
    if (system && lab.levelDb(system) > -60) {
      console.log('    but the system track has audio, so the helper is fine and the ring');
      console.log('    indexing is handing back positions that contain nothing. Alignment bug.');
    } else if (system) {
      console.log('    and the system track is silent too, so nothing reached the renderer.');
      console.log('    The helper, its permissions, or the audio routing - not the canceller.');
    }
    return true;
  }

  // 2. Delay, and whether it is causal.
  const slices = 8;
  const delays = delayOverTime(reference, micRaw, slices);
  const usable = delays.filter((d) => d !== null);
  if (!usable.length) {
    console.log('  no slice had both signals present - was anything played through the speakers?');
    return true;
  }
  const median = usable.slice().sort((a, b) => a - b)[Math.floor(usable.length / 2)];
  console.log(`  echo delay   ${((median / RATE) * 1000).toFixed(1)}ms median   ` +
    `[${usable.map((d) => ((d / RATE) * 1000).toFixed(0)).join(', ')}] ms across the call`);
  if (median <= 1) {
    console.log('    \x1b[31mdelay pinned at zero\x1b[0m - the reference is at or behind the echo,');
    console.log('    which is the non-causal case. Raise SYSTEM_CAPTURE_ASSUMED_LATENCY_MS.');
  }

  // 3. Drift - the number that decides whether cancellation survives a long call.
  const ppm = driftPpm(delays, seconds / slices);
  if (ppm === null) {
    console.log('  clock drift  not measurable (too few slices with audio on both sides)');
  } else {
    const verdict = Math.abs(ppm) < 100 ? 'negligible'
      : Math.abs(ppm) < 500 ? 'present, AEC3 tracks this'
      : 'LARGE - expect cancellation to decay over a long call';
    console.log(`  clock drift  ${fmt(ppm)} ppm   ${verdict}`);
  }

  // 4. Coherence - the ceiling on any linear canceller, on this real path.
  const coh = lab.coherence(reference, micRaw, RATE, { lag: median });
  const ceiling = -10 * Math.log10(Math.max(1 - coh, 1e-6));
  console.log(`  coherence    ${coh.toFixed(3)}   linear ceiling ${ceiling.toFixed(1)}dB` +
    (coh < 0.3 ? '   \x1b[33m<- path barely linear, or still misaligned\x1b[0m' : ''));

  // 5. What was actually achieved.
  if (mic) {
    const erle = lab.levelDb(micRaw) - lab.levelDb(mic);
    console.log(`  achieved     ${fmt(erle)}dB level change from mic-raw to what was sent`);
    console.log('    \x1b[2m(whole-call energy: it mixes echo removed with the rep talking,');
    console.log('     so read it alongside the delay and coherence above, not alone)\x1b[0m');
  }
  return true;
}

function main() {
  const sessions = findSessions(dir);
  if (!sessions.length) {
    console.error(`no debug sessions in ${dir}\n` +
      `  enable recording with:  touch ~/Desktop/Taylos_DEBUG_AUDIO\n` +
      `  then start a call, play some audio through the speakers, talk, and stop it.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n\x1b[1mREAL SESSION ANALYSIS\x1b[0m  ${sessions.length} session(s) in ${dir}`);
  const valid = sessions.map(([name, files]) => analyse(name, files));
  if (valid.some((result) => !result)) process.exitCode = 2;
  console.log();
}

if (require.main === module) main();

module.exports = { analyse, delayOverTime, driftPpm, findSessions };
