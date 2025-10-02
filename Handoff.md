# EVIA Project Handoff (Desktop ✕ Backend ✕ Frontend ✕ Glass Reference)

_Last updated: 2025-09-30 — Source repo root `/Users/benekroetz/EVIA`_

---

## 1. Repository Structure & Branch Context
- `@EVIA-Desktop/` — Electron overlay. Active branch: **`evia-glass-complete-desktop`** (uncommitted changes in header parity, shortcuts, screenshot flow).
- `@EVIA-Backend/` — FastAPI service; streaming `/ask`, `/ws/transcribe`, metrics. Deployed via Azure Container Apps.
- `@EVIA-Frontend/` — Next.js/Vite web app; admin dashboards, activity views, Ask streaming.
- `@glass/` — Reference (PickleGlass) implementation; use for pixel parity and feature behavior.

Supporting docs:
- `@EVIA-Desktop/EVIAContext.md`
- `@EVIA-GLASS-FASTEST-MVP-DETAILED.md`
- `@EVIA-Backend/README.md`
- `@EVIA-Frontend/README.md`

---

## 2. Environment & Run Commands

### Desktop Overlay (`@EVIA-Desktop/`)
```bash
npm install
npm run dev:renderer         # Renderer (Vite) – default port 5174 (configurable via VITE_PORT)
EVIA_DEV=1 npm run dev:main  # Electron main process (pipe via `| cat` to avoid pager)
npm run build                # Verifies TS, Vite build, electron-builder DMG (unsigned)
```
- Build produces `dist/EVIA Desktop-0.1.0-arm64.dmg` (unsigned; signing identity absent).
- For packaging parity ensure `electron-builder` installed globally if CI requires (`npm i -g electron-builder`).

### Backend (`@EVIA-Backend/`)
```bash
docker compose up --build   # Full local stack: db, redis, backend, dev frontend
```
Key env vars: `DB_URL`, `REDIS_URL`, `SECRET_KEY`, `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `FRONTEND_URL`.

### Frontend (`@EVIA-Frontend/`)
```bash
npm install
npm run dev                 # Dev server (port 5173)
```
Production Docker build uses `VITE_BACKEND_URL` build arg (see `Dockerfile`, GitHub Action workflow).

---

## 3. Desktop Overlay – Current State

### Header & Window Management
- Primary logic: `@EVIA-Desktop/src/main/overlay-windows.ts`
  - Header window size `353×47`, blur/gradient parity, always-on-top (`'screen-saver'`), content protection, all workspace visibility, persisted bounds (`overlay-prefs.json`).
  - Child windows defined in `WINDOW_DATA`; positioned relative to header, content protected, ignore mouse events when hidden.
  - Global shortcuts registered here: `Cmd/Ctrl+\` toggle, `Cmd/Ctrl+Enter` ask, arrow keys nudge by 12px.

- Entry points & IPC:
  - `@EVIA-Desktop/src/main/main.ts`: orchestrates app lifecycle, registers global shortcuts (delegating to overlay helpers), handles screenshot capture via `desktopCapturer`, toggles visibility with `hideAllChildWindows`.
  - `@EVIA-Desktop/src/main/preload.ts`: exposes `window.evia` bridge (`windows.toggleAllVisibility`, `nudgeHeader`, `openAskWindow`, `capture.takeScreenshot`, prefs, auth).

### Renderer Components
- `@EVIA-Desktop/src/renderer/overlay/EviaBar.tsx`: Pixel-parity Glass header clone (drag behavior, gradient, button states, hover). Drag logic uses `getHeaderPosition` + `moveHeaderTo`; toggles windows via `window.evia.windows.show`.
- `@EVIA-Desktop/src/renderer/overlay/ListenView.tsx`: Bubbles align right (local speaker 0, blue gradient) and left (remote, translucent gray), `Follow Live` + `Jump to latest`. Integrates insights placeholder, copy button states; styles in `overlay-glass.css`.
- `@EVIA-Desktop/src/renderer/overlay/AskView.tsx`: Streams via `streamAsk`, auto-creates chat if missing, captures screenshot on submit (including `Cmd+Enter`). Screenshot flows:
  1. Renderer invokes `window.evia.capture.takeScreenshot()`.
  2. Main process (`capture:screenshot` handler) writes PNG to temp, returns base64 + metadata.
  3. Ask payload includes `screenshot_ref` (base64) via `@EVIA-Desktop/src/renderer/lib/evia-ask-stream.ts`.

### Audio Capture & WS
- `@EVIA-Desktop/src/renderer/audio-processor.js`: Mic capture at 16 kHz PCM16, ~150 ms chunk cadence, logs chunk size. System audio/AEC stubs exist but parity not fully ported (future).
- `@EVIA-Desktop/src/renderer/services/websocketService.ts`: Chat WebSocket abstraction (connect/disconnect, send binary/audio). Ensure `current_chat_id` stored in `localStorage`.

### Remaining Desktop Gaps
- Side-by-side diff still pending for header pixel parity (<2 px).
- Settings/Shortcuts window animations & exact offsets not yet re-confirmed.
- Windows packaging/signing outstanding (see `@EVIA-GLASS-FASTEST-MVP-DETAILED.md` “Distribution & invisibility polish”).
- Need runtime evidence: logs (Listen WS, chunk cadence, Ask screenshot), screenshots vs Glass, DMG artifact.

---

## 4. Backend – Current Capabilities & Pending

### Key Endpoints & Services
- Routes & summary: `@EVIA-Backend/README.md`.
  - Auth: `POST /login/`, JWT via `authService`.
  - Chats: `POST /chat/`, `GET /chat/{id}`, transcripts, rename, delete.
  - Streaming: `/ws/transcribe?chat_id=&token=&source=mic|system&dg_lang=de`.
  - Ask: `POST /ask` streaming (JSONL) with optional `screenshot_ref`.
  - Metrics: `GET /admin/metrics`, `GET /admin/users/{username}/metrics`.
- Metrics implementation details: `@EVIA-Backend/EVIA_Metrics_Implementation.md`.
- Security hardening to-do: `@EVIA-Backend/SECURITY_HARDENING.md`.

### Current Issues / Risks
- `/insights` endpoint pending (see Taskboard in `EVIA-GLASS-FASTEST-MVP-DETAILED.md`).
- Admin metrics `last_updated` not yet returned.
- WebSocket command validation & rate limiting not hardened (documented future work).
- Dev-signed packaging only; Groq API 401s if key missing; ensure env.

---

## 5. Frontend – Status Overview
- App Router with Shadcn UI; streaming Ask integrated via shared `evia-ask-stream`.
- Activity Details page streams Ask responses and manipulates `current_chat_id` (`@EVIA-Frontend/src/pages/settings/ActivityDetails.tsx`).
- Admin dashboards hitting metrics endpoints (`@EVIA-Frontend/src/pages/AdminMetrics.tsx`, `AdminPage.tsx`).
- Settings + Prompts management (`@EVIA-Frontend/src/pages/settings/Settings.tsx`, `PromptsManagement.tsx`).
- Remaining parity (per docs):
  - Activity transcript styling vs Glass.
  - Insights click → Ask.
  - German i18n expansion beyond current `src/i18n/{de,en}.json`.

---

## 6. Evidence & QA Expectations
- **Runtime Logs**: Capture from Electron dev tools / main console showing:
  - Chat ID creation (`getOrCreateChatId` logs).
  - WebSocket open/chunk send cadence from `audio-processor` (`Chunk sent: size=..., cadence=...`).
  - Incoming transcript segment logs.
- **Screenshots**:
  - Header bar diff (<2 px) vs `@glass/src/ui/app/MainHeader.js`.
  - Listen bubbles vs `@glass/src/ui/listen/SttView.js`.
- **Artifacts**: DMG (`dist/EVIA Desktop-0.1.0-arm64.dmg`), `builder-effective-config.yaml`.
- **Shortcuts Validation**: Document manual test: `Cmd+\` hide/show, `Cmd+Enter` open Ask (with screenshot), arrow keys nudge.

---

## 7. Outstanding Tasks / Next Steps
1. **Visual QA**
   - Side-by-side diff for header/listen/ask vs Glass (target <2 px).
   - Ensure drag inertia & child window animations mirror reference.
2. **Evidence Collection**
   - Compile logs/screenshots per coordinator request.
3. **Packaging**
   - Investigate signing/notarization; track in packaging task (see `EVIA-GLASS-FASTEST-MVP-DETAILED.md > Dev E/B`).
4. **Backend Enhancements**
   - `/insights` endpoint implementation & metrics completion.
   - Security hardening checklist items.
5. **Frontend Parity**
   - Insights stream integration, i18n consistency.

---

## 8. Key References (quick jump)
- Header parity: `@glass/src/ui/app/MainHeader.js`, `@EVIA-Desktop/src/renderer/overlay/EviaBar.tsx`
- Screenshot capture reference: `@glass/src/features/ask/askService.js`, `@EVIA-Desktop/src/main/main.ts`, `@EVIA-Desktop/src/renderer/overlay/AskView.tsx`
- Diarization visuals: `@glass/src/ui/listen/SttView.js`, `@EVIA-Desktop/src/renderer/overlay/ListenView.tsx`
- Window management: `@EVIA-Desktop/src/main/overlay-windows.ts`
- Preload bridge: `@glass/src/preload.js`, `@EVIA-Desktop/src/main/preload.ts`
- Backend streaming: `@EVIA-Backend/api/routes/ask.py` (inspect in repo), metrics service `@EVIA-Backend/api/services/analytics_service.py`
- Frontend streaming client: `@EVIA-Frontend/src/lib/evia-ask-stream.ts`, Desktop counterpart `@EVIA-Desktop/src/renderer/lib/evia-ask-stream.ts`

---

## 9. Known Risks & Caveats
- Desktop system audio parity (AEC, dual capture) not yet at Glass fidelity—documented for future iteration.
- DMG unsigned → Gatekeeper prompts; plan dev signing per `EVIA-GLASS-FASTEST-MVP-DETAILED.md`.
- Environment tokens (Groq, Deepgram) must be valid; current dev logs show 401 when absent.
- Multi-window layout may need further z-order tuning (listen > settings > ask) to match Glass exactly.

---

## 10. Handoff Checklist
- [ ] Provide runtime logs + screenshots to coordinator.
- [ ] Run `npm run build` (desktop) and archive artifacts.
- [ ] Push branch `evia-glass-complete-desktop` after evidence.
- [ ] Ensure backend `/insights` story assigned (dependency for full parity).
- [ ] Frontend downstream notified about screenshot ref in `/ask`.

---

## Appendix: Verification Notes
- Shortcuts verified via `ripgrep` search for “Cmd+Enter” (Desktop + docs).
- Screenshot pipeline confirmed by inspecting `capture:screenshot` handler and Ask view invocation.
- Overlay state persistence and content protection cross-validated with `overlay-windows` definitions.