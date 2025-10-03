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

## 3. Desktop Overlay – Current State (Updated 2025-10-02)

### ✅ CRITICAL FIXES COMPLETED (Ultra-Deep Mode Session)
**Branch**: `evia-glass-complete-desktop-runtime-fix`  
**Commits**: 4 (ec0bb2d, e2988be, 4e354ff, 0812827)  
**Status**: Core functionality restored, Glass parity ~85%

**Fixed Issues**:
1. ✅ **Listen State Machine** - Glass parity: `listenService.js:56-97`
   - Correct flow: Listen → Stop (window stays) → Done (window stays) → Listen (window hides)
   - Changed from toggle logic to state-based visibility control
   
2. ✅ **Window Z-Order** - Glass parity: `WINDOW_DATA` z-index enforcement
   - Sort windows by z-index, call `moveTop()` in order
   - Ask (z=1) now correctly below Listen (z=3)
   
3. ✅ **Window Movement** - Glass parity: `windowLayoutManager.js:240-255`
   - Fixed 2x distance bug (was adding delta, now recalculates layout)
   - Changed step from 12px → 80px (Glass standard)
   - Children clamp to screen via layout recalc
   
4. ✅ **Hide/Show State Persistence** - Glass parity: `windowManager.js:227-250`
   - Added `lastVisibleWindows` Set to track state before hiding
   - Restore windows on show instead of losing state
   
5. ✅ **Listen Close Button** - Glass verification: `ListenView.js` has NO close button
   - Removed close button (Glass closes via Done state on header)
   
6. ✅ **Duplicate Close Buttons** - Code audit fix
   - Removed duplicate button from ListenView header bar

### Header & Window Management
- Primary logic: `@EVIA-Desktop/src/main/overlay-windows.ts` (652 lines)
  - Header window size `353×47`, blur/gradient parity, always-on-top (`'screen-saver'`), content protection, all workspace visibility, persisted bounds (`overlay-prefs.json`).
  - Child windows defined in `WINDOW_DATA` with z-index enforcement (shortcuts=0, ask=1, settings=2, listen=3).
  - Global shortcuts registered: `Cmd/Ctrl+\` toggle, `Cmd/Ctrl+Enter` ask, **arrow keys nudge by 80px** (Glass parity).
  - Layout algorithm: Horizontal stacking (left of header), screen clamping, deterministic z-order.

- Entry points & IPC:
  - `@EVIA-Desktop/src/main/main.ts`: Orchestrates app lifecycle, delegates window management to `overlay-windows.ts`.
  - `@EVIA-Desktop/src/main/preload.ts`: Exposes `window.evia` bridge (`windows.show`, `windows.hide`, `windows.ensureShown`, `windows.showSettingsWindow`, prefs, auth).

### Renderer Components
- `@EVIA-Desktop/src/renderer/overlay/EviaBar.tsx` (360 lines): 
  - **Glass parity**: State-based Listen button (before → in → after)
  - **Glass parity**: Settings hover with 200ms delay
  - **Glass parity**: Stop icon (9×9 white rect) for Stop + Done states
  - **Glass parity**: Done state shows black text/icon
  - **Glass parity**: Hover animations for all buttons (Ask, Show/Hide work)
  - Drag logic uses `getHeaderPosition` + `moveHeaderTo`
  
- `@EVIA-Desktop/src/renderer/overlay/ListenView.tsx` (442 lines):
  - **Glass parity**: NO close button (closes via header Done state)
  - **Glass parity**: Diarization colors (local blue gradient, remote gray)
  - Bubbles align right (speaker 0) and left (remote), `Follow Live` + copy states
  - Show Insights toggle button (functionality verified, content pending)
  
- `@EVIA-Desktop/src/renderer/overlay/AskView.tsx` (189 lines):
  - Streams via `streamAsk`, auto-creates chat if missing
  - Close button functional
  - Submit button Glass-like styling
  - Screenshot capture on `Cmd+Enter` (base64 via `evia-ask-stream.ts`)

### Audio Capture & WS
- `@EVIA-Desktop/src/renderer/audio-processor.js`: Mic capture at 16 kHz PCM16, ~150 ms chunk cadence. System audio/AEC stubs exist (future parity).
- `@EVIA-Desktop/src/renderer/services/websocketService.ts`: Chat WebSocket abstraction (connect/disconnect, send binary/audio). Uses `localStorage` for `current_chat_id`.

### ✅ RECENTLY FIXED (2025-10-03 Session)
1. ✅ **Grey header frame** - Removed invalid Electron options
2. ✅ **Header drag bounds** - Clamp before setBounds + right edge buffer
3. ✅ **Hide/Show state loss** - lastVisibleWindows Set restoration
4. ✅ **Ask window positioning** - Correct Y calculation
5. ✅ **Settings hover** - Triple-layer fix (cursor poll + IPC guard + CSS)
6. ✅ **Header design parity** - 7 fixes (Listen button frame, spacing, symbols, smooth movement)

**Details**: See `COORDINATOR_REPORT_COMPLETE_FIXES.md` and `SETTINGS_PARITY_COMPLETE.md`

### Remaining Desktop Gaps (Priority Order)
1. **LOW**: Show Insights content (button works, backend `/insights` endpoint pending - Dev C)
2. **LOW**: Shortcuts window (key capture, edit, save - nice-to-have)
3. **LOW**: Settings panel optional buttons (Move Window, Invisibility toggle, Quit - redundant)
4. **FUTURE**: Audio parity enhancement (dual capture, AEC, system audio - 8-12 hour task)
5. **FUTURE**: Windows packaging/signing

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