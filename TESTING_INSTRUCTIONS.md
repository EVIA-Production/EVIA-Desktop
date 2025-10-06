# Testing Instructions - Transcript Deduplication Fix

## Quick Test (5 minutes)

```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
git checkout desktop-transcript-dedup
npm run dev
```

1. Click "Listen" button in header
2. **Speak into microphone**: "Testing one two three"
3. **Play YouTube video** (system audio): Any speech
4. **Open DevTools** on Listen window (Right-click → Inspect)

### ✅ SUCCESS CRITERIA

**Console Logs Should Show**:
```
[ListenView] ➕ ADDING new partial
[ListenView] 🔄 REPLACING partial at index 0
[ListenView] 🔄 REPLACING partial at index 0
[ListenView] 🔄 CONVERTING partial to final at index 0
```

**Visual Results**:
- **ONE line per sentence** (not 9+ lines)
- **Mic speech**: Blue bubble, right-aligned, "Me (Mic)" label
- **System audio**: Grey bubble, left-aligned, "Them (System)" label
- **All bubbles**: Full opacity (no fading)

### ❌ FAILURE INDICATORS

- Multiple lines for same sentence → Deduplication broken
- Blue bubbles on left or grey on right → Speaker styling broken
- Some bubbles faded → Opacity logic broken

---

## Detailed Test (15 minutes)

### Test 1: Mic Transcription

1. Start Listen mode
2. Speak: "The quick brown fox jumps over the lazy dog"
3. **Watch bubble update in real-time** (same line, text grows)
4. **Final state**: One blue bubble on right with complete sentence

**Console verification**:
```
[AudioCapture] Forwarding MIC message to Listen window: status
[ListenView] 📨 status (echo_text): The quick _source: mic
[ListenView] 🔄 REPLACING status partial at index 0
```

### Test 2: System Audio Transcription

1. Play YouTube video with speech
2. **Watch bubble update** (grey, left side)
3. **Final state**: One grey bubble per spoken sentence

**Console verification**:
```
[AudioCapture] Forwarding SYSTEM message to Listen window: transcript_segment
[ListenView] 📨 transcript_segment: ... speaker: 0 final: true
[ListenView] 🔄 CONVERTING partial to final at index X
```

### Test 3: Mixed Audio (Mic + System)

1. Play YouTube video
2. Simultaneously speak into mic
3. **Expected**: Separate bubbles - grey (left) for system, blue (right) for mic
4. **No cross-contamination** of speaker colors

### Test 4: Rapid Interim Updates

1. Speak slowly: "One... two... three... four... five"
2. **Watch single bubble grow** with each word
3. **No duplicate lines**

---

## Screenshot Comparison

### Before Fix (User's logs showed):
```
And they
And they were in the
And they were in their gym class and
And they were in the gym class, and he was getting ready
And they were in their gym class and you line up...
```
**9+ lines for ONE sentence!**

### After Fix (Expected):
```
And they were in their gym class and you line up and getting ready for the next unit.
```
**1 line, updated in-place**

---

## Debug Console Checklist

Open DevTools on **Listen window** and verify:

### Message Flow
- [x] `[AudioCapture] Forwarding MIC message` appears for mic speech
- [x] `[AudioCapture] Forwarding SYSTEM message` appears for system audio
- [x] `_source: mic` or `_source: system` logged
- [x] `speaker: 0` for system, `speaker: 1` for mic in transcript_segment

### Deduplication
- [x] `REPLACING partial at index X` for interim updates
- [x] `CONVERTING partial to final at index X` when speech ends
- [x] **NOT** seeing `ADDING new` repeatedly for same sentence

### State
- [x] `Updated transcripts count: X` increments by 1 per sentence (not per interim update)

---

## Expected Log Pattern

```
// User speaks "Hello world"

[AudioCapture] Forwarding MIC message to Listen window: status
[ListenView] 📨 status (echo_text): Hello _source: mic speaker: 1
[ListenView] ➕ ADDING new status partial

[AudioCapture] Forwarding MIC message to Listen window: status
[ListenView] 📨 status (echo_text): Hello world _source: mic speaker: 1
[ListenView] 🔄 REPLACING status partial at index 0

[AudioCapture] Forwarding MIC message to Listen window: transcript_segment
[ListenView] 📨 transcript_segment: Hello world speaker: 1 final: true
[ListenView] 🔄 CONVERTING partial to final at index 0

[State Debug] Updated transcripts count: 1  // ← Only 1 line!
```

---

## Rollback if Issues

```bash
git checkout main
npm run build
npm run dev
```

---

## Report Template

**Status**: ✅ PASS / ❌ FAIL  
**Test Duration**: X minutes  
**Transcript Count for 1 Sentence**: X (expected: 1)  
**Speaker Colors Correct**: YES / NO  
**Opacity Correct**: YES / NO  
**Console Logs Match**: YES / NO  

**Issues Found**:
- (list any issues)

**Screenshots**:
- (attach before/after if possible)

---

## Next Actions if Test Passes

1. **Merge branch**: `git checkout main && git merge desktop-transcript-dedup`
2. **Push to remote**: `git push origin desktop-transcript-dedup`
3. **Update MVP tracker**: Mark "Transcript Display Fix" as complete
4. **Notify team**: Share `TRANSCRIPT_DEDUP_FIX_COMPLETE.md`

---

## Contact

If issues found, check:
1. `TRANSCRIPT_DISPLAY_ANALYSIS.md` - Root cause analysis
2. `TRANSCRIPT_DEDUP_FIX_COMPLETE.md` - Implementation details
3. Console logs - Debug patterns above