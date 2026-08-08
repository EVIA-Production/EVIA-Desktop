# Desktop 1.0.67

- Render the transcript in the order words were spoken, not the order the two
  capture sockets delivered them.
- Keep a partial's start time across interim updates, so a turn still being
  spoken no longer overtakes an earlier one and snap back.
- Stop a shared utterance id from overwriting a visible bubble when the provider
  moves to the next segment of the same turn.
- Settle every partial when capture stops; no bubble stays dimmed after Stop.
- Send the in-flight turn with a suggestion request, so advice answers the
  current moment instead of the previous topic.
- Resolve session state from the capture controller, so a finished call is not
  answered as if it were live.
- Label a pending preset toggle "Deactivating..." when switching off.

# Desktop Sprint V9 Changelog

- Added macOS system-audio watchdog and restart path.
- Added preload/main IPC support for `system-audio:restart`.
- Tightened insight stub handling in ListenView.
- Disabled audio processing constraints on Windows loopback system capture.
