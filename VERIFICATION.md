# Desktop Sprint V9 Verification

## Manual checks
1. Open `/Users/benekroetz/EVIA/EVIA-Desktop/dist/mac-arm64/Taylos.app` after local build.
2. Start `Listen` with system audio enabled.
3. Verify system transcript still updates after 8+ minutes.
4. Trigger `Was soll ich als Nächstes sagen?` during a long call.
5. Confirm no greeting/opening is returned when the call is already in progress.
6. Confirm insight buttons remain short and readable.

## Expected logs
- `🍎 Starting macOS system-audio watchdog`
- `🍎 System watchdog:`
- `Restarting macOS system audio pipeline:` on recovery
