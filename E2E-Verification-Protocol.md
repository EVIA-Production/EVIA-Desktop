# EVIA Desktop E2E Verification Protocol

**Date**: October 8, 2025  
**Branch**: `desktop-mvp-finish`  
**Status**: 🔴 **BACKEND NOT RUNNING** - Must start services first

---

## ⚠️ CRITICAL: Pre-Verification Checklist

Before running E2E tests, verify ALL services are running:

```bash
# 1. Start backend services
cd /Users/benekroetz/EVIA/EVIA-Backend
docker-compose up -d

# 2. Wait for services to be healthy (30-60 seconds)
docker-compose ps

# 3. Verify all 4 containers are "Up":
# - evia-backend-backend-1 (Up)
# - evia-backend-db-1 (Up, healthy)
# - evia-backend-redis-1 (Up)
# - evia-backend-frontend-1 (Up)

# 4. Test backend health
curl http://localhost:8000/health
# Should return: {"status": "ok"} or similar

# 5. Check logs for any errors
docker-compose logs backend | tail -50
```

### Current State (as of verification attempt):
- ✅ Desktop code complete and committed (`desktop-mac-production`)
- ✅ FAST_MODE disabled (not in .env, defaults to false)
- ✅ Groq API key configured
- ✅ Groq model: `llama-3.3-70b-versatile`
- 🔴 **Backend NOT running** (only DB container up)
- 🔴 **Cannot verify E2E flows** until backend is started

---

## Phase 1: Verify Flows (20 min)

### Test 1: Transcription → Real Insights → Auto-Stream

**Objective**: Verify full insight generation and auto-submit flow

**Steps**:
1. Start EVIA Desktop:
   ```bash
   cd /Users/benekroetz/EVIA/EVIA-Desktop
   npm start
   ```

2. Click "Listen" button (or `Cmd+\`)
3. Start recording
4. Speak for 30 seconds (or play audio from YouTube)
5. Press "Stopp" button

**Expected Results**:
- ✅ Timer stops
- ✅ View auto-switches to "Erkenntnisse" tab
- ✅ 3 insights appear within 2-3 seconds
- ✅ Insights are AI-generated (NOT these dummy German messages):
  - ❌ "Frage nach Budget klären"
  - ❌ "Nächste Schritte vorschlagen"
  - ❌ "Entscheider einbinden"
- ✅ Insight titles/prompts relate to actual transcript content

**Verification**:
- [ ] Insights are contextual to transcript? (Y/N)
- [ ] Insights generated in < 3 seconds? (Y/N)
- [ ] TTFT displayed for insights API call? (Y/N, check console)

**If Insights Are Still Dummy Data**:
1. Check backend logs:
   ```bash
   docker-compose logs backend | grep -i "FAST_MODE\|stub"
   ```
2. If you see "FAST_MODE stub active" → backend is using stubs
3. Ensure `FAST_MODE` is not set in `.env` OR is explicitly `FAST_MODE=false`
4. Restart backend: `docker-compose restart backend`

---

### Test 2: Insight Click → Auto-Stream

**Objective**: Verify auto-submit works without manual interaction

**Steps**:
1. From Test 1, with insights visible
2. Click ANY insight card (e.g., first one)

**Expected Results**:
- ✅ Ask window opens
- ✅ Window height is 450px initially
- ✅ Prompt is filled with insight question
- ✅ Stream starts IMMEDIATELY (no need to press "Fragen" button)
- ✅ Header shows "Thinking..." during load
- ✅ First token arrives → header changes to "AI Response"
- ✅ Response streams in real-time
- ✅ Window dynamically resizes to match content (450-700px)
- ✅ TTFT displays (e.g., "TTFT: 486ms ⚠️")

**Verification**:
- [ ] Auto-submit worked? (Y/N)
- [ ] Window resized dynamically? (Y/N)
- [ ] Header updated correctly? (Y/N)
- [ ] TTFT displayed? (Y/N) - Value: ______ ms

**Console Logs to Check**:
```
[ListenView] 🎯 Insight clicked: <title>
[ListenView] ✅ Ask window opened
[ListenView] ✅ Prompt sent via IPC
[ListenView] ✅ Auto-submitted prompt via IPC
[AskView] 📨 Received prompt via IPC: <prompt>
[AskView] 📨 Received submit-prompt via IPC - auto-submitting with: <prompt>
[AskView] 🚀 Starting stream with prompt: <prompt>
[AskView] ⚡ TTFT: <ms>
```

---

### Test 3: Screenshot Vision Ask

**Objective**: Verify Cmd+Enter captures screenshot and AI describes screen

**⚠️ CRITICAL REQUIREMENT**: Backend MUST have vision model integration (GPT-4V or Gemini)

**Steps**:
1. Open a web page or document with visible content (e.g., GitHub, PDF, image)
2. Open Ask window (`Cmd+\`)
3. Press `Cmd+Enter` (should capture screenshot)
4. Type prompt: "Was zeigt mein Bildschirm?" or "Describe what you see"
5. Press Enter

**Expected Results**:
- ✅ Console shows: `[AskView] 📸 Screenshot captured: <width> x <height>`
- ✅ Console shows: `Base64 length: <number>`
- ✅ AI response describes actual screen content (NOT generic answer)
- ✅ Response mentions specific elements visible (text, images, colors, layout)

**Verification**:
- [ ] Screenshot captured? (Y/N) - Size: ______ x ______
- [ ] Base64 length logged? (Y/N) - Length: ______
- [ ] Response is contextual? (Y/N)

**If Response is NOT Contextual**:
1. Screenshot capture is working ✅
2. Backend is receiving base64 image ✅
3. **BLOCKER**: Backend lacks vision model integration
4. Check backend `/ask` endpoint - should use GPT-4 Vision or Gemini
5. See: `/Users/benekroetz/EVIA/EVIA-Desktop-Remaining-Backend-Fixes.md` section "Screenshot Feature - Vision Model Required"

**Fallback Verification** (if vision not implemented):
```bash
# Check backend logs for screenshot_ref length
docker-compose logs backend | grep -i "screenshot_ref"
# Should see: "Ask request includes screenshot_ref (len=<large number>)"
```

---

## Phase 2: Polish/Verify (20 min)

### Test 4: No Undo Button

**Objective**: Verify undo button never appears

**Steps**:
1. Start recording
2. Press "Stopp" button

**Expected Results**:
- ✅ Timer stops
- ✅ View switches to Insights
- ✅ **NO undo button appears** (previously appeared for 10 seconds)

**Verification**:
- [ ] Undo button absent? (Y/N)

---

### Test 5: Window Sizing

**Objective**: Verify Ask window dynamically adjusts height

**Steps**:
1. Open Ask window
2. Type short prompt: "Hi"
3. Press Enter
4. Observe window height after response
5. Type longer prompt: "Explain quantum computing in detail with examples"
6. Press Enter
7. Observe window height adjustment

**Expected Results**:
- ✅ Window starts at 450px
- ✅ After short response: Window stays ~450-500px
- ✅ After long response: Window grows to fit content (up to 700px max)
- ✅ Window shrinks back for next short response

**Verification**:
- [ ] Initial height 450px? (Y/N)
- [ ] Dynamic resize working? (Y/N)
- [ ] Min/max enforced (450-700px)? (Y/N)

**Console Logs to Check**:
```
[AskView] Set initial window height to 450px
[AskView] 📏 Resizing window: <old> → <new>
```

---

### Test 6: TTFT Logging (10 Runs)

**Objective**: Collect TTFT metrics for Ask endpoint, target p50 < 400ms

**Steps**:
1. Open Ask window
2. Type prompt: "What is 2+2?"
3. Press Enter
4. Record TTFT from console (e.g., `[AskView] ⚡ TTFT: 486ms`)
5. Repeat 9 more times (total 10 runs)

**Data Collection**:
| Run | Prompt | TTFT (ms) | Status |
|-----|--------|-----------|--------|
| 1   | What is 2+2? | _____ | ✅/⚠️ |
| 2   | What is 2+2? | _____ | ✅/⚠️ |
| 3   | What is 2+2? | _____ | ✅/⚠️ |
| 4   | What is 2+2? | _____ | ✅/⚠️ |
| 5   | What is 2+2? | _____ | ✅/⚠️ |
| 6   | What is 2+2? | _____ | ✅/⚠️ |
| 7   | What is 2+2? | _____ | ✅/⚠️ |
| 8   | What is 2+2? | _____ | ✅/⚠️ |
| 9   | What is 2+2? | _____ | ✅/⚠️ |
| 10  | What is 2+2? | _____ | ✅/⚠️ |

**Calculation**:
```
p50 (median) = _____ ms
p90 = _____ ms
p99 = _____ ms

Target: p50 < 400ms
Actual: ______
Status: ✅ PASS / ❌ FAIL
```

---

### Test 7: Transcript Flow

**Objective**: Verify transcript UI improvements

**Steps**:
1. Start recording
2. Speak into mic: "This is a test of the microphone audio"
3. Observe blue bubbles
4. Play YouTube video (system audio)
5. Observe grey bubbles
6. Check for "EVIA connection OK" messages
7. Check for speaker labels

**Expected Results**:
- ✅ Mic speech → Blue bubbles, right-aligned
- ✅ System audio → Grey bubbles, left-aligned
- ✅ **NO "EVIA connection OK" in transcript** (only in console)
- ✅ **NO speaker labels** ("Me (Mic)" / "Them (System)")
- ✅ Bubbles grouped well (1-3 per paragraph, not 5-10)

**Verification**:
- [ ] Blue bubbles for mic? (Y/N)
- [ ] Grey bubbles for system? (Y/N)
- [ ] No connection messages in transcript? (Y/N)
- [ ] No speaker labels? (Y/N)
- [ ] Bubble grouping acceptable? (Y/N)

---

## Phase 3: Deploy (10 min)

### Build Production App

**⚠️ Note**: DMG packaging may fail due to code signing requirements. The `.app` will still be created and functional.

**Steps**:
1. Clean previous builds:
   ```bash
   cd /Users/benekroetz/EVIA/EVIA-Desktop
   rm -rf dist/
   ```

2. Build app:
   ```bash
   npm run build
   ```

3. Expected output:
   ```
   ✓ built in <time>
   • electron-builder version=26.0.12
   • packaging platform=darwin arch=arm64
   • building target=DMG
   ```

4. Check for `.app`:
   ```bash
   ls -lh dist/mac-arm64/
   # Should see: EVIA Desktop.app
   ```

**Verification**:
- [ ] Build completed? (Y/N)
- [ ] `.app` created? (Y/N)
- [ ] DMG created? (Y/N) - May fail, that's OK

**If DMG Packaging Fails**:
- Error: `hdiutil create` failure → Expected (no code signing cert)
- Workaround: Use the `.app` directly from `dist/mac-arm64/`
- Test: Double-click `EVIA Desktop.app` → should launch

---

### Test Installation

**Steps**:
1. If DMG created:
   ```bash
   open dist/EVIA\ Desktop-*.dmg
   ```
2. Drag to Applications folder
3. Launch from Applications

**If only .app (no DMG)**:
1. Copy app:
   ```bash
   cp -r "dist/mac-arm64/EVIA Desktop.app" /Applications/
   ```
2. Launch:
   ```bash
   open "/Applications/EVIA Desktop.app"
   ```

**Expected Results**:
- ✅ App launches without errors
- ✅ Permissions prompts appear (mic, screen recording, keychain)
- ✅ Main window appears
- ✅ Can start recording
- ✅ All features work

**Verification**:
- [ ] App installed? (Y/N)
- [ ] App launches? (Y/N)
- [ ] Permissions requested? (Y/N)
- [ ] Features functional? (Y/N)

---

## Screenshots Required

Take screenshots of the following:

### Screenshot 1: Insights Flow
- Record 30s → Press "Stopp" → Insights auto-show
- **Highlight**: 3 real insights (not dummy German)
- **Filename**: `insights-flow.png`

### Screenshot 2: Auto-Submit
- Click insight → Ask window opens + streams
- **Highlight**: Response streaming, TTFT displayed
- **Filename**: `auto-submit-flow.png`

### Screenshot 3: Screenshot Vision (if implemented)
- Press Cmd+Enter → AI describes screen
- **Highlight**: Contextual response
- **Filename**: `screenshot-vision.png`

### Screenshot 4: Transcript UI
- Blue bubbles (mic) + Grey bubbles (system)
- **Highlight**: No labels, no connection messages
- **Filename**: `transcript-ui.png`

### Screenshot 5: Window Sizing
- Short response vs long response
- **Highlight**: Dynamic height adjustment
- **Filename**: `window-sizing.png`

---

## Final Verification Checklist

### Desktop Fixes (Should All Pass ✅)
- [ ] Insights auto-submit works (no second click)
- [ ] Ask window resizes dynamically (450-700px)
- [ ] Ask header updates ("Thinking..." → "AI Response")
- [ ] No undo button appears
- [ ] "EVIA connection OK" filtered from transcript
- [ ] Speaker labels removed

### Backend Requirements (May Need Fixes 🔧)
- [ ] Real insights generated (not dummy German)
- [ ] Screenshot vision working (requires vision model)
- [ ] German AI prompts (optional)

### Performance
- [ ] TTFT p50 < 400ms for Ask endpoint
- [ ] Insights load < 3 seconds
- [ ] UI responsive (no lag)

### Deployment
- [ ] Build completes successfully
- [ ] `.app` created and functional
- [ ] DMG created (or acceptable failure documented)
- [ ] Installation tested

---

## Troubleshooting

### Issue: Insights are still dummy German
**Cause**: Backend FAST_MODE enabled OR Groq key invalid  
**Fix**:
```bash
cd /Users/benekroetz/EVIA/EVIA-Backend
grep FAST_MODE .env  # Should be "false" or not present
docker-compose logs backend | grep -i groq  # Check for API errors
```

### Issue: Screenshot not contextual
**Cause**: Backend lacks vision model integration  
**Fix**: See `/Users/benekroetz/EVIA/EVIA-Desktop-Remaining-Backend-Fixes.md`  
**Fallback**: Verify base64 captured in logs

### Issue: Build fails on DMG
**Cause**: No code signing certificate (expected)  
**Fix**: Use `.app` directly from `dist/mac-arm64/`

### Issue: Backend 401/403 errors
**Cause**: JWT token expired or invalid  
**Fix**: See `EVIA-Desktop-Implementation-Status.md` "Authentication Resurrection Protocol"

---

## Success Criteria

### MVP Deployed ✅ if:
1. ✅ All Desktop fixes working (auto-submit, resize, header, no undo)
2. ✅ Real insights generated (not stubs)
3. ✅ Auto-submit flow E2E works
4. ✅ TTFT p50 < 400ms
5. ✅ Build completes (DMG optional)
6. ✅ Screenshots captured
7. ✅ No critical bugs

### Acceptable Partial ⚠️ if:
1. ✅ Desktop fixes working
2. ⚠️ Real insights working BUT screenshot vision pending (vision model not yet integrated)
3. ✅ Build completes (.app works, DMG fails due to signing)

### NOT Ready ❌ if:
1. ❌ Desktop fixes not working (auto-submit fails, resize broken, etc.)
2. ❌ Insights still showing dummy data
3. ❌ Backend not running / 401 errors
4. ❌ Build fails completely

---

## Reporting

After verification, create report:

**File**: `EVIA-Desktop-E2E-Verification-Report.md`

**Template**:
```markdown
# EVIA Desktop E2E Verification Report

**Date**: YYYY-MM-DD  
**Branch**: desktop-mvp-finish  
**Tester**: [Your Name]

## Summary
- Status: ✅ PASS / ⚠️ PARTIAL / ❌ FAIL
- Desktop Fixes: ✅/❌
- Real Insights: ✅/❌
- Screenshot Vision: ✅/❌/⚠️ (not implemented)
- Build: ✅/❌
- TTFT p50: ___ ms (target < 400ms)

## Test Results
[Paste checklist results]

## Screenshots
[Attach 5 screenshots]

## Issues Found
[List any bugs or problems]

## Next Steps
[What needs to be fixed]
```

---

**Last Updated**: October 8, 2025  
**Protocol Version**: 1.0  
**Branch**: desktop-mvp-finish

