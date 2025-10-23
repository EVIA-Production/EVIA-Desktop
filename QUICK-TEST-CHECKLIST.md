# Quick Test Checklist - Critical Fixes

## ⚡ Fast Testing (5 minutes)

### Test 1: Listen Window Layout ✅
**Goal**: Verify Listen appears side-by-side, not overlapping

1. Press `Cmd+Enter` → Ask opens
2. Click "Listen" in header
3. **✅ PASS**: Listen is to the LEFT of Ask (not on top)
4. **❌ FAIL**: Listen covers Ask window

---

### Test 2: Cmd+Enter Behavior ✅
**Goal**: Verify closing Ask doesn't close Listen

1. With both Ask and Listen open
2. Press `Cmd+Enter`
3. **✅ PASS**: Ask closes, Listen stays open
4. **❌ FAIL**: Both windows close

---

### Test 3: Language Change Clearing ✅
**Goal**: Verify Ask clears when language changes

1. Open Ask, type question, get response
2. Open Settings, change language
3. **✅ PASS**: Ask is now empty (no question, no response)
4. **❌ FAIL**: Old question/response still visible

---

### Test 4: Input Auto-Focus ✅
**Goal**: Verify can type immediately without clicking

1. Press `Cmd+Enter` to open Ask
2. Immediately start typing (don't click anything)
3. **✅ PASS**: Text appears in input field
4. **❌ FAIL**: Nothing happens, need to click first

---

### Test 5: Clean Recording Start ✅
**Goal**: Verify no old data when starting new recording

1. Record something, get insights
2. Change language
3. Click "Zuhören/Listen" to start new recording
4. **✅ PASS**: See "Transkript" tab, no old data, timer at 00:00
5. **❌ FAIL**: See old insights or transcripts

---

## 🔴 Expected Backend Issues

When testing, you WILL see these backend bugs (not Desktop's fault):

### 1. Wrong Language Transcripts
- Set language to English → Transcripts in German
- **Report to backend team**

### 2. Wrong Language Insights
- Set language to English → Insights in German
- **Report to backend team**

### 3. Wrong Language Ask Responses
- Click German insight → Response in English
- **Report to backend team**

### 4. Groq Rate Limit
- Error: "Rate limit reached for model llama-3.3-70b-versatile"
- **Report to backend team**

---

## 📝 How to Report Results

**If ALL Desktop tests pass**:
```
✅ All Desktop tests PASSED!
Desktop is production-ready.

Backend issues observed:
- [ ] Transcript language mismatch
- [ ] Insights language mismatch
- [ ] Ask response language mismatch
- [ ] Groq rate limit error
```

**If ANY Desktop test fails**:
```
❌ Desktop test FAILED: [Test Name]
Expected: [What should happen]
Actual: [What actually happened]

Console logs:
[Paste relevant console output]
```

---

## 🚀 Start Testing

Run this command:
```bash
cd EVIA-Desktop && npm run dev
```

Then follow the 5 tests above. Should take **5 minutes total**.

---

**Good luck!** 🎯

