# 🎤 Glass SystemAudioDump - Complete Implementation Guide

## 📋 Executive Summary

**Decision:** Electron 38 upgrade did NOT solve system audio capture issue. Proceeding with **Glass's proven SystemAudioDump binary approach**.

**Time Spent on Electron Upgrade:** ~10 minutes  
**Result:** Same `Failed to get sources` error persists in dev mode  
**Root Cause:** macOS ties screen recording permission to parent process (Cursor) in dev mode, regardless of Electron version

---

## 🏗️ Glass Architecture Overview

### Component Diagram
```
┌─────────────────────────────────────────────────────────────┐
│                      ELECTRON MAIN PROCESS                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ listenService.js                                      │  │
│  │  └─ sttService.js                                     │  │
│  │      └─ startMacOSAudioCapture()                      │  │
│  │          ├─ killExistingSystemAudioDump()             │   │
│  │          ├─ spawn('SystemAudioDump')                  │   │
│  │          └─ proc.stdout.on('data')                    │   │
│  │              ├─ Buffer audio chunks (4800 bytes)      │   │
│  │              ├─ Convert stereo → mono                 │   │
│  │              ├─ Base64 encode                         │   │
│  │              ├─ Send to renderer ('system-audio-data')│   │
│  │              └─ Send to WebSocket (Deepgram/Gemini)   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ featureBridge.js (IPC Handlers)                       │   │
│  │  ├─ listen:startMacosSystemAudio                      │   │
│  │  ├─ listen:stopMacosSystemAudio                       │   │
│  │  └─ listen:sendSystemAudio                            │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└───────────────────────┬───────────────────────────────────────┘
                        │ IPC
                        │
┌───────────────────────┴───────────────────────────────────────┐
│                     RENDERER PROCESS                          │
├───────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ listenCapture.js                                        │  │
│  │  └─ startCapture()                                      │  │
│  │      └─ (macOS branch)                                  │  │
│  │          ├─ window.api.listenCapture.startMacosSystemAudio()│
│  │          ├─ setupMicProcessing(micStream)              │  │
│  │          └─ window.api.listenCapture.onSystemAudioData()│  │
│  │              └─ Store in systemAudioBuffer for AEC     │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ preload.js (contextBridge)                              │  │
│  │  window.api.listenCapture = {                           │  │
│  │    startMacosSystemAudio: () => ipcRenderer.invoke(...) │  │
│  │    stopMacosSystemAudio: () => ipcRenderer.invoke(...)  │  │
│  │    onSystemAudioData: (cb) => ipcRenderer.on(...)       │  │
│  │  }                                                       │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘

            ┌──────────────────────────────────────────┐
            │  SystemAudioDump (Mach-O Binary)         │
            │  - Standalone process                     │
            │  - ScreenCaptureKit API (native macOS)    │
            │  - Outputs stereo PCM to stdout           │
            │  - Format: 24kHz, 2 channels, int16       │
            │  - Chunk size: 4800 bytes (0.1s)          │
            └──────────────────────────────────────────┘
```

---

## 📦 Required Components

### 1. **SystemAudioDump Binary** ✅ (Already Exists)
- **Location (Glass):** `glass/src/ui/assets/SystemAudioDump`
- **Type:** Mach-O universal binary (x86_64 + arm64)
- **Size:** 226KB
- **Signed:** Yes, with screen recording entitlements
- **Output Format:** Stereo PCM, 24kHz, 2 bytes/sample, 2 channels
- **Chunk Duration:** 0.1 seconds = 4800 bytes

**Verification:**
```bash
$ file glass/src/ui/assets/SystemAudioDump
# Result: Mach-O universal binary with 2 architectures: [x86_64] [arm64]

$ codesign -d --entitlements :- glass/src/ui/assets/SystemAudioDump
# Result: Contains com.apple.security.personal-information.screen-recording
```

**Action Required:** ✅ Copy this binary to EVIA-Desktop

### 2. **Main Process: Process Manager** (sttService.js)

**Key Functions:**

#### `killExistingSystemAudioDump()`
```javascript
killExistingSystemAudioDump() {
    return new Promise(resolve => {
        const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
            stdio: 'ignore',
        });
        
        killProc.on('close', code => {
            console.log(code === 0 ? 'Killed existing processes' : 'No existing processes found');
            resolve();
        });
        
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}
```

#### `startMacOSAudioCapture()`
```javascript
async startMacOSAudioCapture() {
    // 1. Kill any existing process
    await this.killExistingSystemAudioDump();
    
    // 2. Check/request screen recording permission
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    if (screenStatus !== 'granted') {
        // Request permission (may not work on Sonoma+, manual grant needed)
        await systemPreferences.askForMediaAccess('screen');
    }
    
    // 3. Resolve binary path
    const systemAudioPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'ui', 'assets', 'SystemAudioDump')
        : path.join(app.getAppPath(), 'src', 'ui', 'assets', 'SystemAudioDump');
    
    // 4. Spawn the binary
    this.systemAudioProc = spawn(systemAudioPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    // 5. Process audio from stdout
    const CHUNK_SIZE = 4800; // 24000 Hz * 2 bytes * 2 channels * 0.1s
    let audioBuffer = Buffer.alloc(0);
    
    this.systemAudioProc.stdout.on('data', async data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);
        
        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);
            
            // Convert stereo to mono
            const monoChunk = this.convertStereoToMono(chunk);
            const base64Data = monoChunk.toString('base64');
            
            // Send to renderer for AEC
            this.sendToRenderer('system-audio-data', { data: base64Data });
            
            // Send to STT provider (Deepgram/Gemini)
            if (this.theirSttSession) {
                const payload = Buffer.from(base64Data, 'base64');
                await this.theirSttSession.sendRealtimeInput(payload);
            }
        }
    });
    
    // 6. Error handling
    this.systemAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });
    
    this.systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        this.systemAudioProc = null;
    });
    
    return true;
}
```

#### `convertStereoToMono()`
```javascript
convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4; // 2 bytes per sample * 2 channels
    const monoBuffer = Buffer.alloc(samples * 2); // 2 bytes per sample
    
    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4); // Read left channel
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }
    
    return monoBuffer;
}
```

**Action Required:** ✅ Adapt this code to EVIA's architecture

### 3. **IPC Handlers** (featureBridge.js)

**Glass Implementation:**
```javascript
// In featureBridge.js initialize()
ipcMain.handle('listen:startMacosSystemAudio', async () => 
    await listenService.handleStartMacosAudio()
);

ipcMain.handle('listen:stopMacosSystemAudio', async () => 
    await listenService.handleStopMacosAudio()
);

ipcMain.handle('listen:sendSystemAudio', async (event, { data, mimeType }) => {
    const result = await listenService.sttService.sendSystemAudioContent(data, mimeType);
    if (result.success) {
        listenService.sendToRenderer('system-audio-data', { data });
    }
    return result;
});
```

**Action Required:** ✅ Add these IPC handlers to EVIA's main process

### 4. **Preload Script** (contextBridge)

**Glass Implementation:**
```javascript
// In preload.js
contextBridge.exposeInMainWorld('api', {
    listenCapture: {
        startMacosSystemAudio: () => ipcRenderer.invoke('listen:startMacosSystemAudio'),
        stopMacosSystemAudio: () => ipcRenderer.invoke('listen:stopMacosSystemAudio'),
        sendSystemAudioContent: (data) => ipcRenderer.invoke('listen:sendSystemAudio', data),
        
        // Listener for system audio data (for AEC)
        onSystemAudioData: (callback) => ipcRenderer.on('system-audio-data', callback),
        removeOnSystemAudioData: (callback) => ipcRenderer.removeListener('system-audio-data', callback)
    }
});
```

**Action Required:** ✅ Add to EVIA's preload.ts

### 5. **Renderer Integration** (listenCapture.js)

**Glass Implementation:**
```javascript
async function startCapture() {
    if (isMacOS) {
        // Start macOS audio capture via binary
        const audioResult = await window.api.listenCapture.startMacosSystemAudio();
        if (!audioResult.success) {
            console.warn('[listenCapture] macOS audio start failed:', audioResult.error);
            
            // Retry if already running
            if (audioResult.error === 'already_running') {
                await window.api.listenCapture.stopMacosSystemAudio();
                await new Promise(r => setTimeout(r, 500));
                const retry = await window.api.listenCapture.startMacosSystemAudio();
                if (!retry.success) {
                    throw new Error('Retry failed: ' + retry.error);
                }
            }
        }
        
        // Setup microphone capture (separate from system audio)
        micMediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 24000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            }
        });
        
        const { context, processor } = await setupMicProcessing(micMediaStream);
        audioContext = context;
        audioProcessor = processor;
        
        // Listen for system audio data (for AEC reference)
        window.api.listenCapture.onSystemAudioData((event, { data }) => {
            systemAudioBuffer.push({ data, timestamp: Date.now() });
            // Keep only last 10 chunks for AEC
            if (systemAudioBuffer.length > 10) {
                systemAudioBuffer.shift();
            }
        });
    }
}
```

**Action Required:** ✅ Integrate into EVIA's audio-processor-glass-parity.ts

### 6. **electron-builder Configuration**

**Glass Implementation:**
```yaml
# electron-builder.yml
asarUnpack:
    - "src/ui/assets/SystemAudioDump"
    - "**/node_modules/sharp/**/*"
    - "**/node_modules/@img/**/*"

mac:
    category: public.app-category.utilities
    hardenedRuntime: true
    entitlements: entitlements.plist
    entitlementsInherit: entitlements.plist
    target:
      - target: dmg
        arch: universal
```

**Action Required:** ✅ Add `asarUnpack` to EVIA's electron-builder.yml

### 7. **Entitlements** (entitlements.plist)

**Glass Implementation:** ✅ Already exists at `EVIA-Desktop/build/entitlements.mac.plist`
```xml
<key>com.apple.security.personal-information.screen-recording</key>
<true/>
<key>com.apple.security.device.audio-input</key>
<true/>
<key>com.apple.security.device.microphone</key>
<true/>
<key>com.apple.security.cs.allow-jit</key>
<true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
<true/>
```

**Action Required:** ✅ Already complete!

---

## 🛠️ Implementation Steps for EVIA

### Step 1: Copy SystemAudioDump Binary
```bash
mkdir -p EVIA-Desktop/src/main/assets
cp glass/src/ui/assets/SystemAudioDump EVIA-Desktop/src/main/assets/
chmod +x EVIA-Desktop/src/main/assets/SystemAudioDump
```

### Step 2: Create Process Manager Service
Create `EVIA-Desktop/src/main/system-audio-service.ts`

### Step 3: Register IPC Handlers
Update `EVIA-Desktop/src/main/main.ts` to register:
- `system-audio:start`
- `system-audio:stop`
- Handle `system-audio-data` forwarding to renderer

### Step 4: Update Preload Bridge
Update `EVIA-Desktop/src/main/preload.ts` to expose:
- `window.evia.systemAudio.start()`
- `window.evia.systemAudio.stop()`
- `window.evia.systemAudio.onData(callback)`

### Step 5: Update Renderer Audio Processor
Update `EVIA-Desktop/src/renderer/audio-processor-glass-parity.ts` to:
- Call `window.evia.systemAudio.start()` on macOS
- Listen for `system-audio-data` events
- Send data to WebSocket

### Step 6: Update electron-builder.yml
Add `asarUnpack` for SystemAudioDump

### Step 7: Dev Mode Permission Fix
Create script to sign Electron dev bundle + SystemAudioDump:
```bash
xattr -dr com.apple.quarantine ./node_modules/electron/dist/Electron.app
chmod +x ./src/main/assets/SystemAudioDump
codesign -s - --entitlements build/entitlements.mac.plist --force ./src/main/assets/SystemAudioDump
codesign -s - --deep --force --entitlements build/entitlements.mac.plist ./node_modules/electron/dist/Electron.app
```

---

## 📊 Audio Data Flow

```
┌────────────────────┐
│ SystemAudioDump    │ (Native ScreenCaptureKit)
│ Binary Process     │
└──────┬─────────────┘
       │ stdout
       │ Stereo PCM
       │ 24kHz, int16
       │ 4800 bytes/chunk
       ▼
┌──────────────────────────────────────┐
│ Main Process (sttService.js)         │
│  ├─ Buffer chunks                    │
│  ├─ Convert stereo → mono            │
│  ├─ Base64 encode                    │
│  ├─ sendToRenderer('system-audio-data') │
│  └─ theirSttSession.sendRealtimeInput()  │
└──────┬────────────────────┬──────────┘
       │                    │
       │ IPC                │ WebSocket
       ▼                    ▼
┌──────────────────┐  ┌─────────────────┐
│ Renderer         │  │ Backend         │
│ (AEC Reference)  │  │ (Deepgram/STT)  │
│ systemAudioBuffer│  │ source=system   │
│                  │  │ speaker=0       │
└──────────────────┘  └─────────────────┘
```

---

## ✅ Advantages of Glass Binary Approach

1. **Bypasses Dev Mode Permission Issue** ✅
   - Binary runs as separate process
   - Gets its own TCC permission (not tied to Cursor)

2. **Proven to Work** ✅
   - Already battle-tested in Glass production
   - Handles macOS TCC correctly

3. **Clean Architecture** ✅
   - Separation of concerns
   - Native API (ScreenCaptureKit) for reliability

4. **Cross-Environment Compatibility** ✅
   - Works in both dev and production
   - No Electron version dependencies

5. **Performance** ✅
   - Direct access to system audio
   - No getDisplayMedia overhead

---

## 🚨 Critical: Permission Handling

### Dev Mode
```bash
# After npm install or Electron version change
xattr -dr com.apple.quarantine ./node_modules/electron/dist/Electron.app
codesign -s - --deep --force --entitlements build/entitlements.mac.plist ./node_modules/electron/dist/Electron.app
codesign -s - --entitlements build/entitlements.mac.plist --force ./src/main/assets/SystemAudioDump

# Add Electron.app to System Settings → Privacy & Security → Screen Recording
# Path: /Users/.../EVIA-Desktop/node_modules/electron/dist/Electron.app
```

### Production Mode
```bash
# electron-builder handles signing with entitlements.plist
# User must grant Screen Recording permission on first run
```

---

## 🔍 Debugging Checklist

- [ ] Binary exists and is executable: `ls -lah src/main/assets/SystemAudioDump`
- [ ] Binary is signed: `codesign -d --entitlements :- src/main/assets/SystemAudioDump`
- [ ] Electron is signed: `codesign -d --entitlements :- node_modules/electron/dist/Electron.app`
- [ ] TCC entry exists: `sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db "SELECT * FROM access WHERE service='kTCCServiceScreenCapture' AND client LIKE '%Electron%';"`
- [ ] Process starts: Check for `SystemAudioDump started with PID: XXX` in logs
- [ ] No immediate exit: Process should not close with code 1
- [ ] Audio flows: Check for `Sent SYSTEM chunk: 4800 bytes` logs
- [ ] Backend receives: Check for `source=system` WebSocket connection
- [ ] UI shows transcripts: Grey bubbles should appear for system audio

---

## 📝 Next Actions

**Shall I proceed with implementing this approach?** 

It will involve:
1. ✅ Copying the SystemAudioDump binary (~2 min)
2. ✅ Creating TypeScript service class (~10 min)
3. ✅ Registering IPC handlers (~5 min)
4. ✅ Updating preload bridge (~5 min)
5. ✅ Integrating renderer code (~10 min)
6. ✅ Testing in dev mode (~10 min)
7. ✅ Testing production build (~10 min)

**Total estimated time: ~1 hour**

**Ready to start?** 🚀

