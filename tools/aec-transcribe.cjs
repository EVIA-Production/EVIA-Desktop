/**
 * The arbiter: does the echo still get transcribed?
 *
 *     node tools/aec-bench.cjs --wav && node tools/aec-transcribe.cjs
 *
 * Every dB in `aec-bench.cjs` is a proxy. This is the actual product
 * requirement - the microphone transcript must contain what the rep said and
 * must NOT contain what the prospect said - and it is measured by running the
 * same recogniser production runs, with the same options, over the bench's
 * own audio.
 *
 * The audio is synthetic (two macOS voices reading a scripted sales call), so
 * nothing customer-related leaves the machine. The key is read from the
 * backend's .env and never printed.
 */

const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = path.join(__dirname, 'aec-out');
const ENV_PATH = path.join(__dirname, '..', '..', 'EVIA-Backend', '.env');

// What the two voices actually say, from tools/make-speech.sh.
const FAR_SCRIPT = `Hi thanks for taking the time today So right now our sales team is about
forty people and honestly the biggest problem we have is ramp time A new rep takes about five
months before they hit quota and we just cannot afford that anymore We looked at two other tools
last quarter but neither of them handled objection handling in real time`;

const NEAR_SCRIPT = `Right that makes sense Let me ask you something about that When you say ramp
time are you measuring from the first day or from the end of onboarding Because most teams we work
with measure it differently and that changes the number quite a lot Also how are you tracking it
today`;

function readKey() {
  if (process.env.DEEPGRAM_API_KEY) return process.env.DEEPGRAM_API_KEY;
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`no DEEPGRAM_API_KEY in the environment and no ${ENV_PATH}`);
  }
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = /^\s*DEEPGRAM_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  throw new Error('DEEPGRAM_API_KEY not found');
}

/** Production's options, from backend/api/routes/websocket.py. */
const DEEPGRAM_QUERY = new URLSearchParams({
  model: 'nova-3',
  language: 'en',
  punctuate: 'true',
  smart_format: 'true',
  filler_words: 'true',
});

async function transcribe(file, key) {
  const res = await fetch(`https://api.deepgram.com/v1/listen?${DEEPGRAM_QUERY}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
    body: fs.readFileSync(file),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return body?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
}

const words = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Longest run of consecutive script words appearing consecutively in the
 * transcript.
 *
 * The backend's own bleed detector settled on contiguous runs rather than word
 * overlap for a good reason: two recognisers hearing the same sentence produce
 * different words, so containment ratios blur, while a run of 5+ consecutive
 * matching words essentially never happens by chance between two people talking
 * about the same subject. The same logic makes it the right measure here.
 */
function longestRun(script, hyp) {
  const a = words(script);
  const b = words(hyp);
  const index = new Map();
  b.forEach((w, i) => {
    if (!index.has(w)) index.set(w, []);
    index.get(w).push(i);
  });
  let best = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (const start of index.get(a[i]) || []) {
      let run = 0;
      while (i + run < a.length && start + run < b.length && a[i + run] === b[start + run]) run += 1;
      if (run > best) best = run;
    }
  }
  return best;
}

/** Fraction of the script's words that appear anywhere in the transcript. */
function recall(script, hyp) {
  const need = words(script);
  const have = new Map();
  for (const w of words(hyp)) have.set(w, (have.get(w) || 0) + 1);
  let hit = 0;
  for (const w of need) {
    if ((have.get(w) || 0) > 0) { hit += 1; have.set(w, have.get(w) - 1); }
  }
  return hit / need.length;
}

(async () => {
  const key = readKey();
  const files = [
    ['microphone, RAW baseline', 'mic-raw.wav'],
    ['microphone, AEC3 CANCELLED', 'mic-cancelled-aec3.wav'],
    ['the rep alone (ground truth)', 'near-truth.wav'],
  ].filter(([, f]) => fs.existsSync(path.join(OUT_DIR, f)));

  if (!files.length) {
    throw new Error(`no audio in ${OUT_DIR} - run: node tools/aec-bench.cjs --wav`);
  }

  console.log('\n\x1b[1mTRANSCRIPT TEST\x1b[0m  nova-3, the model and options production uses\n');

  const rows = [];
  for (const [label, file] of files) {
    const text = await transcribe(path.join(OUT_DIR, file), key);
    const repRecall = recall(NEAR_SCRIPT, text);
    const farRun = longestRun(FAR_SCRIPT, text);
    const repRun = longestRun(NEAR_SCRIPT, text);
    rows.push({ label, text, repRecall, farRun, repRun });

    console.log(`\x1b[1m${label}\x1b[0m`);
    console.log(`  rep's words recovered   ${(repRecall * 100).toFixed(0)}%  (longest run ${repRun})`);
    console.log(`  prospect's words leaked longest run ${farRun}` +
      `${farRun >= 4 ? '  \x1b[31m<- the far end is being transcribed\x1b[0m' : '  \x1b[32m<- clean\x1b[0m'}`);
    console.log(`  \x1b[2m"${text.slice(0, 300)}${text.length > 300 ? '...' : ''}"\x1b[0m\n`);
  }

  const raw = rows.find((r) => r.label.includes('RAW'));
  const aec = rows.find((r) => r.label.includes('CANCELLED'));
  if (raw && aec) {
    console.log('─'.repeat(78));
    const leakGone = aec.farRun < 4;
    const repKept = aec.repRecall >= raw.repRecall - 0.05;
    console.log(`prospect leak   raw run ${raw.farRun} -> cancelled run ${aec.farRun}   ` +
      `${leakGone ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}`);
    console.log(`rep preserved   raw ${(raw.repRecall * 100).toFixed(0)}% -> cancelled ` +
      `${(aec.repRecall * 100).toFixed(0)}%   ${repKept ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}`);
    process.exit(leakGone && repKept ? 0 : 1);
  }
})().catch((e) => { console.error('\nTRANSCRIBE FAILED:', e.message); process.exit(2); });
