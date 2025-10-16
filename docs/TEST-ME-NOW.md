# 🚀 TEST ME NOW - Quick Start

**Branch:** `staging-unified-v2`  
**DMG:** `dist/EVIA Desktop-0.1.0-arm64.dmg` (1.9 GB)  
**Status:** ✅ READY

---

## ⚡ Install & Test (5 Minutes)

### Install
```bash
cd /Users/benekroetz/EVIA/EVIA-Desktop
open "dist/EVIA Desktop-0.1.0-arm64.dmg"
# Drag to Applications, launch
```

---

## 🎯 3 Critical Tests

### Test 1: Insight Click (30 seconds)
```
1. Start Listen → Wait for insight
2. Click insight

✅ PASS: Ask window opens at 400px, response visible & streams
❌ FAIL: Window tiny / response "swallowed" / no output
```

---

### Test 2: Language Toggle (15 seconds)
```
1. Settings → Click "English"

✅ PASS: Instant update (no reload), smooth animation, all windows change
❌ FAIL: Page reloads / lag / windows don't update
```

---

### Test 3: English Transcription (30 seconds)
```
1. Settings → English → Start Listen → Speak English

✅ PASS: Transcript in English
❌ FAIL: Still German
```

---

## 📊 Report Results

**If PASS:**
- "All tests passed, ready to merge!"

**If FAIL:**
```
1. Open DevTools (F12)
2. Go to Console tab
3. Copy ALL logs
4. Paste in chat with test number that failed
```

---

## 🔧 What Was Fixed

✅ Ask window height: 61px → 400px  
✅ IPC conflicts removed (old code deleted)  
✅ Reactive i18n: No reload, instant, animated  
✅ Language parameter: WebSocket now includes `&lang=en`

---

**Ready? Install DMG and run 3 tests above. Takes 2 minutes.**

**DMG Location:** `/Users/benekroetz/EVIA/EVIA-Desktop/dist/EVIA Desktop-0.1.0-arm64.dmg`

