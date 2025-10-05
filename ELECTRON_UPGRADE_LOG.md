# Electron 30.5.1 → 31.x Upgrade Log

**Timebox:** 30 minutes  
**Start Time:** <!-- Will be filled when we start -->  
**Objective:** Enable system audio capture via Chromium's built-in loopback support

---

## Pre-Upgrade State

**Current Electron Version:** 30.5.1  
**Current Status:**
- ✅ Microphone capture works
- ❌ System audio capture fails (desktopCapturer returns no sources)
- ✅ Timer works
- ✅ Diarization UI ready

**Key Issue:** Electron < 31.0.1 lacks Chromium flags for system audio loopback

---

## Upgrade Plan

### Phase 1: Backup & Prepare (5 min)
- [x] Document current state
- [ ] Backup package.json
- [ ] Backup package-lock.json
- [ ] Check current dependencies

### Phase 2: Upgrade Electron (10 min)
- [ ] Run `npm install electron@latest`
- [ ] Check for breaking changes in Electron 31 changelog
- [ ] Fix any TypeScript/build errors
- [ ] Rebuild native modules if needed

### Phase 3: Implement Audio Loopback (10 min)
- [ ] Add `setDisplayMediaRequestHandler` in main process
- [ ] Update renderer to use `getDisplayMedia` for system audio
- [ ] Update system audio capture logic

### Phase 4: Test (5 min)
- [ ] Test dev mode: `npm run dev`
- [ ] Verify system audio permission prompt appears
- [ ] Verify system audio capture works
- [ ] Check backend logs for `source=system` WebSocket

---

## Execution Log

### Attempt 1: Electron 31.x Upgrade

**Time:** [START]

#### Step 1: Backup
```bash
cp package.json package.json.electron30.backup
cp package-lock.json package-lock.json.electron30.backup
```

#### Step 2: Upgrade
```bash
npm install electron@latest
```

**Electron Version After Upgrade:** [TO BE FILLED]

#### Step 3: Breaking Changes Check
- [ ] Review Electron 31 release notes
- [ ] Check for API deprecations
- [ ] Test build: `npm run build`

#### Step 4: Implement Audio Loopback

**File: `src/main/overlay-windows.ts`**
```typescript
// Add after imports
const { session } = require('electron');

// Add in app.whenReady() or before window creation
session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
  desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
    if (sources.length > 0) {
      callback({ 
        video: sources[0],
        audio: 'loopback'  // ← Chromium 31+ loopback support
      });
    } else {
      callback({});
    }
  });
});
```

**File: `src/renderer/audio-processor-glass-parity.ts`**
```typescript
// Replace desktopCapturer approach with getDisplayMedia
systemStream = await navigator.mediaDevices.getDisplayMedia({
  video: true,  // Required even if we only want audio
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }
});

// Remove video track if not needed
const videoTracks = systemStream.getVideoTracks();
videoTracks.forEach(track => {
  track.stop();
  systemStream.removeTrack(track);
});
```

#### Step 5: Testing

**Dev Mode Test:**
```bash
npm run dev:main &
npm run dev:renderer
```

**Expected Behavior:**
1. Click "Zuhören"
2. macOS permission prompt appears for "EVIA Desktop" (not Cursor)
3. System audio capture starts
4. Backend logs show `source=system` WebSocket
5. Grey transcripts appear in Listen window

**Test Results:** [TO BE FILLED]

---

## Decision Point

**Time Elapsed:** [TO BE FILLED]  
**Result:** [SUCCESS / FAILURE]

### If SUCCESS ✅
- [ ] Build production app: `npm run build`
- [ ] Test production build
- [ ] Document changes
- [ ] Commit

### If FAILURE ❌ (or time > 30 min)
- [ ] Revert to Electron 30.5.1: `npm install electron@30.5.1`
- [ ] Switch to **Glass SystemAudioDump binary approach**
- [ ] Copy `glass/src/features/listen/audioCore/SystemAudioDump`
- [ ] Implement child process spawning
- [ ] Wire up stdout → WebSocket

---

## Breaking Changes & Issues Encountered

### Issue 1: [TO BE FILLED]
**Description:**  
**Solution:**  

### Issue 2: [TO BE FILLED]
**Description:**  
**Solution:**  

---

## Final Outcome

**Approach Used:** [ Electron 31 Upgrade / Glass Binary Fallback ]

**System Audio Status:** [ ✅ Working / ❌ Failed ]

**Notes:**

---

## Rollback Instructions (If Needed)

```bash
# Restore backups
cp package.json.electron30.backup package.json
cp package-lock.json.electron30.backup package-lock.json

# Reinstall dependencies
npm install

# Rebuild
npm run build
```

