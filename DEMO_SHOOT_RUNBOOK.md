# Taylos Demo Shoot Runbook

This worktree is a local, unpackaged recording build. It preserves the ordinary Taylos interface and interaction path while substituting a small set of authored demo outcomes. Authentication, presets, microphone capture, system-audio capture, transcription, speaker separation, and every non-scripted Ask/action continue to use production services.

## Safety Boundary

- Demo mode requires an unpackaged app and `TAYLOS_DEMO_MODE=1`.
- `npm run dev`, packaged releases, CI, and installed customer builds cannot activate it.
- No demo shortcuts, hidden cue commands, extra windows, or alternate component designs exist.
- The only deterministic Ask outcomes are the Anista prep request and `What should I say next?` during the call.
- During- and post-call deterministic data are rendered through the ordinary `Insight` model and ordinary Insights UI.
- Every other Ask request and every non-scripted action uses the production backend normally.
- Demo preferences and local renderer state live under `Taylos Demo Shoot`, separate from the installed app.
- Demo mode does not register itself as the macOS `taylos://` protocol handler.
- Do not merge, deploy, or publish this branch before the shoot.

## Start

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop-Demo-Shoot
npm run dev:demo
```

The command builds the renderer in production mode and loads it from local files, matching the packaged app's browser origin. It targets `https://api.taylos.ai` and the production realtime service. This is required for presets, normal Ask, and audio/WebSocket requests to work without the localhost CORS failure.

If a previous demo run was interrupted while a call was active, startup completes that stale backend session, clears its local transcript snapshot, and returns the header to the ordinary `Listen` state. The next `Listen` press creates a fresh chat automatically.

## Ordinary Shoot Flow

Use Taylos exactly as a user would. No terminal interaction is required after launch.

1. Confirm the header reads `Listen`, not `Stop` or `Done`.
2. Open Ask through the ordinary Ask control.
3. Enter `Prepare me for my call with Anista.` and submit normally.
4. Record the standard Ask result. The ordinary Ask input remains visible below it.
5. Press `Listen` normally and begin the real call with Anton.
6. Open Insights using the ordinary Transcript/Insights toggle.
7. Record the standard Insights view: `Insights` title, Transcript toggle, Prospect bullets, Sales Analysis bullets, and Next Actions.
8. After Anton gives the skill-dependency objection, click `What should I say next?` in Next Actions.
9. Record the standard Ask response after its 150 ms thinking state:

   `Pilots don't learn by crashing. They use tools to win. Ask: "What did the last deal a junior lost cost you?"`

10. Deliver that line. Anton quantifies the lost deal and says the skill must live in the rep's head rather than on the screen.
11. Return to the ordinary Insights view. The transcript drives these ordinary Sales Analysis bullets:

   - `Buying signal detected: a lost deal costs about €40,000.`
   - `Close: 2-week pilot | 10 reps.`

12. Press `Stop` normally. If Ask was visible, the local demo restores the ordinary Listen window automatically.
13. Wait about 450 ms. Post-call Insights replace the live view automatically and begin at the top.
14. Record Prospect, Sales Analysis, and all five standard actions: Follow-up Email, Plan follow-up, Action Items, Update CRM, and Summary.
15. Press `Done` only after the post-call shot is complete.

## Deterministic Outcomes

### Prep

- Prior-call objection lost twice.
- Best-rep counter retained.
- Anista context: 67 reps, nine-month ramp, 34% turnover.
- Playbook: reframe price to cost of inaction and quantify the last winnable lost deal.

### During Call

- Standard Prospect and Sales Analysis bullets.
- Standard Next Actions.
- One deterministic hero response for `What should I say next?`.
- Buying signal and pilot close appear as ordinary Sales Analysis bullets when matching transcript evidence arrives.

### Post Call

- Agreed two-week pilot with ten reps.
- Quantified buying signal.
- Skill-transfer concern.
- Key moment and exact rep line.
- Best-rep comparison.
- Prior-call learning and next-call injection.
- Follow-up email drafted and CRM update prepared.
- Five ordinary post-call actions.

## Truth Boundary

The product performs real capture, real transcription, and real speaker separation during the shoot. Authored demo outcomes are intentionally deterministic for recording reliability.

`CRM update prepared` means the update content is ready. It does not claim that this local demo wrote to an external CRM.

## Preflight Gate

Do not record the final take until every item passes:

- Settings shows `My Presets (11)` or the current production count, not zero.
- A non-scripted Ask request returns a real backend response without a CORS error.
- Listen acquires the microphone, connects the mic WebSocket, starts system audio, and receives transcript segments.
- Microphone transcript bubbles use `me`; system-audio transcript bubbles use `them`.
- The prep result uses the standard Ask design and retains the input.
- During Insights use the standard title, toggle, bullet layout, and actions.
- The hero action produces the authored response in the standard Ask design.
- The buying signal and close are Sales Analysis bullets, not cards or badges.
- Stop automatically shows standard post-call Insights at scroll position zero.
- Post-call Insights contain all five ordinary actions with one emoji each.
- Clicking any non-scripted action still calls the production backend.
- No DevTools, demo controls, unrelated apps, notifications, or browser tabs are visible.

## Recorder

Recordly `v1.3.3` is installed at `/Applications/Recordly.app`. Before recording, grant Screen & System Audio Recording, Microphone, and Accessibility permissions, then restart Recordly.

- Record the target display at native resolution and 60 fps when available.
- Capture system audio and the selected microphone.
- Use 16:9 for the master.
- Use cursor smoothing and restrained click emphasis.
- Use approximately 1.25-1.35x zoom with 350-450 ms transitions only where text must be read.
- Keep an unedited master before applying backgrounds, crops, or zooms.
- Record one safety master in OBS or QuickTime if system resources allow.
