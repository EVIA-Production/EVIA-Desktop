# Demo shoot script

`npm run demo:start` launches Taylos in demo mode (`TAYLOS_DEMO_MODE=1`, isolated
state under "Taylos Demo Shoot", updater and telemetry off). It is the instance
the launch video was shot with.

In demo mode every "What should I say next?" (the insights chip, the Ask
shortcut with an empty box, or typing the question) answers from
`demo/suggestions.json`, in order, and wraps around: first press = line 1,
second press = line 2, third press = line 3, fourth press = line 1 again.

Edit the JSON and press again; the file is read on every press, no restart.
Delete the file (or empty the list) to fall back to the launch-video line.

Listen still captures for real (state "during"); the script also answers in the
"before" state, so the lines show even if capture is not running.
