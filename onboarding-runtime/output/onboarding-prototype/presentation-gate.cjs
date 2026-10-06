// Decides when the onboarding owner window may be seen, and what happens when it
// cannot be. The owner starts hidden so a transparent, still-unpainted window never
// flashes over the desktop; it becomes visible only once the renderer acknowledges
// its first paint.
//
// On Windows, prime the compositor without revealing an unpainted surface. This
// is defensive, not evidence that hidden-window painting caused the incident:
// Electron normally paints initially hidden windows too.
//
// A DOM render is not a first-paint acknowledgement. Missing acknowledgement
// always fails so the caller can recover, never reveal an unverified rectangle.
const DEFAULT_TIMEOUT_MS = 9000;

function createPresentationGate({
  window,
  platform = process.platform,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onPresent = () => {},
  onFail = () => {},
  trace = () => {},
  // false: the deadline starts at arm(), i.e. when the owner page starts loading.
  // Building the product windows before that took 10.7 s on the Windows signing
  // PC (v1.0.120) and must not count against the renderer's first paint.
  autoArm = true,
}) {
  let state = 'waiting';
  let rendered = false;
  let primed = false;
  let timer = null;
  let armed = false;
  let resolveOutcome;
  const outcome = new Promise(resolve => { resolveOutcome = resolve; });
  const alive = () => !window.isDestroyed();

  function present(reason) {
    if (state !== 'waiting') return false;
    if (!alive()) return fail('window-destroyed');
    state = 'presented';
    clearTimer(timer);
    if (primed) {
      window.setIgnoreMouseEvents(false);
      window.setOpacity(1);
    }
    trace('presented', { reason });
    onPresent(reason);
    resolveOutcome({ presented: true, reason });
    return true;
  }

  function fail(reason) {
    if (state !== 'waiting') return false;
    state = 'failed';
    clearTimer(timer);
    if (primed && alive()) window.hide();
    trace('failed', { reason, rendered });
    onFail(reason);
    resolveOutcome({ presented: false, reason });
    return true;
  }

  function arm() {
    if (armed || state !== 'waiting') return false;
    armed = true;
    timer = setTimer(() => {
      fail('not-presentable');
    }, timeoutMs);
    trace('deadline-armed', { timeoutMs });
    return true;
  }
  if (autoArm) arm();

  return {
    outcome,
    arm,
    /** Called once the page has loaded. Only Windows needs the invisible show. */
    prime() {
      if (platform !== 'win32' || primed || state !== 'waiting' || !alive()) return false;
      primed = true;
      window.setOpacity(0);
      window.setIgnoreMouseEvents(true);
      window.showInactive();
      trace('primed-invisible');
      return true;
    },
    /** The renderer drew the first view (not yet acknowledged as painted). */
    markRendered() {
      if (rendered || state !== 'waiting') return;
      rendered = true;
      trace('renderer-rendered');
    },
    acknowledge: () => present('acknowledged'),
    fail,
    get state() { return state; },
    get primed() { return primed; },
  };
}

module.exports = { createPresentationGate, DEFAULT_TIMEOUT_MS };
