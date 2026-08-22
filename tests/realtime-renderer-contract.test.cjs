const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const audioSource = read('src/renderer/audio-processor-glass-parity.ts');
const macAudioSource = read('src/main/system-audio-mac-service.ts');
const askSource = read('src/renderer/overlay/AskView.tsx');
const barSource = read('src/renderer/overlay/EviaBar.tsx');
const listenSource = read('src/renderer/overlay/ListenView.tsx');
const streamSource = read('src/renderer/lib/evia-ask-stream.ts');
const wsSource = read('src/renderer/services/websocketService.ts');
const mainSource = read('src/main/main.ts');
const bridgeSource = read('src/main/desktop-bridge.ts');
const overlayWindowsSource = read('src/main/overlay-windows.ts');
const overlayEntrySource = read('src/renderer/overlay/overlay-entry.tsx');
const rendererConfigSource = read('src/renderer/config/config.ts');
const subscriptionSource = read('src/main/subscription-service.ts');
const preloadSource = read('src/main/preload.ts');
const settingsSource = read('src/renderer/overlay/SettingsView.tsx');
const liquidGlassSource = read('src/renderer/overlay/liquid-glass.css');
const overlayGlassSource = read('src/renderer/overlay/overlay-glass.css');
const nativeGlassSource = read('native/macos-liquid-glass/src/taylos_liquid_glass.mm');

test('macOS watchdog waits for a real first system-audio chunk', () => {
  assert.match(audioSource, /macSystemCaptureStartedAt/);
  assert.match(audioSource, /no-first-audio-chunk/);
  assert.match(audioSource, /pipelineMetrics\.lastSystemChunkTime = 0/);
});

test('macOS capture becomes ready only after ScreenCaptureKit confirms startup', () => {
  assert.match(macAudioSource, /statusName === 'capture_started'/);
  assert.match(macAudioSource, /const readyInMs = await captureReadyPromise/);
  assert.match(macAudioSource, /capture readiness timed out/);
  assert.match(macAudioSource, /statusName === 'permission_error'/);
  assert.match(macAudioSource, /statusName === 'unsupported_os'/);
  assert.match(macAudioSource, /invalid_audio_protocol/);
});

test('macOS helper cleanup is global only once and session shutdown targets its owned child', () => {
  const startBlock = macAudioSource.split('public async start()', 2)[1].split('public async stop()', 1)[0];
  const stopBlock = macAudioSource.split('public async stop()', 2)[1].split('public isSystemAudioRunning()', 1)[0];
  assert.match(macAudioSource, /ensureInitialOrphanCleanup/);
  assert.match(macAudioSource, /terminateOwnedProcess/);
  assert.doesNotMatch(startBlock, /await this\.killExistingSystemAudioDump\(\)/);
  assert.doesNotMatch(stopBlock, /killExistingSystemAudioDump/);
});

test('normal desktop instances are single-process on every platform', () => {
  const lockIndex = mainSource.indexOf('app.requestSingleInstanceLock()');
  const windowsBlockEnd = mainSource.indexOf('// A fixed localhost bridge');
  assert.ok(lockIndex > windowsBlockEnd, 'single-instance lock must not be scoped to Windows');
  assert.match(mainSource, /IS_ISOLATED_HARNESS \|\| app\.requestSingleInstanceLock\(\)/);
  assert.match(mainSource, /if \(!IS_ISOLATED_HARNESS\) \{\s*try \{\s*console\.log\('\[Main\] 🌉 Starting Desktop Bridge/);
  assert.match(mainSource, /if \(gotSingleInstanceLock\) \{\s*boot\(\)\.catch/);
  assert.match(overlayWindowsSource, /let ownsRegisteredShortcuts = false/);
  assert.match(overlayWindowsSource, /if \(!app\.isReady\(\) \|\| isAppQuitting\)/);
  assert.match(
    overlayWindowsSource,
    /function unregisterShortcuts\(\) \{[\s\S]*if \(!ownsRegisteredShortcuts \|\| !app\.isReady\(\)\)/
  );
  assert.match(
    overlayWindowsSource,
    /try \{\s*globalShortcut\.unregisterAll\(\)[\s\S]*finally \{\s*ownsRegisteredShortcuts = false/
  );
});

test('macOS screenshot shortcuts remain reserved for the operating system', () => {
  assert.match(overlayWindowsSource, /'Cmd\+Shift\+3'/);
  assert.match(overlayWindowsSource, /'Cmd\+Shift\+4'/);
  assert.match(overlayWindowsSource, /'Cmd\+Shift\+5'/);
  assert.match(overlayWindowsSource, /\.replace\('Cmd\+#', 'Cmd\+Shift\+3'\)/);
  assert.doesNotMatch(overlayWindowsSource, /registerSafe\('Cmd\+#'/);
});

test('unpackaged macOS Electron never claims the production deep-link scheme', () => {
  assert.match(mainSource, /process\.platform === 'darwin' && !app\.isPackaged/);
  assert.match(mainSource, /Skipping \$\{scheme\}:\/\/ registration for unpackaged macOS app/);
  assert.match(mainSource, /Queued deep link until desktop initialization/);
  assert.match(mainSource, /\?token=<redacted>/);
});

test('desktop bridge handles a port collision without an uncaught error', () => {
  assert.match(bridgeSource, /this\.wss\.on\('error'/);
  assert.match(bridgeSource, /err\.code === 'EADDRINUSE'/);
  assert.match(bridgeSource, /bridge disabled for this process/);
});

test('renderer subscribes before starting the macOS native helper', () => {
  const macBlock = audioSource.split('async function startMacSystemAudioCapture', 2)[1];
  assert.ok(macBlock, 'macOS capture startup helper should exist');
  assert.ok(
    macBlock.indexOf('eviaApi.systemAudio.onData') < macBlock.indexOf('eviaApi.systemAudio.start()'),
    'system-audio listener must be registered before native helper start'
  );
});

test('both Deepgram providers are ready before macOS physical capture starts', () => {
  const startBlock = audioSource.split('async function startCaptureInternal', 2)[1];
  assert.ok(startBlock, 'capture startup should exist');
  // The handshake is now STARTED before getUserMedia and awaited here, so the
  // barrier is the await, not the call. What this test protects is unchanged:
  // no physical capture may begin until both providers have reported dg_open.
  // Overlapping moved when the handshake is PAID FOR, never when audio flows.
  const providerBarrier = startBlock.indexOf('const socketStatus = await socketsStarted;');
  const release = startBlock.indexOf('releaseCaptureTransport()');
  const nativeCapture = startBlock.indexOf('await startMacSystemAudioCapture(eviaApi, timeline)');
  assert.ok(providerBarrier >= 0, 'provider readiness barrier must exist');
  assert.ok(providerBarrier < release, 'transport releases only after provider readiness');
  assert.ok(release < nativeCapture, 'physical capture starts only after live transport release');
  assert.match(startBlock, /Required system audio failed/);
  assert.match(startBlock, /systemAudioAvailable/);
  assert.match(startBlock, /systemAudioStatus/);
  assert.doesNotMatch(startBlock, /Optional macOS system audio failed; microphone capture remains active/);
});

test('a two-sided call fails closed unless both capture WebSockets are connected', () => {
  const socketBlock = audioSource.split('async function connectCaptureWebSockets', 2)[1];
  assert.ok(socketBlock, 'capture socket startup should exist');
  assert.match(socketBlock, /await Promise\.all\(\[pair\.mic\.connect\(\), pair\.system\.connect\(\)\]\)/);
  assert.match(socketBlock, /Required dual-source WebSocket startup failed/);
  assert.match(socketBlock, /error\.systemAudioStatus = 'socket_connection_failed'/);
  assert.doesNotMatch(socketBlock, /systemConnection[\s\S]*\.catch/);
});

test('late audio callbacks cannot recreate sockets after capture stops', () => {
  const macBlock = audioSource.split('eviaApi.systemAudio.onData', 2)[1];
  const micBlock = audioSource.split('micProcessor.onaudioprocess =', 2)[1];
  const systemBlock = audioSource.split('sysProcessor.onaudioprocess =', 2)[1];

  for (const [name, block] of [
    ['macOS native', macBlock],
    ['microphone', micBlock],
    ['system stream', systemBlock],
  ]) {
    assert.ok(block, `${name} callback should exist`);
    assert.ok(
      block.indexOf('if (!isCurrentCaptureTimeline(timeline)) return;') >= 0,
      `${name} callback must reject frames from a stopped or superseded capture generation`
    );
  }
  const stopBlock = audioSource.split('export async function stopCapture', 2)[1];
  assert.ok(stopBlock.indexOf('isActivelyCapturing = false') < stopBlock.indexOf('captureTimeline = null'));
});

test('language changes stop physical capture through the canonical lifecycle', () => {
  assert.match(overlayEntrySource, /captureApi\?\.beginStop\?\.\(\)/);
  assert.match(overlayEntrySource, /await stopCapture\(activeHandle\)/);
  assert.match(overlayEntrySource, /captureApi\?\.confirmStopped\?\.\(stopGeneration\)/);
  assert.match(overlayEntrySource, /captureApi\?\.complete\?\.\(stopGeneration\)/);
  assert.match(overlayEntrySource, /captureApi\?\.reconcileNoCapture\?\.\('language_changed'\)/);

  const normalStop = overlayEntrySource.split('// Stop capture', 2)[1];
  assert.ok(normalStop, 'normal stop branch must remain present');
  assert.ok(
    normalStop.indexOf('await stopCapture(activeHandle)') <
      normalStop.indexOf('captureHandleRef.current = null'),
    'the renderer must retain its physical capture handle until shutdown completes',
  );
});

test('capture shutdown cleans resources before optional debug export', () => {
  const stopBlock = audioSource.split('export async function stopCapture', 2)[1];
  assert.ok(stopBlock, 'capture shutdown should exist');
  assert.ok(
    stopBlock.indexOf("closeWebSocketInstance(chatId, 'mic')") <
      stopBlock.indexOf("saveDebugAudio('mic'"),
    'mic socket must close before diagnostic files are written'
  );
  assert.ok(
    stopBlock.indexOf('eviaApi.systemAudio?.stop()') <
      stopBlock.indexOf("saveDebugAudio('system'"),
    'native helper must stop before diagnostic files are written'
  );
});

test('WebSocket startup resolves only after the transcription provider is ready', () => {
  assert.match(wsSource, /Transport open; waiting for Deepgram readiness/);
  assert.match(wsSource, /statusData\?\.dg_open === true/);
  assert.match(wsSource, /WebSocket closed before provider ready/);
  assert.match(wsSource, /payload\?\.type === 'error' && !providerReadyEver && !settled/);
  assert.match(wsSource, /this\.ws\?\.readyState !== WebSocket\.OPEN \|\| !this\.isConnectedFlag/);
  assert.match(wsSource, /this\.isConnectedFlag &&\s*this\.queue\.length > 0/);
  assert.match(wsSource, /private connectPromise: Promise<void> \| null = null/);
});

test('a provider-readiness timeout does not invalidate a chat', () => {
  assert.match(wsSource, /socket\.close\(1000, 'Provider ready timeout'\)/);
  assert.doesNotMatch(wsSource, /socket\.close\(4000, 'Provider ready timeout'\)/);
});

test('metadata-paired capture explicitly negotiates strict protocol v1', () => {
  assert.match(wsSource, /sample_rate=24000&capture_protocol=1/);
});

test('held movement accelerates continuously and eases out on release', () => {
  assert.match(overlayWindowsSource, /function signalHeaderMovement/);
  assert.match(overlayWindowsSource, /function startContinuousHeaderMovement/);
  assert.match(overlayWindowsSource, /function animateContinuousHeaderRelease/);
  assert.match(overlayWindowsSource, /function cancelContinuousHeaderRelease/);
  assert.match(overlayWindowsSource, /isMacPhysicalKeyPressed\(heldMovementKeyCode\)/);
  assert.match(overlayWindowsSource, /physicalKeyPressed === false/);
  assert.match(overlayWindowsSource, /stopContinuousHeaderMovement\(true, true\)/);
  assert.match(overlayWindowsSource, /velocityX \* durationSeconds \/ 3/);
  assert.match(overlayWindowsSource, /1 - Math\.pow\(1 - progress, 3\)/);
  assert.match(overlayWindowsSource, /heldHeaderRelease/);
  assert.match(overlayWindowsSource, /HELD_MOVEMENT_INITIAL_PX_PER_SECOND = 800/);
  assert.match(overlayWindowsSource, /HELD_MOVEMENT_MAX_PX_PER_SECOND = 1800/);
  assert.match(overlayWindowsSource, /HELD_MOVEMENT_RAMP_MS = 1200/);
  assert.match(nativeGlassSource, /CGEventSourceKeyState/);
  assert.match(nativeGlassSource, /exports\.Set\("isKeyPressed"/);
  assert.match(overlayWindowsSource, /const clamped = clampBounds\(requested\)/);
  assert.match(overlayWindowsSource, /if \(atEdge\)/);
  assert.match(
    overlayWindowsSource,
    /signalHeaderMovement\('left', -step, 0, MAC_ARROW_KEY_CODES\.left\)/,
  );
  assert.match(
    overlayWindowsSource,
    /signalHeaderMovement\('right', step, 0, MAC_ARROW_KEY_CODES\.right\)/,
  );
});

test('Done never waits for backend archival before closing the local session', () => {
  const reviewBlock = barSource.split("current.state === 'review'", 2)[1];
  assert.ok(reviewBlock, 'review transition should exist');
  assert.match(reviewBlock, /const chatIdToArchive = localStorage\.getItem\('current_chat_id'\)/);
  assert.match(reviewBlock, /void archiveSession\(chatIdToArchive\);/);
  assert.ok(
    reviewBlock.indexOf('void archiveSession(chatIdToArchive);') <
      reviewBlock.indexOf('await captureApi.complete'),
    'backend archival must be dispatched before immediate local completion'
  );
});

test('partial transcript rendering and model context use the same bleed-filtered projection', () => {
  assert.match(listenSource, /const transition = applyRealtimeTranscriptEvent\(/);
  assert.match(listenSource, /const canonicalProjection = useMemo\([\s\S]*projectRealtimeTranscriptState\(canonicalTranscriptState\)/);
  assert.match(listenSource, /canonicalProjection\.visibleRows\.map/);
  assert.match(listenSource, /const filteredTranscriptContext = useMemo/);
  assert.match(listenSource, /transcriptContext: filteredTranscriptContext/);
});

test('late provider interims are rejected before transcript state changes', () => {
  const reducerSource = read('src/main/realtime-transcript-state.ts');
  assert.match(reducerSource, /if \(existing\.isFinal\) \{\s*return \{ state, accepted: false, reason: 'finalized-row' \}/);
  assert.match(reducerSource, /if \(event\.seq <= existing\.seq\) \{\s*return \{ state, accepted: false, reason: 'stale-seq' \}/);
  assert.match(listenSource, /if \(!transition\.accepted\) \{[\s\S]*return;/);
});

test('during-call Ask prefers live context before database history', () => {
  const contextBlock = askSource.split('// GLASS PARITY: Fetch transcript context for backend', 2)[1];
  assert.ok(contextBlock.indexOf("currentSessionState === 'during'") < contextBlock.indexOf('getChatTranscripts(chatId'));
});

test('one canonical chat owns capture reconnects, Ask, live context, and Insights', () => {
  assert.match(wsSource, /const sharedState = shared\?\.data \?\? shared/);
  assert.match(wsSource, /Replacing divergent local chat/);

  const socketConnect = wsSource
    .split('async connect(attempt: number = 1): Promise<void> {', 2)[1]
    .split('sendAudioChunk(', 1)[0];
  assert.match(socketConnect, /const chatId = this\.chatId\.trim\(\)/);
  assert.doesNotMatch(socketConnect, /getOrCreateChatId\(/);
  assert.doesNotMatch(socketConnect, /localStorage\.removeItem\('current_chat_id'\)/);

  const askStart = askSource
    .split('const startStream = async', 2)[1]
    .split('// GLASS PARITY: Fetch transcript context for backend', 1)[0];
  assert.match(askStart, /chatIdOverrideRef\.current/);
  assert.match(askStart, /getOrCreateChatId\(baseUrl\.replace/);
  assert.doesNotMatch(askStart, /fetch\(`\$\{baseUrl\.replace\([^\n]+\/chat\//);

  assert.match(
    listenSource,
    /Number\(canonicalTranscriptState\.chatId \?\? lastKnownChatIdRef\.current \?\? '0'\)/,
  );
  assert.match(
    listenSource,
    /chatId: canonicalTranscriptStateRef\.current\.chatId \?\? lastKnownChatIdRef\.current/,
  );
  assert.match(listenSource, /transcriptContext: filteredTranscriptContext/);
  assert.match(
    listenSource,
    /canonicalTranscriptStateRef\.current\.chatId \?\? lastKnownChatIdRef\.current \?\? '0'/,
  );
});

test('stub insights are rejected and live refreshes replace atomically', () => {
  assert.match(listenSource, /if \(isStubInsightPayload\(fetchedInsights\)\)/);
  assert.match(listenSource, /const receivedStub = isStubInsightPayload\(fetchedInsights\)/);
  assert.match(listenSource, /derivedSessionState !== 'after' && !liveProspectSpeechAvailable/);
  assert.match(listenSource, /const showBlockingLoader = latestSessionState === 'after'/);
  assert.match(listenSource, /sessionState === 'during' \? \(/);
  assert.match(listenSource, /Grounded prospect speech arrived - refreshing visible insights/);
  assert.doesNotMatch(listenSource, /Refreshing insights\.\.\./);
  assert.doesNotMatch(listenSource, /Waiting for fresher transcript data\.\.\./);
  assert.doesNotMatch(listenSource, /derivedSessionState !== 'after' && isStubInsightPayload/);
  assert.doesNotMatch(listenSource, /Post-meeting insights accepted without stub rejection/);
});

test('Ask requests carry an end-to-end request trace', () => {
  assert.match(askSource, /requestId = crypto\.randomUUID\(\)/);
  assert.match(streamSource, /request_id: requestId/);
  assert.match(streamSource, /client_started_at_ms: clientStartedAtMs/);
  assert.match(streamSource, /route\?\.type === 'request_trace'/);
});

test('Ask language is explicit and capture startup cannot erase visible content', () => {
  assert.match(streamSource, /const payload: any = \{[\s\S]*language,/);
  const clearHandler = askSource.split('const handleClearSession = () => {', 2)[1]
    .split('// SESSION STATE:', 1)[0];
  assert.doesNotMatch(clearHandler, /setResponse\(''\)/);

  const stateHandler = askSource.split('const handleSessionStateChanged =', 2)[1]
    .split('// FIX: Clear state on language change', 1)[0];
  assert.doesNotMatch(stateHandler, /setResponse\(''\)/);
  assert.match(askSource, /const handleSessionClosed = \(\) => \{[\s\S]*setResponse\(''\)/);
});

test('audio activity uses content-free control messages with a silence tail', () => {
  assert.match(wsSource, /command: 'audio_activity'/);
  assert.match(wsSource, /const HANGOVER_MS = 500/);
  assert.match(wsSource, /this\.silentDurationMs \+= chunkDurationMs/);
  assert.match(wsSource, /this\.sendAudioActivity\(false, true\)/);
});

test('bound preset context status reaches the normal Listen window', () => {
  const forwardedContextStatusMatches = audioSource.match(/msg\.type === 'context_status'/g) || [];
  assert.equal(forwardedContextStatusMatches.length, 2, 'mic and system sockets must forward context status');
  assert.match(listenSource, /if \(msg\.type === 'context_status'\)/);
  assert.match(listenSource, /setPresetContextWarning\(!contextAvailable\)/);
  assert.match(listenSource, /presetContextUnavailable/);
});

test('development builds reach production services through the dev-only HTTP proxy', () => {
  assert.match(rendererConfigSource, /VITE_SERVICE_TARGET \|\| 'production'/);
  assert.match(rendererConfigSource, /SERVICE_TARGET === 'local'/);
  assert.match(rendererConfigSource, /http:\/\/localhost:5174\/__taylos_api/);
  assert.match(rendererConfigSource, /IS_PRODUCTION[\s\S]*https:\/\/api\.taylos\.ai/);
  assert.match(rendererConfigSource, /https:\/\/api\.taylos\.ai/);
  assert.match(rendererConfigSource, /wss:\/\/backend-rt\.livelydesert-1db1c46d\.westeurope\.azurecontainerapps\.io/);
  assert.match(mainSource, /TAYLOS_SERVICE_TARGET \|\| ''/);
  assert.match(subscriptionSource, /TAYLOS_SERVICE_TARGET \|\| ''/);
});

test('child-window DevTools require explicit opt-in', () => {
  assert.match(overlayWindowsSource, /TAYLOS_OPEN_DEVTOOLS === '1'/);
});

test('settings restores the compact placement relative to the live bar right edge', () => {
  assert.match(overlayWindowsSource, /const SETTINGS_LEFT_FROM_BAR_RIGHT = 70/);
  assert.match(overlayWindowsSource, /requestedX = hb\.x \+ hb\.width - SETTINGS_LEFT_FROM_BAR_RIGHT/);
  assert.match(overlayWindowsSource, /requestedY = hb\.y \+ hb\.height \+ 5/);
  assert.doesNotMatch(overlayWindowsSource, /headerSettingsAnchorOffset/);
});

test('desktop presets use the authenticated main-process bridge', () => {
  assert.match(mainSource, /ipcMain\.handle\('presets:list'/);
  assert.match(mainSource, /ipcMain\.handle\('presets:activate'/);
  assert.match(preloadSource, /list: \(\) => ipcRenderer\.invoke\('presets:list'\)/);
  assert.match(preloadSource, /activate: \(presetId: number \| string\) => ipcRenderer\.invoke\('presets:activate', presetId\)/);
  assert.match(settingsSource, /evia\?\.presets/);
  assert.doesNotMatch(settingsSource, /fetch\(`\$\{BACKEND_URL\}\/prompts/);
  assert.match(mainSource, /method: 'PUT'/);
  assert.match(mainSource, /JSON\.stringify\(\{ is_active: true \}\)/);
  assert.match(mainSource, /compatibility_mode: 'legacy_put'/);
});

test('the bar retains an explicit bottom drag strip without making controls draggable', () => {
  assert.match(barSource, /evia-bar-bottom-drag-region/);
  assert.match(barSource, /handleBottomDragPointerDown/);
  assert.match(barSource, /moveHeaderTo/);
  assert.match(overlayGlassSource, /\.evia-bar-bottom-drag-region[\s\S]*-webkit-app-region:\s*no-drag/);
  assert.match(overlayGlassSource, /\.evia-bar-bottom-drag-region[\s\S]*height:\s*10px/);
  assert.match(overlayGlassSource, /\.evia-bar-bottom-drag-region[\s\S]*cursor:\s*default/);
  assert.match(overlayGlassSource, /\.evia-main-header button,[\s\S]*-webkit-app-region:\s*no-drag/);
});

test('native Bar, Ask, and Insights share one dark live glass plane', () => {
  assert.match(liquidGlassSource, /--taylos-glass-live-plane-native:/);
  const livePlaneUses = liquidGlassSource.match(/background:\s*var\(--taylos-glass-live-plane-native\)/g) || [];
  assert.ok(livePlaneUses.length >= 2, 'native overlay and reading surfaces must share the live plane');
  assert.match(liquidGlassSource, /data-material='native'\]\[data-surface='overlay'\] \.evia-main-header/);
  assert.match(liquidGlassSource, /data-material='native'\] :is\(\.assistant-container, \.ask-container\)/);
});

test('AppKit owns the native optical rim and renderer focus halos stay disabled', () => {
  assert.match(liquidGlassSource, /data-surface='content'\][\s\S]*::after,[\s\S]*opacity:\s*0 !important/);
  assert.match(liquidGlassSource, /:focus-visible[\s\S]*outline:\s*none !important/);
  assert.doesNotMatch(
    overlayGlassSource,
    /box-shadow:\s*0 0 0 1px rgba\(255,255,255,0\.25\)/
  );
  assert.doesNotMatch(
    overlayGlassSource,
    /outline:\s*2px solid rgba\(59, 130, 246, 0\.8\)/
  );
});

test('Listen and Done retain component glass depth when focused', () => {
  assert.match(
    liquidGlassSource,
    /\.evia-listen-button:is\(:focus, :focus-visible, :focus-within\)[\s\S]*inset 0 1px 0\.5px[\s\S]*!important/,
  );
  assert.match(
    liquidGlassSource,
    /\.evia-listen-button\.listen-done:is\(:focus, :focus-visible, :focus-within\)[\s\S]*inset 0 1px 0[\s\S]*!important/,
  );
  assert.match(overlayGlassSource, /\.evia-listen-button \{[\s\S]*background: transparent/);
  assert.match(
    overlayGlassSource,
    /\.evia-listen-button::before \{[\s\S]*background: rgba\(255, 255, 255, 0\.14\)/,
  );
  assert.match(
    overlayGlassSource,
    /\.evia-listen-button:not\(\.listen-active\):not\(\.listen-done\):hover::before \{[\s\S]*background: rgba\(255, 255, 255, 0\.18\)/,
  );
  assert.match(overlayGlassSource, /\.evia-listen-button\.listen-done \{[\s\S]*background: linear-gradient\(180deg, rgb\(248, 248, 248\)/);
});

test('selected language keeps blue center, brighter frame, and hover glow', () => {
  assert.match(overlayGlassSource, /\.language-button\.active \{[\s\S]*background: rgb\(0, 91, 191\) !important[\s\S]*border-color: rgb\(42, 139, 255\) !important/);
  assert.match(overlayGlassSource, /\.language-button\.active:hover,[\s\S]*background: rgb\(0, 112, 224\) !important[\s\S]*border-color: rgb\(83, 164, 255\) !important[\s\S]*0 0 10px/);

  const genericHoverBlock = liquidGlassSource.match(/:is\([\s\S]*?\):hover \{\n  background-color: var\(--taylos-glass-control-hover\) !important;/)?.[0] || '';
  assert.doesNotMatch(genericHoverBlock, /\.language-button/);
});

test('read-mode markdown normalizes standalone section titles', () => {
  assert.match(askSource, /bold section title to the preceding takeaway/);
  assert.match(askSource, /\(\\\*\\\*\[\^\*\\n\]\{2,80\}\\\*\\\*\)/);
});

test('Ask history stores each response with its request-local question', () => {
  assert.match(askSource, /onSubmitPrompt\(actualPrompt\)/);
  assert.match(
    askSource,
    /setResponseHistory\(\(prev\) => \{[\s\S]*question: actualPrompt, response: finalResponse/,
  );
  assert.doesNotMatch(askSource, /questionSnapshot = currentQuestion/);
  assert.match(
    askSource,
    /handleShortcutPreviousResponse[\s\S]*setResponse\(entry\.response\)[\s\S]*setCurrentQuestion\(entry\.question\)/,
  );
  assert.match(
    askSource,
    /handleShortcutNextResponse[\s\S]*setResponse\(entry\.response\)[\s\S]*setCurrentQuestion\(entry\.question\)/,
  );
});

test('Ask renders its complete thinking state before asynchronous context work', () => {
  const startBlock = askSource.split('const startStream = async', 2)[1];
  const firstAwait = startBlock.indexOf('await ');
  for (const marker of [
    'setCurrentQuestion(actualPrompt)',
    'setResponse(\'\')',
    'setIsStreaming(true)',
    'setIsLoadingFirstToken(true)',
    'requestWindowResize(thinkingHeight)',
  ]) {
    const markerIndex = startBlock.indexOf(marker);
    assert.ok(markerIndex >= 0 && markerIndex < firstAwait, `${marker} must run before the first await`);
  }
  assert.match(askSource, /const hasResponse = Boolean\(response\) \|\| isLoadingFirstToken/);
  assert.match(askSource, /const resetPendingRequest = \(\) => \{[\s\S]*setIsStreaming\(false\)[\s\S]*requestWindowResize\(MIN_ASK_BAR_HEIGHT\)/);
});

test('visible live insights refresh after the first grounded prospect line', () => {
  assert.match(listenSource, /liveInsightsRefreshTimerRef/);
  assert.match(listenSource, /hasGroundedProspectSpeech\(transcripts\)/);
  assert.match(listenSource, /canonicalTranscriptState\.prospectRevision <= lastInsightsProspectRevisionRef\.current/);
  assert.match(listenSource, /void fetchInsightsNowRef\.current\(\)/);
});
