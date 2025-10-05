# 🎯 Quick Start: System Audio Testing

## Prerequisites
1. **Backend**: `cd EVIA-Backend && python main.py`
2. **Frontend Dev Server**: `cd EVIA-Desktop && npm run dev:vite`
3. **macOS Permission**: System Preferences > Security & Privacy > Screen Recording > Enable "Electron"

## Quick Test (30 seconds)

```bash
cd EVIA-Desktop
./TEST_SPRINT1.sh
```

### What to Do
1. Click "Zuhören" button
2. Play a YouTube video or music
3. Speak into microphone: "This is my voice"
4. Check console logs (see below)
5. Verify UI shows:
   - **Blue bubbles on right** (your mic = "Me")
   - **Grey bubbles on left** (system audio = "Them")

### Expected Console Output

**Header Window (Dev Tools):**
```
[AudioCapture] Starting dual capture (mic + system audio)...
[AudioCapture] Found 2 desktop sources
[AudioCapture] System audio tracks: [{label: "...", enabled: true}]
[AudioCapture] Forwarding MIC message: transcript_segment
[AudioCapture] Forwarding SYSTEM message: transcript_segment
```

**Listen Window (Dev Tools):**
```
[ListenView] ✅ Received message: {type: 'transcript_segment', data: {speaker: 1}}
[ListenView] Adding transcript: text="This is my voice", speaker=1
[ListenView] ✅ Received message: {type: 'transcript_segment', data: {speaker: 0}}
[ListenView] Adding transcript: text="[YouTube audio]", speaker=0
```

**Backend Terminal:**
```
[WebSocket] New connection: chat_id=698, source=mic, speaker=1
[WebSocket] New connection: chat_id=698, source=system, speaker=0
[Deepgram] Created stream for source=mic
[Deepgram] Created stream for source=system
[Deepgram] Transcript (source=mic, speaker=1): "This is my voice"
[Deepgram] Transcript (source=system, speaker=0): "[YouTube audio]"
```

## Troubleshooting

### ❌ "Screen Recording permission denied"
**Fix:**
1. Open System Preferences > Security & Privacy > Screen Recording
2. Check the box next to "Electron" (or your app name)
3. Restart Electron: `pkill -f Electron && ./TEST_SPRINT1.sh`

### ❌ "No desktop sources available"
**Fix:**
1. Grant Screen Recording permission (see above)
2. Reset permissions: `tccutil reset ScreenCapture`
3. Restart test

### ❌ "No audio track in system stream"
**Possible causes:**
- Screen Recording permission not granted
- macOS Ventura+ additional restrictions
- No audio currently playing on system

**Fix:**
1. Play audio BEFORE clicking "Zuhören"
2. Check macOS Sound settings > Output device is working
3. Try different screen/window in source selection

### ❌ Only mic works, no system audio
**Debug:**
1. Check Header console for: `[AudioCapture] System audio tracks: []`
2. If empty array → no audio captured
3. Grant Screen Recording permission and restart

### ❌ UI shows all bubbles on one side
**Debug:**
1. Check Listen console for: `speaker=0` and `speaker=1`
2. If all `speaker=1` → system audio not captured
3. If no speaker field → backend not sending speaker info

## Success Criteria

✅ **CRITICAL**: Console shows "Found X desktop sources"  
✅ **CRITICAL**: Console shows "System audio tracks: [...]" (non-empty)  
✅ **CRITICAL**: Backend shows two WebSocket connections (source=mic, source=system)  
✅ **CRITICAL**: UI shows blue bubbles on right, grey bubbles on left  
✅ **CRITICAL**: Timer runs continuously (no resets on reconnection)  

## Next Steps After Success

1. **Screenshot**: Capture UI with separated bubbles
2. **Save Logs**: Copy console output from Header, Listen, and Backend
3. **Report**: Update `SPRINT1_SYSTEM_AUDIO_DIARIZATION_REPORT.md` with evidence
4. **Commit**: `git add . && git commit -m "feat: system audio capture + diarization"`
5. **Push**: `git push origin mup-integration`
6. **Ping Coordinator**: Report completion with evidence

## Files Changed

- `src/renderer/audio-processor-glass-parity.ts` (431 lines)
- `src/main/preload.ts` (IPC bridge)
- `src/main/overlay-windows.ts` (IPC handler)
- `src/renderer/overlay/ListenView.tsx` (timer + UI)
- `src/renderer/overlay/overlay-entry.tsx` (enable system audio)
- `electron-builder.yml` (macOS permissions)

## Related Documentation

- Full Report: `SPRINT1_SYSTEM_AUDIO_DIARIZATION_REPORT.md`
- Test Script: `TEST_SPRINT1.sh`
- Coordinator Brief: `COORDINATOR_HANDOFF.md`

---

**Last Updated**: 2025-10-05  
**Status**: ✅ Implementation Complete, Testing Pending

