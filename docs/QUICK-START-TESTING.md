# 🚀 Quick Start: Fresh User Testing

**Goal:** Test EVIA Desktop as a brand new user  
**Time:** 30 minutes total  
**Branch:** `evia-desktop-unified-best`

---

## 📝 Step-by-Step Guide

### **Phase 1: Reset (5 min)**

1. **Run automated reset:**
   ```bash
   cd EVIA-Desktop
   ./fresh-user-test-setup.sh
   ```

2. **Manual permission cleanup (REQUIRED):**
   - Open: **System Settings** → **Privacy & Security**
   - **Screen Recording:** Toggle OFF or remove "EVIA Desktop" / "Electron"
   - **Microphone:** Toggle OFF or remove "EVIA Desktop" / "Electron"
   - Close System Settings

---

### **Phase 2: Build (5 min)**

```bash
cd EVIA-Desktop
git checkout evia-desktop-unified-best
npm run build
```

**Expected:** DMG created at `dist/EVIA Desktop-0.1.0-arm64.dmg`

---

### **Phase 3: Install (2 min)**

```bash
# Remove old app
rm -rf /Applications/EVIA\ Desktop.app

# Open DMG
open dist/EVIA\ Desktop-0.1.0-arm64.dmg
```

**Drag "EVIA Desktop" to Applications folder**

---

### **Phase 4: Test E2E Flow (18 min)**

#### **TC1: Launch & Welcome (2 min)**
1. Launch **EVIA Desktop** from Applications
2. ✅ **Verify:** Welcome window appears with:
   - "Get Started with EVIA" title
   - "Open Browser to Log In" button
   - Privacy policy link
   - Glassmorphic design (blur/transparency)

---

#### **TC2: Authentication (3 min)**
1. Click **"Open Browser to Log In"**
2. ✅ **Verify:** 
   - Browser opens to login page
   - Welcome window closes immediately
3. Login with test credentials
4. ✅ **Verify:** Redirect to `evia://auth-callback?token=...`
5. ✅ **Verify:** Permission window appears

---

#### **TC3: Permissions Setup (5 min)**
1. **Microphone Permission:**
   - Click **"Grant Microphone Access"**
   - System dialog appears → Click **"OK"**
   - ✅ **Verify:** Button changes to "Microphone Access Granted" (disabled, green)

2. **Screen Recording Permission:**
   - Click **"Grant Screen Recording Access"**
   - ✅ **Verify:** System Settings opens
   - Manually enable "EVIA Desktop" in Screen Recording
   - Return to EVIA
   - ✅ **Verify:** Button changes to "Screen Recording Granted" (disabled, green)

3. **Auto-continue:**
   - ✅ **Verify:** After both granted, brief "✅ All permissions granted" message appears
   - ✅ **Verify:** Window auto-closes after 200ms (NO manual "Continue" button!)
   - ✅ **Verify:** Main EVIA header appears at top of screen

---

#### **TC4: Core Features (5 min)**
1. **Header:**
   - ✅ **Verify:** Header visible with Listen/Ask buttons
   - Press **Cmd+\\** → Header hides
   - Press **Cmd+\\** → Header shows

2. **Listen:**
   - Click **"Listen"** button
   - ✅ **Verify:** Listen window appears below header
   - Speak a sentence
   - ✅ **Verify:** Real-time transcript appears

3. **Insights:**
   - Click **"Insights"** tab (if available)
   - Click an insight card
   - ✅ **Verify:** Ask window opens with pre-filled prompt
   - ✅ **Verify:** Query auto-submits (no manual "Ask" click needed)
   - ✅ **Verify:** Response streams in
   - ✅ **Verify:** Ask window dynamically resizes to show full response

4. **Manual Ask:**
   - Press **Cmd+Enter**
   - Type: "What is EVIA?"
   - Press **Enter** or click **"Ask"**
   - ✅ **Verify:** Response appears and window resizes

---

#### **TC5: Settings & Account (3 min)**
1. Click **Settings** icon in header
2. ✅ **Verify:** Settings window appears
3. ✅ **Verify:** Contains:
   - Language dropdown
   - Shortcut settings
   - **Logout** button (orange theme)
   - **Quit EVIA** button (red theme)

4. **Test Logout:**
   - Click **"Logout"**
   - ✅ **Verify:** Returns to Welcome window

5. **Re-login:**
   - Click **"Open Browser to Log In"** again
   - ✅ **Verify:** Skips permission window (already granted)
   - ✅ **Verify:** Header appears immediately

---

## ✅ Success Criteria Checklist

- [ ] Welcome window appears on first launch
- [ ] Login opens browser & closes welcome window
- [ ] Permission window styled correctly (Glass parity)
- [ ] Both mic & screen recording permissions grantable
- [ ] Auto-continue after permissions (NO button)
- [ ] Header appears after permissions
- [ ] Cmd+\\ toggles header hide/show
- [ ] Listen captures real-time audio
- [ ] Insight click → Ask auto-submits
- [ ] Ask window dynamically resizes
- [ ] Settings has Logout & Quit buttons
- [ ] Logout returns to Welcome
- [ ] Re-login skips permissions

---

## 🐛 Common Issues & Fixes

### Issue: "Screen Recording permission not working"
**Fix:** 
1. Quit EVIA completely
2. System Settings → Screen Recording → Toggle OFF "EVIA Desktop"
3. Remove "EVIA Desktop" from list
4. Relaunch EVIA and grant permission again

### Issue: "App crashes on launch"
**Fix:**
1. Check Console.app for crash logs
2. Verify DMG built correctly: `ls -lh out/`
3. Rebuild: `npm run build`

### Issue: "Welcome window doesn't appear"
**Fix:**
1. Check if auth token exists: `security find-generic-password -s "EVIA Desktop"`
2. If found, delete: `security delete-generic-password -s "EVIA Desktop" -a "auth-token"`
3. Relaunch

---

## 📊 Test Report Template

```markdown
## EVIA Desktop - Fresh User Test Report

**Tester:** [Your Name]
**Date:** [YYYY-MM-DD]
**Branch:** evia-desktop-unified-best
**Build:** EVIA Desktop-0.1.0-arm64.dmg

### Test Results
- TC1 (Welcome): ✅ PASS / ❌ FAIL
- TC2 (Auth): ✅ PASS / ❌ FAIL
- TC3 (Permissions): ✅ PASS / ❌ FAIL
- TC4 (Core Features): ✅ PASS / ❌ FAIL
- TC5 (Settings): ✅ PASS / ❌ FAIL

### Issues Found
1. [Description]
   - **Severity:** P0 / P1 / P2
   - **Steps to Reproduce:** [...]
   - **Expected:** [...]
   - **Actual:** [...]

### Overall Assessment
- [ ] Ready for user testing
- [ ] Needs minor fixes
- [ ] Needs major fixes

### Notes
[Additional observations]
```

---

## 📚 Related Documentation
- **Detailed Protocol:** `FRESH-USER-TEST-PROTOCOL.md`
- **Branch Analysis:** `BRANCH-SCORING-ANALYSIS.md`
- **Glass Parity:** `GLASS-PARITY-VERIFICATION-REPORT.md`

---

**Time to test!** 🚀
