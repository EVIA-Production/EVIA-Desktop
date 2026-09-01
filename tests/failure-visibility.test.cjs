/**
 * Every production failure must leave a trace somewhere we look.
 *
 * The cost of not having this: v1.0.98 through v1.0.102 shipped a `finally`
 * block referencing five identifiers scoped inside its `try`. Every insights
 * request threw `ReferenceError: analyticsOutcomeTracked is not defined` before
 * the line clearing the in-flight flag, so post-meeting insights could not
 * generate at all. Five releases, four days, and it surfaced only because one
 * person pasted a console log into a chat.
 *
 * `trackError` existed the whole time. It had two call sites, both in capture
 * start, both for failures someone had predicted. The failures nobody predicted
 * had no path to us at all.
 *
 * These tests pin the three paths that close that, one per failure class:
 *   renderer throw          -> window 'error'
 *   renderer async rejection-> window 'unhandledrejection'   <- the outage
 *   renderer/main death     -> main process, via the backend
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const posthogSource = read('src', 'renderer', 'services', 'posthogService.ts');
const entrySource = read('src', 'renderer', 'overlay', 'overlay-entry.tsx');
const mainSource = read('src', 'main', 'main.ts');

test('the renderer reports throws and unhandled rejections', () => {
  assert.match(posthogSource, /export function installGlobalErrorReporting/);
  assert.match(posthogSource, /window\.addEventListener\('error'/);
  // The insights outage was an unawaited async rejection. window.onerror never
  // sees those, so this listener is the one that would have caught it.
  assert.match(posthogSource, /window\.addEventListener\('unhandledrejection'/);
  assert.match(posthogSource, /reportUncaughtFailure\('uncaught_exception'/);
  assert.match(posthogSource, /reportUncaughtFailure\('unhandled_rejection'/);
});

test('a crash loop cannot drown the signal it is trying to send', () => {
  // A throw inside a React render or an animation frame repeats forever. An
  // uncapped reporter turns the one event that matters into rate-limited noise.
  assert.match(posthogSource, /MAX_UNCAUGHT_REPORTS_PER_WINDOW/);
  assert.match(posthogSource, /seenErrorSignatures\.has\(signature\)/);
  assert.match(posthogSource, /uncaughtReportCount >= MAX_UNCAUGHT_REPORTS_PER_WINDOW/);
  // Reporting a crash must never itself throw.
  const body = posthogSource.slice(
    posthogSource.indexOf('function reportUncaughtFailure'),
    posthogSource.indexOf('function safeStringify'),
  );
  assert.match(body, /catch \(reportingFailure\)/);
});

test('error reporting is installed before anything in the window can throw', () => {
  const install = entrySource.indexOf('installGlobalErrorReporting()');
  assert.notEqual(install, -1, 'the overlay entry never installs error reporting');

  // Every overlay view - header, listen, ask, settings - runs this one module,
  // so a single call covers all of them. It must not wait for React to mount.
  const render = entrySource.search(/createRoot|ReactDOM\.render|\.render\(/);
  if (render !== -1) {
    assert.ok(install < render, 'error reporting must be installed before React renders');
  }
});

test('every renderer entry installs it, not just the overlay', () => {
  // Each overlay HTML file is its own renderer process with its own module
  // scope, so installing in overlay-entry covers only the windows that load
  // overlay-entry. permission/welcome/subscription are separate entries, and
  // onboarding is where a silent failure costs the most - the user has no
  // product yet to fall back on.
  const entries = [
    'overlay-entry.tsx',
    'permission-entry.tsx',
    'welcome-entry.tsx',
    'subscription-entry.tsx',
  ];
  for (const entry of entries) {
    const src = read('src', 'renderer', 'overlay', entry);
    assert.match(src, /installGlobalErrorReporting\(\)/, `${entry} has no error reporting`);
  }
});

test('it does not depend on PostHog init having run', () => {
  // initPostHog is deferred to requestIdleCallback by the privacy/startup fix,
  // so a startup crash would otherwise land before any transport existed.
  // sendDesktopEvent queues until init and flushes after; that is what makes
  // installing at import time meaningful rather than decorative.
  assert.match(posthogSource, /if \(!initialized\) \{\s*\n\s*if \(queuedEvents\.length < MAX_QUEUED_EVENTS\)/);
  assert.match(posthogSource, /function flushQueuedEvents/);
});

test('the posthog import must be one that can load the session recorder', () => {
  // v1.0.101 switched this to 'posthog-js/dist/module.full.no-external' under
  // the claim that it bundled the recorder. It does not: posthog-js NEVER
  // inlines the recorder, it fetches "lazy-recorder" through
  // loadExternalDependency - and the no-external build ships no
  // loadExternalDependency at all. Replay was dead from v1.0.101 to v1.0.105
  // and Desktop recordings stop at v1.0.100.
  assert.match(posthogSource, /^import posthog from 'posthog-js';$/m);
  assert.doesNotMatch(posthogSource, /from 'posthog-js\/dist\/module\.full\.no-external'/);

  // And the shipped bundle must actually carry the loader.
  const fs2 = require('node:fs');
  const assetDir = path.join(__dirname, '..', 'dist', 'renderer', 'assets');
  if (!fs2.existsSync(assetDir)) return; // renderer not built in this run
  const bundles = fs2.readdirSync(assetDir).filter((f) => f.endsWith('.js'));
  const defines = bundles.some((f) =>
    /loadExternalDependency\s*=/.test(fs2.readFileSync(path.join(assetDir, f), 'utf8')));
  assert.ok(defines, 'no built bundle defines loadExternalDependency - the recorder cannot load');
});

test('PostHog capture_exceptions stays off, and the comment says why', () => {
  // posthog-js lazy-loads `exception-autocapture` from its CDN. The bundle we
  // ship intentionally keeps it off: enabling it adds another remote loader
  // and silently does nothing where PostHog is blocked. Our own handlers also
  // travel through the authenticated backend relay.
  assert.match(posthogSource, /capture_exceptions: false/);
  assert.match(posthogSource, /exception-autocapture/);
});

test('replay health only calls it broken when the answer is terminal', () => {
  // Measured 2026-09-01: 45 health events in one day all said
  // recording_started=false while PostHog held a real recording from the same
  // session. The check gave up 21.5s in. `lazy_loading` means the /flags
  // response has not been processed yet - the terminal negative is `disabled`.
  // A signal that is always red gets ignored, or sends someone chasing a fault
  // that is not there. Both happened here.
  assert.match(posthogSource, /verdict/);
  assert.match(posthogSource, /status === 'disabled' \? 'disabled'/);
  assert.match(posthogSource, /isLastAttempt \? 'never_started' : 'pending'/);
  assert.match(posthogSource, /is_terminal:/);
  // And it must stop retrying once the answer really is terminal.
  assert.match(posthogSource, /if \(!recordingStarted && status !== 'disabled' && !isLastAttempt\)/);

  const delays = posthogSource.match(/REPLAY_HEALTH_DELAYS_MS = \[([^\]]+)\]/);
  assert.ok(delays, 'the delay ladder is gone');
  const total = delays[1].split(',').map((d) => Number(d.replace(/[_ ]/g, ''))).reduce((a, b) => a + b, 0);
  assert.ok(total >= 120000, `the window is ${total}ms; the old 21.5s one reported failures that had not happened`);
});

test('the main process reports what a dead renderer cannot', () => {
  assert.match(mainSource, /process\.on\('uncaughtException'/);
  assert.match(mainSource, /process\.on\('unhandledRejection'/);
  assert.match(mainSource, /app\.on\('render-process-gone'/);
  assert.match(mainSource, /app\.on\('child-process-gone'/);
  assert.match(mainSource, /'main_process_crash'/);
  assert.match(mainSource, /'renderer_process_gone'/);
});

test('a main-process throw does not kill a live call', () => {
  const block = mainSource.slice(
    mainSource.indexOf('function installMainProcessCrashReporting'),
    mainSource.indexOf('function startDesktopClientTelemetry'),
  );
  assert.ok(block.length > 0, 'crash reporting block not found');
  // Quitting on uncaughtException would cost the rep the recording, which is
  // strictly worse than the bug being reported. Comments in here name
  // `app.quit()` to explain why it is absent, so assert on code, not prose.
  const code = block.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /app\.quit\(\)|process\.exit\(/);
  // The cap and the dedupe live in reportDesktopCrash, above the installer.
  assert.match(mainSource, /MAX_CRASH_REPORTS_PER_RUN/);
  assert.match(mainSource, /crashReportCount >= MAX_CRASH_REPORTS_PER_RUN/);
  assert.match(mainSource, /reportedCrashSignatures\.has\(signature\)/);
});

test('crash handlers are installed at module scope, not on app ready', () => {
  // Module scope means it runs while main.ts is still executing, which is
  // before any whenReady callback can fire. Anchored at column 0 so nesting it
  // inside a function or a ready handler fails here.
  assert.match(mainSource, /^installMainProcessCrashReporting\(\);$/m);

  // The module-scope ready hook - not the `await app.whenReady()` inside an
  // async function, and not the comment that mentions it.
  const install = mainSource.search(/^installMainProcessCrashReporting\(\);$/m);
  const ready = mainSource.search(/^if \(gotSingleInstanceLock\) app\.whenReady\(\)/m);
  assert.notEqual(ready, -1, 'the module-scope ready hook moved; re-anchor this test');
  assert.ok(install < ready, 'must be listening before the app becomes ready');
});
