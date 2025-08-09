# EVIA Desktop (macOS first)

- Transparent overlay window (frameless, always-on-top)
- Dual WebSocket connections to backend `/ws/transcribe?source=mic|system`
- Preload isolation; no Node in renderer
- Later: Keychain storage for JWT via `keytar`, ScreenCaptureKit helper

## Dev

```sh
cd apps/evia-desktop
npm i
EVIA_DEV=1 npm run dev # in one terminal (Electron, dev paths enabled)
# in another terminal
npm run dev --prefix . # Vite server for renderer runs on :5174
```

Set backend URL, chat_id, and token when prompted to validate end-to-end WS.

### macOS helper (Phase 1)

- Build the CLI helper once (requires Xcode CLT):

```sh
cd native/mac/SystemAudioCapture
swift build -c debug
```

- Electron (dev) will spawn the debug binary from `.build/debug/SystemAudioCapture` when `EVIA_DEV=1`.
- Production build will bundle the helper into `Resources/mac/SystemAudioCapture` via electron-builder extraResources.

## Build

```sh
npm run build
```

## Notes
- Binary audio frames must be PCM16 mono at 16kHz; send 100–200ms frames.
- See `EVIA-backend/backend/api/routes/websocket.py` and `EVIA-backend/desktop-migration/WS_PROTOCOL.md` for protocol details.
