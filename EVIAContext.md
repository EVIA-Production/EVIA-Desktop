EVIA Product Knowledge Base
REPO_STRUCTURE
ROOT: /Users/benekroetz/EVIA/
SUBDIRS: EVIA-Backend/ (backend logic, APIs); EVIA-Desktop/ (Electron app, overlay UI); EVIA-Frontend/ (web app, settings); glass/ (reference repo for parity); Website/ (static site)
FOCUS_GLASS_UI: glass/src/ui/ - Core components (headers, views, audio); glass/src/preload.js - IPC bridge; glass/src/features/common/services/ - Backend services
FOCUS_EVIA_DESKTOP: /EVIA-Desktop/src/main/overlay-windows.ts (632 lines, cursor 370: overlay init); /EVIA-Desktop/src/renderer/overlay/overlay-entry.tsx (150 lines: renderer entry)
RECENTLY_VIEWED: EVIA-Desktop/EVIAContext.md; EVIA-Desktop/src/main/overlay-windows.ts; main.ts; tsconfig.json; EVIA-Frontend/src/services/chatService.ts; EVIA-Desktop/src/renderer/overlay/overlay-entry.tsx; glass/src/ui/listen/audioCore/listenCapture.js; EVIA-Desktop/native/mac/SystemAudioCapture/Sources/SystemAudioCapture/main.swift; EVIA-Frontend/src/pages/Login.tsx; settings/ActivityDetails.tsx; EVIA-Desktop/src/main/process-manager.js
OPEN_FILES: glass/src/ui/app/ApiKeyHeader.js (focused, cursor 2072/2091)
GLASS_UI_COMPONENTS (@ui/ scan: full dir analysis)
UI_STRUCTURE: LitElement-based web components; modular (app/, ask/, listen/, settings/); preload.js exposes IPC; renderer.js handles audio; content/header.html as templates
KEY_FILES_SUMMARY:
app/ApiKeyHeader.js (full scan lines 1-2091): Provider config (LLM/STT), API key input, Ollama/Whisper install. Props: llmProvider, sttProvider, models. Methods: loadProviderConfig (async IPC), handleSubmit (validate/save keys), installModel (Ollama pull). Listeners: onLocalAIProgress. EVIA_ADAPT: Move to EVIA-Frontend/settings/ApiKeys.tsx; use EVIA auth JWT for backend storage.
app/HeaderController.js (lines 1-290): Header state transitions (welcome/apikey/permission/main). Class: HeaderTransitionManager. Methods: handleStateUpdate (userState checks), transitionToMainHeader (resize/animate). IPC: onUserStateChanged. EVIA_ADAPT: Integrate German i18n; web-based state via EVIA-Frontend contexts.
app/MainHeader.js (lines 1-680): Main bar w/ listen/ask buttons, shortcuts. Props: shortcuts, listenSessionStatus. Methods: toggleVisibility (hide/show), handleListenClick (IPC). Styles: Glass blur/gradients. EVIA_ADAPT: Port to EVIA-Desktop/src/renderer/overlay/EviaBar.tsx; add German labels.
app/PermissionHeader.js (lines 1-606): Permission UI (mic/screen/keychain). Props: microphoneGranted, screenGranted. Methods: checkPermissions (IPC probe), handleMicrophoneClick (request). EVIA_ADAPT: Reuse in EVIA-Desktop for desktop perms; no keychain (EVIA auth handles encryption).
app/PickleGlassApp.js (lines 1-162): App router for views. Props: currentView. Renders: listen/ask/settings based on params. EVIA_ADAPT: Adapt to EVIA-Desktop multi-window (overlay-windows.ts).
app/WelcomeHeader.js (lines 1-236): Welcome/login screen. Methods: openPrivacyPolicy (IPC). EVIA_ADAPT: Replace with EVIA-Frontend/src/pages/Login.tsx; German text.
app/content.html (HTML template): Inline scripts for settings animation. EVIA_ADAPT: Merge into EVIA-Desktop/src/renderer/overlay.html.
app/header.html (HTML template): Header structure. EVIA_ADAPT: As above.
ask/AskView.js (lines 1-1440): Question/response w/ markdown. Props: currentResponse, isLoading. Methods: renderStreamingMarkdown (marked.js), adjustWindowHeight (IPC). EVIA_ADAPT: Port to EVIA-Desktop/src/renderer/overlay/AskView.tsx; stream from EVIA-Backend /ask; German prompts.
listen/ListenView.js (lines 1-691): Transcription/insights toggle. Props: viewMode, elapsedTime. Methods: adjustWindowHeight, handleCopy. EVIA_ADAPT: Port to EVIA-Desktop/src/renderer/overlay/ListenView.tsx; fix transcription via EVIA WS; German UI.
listen/audioCore/aec.js (lines 1-21): Echo cancellation WASM. EVIA_ADAPT: Integrate into EVIA-Desktop/src/renderer/audio-processing.js for parity.
listen/audioCore/listenCapture.js (lines 1-632): Audio capture (mic/system), AEC, tokens. Functions: startCapture (streams), runAecSync. EVIA_ADAPT: Port to EVIA-Desktop/src/renderer/audio-processor.js; send to EVIA-Backend WS.
listen/audioCore/renderer.js (lines 1-30): Renderer audio handling. EVIA_ADAPT: As above.
listen/stt/SttView.js (lines 1-226): STT display. Props: sttMessages. Methods: handleSttUpdate. EVIA_ADAPT: Integrate into ListenView.tsx; fix EVIA transcription.
listen/summary/SummaryView.js (lines 1-548): Summary/insights. Props: structuredData. Methods: renderMarkdownContent. EVIA_ADAPT: Port for insights parity; use EVIA /insights.
settings/SettingsView.js (full): Settings UI (API keys, models, presets). Props: apiKeys, selectedLlm. Methods: handleSaveKey. EVIA_ADAPT: Move API keys to EVIA-Frontend/src/pages/settings/ApiKeys.tsx; web-based.
settings/ShortCutSettingsView.js (full): Shortcut editor. Props: shortcuts. Methods: handleKeydown. EVIA_ADAPT: Port to EVIA-Desktop/src/renderer/overlay/ShortCutSettingsView.tsx.
styles/glass-bypass.css (full): CSS overrides for glass effect. EVIA_ADAPT: Apply to EVIA-Desktop/src/renderer/overlay/overlay-glass.css.
GLASS_PRELOAD (@preload.js scan: lines 1-315)
IPC_BRIDGE: contextBridge exposes 'api' object w/ namespaces (common, apiKeyHeader, headerController, etc.). Handles: auth (getCurrentUser, firebaseLogout), models (getProviderConfig, installLocalAI), windows (resizeHeaderWindow), permissions (checkSystemPermissions), audio (sendMicAudioContent), listeners (onUserStateChanged). EVIA_ADAPT: Port to EVIA-Desktop/src/preload.js; replace Firebase with EVIA auth; backend calls via EVIA config.
GLASS_ASSETS (@assets/ scan)
ASSETS_USAGE: Icons (logo.icns/ico/png) for app; libs (dompurify, highlight, lit-core, marked, smd) for markdown/rendering. SVGs in UI (e.g., check-icon in PermissionHeader). EVIA_ADAPT: Reuse in EVIA-Desktop/src/renderer/overlay/assets/; ensure German alt text. Note: Custom icons last per updates.
GLASS_API (@api/ scan: backend-like services in features/common/)
API_CALLS: From preload/renderer to main (e.g., model:get-provider-config, localai:install). No direct external APIs; local services (ollamaService.js, whisperService.js). EVIA_ADAPT: Map to EVIA-Backend endpoints (/ask, /ws/transcribe); use JWT auth.
GLASS_RENDERER (@renderer/ scan: lines 1-30 in audioCore/renderer.js + others)
RENDERER_LOGIC: audioCore/renderer.js - pickleGlass exports (startCapture, stopCapture); listens to 'change-listen-capture-state'. EVIA_ADAPT: Integrate into EVIA-Desktop/src/renderer/main.ts; adapt for web EVIA-Frontend.
GLASS_PERMISSION (@PermissionHeader.js / @permission/ scan: lines 1-606)
PERMS_LOGIC: PermissionHeader.js - UI for mic/screen/keychain; IPC checks/probes. EVIA_ADAPT: Port to EVIA-Desktop; drop keychain (use EVIA auth); German strings.
GLASS_SERVICES (@services/ scan: features/common/services/)
SERVICES_SUMMARY:
authService.js: Firebase auth, user state.
databaseInitializer.js: SQLite setup.
encryptionService.js: Keychain encryption.
firebaseClient.js: Firebase config.
localAIManager.js: Local AI (Ollama/Whisper) management.
migrationService.js: DB migrations.
modelStateService.js: Model config/state.
ollamaService.js: Ollama install/start/pull.
permissionService.js: System perms repo.
sqliteClient.js: SQLite queries.
whisperService.js: Whisper model download. EVIA_ADAPT: Replace Firebase with EVIA auth; move local AI to backend; web-based in EVIA-Frontend.
EVIA_CHANGES_INTEGRATION_NOTES (from @EVIA-GLASS-FASTEST-MVP-DETAILED.md)
GERMAN_LANGUAGE: Add i18n (de.json) to all UI strings; default to DE in prompts/settings.
API_KEY_CONFIG: Move from glass settings to EVIA-Frontend/src/pages/settings/ApiKeys.tsx; store via EVIA-Backend w/ auth.
AUTH: Use existing EVIA auth (JWT) instead of Firebase; integrate in preload/common.
WEB_NOT_LOCAL: EVIA-Frontend handles web UI; desktop overlays call EVIA-Backend APIs; no local DB/models.
KNOWN_ISSUES_FOR_PARITY
BLACK_OVERLAY_OLD_UI: Fix loadURL/CSP in EVIA-Desktop/src/main/overlay-windows.ts (lines 370+).
TRANSCRIPTION_FIX: Port listenCapture.js logic to EVIA-Desktop/audio-processor.js; ensure WS to EVIA-Backend.
PIXEL_PARITY: Match glass CSS (blur, gradients, radii) in EVIA-Desktop/overlay-glass.css.
CODE_PATTERNS
LIT_ELEMENT: Extends LitElement; static styles/props; connectedCallback for IPC listeners.
IPC: window.api namespaces; invoke/send for async/sync.
AUDIO_STT: Dual streams (mic/system) w/ AEC; WS-like updates to UI.
MARKDOWN: marked.js + highlight.js for Ask/Summary.
PERMS: Periodic checks; auto-continue on grant.
MODELS: Local install/progress UI; EVIA moves to web.
EVIA_INTEGRATION_POINTS
OVERLAY: EVIA-Desktop/src/main/overlay-windows.ts - Port glass MainHeader.
TRANSCRIPTION: EVIA-Desktop/src/renderer/audio-processor.js - Adapt listenCapture.
WEB_UI: EVIA-Frontend/src/pages/settings/_ - Add API keys; ActivityDetails.tsx for chat/transcripts.
BACKEND_GLUE: EVIA-Backend/api/routes/_ - Map glass services to /ask, /ws/transcribe.
Updates from Latest Query
Default models: Deepgram for STT. LLM suggestion logic now lives in the frontend (provider-agnostic). Exclude Ollama and Whisper initially.
Language: Implement German (de.json), but evaluate if current strategy across frontend/backend/desktop is sustainable long-term.
Permissions: Consider dropping keychain step in PermissionHeader for EVIA; verify if needed.
Assets: Custom icons to be implemented last.

CURRENT_STATE (2025-09-22):

- Backend: FastAPI up at http://localhost:8000; CORS allows 5173/5174. JWT login works via JSON; form-encoded also supported. LLM warmup/errors are handled in the frontend; desktop overlay no longer manages provider keys.
- Auth/Chat: Desktop POST /chat/ sometimes returns {} (backend likely serializing empty or auth context missing). Needs investigation in routes/chats.py and dependencies for get_current_active_user. Manual curl with Authorization sometimes returns id; browser fetch showed {}.
- Desktop: Header visible, windows managed. ListenView wired to WS; guard prevents connect with missing chat_id. AudioWorklet loads, sends PCM16 chunks; WS client has reconnect.
- WS: Connect URL ws://localhost:8000/ws/transcribe?chat_id=<id>&token=<jwt>&source=mic. Recent logs showed chat_id undefined due to missing localStorage set.
- Frontend: 5173 login path throws "module is not defined" (ESM/CJS). Vite optimizeDeps excludes added.
- Chat creation now returns non-null id after sequence fix.
- Transcription end-to-end unblocked and tested.

BLOCKERS:

1. /chat/ returning {} for some calls → Desktop cannot persist chat_id reliably; WS gets 403 (undefined chat_id).
2. Frontend login page unusable for token mint; fallback via curl/DevTools required.
3. AEC/system capture basic; parity acceptable for MVP, refine later.

NEXT STEPS (dev):

- Backend: Ensure /chat/ returns full Chat (id) consistently; verify dependency injection for current user; add test for create_chat.
- Desktop: Before connecting WS, ensure chat_id exists; if absent, call create chat endpoint and persist; handle 401 by prompting re-login.
- Frontend: Fix ESM error on /login or bypass for local.
