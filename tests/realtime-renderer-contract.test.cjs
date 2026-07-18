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
const systemAudioHelper = fs.readFileSync(path.join(ROOT, 'src/main/assets/SystemAudioDump'));

test('macOS watchdog waits for a real first system-audio chunk', () => {
  assert.match(audioSource, /macSystemCaptureStartedAt/);
  assert.match(audioSource, /no-first-audio-chunk/);
  assert.match(audioSource, /pipelineMetrics\.lastSystemChunkTime = 0/);
});

test('macOS capture becomes ready only after ScreenCaptureKit confirms startup', () => {
  assert.match(macAudioSource, /CAPTURE_READY_MARKER = 'Capturing system audio'/);
  assert.match(macAudioSource, /const readyInMs = await captureReadyPromise/);
  assert.match(macAudioSource, /capture readiness timed out/);
});

test('bundled macOS helper exposes the readiness contract consumed by Electron', () => {
  assert.ok(
    systemAudioHelper.includes(Buffer.from('Capturing system audio')),
    'SystemAudioDump must contain the post-startCapture readiness marker'
  );
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

test('capture sockets and native macOS capture start in parallel', () => {
  const startBlock = audioSource.split('export async function startCapture', 2)[1];
  assert.ok(startBlock, 'capture startup should exist');
  assert.match(startBlock, /const socketConnectionsPromise = connectCaptureWebSockets\(includeSystemAudio\)/);
  assert.match(startBlock, /const macSystemCapturePromise = includeSystemAudio && isMac/);
  assert.match(startBlock, /await Promise\.all\(\[socketConnectionsPromise, macSystemCapturePromise\]\)/);
});

test('late audio callbacks cannot recreate sockets after capture stops', () => {
  const macBlock = audioSource.split('eviaApi.systemAudio.onData', 2)[1];
  const micBlock = audioSource.split('micProcessor.onaudioprocess =', 2)[1];
  const systemBlock = audioSource.split('sysProcessor.onaudioprocess =', 2)[1];

  for (const [name, block, socketFactory] of [
    ['macOS native', macBlock, 'ensureSystemWs'],
    ['microphone', micBlock, 'ensureMicWs'],
    ['system stream', systemBlock, 'ensureSystemWs'],
  ]) {
    assert.ok(block, `${name} callback should exist`);
    assert.ok(
      block.indexOf('if (!isActivelyCapturing) return;') >= 0 &&
        block.indexOf('if (!isActivelyCapturing) return;') < block.indexOf(socketFactory),
      `${name} callback must reject late frames before creating a socket`
    );
  }
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

test('capture reconciliation tears down renderer and native capture before idle', () => {
  const forceStopBlock = mainSource
    .split('async function stopPhysicalCapture', 2)[1]
    .split('async function reconcileNoPhysicalCapture', 1)[0];
  const reconcileBlock = mainSource
    .split('async function reconcileNoPhysicalCapture', 2)[1]
    .split('captureSessionController.subscribe', 1)[0];

  assert.ok(forceStopBlock, 'main process physical capture shutdown must exist');
  assert.match(mainSource, /webContents\.send\('capture-session:force-stop'/);
  assert.match(forceStopBlock, /requestHeaderCaptureStop\(reason, snapshot\.generation\)/);
  assert.match(forceStopBlock, /systemAudioMacService\.stop\(\)/);
  assert.match(forceStopBlock, /systemAudioWindowsService\.stop\(\)/);
  assert.ok(reconcileBlock, 'physical shutdown must wrap lifecycle reconciliation');
  assert.ok(
    reconcileBlock.indexOf('await stopPhysicalCapture(reason)') <
      reconcileBlock.indexOf('captureSessionController.reconcileNoCapture(reason)'),
    'capture resources must stop before idle is published',
  );
  assert.match(mainSource, /await stopPhysicalCapture\('logout'\)/);
  assert.match(mainSource, /ipcMain\.handle\('capture-session:force-stop-complete'/);
  assert.match(preloadSource, /completeForceStop: \(requestId: string\)/);

  const rendererForceStopBlock = overlayEntrySource
    .split("eviaIpc.on('capture-session:force-stop'", 1)[0]
    .split('const handleForceStop =', 2)[1];
  assert.ok(rendererForceStopBlock, 'header renderer must handle forced capture shutdown');
  assert.match(rendererForceStopBlock, /await stopCapture\(captureHandleRef\.current \?\? undefined\)/);
  assert.match(rendererForceStopBlock, /captureHandleRef\.current = null/);
  assert.match(rendererForceStopBlock, /completeForceStop\?\.\(request\.requestId\)/);
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

test('a WebSocket policy close before open rejects the active connection attempt', () => {
  assert.match(wsSource, /if \(!opened\) \{/);
  assert.match(wsSource, /WebSocket closed before open/);
  assert.match(wsSource, /private connectPromise: Promise<void> \| null = null/);
});

test('a client connection timeout does not invalidate a chat', () => {
  assert.match(wsSource, /socket\.close\(1000, 'Connect timeout'\)/);
  assert.doesNotMatch(wsSource, /socket\.close\(4000, 'Connect timeout'\)/);
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

test('partial transcript rendering follows the audio cadence', () => {
  assert.match(listenSource, /PARTIAL_THROTTLE_MS = 100/);
});

test('during-call Ask prefers live context before database history', () => {
  const contextBlock = askSource.split('// GLASS PARITY: Fetch transcript context for backend', 2)[1];
  assert.ok(contextBlock.indexOf("currentSessionState === 'during'") < contextBlock.indexOf('getChatTranscripts(chatId'));
});

test('stub insights are rejected in every lifecycle state', () => {
  assert.match(listenSource, /if \(isStubInsightPayload\(fetchedInsights\)\)/);
  assert.doesNotMatch(listenSource, /derivedSessionState !== 'after' && isStubInsightPayload/);
  assert.doesNotMatch(listenSource, /Post-meeting insights accepted without stub rejection/);
});

test('Ask requests carry an end-to-end request trace', () => {
  assert.match(askSource, /requestId = crypto\.randomUUID\(\)/);
  assert.match(streamSource, /request_id: requestId/);
  assert.match(streamSource, /client_started_at_ms: clientStartedAtMs/);
  assert.match(streamSource, /route\?\.type === 'request_trace'/);
});

test('audio activity uses content-free control messages with a silence tail', () => {
  assert.match(wsSource, /command: 'audio_activity'/);
  assert.match(wsSource, /HANGOVER_SILENT_CHUNKS = 5/);
  assert.match(wsSource, /this\.sendAudioActivity\(false, true\)/);
});

test('bound preset context status reaches the normal Listen window', () => {
  const forwardedContextStatusMatches = audioSource.match(/msg\.type === 'context_status'/g) || [];
  assert.equal(forwardedContextStatusMatches.length, 2, 'mic and system sockets must forward context status');
  assert.match(listenSource, /if \(msg\.type === 'context_status'\)/);
  assert.match(listenSource, /setPresetContextWarning\(!contextAvailable\)/);
  assert.match(listenSource, /presetContextUnavailable/);
});

test('development builds use production services unless local mode is explicit', () => {
  assert.match(rendererConfigSource, /VITE_SERVICE_TARGET \|\| 'production'/);
  assert.match(rendererConfigSource, /SERVICE_TARGET === 'local'/);
  assert.match(rendererConfigSource, /https:\/\/api\.taylos\.ai/);
  assert.match(rendererConfigSource, /wss:\/\/backend-rt\.livelydesert-1db1c46d\.westeurope\.azurecontainerapps\.io/);
  assert.match(mainSource, /TAYLOS_SERVICE_TARGET \|\| ''/);
  assert.match(subscriptionSource, /TAYLOS_SERVICE_TARGET \|\| ''/);
});

test('child-window DevTools require explicit opt-in', () => {
  assert.match(overlayWindowsSource, /TAYLOS_OPEN_DEVTOOLS === '1'/);
});

test('settings follows the live three-dot right edge', () => {
  assert.match(overlayWindowsSource, /headerSettingsAnchorOffset/);
  assert.match(overlayWindowsSource, /const SETTINGS_POPOVER_RIGHT_NUDGE = 22/);
  assert.match(overlayWindowsSource, /positionPopoverFromRightAnchor/);
  assert.match(overlayWindowsSource, /settingsAnchorRight = hb\.x \+ anchorOffset \+ SETTINGS_POPOVER_RIGHT_NUDGE/);
});

test('desktop presets use the authenticated main-process bridge', () => {
  assert.match(mainSource, /ipcMain\.handle\('presets:list'/);
  assert.match(mainSource, /ipcMain\.handle\('presets:activate'/);
  assert.match(preloadSource, /list: \(\) => ipcRenderer\.invoke\('presets:list'\)/);
  assert.match(preloadSource, /activate: \(presetId: number \| string\) => ipcRenderer\.invoke\('presets:activate', presetId\)/);
  assert.match(settingsSource, /evia\?\.presets/);
  assert.doesNotMatch(settingsSource, /fetch\(`\$\{BACKEND_URL\}\/prompts/);
});

test('the bar retains a bottom native drag strip without making controls draggable', () => {
  assert.match(barSource, /evia-bar-bottom-drag-region/);
  assert.match(overlayGlassSource, /\.evia-bar-bottom-drag-region[\s\S]*-webkit-app-region:\s*drag/);
  assert.match(overlayGlassSource, /\.evia-bar-bottom-drag-region[\s\S]*height:\s*10px/);
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
