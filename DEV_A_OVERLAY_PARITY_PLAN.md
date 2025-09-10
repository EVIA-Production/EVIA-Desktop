## EVIA Desktop Overlay – Dev A Parity Plan (Working Notes)

Branch strategy
- Base: `desktop-app-macos-sck` (stable audio + WS).
- New: `dev-a-overlay-parity` (UI parity work).

Scope (this branch)
- Add overlay design tokens CSS.
- Scaffold TSX components mirroring Glass: `EviaBar`, `ListenView`, `AskView`, `SettingsView`, `ShortCutSettingsView`.
- Wire minimal props and imports; no Node APIs in renderer.

Copy sources (Glass → EVIA)
- `glass/src/ui/ask/AskView.js`
- `glass/src/ui/listen/ListenView.js`
- `glass/src/ui/settings/SettingsView.js`
- `glass/src/ui/settings/ShortCutSettingsView.js`
- `glass/src/ui/styles/glass-bypass.css` (adapt into tokens + classes)

Next implementation steps (after scaffold)
- Replace inline styles with tokens; add `-webkit-app-region` drag zones.
- Wire Ask JSONL: POST `/ask` and token-by-token rendering.
- Wire dual WS using existing `src/renderer/services/websocketService.ts`.
- Add language persistence and propagation (dg_lang + ask body).
- Ensure `contentProtection` and click-through via IPC from main.

Notes
- Keep visuals 1:1 with Glass; TSX typing minimal but explicit.
- Avoid dragging via JS; use app-region.

