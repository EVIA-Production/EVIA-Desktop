# 🔴 CRITICAL: Backend Language Parameter Ignored

**Date:** 2025-10-12  
**Status:** 🔴 **BACKEND BUG - BLOCKING FEATURE**

---

## 🚨 Problem Summary

**Frontend sends `&lang=en` → Backend ignores it → Deepgram uses German**

---

## 📊 Evidence from Backend Logs

### What Frontend Sends (CORRECT ✅)
```
Line 30: GET /ws/transcribe?chat_id=13&token=...&source=mic&lang=en&sample_rate=24000
                                                                    ^^^^^^^^
```

### What Backend Does (WRONG ❌)
```
Line 61-63:
[LANG] Retrieved from Redis: None (user_id=10)
[LANG] After Redis fallback: de              ❌ IGNORES URL PARAM
[LANG] FINAL language for Deepgram: de      ❌ USES FALLBACK, NOT URL
```

### Deepgram Configuration (WRONG ❌)
```
Line 87-100:
options: {
    "language": "de",    ❌ Should be "en" from URL parameter
    "model": "nova-2",
    ...
}
```

---

## 🔍 Root Cause Analysis

### Backend Logic Flow (Current - BROKEN)
```python
# Line 270: api/routes/websocket.py
lang_from_redis = redis.get(f"user:{user_id}:language")  # Returns None
if not lang_from_redis:
    lang = 'de'  # ❌ HARDCODED FALLBACK - IGNORES URL PARAM

# Line 287:
final_lang = lang  # Uses 'de' from fallback, NOT from URL param
```

### What Should Happen (CORRECT)
```python
# STEP 1: Get lang from URL query parameter (highest priority)
lang_from_url = query_params.get('lang')  # 'en'

# STEP 2: Fallback to Redis if URL param missing
if not lang_from_url:
    lang_from_redis = redis.get(f"user:{user_id}:language")
    
# STEP 3: Final fallback to 'de' if both missing
final_lang = lang_from_url or lang_from_redis or 'de'
```

---

## 🎯 Required Backend Fix

### File: `EVIA-Backend/api/routes/websocket.py`

**Current Code (Lines ~270-287):**
```python
# [LANG] Retrieve language from Redis
lang_from_redis = await redis.get(f"user:{user.id}:language")
logger.info(f"[LANG] Retrieved from Redis: {lang_from_redis} (user_id={user.id})")

if not lang_from_redis:
    lang = 'de'  # ❌ WRONG: Ignores URL parameter
    logger.info(f"[LANG] After Redis fallback: {lang}")
else:
    lang = lang_from_redis
    
# ... later ...
final_lang = lang  # ❌ WRONG: Never checks URL param
logger.info(f"[LANG] FINAL language for Deepgram: {final_lang} | source={source} | dg_lang_param={dg_lang}")
```

**Fixed Code (CORRECT):**
```python
# [LANG] Priority: URL param > Redis > Default 'de'
lang_from_url = query_params.get('lang')  # ✅ Check URL first
lang_from_redis = await redis.get(f"user:{user.id}:language")

logger.info(f"[LANG] Retrieved from URL: {lang_from_url} (user_id={user.id})")
logger.info(f"[LANG] Retrieved from Redis: {lang_from_redis} (user_id={user.id})")

# Apply priority
if lang_from_url:
    lang = lang_from_url  # ✅ URL has highest priority
    logger.info(f"[LANG] Using URL parameter: {lang}")
elif lang_from_redis:
    lang = lang_from_redis
    logger.info(f"[LANG] Using Redis value: {lang}")
else:
    lang = 'de'  # Default fallback
    logger.info(f"[LANG] Using default fallback: {lang}")
    
# ... later ...
final_lang = lang
logger.info(f"[LANG] FINAL language for Deepgram: {final_lang} | source={source} | dg_lang_param={dg_lang}")
```

---

## 📋 Verification Test

### Test Command
```bash
cd EVIA-Backend
python3 test_lang_transcription.py
```

### Expected Backend Logs (CORRECT)
```
[LANG] Retrieved from URL: en (user_id=10)           ✅
[LANG] Retrieved from Redis: None (user_id=10)        ✅
[LANG] Using URL parameter: en                        ✅
[LANG] FINAL language for Deepgram: en | source=mic  ✅

options: {
    "language": "en",    ✅ Correct!
    ...
}
```

---

## 🔧 Additional Backend Issues Found

### Issue 2: Ask Prompt Context (from user)
**Problem:** When user types in Ask bar after insight, Groq thinks ask query is from prospect, not user.

**Current Prompt (WRONG):**
```python
# Backend probably sends transcript like:
"Transcript:
Speaker 0 (Them): Hello, I'm interested in your product
Speaker 1 (You): Great! What features do you need?

User Ask: What are their pain points?"
```

Groq interprets "User Ask" as Speaker 0's dialogue.

**Fixed Prompt (Glass Parity):**
```python
# Check glass/src/features/ask/askService.js
# Glass separates transcript from user query:

"Context from meeting:
[TRANSCRIPT START]
Speaker 0 (Prospect): Hello, I'm interested in your product
Speaker 1 (User): Great! What features do you need?
[TRANSCRIPT END]

User's Question:
What are their pain points?

Instructions: Answer the user's question based on the transcript context above."
```

**Backend Files to Check:**
- `EVIA-Backend/api/routes/ask.py` (or wherever Ask prompts are constructed)
- Look for how transcript is injected into LLM prompt
- Need to clearly separate:
  - Transcript context (labeled as "meeting dialogue")
  - User's question (labeled as "user's query")

---

### Issue 3: WebSocket Connection Timeout
**Problem:** Backend closes connection after ~15 seconds of no audio.

**Backend Logs:**
```
Line 145: WARNING - WebSocket receive timeout, closing connection
Line 147: Session summary: frames_enqueued=0 frames_sent=0 bytes_sent=0B
```

**Root Cause:** No audio being sent from frontend (0 frames).

**Possible Causes:**
1. Audio capture not starting (frontend issue)
2. Audio permissions not granted (frontend issue)
3. Audio processor not sending data (frontend issue)

**Quick Test:**
- Open browser DevTools → Console
- Look for: `[AudioProcessor] Sending audio frame` logs
- If missing → Audio capture broken

---

## 📊 Impact Assessment

| Issue | Impact | Blocker | Owner |
|-------|--------|---------|-------|
| Lang parameter ignored | HIGH | ✅ YES | Backend |
| Ask prompt context | HIGH | ✅ YES | Backend |
| WebSocket timeout | MEDIUM | ⚠️ PARTIAL | Frontend/Backend |
| German transcription stops | HIGH | ✅ YES | Backend |

---

## 🎯 Action Plan

### Backend Team (URGENT - 30 minutes)

1. **Fix language parameter priority** (15 min)
   - File: `api/routes/websocket.py`
   - Change: URL param > Redis > Default
   - Test: `python3 test_lang_transcription.py`

2. **Fix Ask prompt context** (15 min)
   - File: `api/routes/ask.py`
   - Change: Separate transcript from user query
   - Reference: Glass askService.js

### Frontend Team (DONE ✅)

1. ✅ Send `&lang=en` parameter (WORKING)
2. ✅ Reactive language toggle (WORKING)
3. ⏳ Header singularity animation (IN PROGRESS)
4. ⏳ Close windows on language toggle (IN PROGRESS)

---

## 🔍 Backend Test Protocol

### Test 1: Language Parameter
```bash
# Start backend
docker-compose up

# In new terminal
cd EVIA-Backend
python3 test_lang_transcription.py

# Check logs for:
# [LANG] Using URL parameter: en ✅
# [LANG] FINAL language for Deepgram: en ✅
```

### Test 2: Ask Prompt
```bash
# After fix, test Ask window:
1. Start Listen → Get transcript
2. Click insight → Ask window opens
3. Type: "What are their pain points?"
4. Check response: Should understand question is FROM user, not prospect
```

---

## 💬 Communication to Backend Team

**Subject:** URGENT - Language parameter ignored in WebSocket endpoint

**Body:**
The frontend correctly sends `&lang=en` in the WebSocket URL, but the backend ignores it and defaults to German. This blocks the English transcription feature.

**Backend logs show:**
```
Line 30: &lang=en (frontend sends correct param) ✅
Line 62: [LANG] Retrieved from Redis: None
Line 62: [LANG] After Redis fallback: de  ❌ IGNORES URL
Line 63: [LANG] FINAL language for Deepgram: de ❌
```

**Required fix:** Change priority to URL param > Redis > Default 'de'

**File:** `EVIA-Backend/api/routes/websocket.py` (lines ~270-287)

**ETA:** 15 minutes

**Test:** `python3 test_lang_transcription.py` (should show "Using URL parameter: en")

---

## 📄 Related Files

- Backend: `EVIA-Backend/api/routes/websocket.py`
- Backend: `EVIA-Backend/api/routes/ask.py`
- Frontend: `EVIA-Desktop/src/renderer/services/websocketService.ts` (✅ CORRECT)
- Test: `EVIA-Backend/test_lang_transcription.py` (✅ WORKING)

---

**Status:** 🔴 **BLOCKED - Awaiting Backend Fix**

**Frontend:** ✅ DONE (lang parameter sent correctly)  
**Backend:** ❌ BROKEN (ignores lang parameter)

**ETA to Complete:** 30 minutes (backend fix) + 10 minutes (frontend animations)

---

**Next Steps:**
1. Backend team fixes language priority
2. Backend team fixes Ask prompt context
3. Frontend team completes animations (in progress)
4. Test end-to-end with new DMG

