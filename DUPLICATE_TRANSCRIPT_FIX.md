# Duplicate Transcript Fix - OBSOLETE (BROKE DISPLAY)

**⚠️ WARNING: This fix removed duplicates BUT broke transcript display!**
**See `TRANSCRIPTION_DISPLAY_FIX.md` for the corrected fix.**

---

# Original (Incomplete) Fix Documentation

## Problem
Transcripts were being added **5-7 times each**, causing:
- Transcript count reaching 160+ duplicates
- Excessive re-renders in ListenView
- Transcript list becoming unusable

## Root Cause
**Double message handling:**
1. **WebSocket**: ListenView had its own WebSocket connection receiving transcripts
2. **IPC Relay**: Main process was also relaying the SAME messages from Header → Listen

Both handlers were adding transcripts to the state, causing multiplication.

## Fix Applied
✅ **Removed IPC relay** in `src/main/overlay-windows.ts` (lines 1058-1069)
✅ **Removed IPC listener** in `src/renderer/overlay/ListenView.tsx` (lines 130-183)

Each window now manages its own WebSocket connection directly.

## Testing
1. Restart Electron: `EVIA_DEV=1 npm run dev:main`
2. Click "Zuhören" button
3. Speak some text
4. Check DevTools → Console

**Expected result:**
- ONE `[ListenView] ✅ Adding transcript` per utterance
- Transcript count increases by 1 per message (not 5-7x)
- No duplicate `[IPC State Debug]` logs

## System Audio Permission (Still TODO)
System audio capture still fails with:
```
[SystemAudioService] 🔴 SystemAudioDump process closed with code: 1
[SystemAudioService] ❌ Binary exited with code 1 - PERMISSION DENIED
```

**Fix**: Run the permission script:
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
chmod +x FORCE_PERMISSION_REFRESH.sh
./FORCE_PERMISSION_REFRESH.sh
```

Then follow the steps to **remove and re-add** the Screen Recording permission.

## Windows Compatibility Branch
The `origin/dev-c-windows-compatibility` branch has updates to:
- `src/main/preload.cjs` (transcript module fixes)
- `src/renderer/main.ts` (audio worklet improvements)
- `src/renderer/mic-audio-worklet.js` (new file)

These changes appear to be Windows-specific but may include cross-platform improvements. Consider cherry-picking if macOS compatibility is confirmed.

