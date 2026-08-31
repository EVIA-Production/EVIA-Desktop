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

test('it does not depend on PostHog init having run', () => {
  // initPostHog is deferred to requestIdleCallback by the privacy/startup fix,
  // so a startup crash would otherwise land before any transport existed.
  // sendDesktopEvent queues until init and flushes after; that is what makes
  // installing at import time meaningful rather than decorative.
  assert.match(posthogSource, /if \(!initialized\) \{\s*\n\s*if \(queuedEvents\.length < MAX_QUEUED_EVENTS\)/);
  assert.match(posthogSource, /function flushQueuedEvents/);
});

test('PostHog capture_exceptions stays off, and the comment says why', () => {
  // posthog-js lazy-loads `exception-autocapture` from its CDN. The bundle we
  // ship (module.full.no-external) inlines the session recorder but contains no
  // $exception code, so enabling it would restore the boot-time remote fetch
  // that fix(privacy,startup) removed AND silently do nothing on a network that
  // blocks PostHog. Our own handlers work where the CDN does not.
  assert.match(posthogSource, /capture_exceptions: false/);
  assert.match(posthogSource, /exception-autocapture/);
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
