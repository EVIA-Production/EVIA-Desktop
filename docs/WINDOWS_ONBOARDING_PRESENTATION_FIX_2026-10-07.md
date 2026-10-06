# Native onboarding presentation repair: 1.0.120

## Scope and authority

Patch branch `fix/windows-onboarding-presentation`, based on v1.0.119
(`2d5d0116bf46d5a55326002944f8ceac6c39c50a`). The founder explicitly
authorized publication before two Windows and two Mac production-path tests.
That later instruction supersedes the original handoff's candidate-only limit.
Analytics/admin prompts are documentation only, not implementation authority.

## Facts, inference, and remaining uncertainty

The v1.0.119 Windows evidence shows a live, hidden owner and working native
glass surfaces, with no first-paint acknowledgement. The code waited without
a deadline before showing the owner; a second controller launch could create
another owner while the first launch was still unresolved. These are verified
lifecycle defects. The original Windows evidence does not identify the first
missing renderer step; neither Crashpad, signing, fonts, nor hidden rAF is a
proven root cause. Electron normally paints initially hidden windows:
[BrowserWindow documentation](https://www.electronjs.org/docs/latest/api/browser-window#showing-the-window-gracefully).

During the real isolated Mac check, Electron's development security-warning
logger raised `Invalid URL`. Making every global renderer error fatal would
incorrectly reject an otherwise rendered owner. Only explicit readiness,
load/preload failures, a crash, or the deadline now trigger recovery. Incidental
global errors are diagnostic events. Development stacks are available only
when the unpackaged diagnostic harness explicitly requests them.

## Repair

- `presentation-gate.cjs`: nine-second host deadline, acknowledge exactly once,
  ignore late acknowledgements, fail without revealing an unverified rectangle.
  Windows primes the compositor invisibly after loading; this is defensive,
  not proof that initial hidden painting caused the incident.
- `renderer-readiness.mjs` and the owner renderer: bounded initial state, launch
  image, font readiness, and compositor frames; missing launch image or bridge
  fails explicitly. Fonts may fall back to system fonts. Identity initialization
  cannot hold the first visible screen indefinitely. Opening timings remain.
- `local-onboarding.cjs` / preload: local `.mjs` MIME support, metadata-only
  rotating readiness trace, cleanup for navigation/preload/crash/close/native
  construction failures, and no additional unbounded frame wait after showing.
- `header-controller.ts`: one pending launch, no stale handle after early close.
- `native-onboarding.ts`: restore previously visible windows and offer a
  localized retry. Failure/cancellation never marks setup complete.
- Windows release script: run onboarding behavioral tests and the isolated
  native presentation check before uploading the signed release.

Sandboxing, context isolation, navigation restrictions, permission allowlists,
profile/account saving, checkout, signing and updater configuration are kept.
No real user's app data was reset. No capture, inference, checkout, production
API write or analytics event is performed by the presentation harness.

## Verification on this Mac

`npm run verify:release` passed on 7 October 2026:

- Lifecycle: 262/262; transcript: 99/99; AEC: 44/44.
- Onboarding flow/profile/host/readiness: 65/65, including behavioral failure,
  early-close, duplicate-launch, late-ack and production recovery tests.
- AEC benchmark: all ten gates pass; browser WASM loading/cancellation passes.
- Main typecheck passes. The repository renderer gate reports thirteen existing
  non-fatal type errors; this is not a zero-error strict renderer typecheck.
- Real isolated Electron owner: visible in about 1.6 seconds, nonblank opening,
  expansion and welcome captures, exactly one close. Separate disposable
  profile; analytics disabled; no real account or permissions.

Evidence folder outside the repo:
`/Users/benekroetz/EVIA/output/playwright/onboarding-presentation-2026-10-07/`.
Reproduction: `npm run test:onboarding:presentation -- <evidence-directory>`.

## Publication and acceptance

Publish the tag through the existing signed/notarized workflow, never an
unsigned fallback. Windows needs the interactive signing runner and SimplySign.
CI signing/runtime evidence is not equivalent to an installed customer test.
The founder still needs two full signup-to-value runs on each OS, including
Windows 100% and scaled DPI, onboarding replay, fresh versus resumed setup,
correct-account checkout, persisted preset, real capture, saved call and export.
Check public website download manifest and updater feeds after publication;
the website was still advertising older platform releases at preparation time.
Do not describe the product as fully ready until those four runs have passed.
