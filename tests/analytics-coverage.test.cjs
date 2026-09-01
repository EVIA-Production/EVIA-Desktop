/**
 * An analytics function that is defined but never called is not analytics.
 *
 * posthogService exports 40 trackers. On 2026-09-01, 26 of them had zero call
 * sites anywhere in the app - they existed, they were listed in a default export
 * nothing imports, and they had never produced a single event. Among them was
 * every OUTCOME metric: whether the rep clicked a suggestion, whether they used
 * it, how long they waited for it. The request path was instrumented and the
 * result path was not, so the product could prove it had answered and could not
 * prove the answer was worth anything.
 *
 * The same shape as `trackError`, which had two call sites and missed a
 * four-day outage. Defining the function is the easy half.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const posthogSource = read('src', 'renderer', 'services', 'posthogService.ts');
const listenSource = read('src', 'renderer', 'overlay', 'ListenView.tsx');

function callSitesOutsideService(fn) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'aec') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith('posthogService.ts')) {
        files.push(full);
      }
    }
  };
  walk(path.join(root, 'src'));
  const pattern = new RegExp(`\\b${fn}\\s*\\(`);
  return files.filter((f) => pattern.test(fs.readFileSync(f, 'utf8'))).length;
}

const exported = [...posthogSource.matchAll(/^export function ((?:track|begin|install)[A-Za-z]+)/gm)]
  .map((m) => m[1]);

// Bodies of every function in the service, so a tracker called by another
// service function can be judged on whether THAT one is reachable.
function serviceFunctionBodies() {
  const bodies = {};
  const heads = [...posthogSource.matchAll(/^(?:export )?function ([A-Za-z_]+)/gm)];
  heads.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : posthogSource.length;
    bodies[m[1]] = posthogSource.slice(start, end);
  });
  return bodies;
}
const BODIES = serviceFunctionBodies();

// Wired = called from outside the service, or called inside it by something
// that is. One hop is enough for the shapes here: checkForInsightImplementation
// is called by ListenView and fires trackInsightImplemented itself.
function isWired(fn) {
  if (callSitesOutsideService(fn) > 0) return true;
  const callers = Object.entries(BODIES)
    .filter(([name, body]) => name !== fn && new RegExp(`\\b${fn}\\s*\\(`).test(body))
    .map(([name]) => name);
  return callers.some((caller) => callSitesOutsideService(caller) > 0);
}

// Trackers with no call site today. This list may SHRINK freely; growing it
// means a new event was written that nothing fires, which is the defect this
// file exists to catch. Shrink it as they get wired.
const KNOWN_UNWIRED = new Set([
  'trackSessionStateChanged', 'trackSessionStarted', 'trackSessionEnded', 'trackSessionClosed',
  'trackAskResponseImplemented', 'trackInsightsViewed', 'trackInsightsCopied',
  'trackTranscriptCopied', 'trackInsightImplementationRate',
  'trackTranscriptViewToggled', 'trackPresetActivated', 'trackPresetDeactivated',
  'trackSettingsOpened', 'trackLanguageChanged', 'trackAutoUpdateToggled',
  'trackInvisibilityToggled', 'trackWindowMoved', 'trackDesktopAppLaunched',
  'trackDesktopAppClosed', 'trackShortcutUsed',
  'trackAudioDeviceChanged', 'trackViewChanged', 'trackTimeToFirstSuggestion',
]);

test('every exported tracker is either wired or explicitly listed as unwired', () => {
  assert.ok(exported.length >= 40, `expected the full tracker surface, saw ${exported.length}`);

  const unwired = exported.filter((fn) => !isWired(fn));
  const surprises = unwired.filter((fn) => !KNOWN_UNWIRED.has(fn));

  assert.deepEqual(
    surprises,
    [],
    `these trackers fire nowhere and are not on the known list:\n  ${surprises.join('\n  ')}\n` +
    'Wire them, or add them to KNOWN_UNWIRED with a reason.',
  );
});

test('the known-unwired list never silently grows', () => {
  // Entries may be REMOVED as trackers get wired. A tracker that is wired but
  // still listed here is stale bookkeeping, and is also worth failing on.
  const stillUnwired = [...KNOWN_UNWIRED].filter((fn) => !isWired(fn));
  assert.deepEqual(
    [...KNOWN_UNWIRED].filter((fn) => !stillUnwired.includes(fn)),
    [],
    'a tracker on KNOWN_UNWIRED now has call sites - remove it from the list',
  );
  assert.ok(KNOWN_UNWIRED.size <= 23, 'KNOWN_UNWIRED grew; new dead trackers are not acceptable');
});

test('a clicked suggestion is recorded, because that is the product working', () => {
  // Upstream events prove Taylos answered. Only this one proves a human used the
  // answer, which is the entire value claim.
  assert.match(listenSource, /trackInsightClicked\(\{/);
  const handler = listenSource.slice(
    listenSource.indexOf('const handleInsightClick ='),
    listenSource.indexOf('const outboundPrompt') + 2000,
  );
  assert.match(handler, /insight_type: insightType/);
  assert.match(handler, /insight_index: insightIndex/);
  assert.match(handler, /session_state:/);
});

test('every insight the rep can click names its own list and row', () => {
  // Without these the click is just a string, and "the second sales-analysis
  // bullet" is unrecoverable after the fact.
  const clicks = [...listenSource.matchAll(/onClick=\{\(\) => handleInsightClick\(([^}]*)\)\}/g)]
    .map((m) => m[1]);
  assert.equal(clicks.length, 4, `expected 4 insight click sites, found ${clicks.length}`);
  for (const args of clicks) {
    assert.match(args, /'(summary|topic|action|followup)'/, `click site lacks an insight type: ${args}`);
  }
  // The three list-rendered ones carry their map index; the standing
  // "what should I say next" button is not part of a list and passes -1.
  assert.equal(clicks.filter((a) => /,\s*idx\)?$/.test(a.trim())).length, 3);
});

test('the outcome loop is closed: clicked, then actually said', () => {
  // checkForInsightImplementation shipped complete - 60s window, keyword
  // matching, confidence score - and its own docstring said "Call this after
  // each final transcript from speaker 1 (user)". Nobody ever called it, so
  // clicking was recorded and USING was not.
  assert.match(listenSource, /checkForInsightImplementation\(implChatId/);
  const block = listenSource.slice(
    listenSource.indexOf('Did the rep actually say the thing'),
    listenSource.indexOf('The prospect just stopped talking'),
  );
  assert.match(block, /adapted\.event\.isFinal && adapted\.event\.source === 'mic'/,
    'must run on the rep\'s finals only - mic is speaker 1');

  // The verdict itself moved to src/main/insight-implementation.ts so it can be
  // exercised from Node - see tests/insight-implementation.test.cjs, which
  // checks the German filler and the single-keyword case against real inputs
  // rather than against the presence of words in a source file.
  const posthog = read('src', 'renderer', 'services', 'posthogService.ts');
  assert.match(posthog, /judgeImplementation\(insight\.insight_text, userSpeech\)/,
    'the service must delegate the verdict, not re-implement it');
  assert.doesNotMatch(posthog, /const stopWords =/,
    'a second copy of the stop list would drift from the tested one');

  // Splicing inside a for...of over the same array shifts the remaining
  // elements under the iterator, so two suggestions delivered in one breath
  // reported as one. Removal happens after the loop.
  const fn = posthog.slice(
    posthog.indexOf('export function checkForInsightImplementation'),
    posthog.indexOf('// ===', posthog.indexOf('export function checkForInsightImplementation')),
  );
  assert.match(fn, /const implemented: ClickedInsight\[\] = \[\]/);
  assert.match(fn, /for \(const insight of implemented\)/,
    'removal must happen after iteration, not during it');
});
