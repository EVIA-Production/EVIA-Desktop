# 🧪 COMPREHENSIVE TEST PLAN - EVIA Desktop i18n & UI Polish

## ✅ **HOW TO TEST EVERYTHING**

### **PRE-TEST SETUP**

1. **Build the app:**
   ```bash
   cd /Users/benekroetz/EVIA/EVIA-Desktop
   npm run build
   ```

2. **Launch the built app:**
   ```bash
   open "dist/mac-arm64/EVIA Desktop.app"
   ```
   OR for dev mode:
   ```bash
   # Terminal A
   npm run dev:renderer
   
   # Terminal B
   EVIA_DEV=1 npm run dev:main
   ```

3. **Backend must be running:**
   ```bash
   cd /Users/benekroetz/EVIA/EVIA-Backend
   docker-compose up
   ```
   Verify: http://localhost:8000/health should return `{"status":"ok"}`

---

## 📋 **TEST CHECKLIST**

### **1. HEADER UI - Visual Verification** ✅

**Goal**: Verify header displays correctly with all elements visible

- [ ] **Header appears** - Transparent bar at top of screen
- [ ] **All buttons visible**:
  - [ ] Listen button (left side, with icon)
  - [ ] Ask button (middle, with ⌘ + ↵ icons)
  - [ ] Show/Hide button (middle, with ⌘ + \ icons)
  - [ ] Settings button (right side, 3 dots)
- [ ] **No cutoff** - Right side of header NOT clipped
- [ ] **Settings button fully visible** - 3-dot button not cut off
- [ ] **Right edge rounded** - Border radius visible on right side
- [ ] **Background blur** - Glass effect visible through header

**German Test:**
- [ ] Text shows: "Zuhören", "Fragen", "Anzeigen/Ausblenden", ⋮
- [ ] "Anzeigen/Ausblenden" text fully visible (longest word!)
- [ ] No text wrapping or overlap

**English Test:**
- [ ] Text shows: "Listen", "Ask", "Show/Hide", ⋮
- [ ] No excessive space between elements

**Expected Width**: 480px window, content ~451px (German) with 29px buffer

---

### **2. LANGUAGE SWITCHING** 🌐

**Goal**: Verify language toggle works across entire app

#### **Test A: Settings Language Toggle**

1. Click **3-dot settings button** (hover to open)
2. In Settings window, find **Language** section
3. Click **"Deutsch"** button
   - [ ] Button highlights (blue border/background)
   - [ ] App reloads (window flashes briefly)
4. Verify **German UI**:
   - [ ] Header: "Zuhören", "Fragen", "Anzeigen/Ausblenden"
   - [ ] Settings: German text throughout
5. Click **"English"** button
   - [ ] Button highlights
   - [ ] App reloads
6. Verify **English UI**:
   - [ ] Header: "Listen", "Ask", "Show/Hide"
   - [ ] Settings: English text throughout

#### **Test B: Language Persistence**

1. Set language to **German**
2. **Quit app** completely
3. **Reopen app**
   - [ ] Language is still **German** (saved to localStorage)

#### **Test C: All UI Elements Translate**

**German Mode:**
- [ ] Listen button: "Zuhören" → "Stopp" → "Fertig"
- [ ] Ask placeholder: "Stelle EVIA eine Frage..."
- [ ] Settings title: "Einstellungen"
- [ ] Settings sections: "Tastenkombinationen", "Voreinstellungen", "Sprache"
- [ ] Auto-update: "Automatisch aktualisieren"

**English Mode:**
- [ ] Listen button: "Listen" → "Stop" → "Done"
- [ ] Ask placeholder: "Ask EVIA a question..."
- [ ] Settings title: "Settings"
- [ ] Settings sections: "Shortcuts", "Presets", "Language"
- [ ] Auto-update: "Auto Update"

---

### **3. LISTEN FUNCTIONALITY** 🎤

**Goal**: Verify transcription works end-to-end

#### **Test A: Listen Button States**

1. Click **"Zuhören"/"Listen"** button
   - [ ] Button turns **red** (listening state)
   - [ ] Text changes to **"Stopp"/"Stop"**
   - [ ] **Listen Window opens** below header
2. Click **"Stopp"/"Stop"** again
   - [ ] Button turns **white** (done state)
   - [ ] Text changes to **"Fertig"/"Done"**
   - [ ] Button text becomes **black**
3. Wait **3 seconds**
   - [ ] Listen window **auto-hides** after 3s delay
   - [ ] Button resets to initial state ("Zuhören"/"Listen")

#### **Test B: Live Transcription**

**Prerequisites**: Microphone permission granted, backend connected

1. Click **"Listen"**
2. **Speak into microphone**: "This is a test transcription"
3. Verify **in Listen Window**:
   - [ ] Header shows: "EVIA hört zu 0:05" (or "EVIA is Listening 0:05")
   - [ ] Timer increments every second
   - [ ] **Transcription appears** in real-time (grey text)
   - [ ] Text updates as you speak
4. **Scroll test**:
   - [ ] Speak multiple sentences (fill window)
   - [ ] **Auto-scroll** to bottom as new text arrives
   - [ ] **Scrollbar appears** when content overflows
   - [ ] Scroll **UP** manually
   - [ ] New text appears but **doesn't auto-scroll** (you control scroll position)
   - [ ] Scroll to **bottom** (within 50px)
   - [ ] **Auto-scroll resumes** (follows new text)

#### **Test C: Waiting State**

1. Click **"Listen"** but **don't speak**
2. Verify:
   - [ ] German: "Auf Sprache warten..." displays as placeholder
   - [ ] English: "Waiting for speech..." displays

#### **Test D: Copy Transcript**

1. Generate some transcription (speak into mic)
2. **Hover** over Listen window header
   - [ ] German: Text changes to "Transkript kopieren"
   - [ ] English: Text changes to "Copy Transcript"
3. **Click** the copy button area
   - [ ] German: Text changes to "Transkript kopiert!"
   - [ ] English: Text changes to "Copied Transcript"
4. **Paste** into another app (Cmd+V)
   - [ ] Clipboard contains **only transcript text** (no insights)
5. Wait **2 seconds**
   - [ ] Text reverts to timer display

---

### **4. INSIGHTS FUNCTIONALITY** 💡

**Goal**: Verify insights generation and display

#### **Test A: Toggle to Insights**

1. After generating transcription, click **toggle button** in Listen window header
   - [ ] German: Button shows "Erkenntnisse" when on transcript view
   - [ ] English: Button shows "Insights" when on transcript view
2. Click the toggle
   - [ ] View switches to **insights panel**
   - [ ] German: Button now shows "Transkript"
   - [ ] English: Button now shows "Transcript"
3. Verify **insights display**:
   - [ ] 3 bullet points with insights
   - [ ] Markdown formatting (if backend sends it)
   - [ ] **Scrollbar** appears if content overflows

#### **Test B: No Insights State**

1. Click Listen, then **immediately** toggle to insights (before any speech)
2. Verify:
   - [ ] German: "Noch keine Erkenntnisse" displays
   - [ ] English: "No insights yet" displays

#### **Test C: Copy Insights**

1. Generate insights (speak, wait for insights to appear)
2. Switch to **insights view**
3. **Hover** over header
   - [ ] German: "EVIA Analyse kopieren"
   - [ ] English: "Copy Insights"
4. **Click** to copy
   - [ ] German: "EVIA Analyse kopiert!"
   - [ ] English: "Copied Insights"
5. **Paste** into another app
   - [ ] Clipboard contains **only insights text** (no transcript)

#### **Test D: Copied State Isolation**

1. In **transcript view**, click copy → shows "Transkript kopiert!"
2. **Toggle to insights view**
   - [ ] Header shows "EVIA Analyse kopieren" (NOT still showing "kopiert!")
3. In **insights view**, click copy → shows "EVIA Analyse kopiert!"
4. **Toggle back to transcript**
   - [ ] Header shows "Transkript kopieren" (NOT still showing "kopiert!")

**This verifies the bug fix**: `copiedView` state tracks which view was copied, preventing bleed-through.

---

### **5. ASK FUNCTIONALITY** 💬

**Goal**: Verify Ask window and question submission

#### **Test A: Open Ask Window**

1. **Click** "Fragen"/"Ask" button in header
   - [ ] **Ask window opens** below header
   - [ ] Input field visible
   - [ ] German placeholder: "Stelle EVIA eine Frage..."
   - [ ] English placeholder: "Ask EVIA a question..."

#### **Test B: Ask Question**

1. Type a question: "What is the weather today?"
2. **Press Enter** or click submit button (↵ icon)
   - [ ] Question sends to backend
   - [ ] Response appears in window
   - [ ] Markdown rendering (if backend sends formatted text)
   - [ ] **Scrollbar** appears if response is long

#### **Test C: Close Ask Window**

1. With Ask window open, click **"Ask"** button again
   - [ ] Window closes/hides

---

### **6. SETTINGS WINDOW** ⚙️

**Goal**: Verify settings hover behavior and content

#### **Test A: Open Settings**

1. **Hover** over 3-dot settings button
   - [ ] Settings panel appears **immediately** (no delay)
   - [ ] Panel positioned below header
   - [ ] **Width**: 240px
   - [ ] **Height**: ~400px (or auto-sized to content)
   - [ ] **No close button** visible

#### **Test B: Hover Behavior (CRITICAL)**

1. Hover over 3-dot button → panel opens
2. **Move cursor from button to panel**
   - [ ] Panel **stays open** (doesn't disappear)
3. **Move cursor around inside panel**
   - [ ] Panel **stays open** (stable)
4. **Move cursor out of panel** (into empty space)
   - [ ] Panel **closes after 200ms** delay
5. **Quickly move cursor back into panel** (within 200ms)
   - [ ] Panel **stays open** (timer canceled)

**This tests the cursor polling fix!**

#### **Test C: Settings Content**

- [ ] **Title**: "Einstellungen"/"Settings"
- [ ] **Language Section**:
  - [ ] Two buttons: "Deutsch" and "English"
  - [ ] Active language highlighted (blue border)
  - [ ] Clicking toggles language (app reloads)
- [ ] **Shortcuts Section**:
  - [ ] List of keyboard shortcuts
  - [ ] Icons and labels
- [ ] **Presets Section**:
  - [ ] Preset options
- [ ] **Auto Update Toggle**:
  - [ ] Checkbox with label
- [ ] **Scrollbar**:
  - [ ] If content overflows, scrollbar appears
  - [ ] Custom styled (matches Glass)

#### **Test D: No Grey Edges**

- [ ] **Bottom edge**: No grey shadow below panel
- [ ] **Right edge**: Panel not cut off
- [ ] **Rounded corners**: Border radius visible

---

### **7. SHOW/HIDE FUNCTIONALITY** 👁️

**Goal**: Verify visibility toggle

1. Click **"Anzeigen/Ausblenden"** or **"Show/Hide"** button
   - [ ] All windows **hide** (header, listen, ask, settings)
   - [ ] Header remains in dock/task switcher
2. Press **Cmd+\** (keyboard shortcut)
   - [ ] All windows **reappear** in last positions

---

### **8. KEYBOARD SHORTCUTS** ⌨️

**Goal**: Verify all shortcuts work

- [ ] **Cmd+\\**: Toggle visibility (show/hide all)
- [ ] **Cmd+Enter**: Open Ask window
- [ ] **Cmd+↑**: Move header up
- [ ] **Cmd+↓**: Move header down
- [ ] **Cmd+←**: Move header left
- [ ] **Cmd+→**: Move header right

**Smooth Movement Test:**
1. **Hold** Cmd+→ (spam right arrow)
   - [ ] Header moves **smoothly** (no lag)
   - [ ] Movement **stops when released**
   - [ ] **No jank** or stuttering (fixed by animation queue + saveState optimization)

---

### **9. WINDOW POSITIONING** 🎯

**Goal**: Verify window layout and positioning

#### **Test A: Header Centering**

1. On app launch:
   - [ ] Header appears **centered horizontally** at top of screen
   - [ ] Positioned correctly for new 480px width

#### **Test B: Dragging**

1. **Click and drag** header bar (not buttons)
   - [ ] Header moves with cursor
   - [ ] Position **persists** after dragging (saved to disk)
2. **Quit and reopen** app
   - [ ] Header reappears in **last dragged position**

#### **Test C: Screen Edge Clamping**

1. Drag header to **right screen edge**
   - [ ] Header **touches right edge** (no invisible wall)
   - [ ] **+10px buffer** allows full contact with edge
2. Drag header to **left screen edge**
   - [ ] Header stops at left edge (not off-screen)
3. Drag header **down** to bottom
   - [ ] Header stops before going off-screen

#### **Test D: Child Window Positioning**

1. Open **Listen window**
   - [ ] Positioned **below header** (8px gap)
   - [ ] **Centered** horizontally relative to header
2. Move header with **arrow keys**
   - [ ] Listen window **follows header** position
   - [ ] Gap remains constant (8px)

---

### **10. BACKEND INTEGRATION** 🔌

**Goal**: Verify desktop connects to backend correctly

#### **Test A: WebSocket Connection**

**Check backend logs:**
```bash
docker-compose logs -f backend
```

1. Click **"Listen"** in desktop app
2. Backend logs should show:
   - [ ] `WebSocket connection established`
   - [ ] `chat_id: <number>`
   - [ ] `source: mic`
   - [ ] `token: <jwt>`

#### **Test B: Audio Streaming**

**With Listen active and speaking:**

Backend logs should show:
- [ ] `Received audio chunk: <size> bytes`
- [ ] Periodic audio data (every 100-200ms)

Desktop logs (`Console.app` or dev tools):
- [ ] `[AudioProcessor] Sending PCM16 chunk: <size> bytes`

#### **Test C: Transcription Reception**

**Backend sends transcript segments:**

Desktop logs:
- [ ] `[ListenView] Received transcript: <text>`
- [ ] `speaker: null` (no diarization yet)

#### **Test D: Insights Request**

1. After transcription, toggle to insights
2. Backend logs:
   - [ ] `POST /insights with chat_id: <number>`
   - [ ] `Returning <number> insights`

---

### **11. ERROR HANDLING** ⚠️

**Goal**: Verify graceful failures

#### **Test A: No Backend**

1. **Stop backend**: `docker-compose down`
2. Launch desktop app
3. Click **"Listen"**
   - [ ] Error message appears OR
   - [ ] Listen button shows error state
   - [ ] App doesn't crash

#### **Test B: No Microphone Permission**

1. Revoke mic permission (System Preferences → Security → Microphone)
2. Click **"Listen"**
   - [ ] Permission prompt appears OR
   - [ ] Error message about permissions

#### **Test C: Network Interruption**

1. Start listening with backend running
2. **Stop backend** mid-session
   - [ ] Desktop detects disconnect
   - [ ] Shows reconnection attempt OR error state
   - [ ] App doesn't crash

---

## 🎨 **VISUAL REGRESSION TESTS**

### **Glass Parity Checklist**

Compare side-by-side with Glass app (if available):

- [ ] **Header height**: 47px (EVIA) vs Glass
- [ ] **Header width**: 480px (EVIA) vs Glass (varies)
- [ ] **Background blur**: Same opacity/blur amount
- [ ] **Border gradient**: White gradient frame on header
- [ ] **Listen button**: White gradient frame on button (::after)
- [ ] **Button spacing**: 4px gap between actions
- [ ] **Font**: Helvetica Neue, 12px, weights match
- [ ] **Icon sizes**: 
  - Listen icon: 12x11px
  - Command icon: 11x12px
  - Settings dots: 1px radius circles
- [ ] **Rounded edges**: 9000px border-radius (pill shape)
- [ ] **Settings panel**: 240x400px (EVIA) vs Glass
- [ ] **Scrollbar**: Custom styled, matches Glass

---

## 🐛 **KNOWN ISSUES (Already Fixed)**

These should **NOT** occur:

- ❌ ~~Header right side cut off~~ → **FIXED** (480px width)
- ❌ ~~Settings button not visible~~ → **FIXED** (480px width)
- ❌ ~~Settings panel disappears when hovering~~ → **FIXED** (cursor polling)
- ❌ ~~Listen window stays after "Done"~~ → **FIXED** (3s auto-hide)
- ❌ ~~"Copied" state bleeds between views~~ → **FIXED** (copiedView tracking)
- ❌ ~~Copy copies both transcript AND insights~~ → **FIXED** (separate handlers)
- ❌ ~~Movement lags when spamming shortcuts~~ → **FIXED** (animation queue + saveState guard)
- ❌ ~~Header can't touch right screen edge~~ → **FIXED** (+10px buffer)
- ❌ ~~"Follow Live" button~~ → **REMOVED** (auto-scroll instead)

---

## 📊 **TEST REPORT TEMPLATE**

After testing, fill this out:

```
EVIA Desktop i18n & UI Polish - Test Report
Date: _____________
Tester: ___________
Build: mup-integration branch, commit 62ac01a

┌─────────────────────────────────┬──────┬──────┐
│ Test Category                   │ Pass │ Fail │
├─────────────────────────────────┼──────┼──────┤
│ 1. Header UI                    │  [ ] │  [ ] │
│ 2. Language Switching           │  [ ] │  [ ] │
│ 3. Listen Functionality         │  [ ] │  [ ] │
│ 4. Insights Functionality       │  [ ] │  [ ] │
│ 5. Ask Functionality            │  [ ] │  [ ] │
│ 6. Settings Window              │  [ ] │  [ ] │
│ 7. Show/Hide Functionality      │  [ ] │  [ ] │
│ 8. Keyboard Shortcuts           │  [ ] │  [ ] │
│ 9. Window Positioning           │  [ ] │  [ ] │
│ 10. Backend Integration         │  [ ] │  [ ] │
│ 11. Error Handling              │  [ ] │  [ ] │
└─────────────────────────────────┴──────┴──────┘

Critical Issues Found:
1. ____________________________
2. ____________________________
3. ____________________________

Non-Critical Issues:
1. ____________________________
2. ____________________________

Notes:
_________________________________
_________________________________
```

---

## 🚀 **QUICK SMOKE TEST (5 minutes)**

If you only have 5 minutes, test these critical paths:

1. **Visual**: Header visible, no cutoff, settings button visible ✓
2. **Language**: Toggle German ↔ English, verify UI text changes ✓
3. **Listen**: Click Listen, speak, see transcription appear ✓
4. **Insights**: Toggle to insights, verify content shows ✓
5. **Copy**: Hover header in Listen view, click copy, paste elsewhere ✓
6. **Settings**: Hover 3-dot button, move cursor to panel, verify it stays open ✓
7. **Shortcuts**: Press Cmd+→ 10 times rapidly, verify no lag ✓

If all 7 pass → **GREEN LIGHT** ✅  
If any fail → **Run full test suite** ⚠️

---

## 📝 **TESTING NOTES**

- **DevTools**: Enable in dev mode for console logs
- **Backend logs**: Monitor with `docker-compose logs -f backend`
- **Desktop logs**: Check `Console.app` (filter by "EVIA")
- **Screenshots**: Take before/after for visual comparison
- **Video**: Record screen for bug reports

---

## ✅ **ACCEPTANCE CRITERIA**

**To pass QA, ALL must be true:**

1. ✅ Header displays fully (no cutoff, settings visible)
2. ✅ Language toggle works (German ↔ English, persists)
3. ✅ Listen button cycles: Listen → Stop → Done → auto-hide
4. ✅ Transcription appears in real-time
5. ✅ Auto-scroll works (follows when at bottom, stops when scrolled up)
6. ✅ Insights toggle works (Transcript ↔ Insights)
7. ✅ Copy button works separately for transcript and insights
8. ✅ Settings hover works (panel stays open when cursor inside)
9. ✅ Keyboard shortcuts work (no lag when spamming)
10. ✅ Header can touch right screen edge
11. ✅ All German translations correct
12. ✅ No crashes, no console errors (minor warnings OK)

---

**End of Test Plan** 🎯

