// Analytics for the native onboarding shell.
//
// Until 2026-09-16 this window sent nothing: the shell served its own page from
// 127.0.0.1, blocked every other host, and loaded no PostHog. A tester's whole
// first run - the twelve minutes that decide whether Taylos gets a second call -
// left no event and no replay; only the web tab and the overlay afterwards did.
//
// Same project, same person as the overlay and the backend (distinct id = the
// account username), so a run reads as one timeline: login on the web, this
// window, then the first real call in the overlay.
//
// Replay masks every input. What the tester types here is their company, their
// website and their offer, and the standing rule for this flow is that raw
// profile content never enters analytics. The flow itself - which step, how
// long, what was clicked, where it stalled - is what the recording is for.
const POSTHOG_KEY = 'phc_I09s0hYqFHpZv2okGU4hwd2Lth0ktSM5eSp3bRJOJXc';
const POSTHOG_HOST = 'https://eu.i.posthog.com';
const POSTHOG_UI_HOST = 'https://eu.posthog.com';

const params = new URLSearchParams(location.search);
const enabled = params.get('analytics') === '1' && typeof window.posthog?.init === 'function';
const startedAt = Date.now();
let ready = false;
let identity = null;
let stepEnteredAt = startedAt;
let lastStep = null;

const base = () => ({
  surface: 'native_onboarding',
  app_version: params.get('app_version') || null,
  platform: /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'win',
  ms_since_start: Date.now() - startedAt,
});

function init(context = {}) {
  if (!enabled || ready) return ready;
  try {
    window.posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ui_host: POSTHOG_UI_HOST,
      person_profiles: 'identified_only',
      persistence: 'localStorage',
      bootstrap: context.username ? { distinctID: context.username, isIdentifiedID: true } : undefined,
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      disable_surveys: true,
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: true,
        maskInputOptions: { password: true },
        // The uploaded-document list and typed context render outside <input>.
        maskTextSelector: '[data-ph-mask], .context-fields, .document-list, .document-row, #company-website',
        blockSelector: '[data-telemetry-secret], iframe',
        recordCrossOriginIframes: false,
        collectFonts: true,
      },
    });
    ready = true;
    if (context.username) identify(context);
    window.posthog.register({ surface: 'native_onboarding', app_version: base().app_version, platform: base().platform });
  } catch (error) {
    console.warn('[onboarding-analytics] init failed', error);
  }
  return ready;
}

function identify(context) {
  if (!ready || !context?.username || identity === context.username) return;
  identity = context.username;
  window.posthog.identify(context.username, { username: context.username, email: context.email || undefined, source: 'desktop' });
}

function track(event, properties = {}, options = {}) {
  if (!ready) return;
  try { window.posthog.capture(event, { ...base(), ...properties }, options); }
  catch (error) { console.warn('[onboarding-analytics] capture failed', error); }
}

/** One event per step change, with time spent on the step being left and how
 * it was left: the product control the callout named ("action"), a card
 * button, a keyboard shortcut, or automatically. */
function step(view, index, total, direction, advancedVia = 'button') {
  if (!ready) return;
  const now = Date.now();
  track('onboarding_step_viewed', {
    step: view, index, of: total, direction,
    previous_step: lastStep, ms_on_previous_step: lastStep ? now - stepEnteredAt : null,
    advanced_via: lastStep ? advancedVia : null,
  });
  lastStep = view; stepEnteredAt = now;
}

/** Terminal events go out immediately: the window is destroyed right after. */
function terminal(event, properties = {}) {
  track(event, { ...properties, step: lastStep, ms_on_step: Date.now() - stepEnteredAt }, { send_instantly: true });
}

export const analytics = { enabled, init, identify, track, step, terminal, get ready() { return ready; } };
