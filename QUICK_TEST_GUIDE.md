# 🧪 QUICK TEST GUIDE - MUP Desktop Fixes

## ⚡ **5-Minute Smoke Test**

### **Prerequisites**
```bash
# Ensure backend is running:
cd /Users/benekroetz/EVIA/EVIA-Backend
docker compose up
# Verify: http://localhost:8000/health → {"status":"ok"}

# Get auth token (if needed):
curl -X POST http://localhost:8000/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass"}' | jq .access_token
# Save this token in localStorage via Dev Console
```

### **Launch App**
```bash
# Option 1: Built DMG
open "dist/EVIA Desktop-0.1.0-arm64.dmg"
# Drag to Applications, launch

# Option 2: Dev Mode (recommended for testing)
cd /Users/benekroetz/EVIA/EVIA-Desktop

# Terminal A - Renderer
npm run dev:renderer

# Terminal B - Electron (wait for Terminal A to complete)
EVIA_DEV=1 npm run dev:main
```

---

## ✅ **TEST CHECKLIST**

### **1. Header Width & Visibility** (30 sec)
- [ ] Header appears at top of screen
- [ ] All 4 buttons visible: "Zuhören" | "Fragen" | "Anzeigen/Ausblenden" | "⋯" (3 dots)
- [ ] Settings button (3 dots) fully visible on right side
- [ ] Right edge is rounded (not cut off)
- [ ] Switch to German in settings → All text still visible

**Pass Criteria**: No cutoff, settings button clickable ✅

---

### **2. Audio Capture** (2 min)
- [ ] Click "Zuhören" button → Mic permission prompt appears (first time only)
- [ ] Grant permission → Button changes to "Stoppen"
- [ ] Open Dev Console (F12) → See: `[OverlayEntry] Audio capture started successfully`
- [ ] Speak "Hello this is a test"
- [ ] Check console for: `[WS] Sent binary chunk: 6400 bytes` (audio sent to backend)
- [ ] Click "Stoppen" → See: `[OverlayEntry] Audio capture stopped successfully`
- [ ] Button changes to "Fertig"
- [ ] Click "Fertig" → Listen window hides

**Pass Criteria**: 
- Microphone activates ✅
- Audio sent to backend (WebSocket logs) ✅
- No errors in console ✅

**Note**: Transcripts appear when backend is properly configured with Deepgram API key.

---

### **3. Scrollbars** (1 min)
- [ ] Click "Zuhören" again
- [ ] Speak 20+ short sentences (or use backend mock data)
- [ ] Listen window fills with transcript bubbles
- [ ] Scrollbar appears on right side (8px width, semi-transparent white)
- [ ] Hover over scrollbar → Opacity increases
- [ ] Scroll up/down → Smooth scrolling
- [ ] Scroll to bottom → Auto-scroll resumes

**Pass Criteria**: Scrollbar visible and functional ✅

---

### **4. Smooth Movement** (1 min)
- [ ] Press and HOLD ↑ arrow key for 5 seconds
- [ ] Header moves up smoothly without jerking
- [ ] Release → Header stops immediately
- [ ] Press and HOLD → arrow key rapidly (spam it)
- [ ] No lag, header responds instantly
- [ ] Check console → NO spam of `saveState` logs (should be max 1 every 300ms)

**Pass Criteria**: No lag during rapid arrow keys ✅

---

### **5. Ask Window** (30 sec)
- [ ] Press Cmd+Enter globally
- [ ] Ask window appears centered below header
- [ ] Window size: ~384px wide × 420px tall (visually centered)
- [ ] NO close button (X) visible in top-right corner
- [ ] Type "test" in input field
- [ ] Press Enter → Response streams (if backend working)
- [ ] Press Esc or click outside → Window closes

**Pass Criteria**: No visible close button, size matches Glass ✅

---

### **6. No CSP Warnings** (30 sec)
- [ ] Open Dev Console (F12) → Console tab
- [ ] Clear console
- [ ] Navigate through: Listen → Ask → Settings → Shortcuts
- [ ] NO warnings about:
   - "Refused to evaluate a string as JavaScript because 'unsafe-eval'"
   - Content Security Policy violations
   - Any CSP-related errors

**Pass Criteria**: Zero CSP warnings ✅

---

## 🐛 **KNOWN ISSUES** (Expected, Non-Blocking)

### **TypeScript Linter Warnings**:
```
Property 'ipc' does not exist on type 'EviaBridge'
Property 'closeWindow' does not exist on type 'EviaBridge'
```

**Status**: ⚠️ FALSE POSITIVES  
**Explanation**: Types ARE defined in `types.d.ts`, but IDE hasn't refreshed cache  
**Fix**: Restart TypeScript server or ignore (runtime works perfectly)  
**Impact**: NONE - app functions correctly at runtime

---

## ✅ **SUCCESS CRITERIA**

| Test | Expected Result | Status |
|------|----------------|--------|
| Header Width | All buttons visible, no cutoff | ⏳ Test |
| Audio Capture | Mic activates, audio sent to backend | ⏳ Test |
| Scrollbars | Visible when content overflows | ⏳ Test |
| Smooth Movement | No lag with arrow keys | ⏳ Test |
| Ask Window | No close button, correct size | ⏳ Test |
| CSP Warnings | Zero warnings in console | ⏳ Test |

**ALL 6 TESTS MUST PASS** → Report "✅ ALL TESTS PASSED" to coordinator  
**ANY FAILURE** → Report specific failure with logs/screenshots

---

## 📸 **EVIDENCE COLLECTION**

For coordinator report, capture:

1. **Screenshot**: Header showing all 4 buttons visible
2. **Screenshot**: Listen window with scrollbar visible
3. **Screenshot**: Ask window (no close button, centered)
4. **Console Log**: 
   ```
   [OverlayEntry] Audio capture started successfully
   [WS] Connected to ws://localhost:8000/ws/transcribe?chat_id=1...
   [WS] Sent binary chunk: 6400 bytes
   ```
5. **Console Screenshot**: Zero CSP warnings
6. **Video (optional)**: Rapid arrow key movement showing no lag

---

## 🚨 **IF TESTS FAIL**

### **Audio Capture Doesn't Start**:
```bash
# Check backend logs:
docker compose logs -f evia-backend

# Check for:
# - "WebSocket connection opened"
# - "Received binary audio chunk"

# If 403 Forbidden:
# → Check auth token in localStorage: localStorage.getItem('auth_token')
# → Re-login if token expired

# If 404 Not Found:
# → Check chat_id: localStorage.getItem('current_chat_id')
# → Should be numeric (e.g., "1")
```

### **Transcripts Don't Appear**:
```bash
# Check backend .env file:
# DEEPGRAM_API_KEY=<your_key>

# If key missing:
# → Backend uses stub mode (logs "[STT] Using stub transcription")
# → Stub mode returns synthetic transcripts every 3 seconds
# → Real transcripts require valid Deepgram API key
```

### **Header Still Cut Off**:
```bash
# Verify header width in main process:
grep "HEADER_SIZE" src/main/overlay-windows.ts
# Should show: { width: 520, height: 47 }

# If still 480:
# → Rebuild: npm run build
# → Check dist/main.js for updated width value
```

---

## 📞 **REPORT TEMPLATE**

```markdown
## MUP Desktop Test Results

**Tester**: [Your Name]  
**Date**: [Date/Time]  
**Branch**: mup-integration  
**Commit**: 09f681b  

### Test Results:
1. Header Width: [PASS/FAIL]
2. Audio Capture: [PASS/FAIL]
3. Scrollbars: [PASS/FAIL]
4. Smooth Movement: [PASS/FAIL]
5. Ask Window: [PASS/FAIL]
6. CSP Warnings: [PASS/FAIL]

### Overall: [ALL PASS / BLOCKED]

### Evidence:
- Screenshots: [Attach]
- Console Logs: [Paste]
- Video: [Link if recorded]

### Issues Found:
[List any failures with details]

### Recommendation:
[APPROVED FOR MERGE / REQUIRES FIXES]
```

---

**Testing Time**: ~5 minutes  
**Report Time**: ~2 minutes  
**Total**: 7 minutes to full verification

🚀 **Ready to test!**

