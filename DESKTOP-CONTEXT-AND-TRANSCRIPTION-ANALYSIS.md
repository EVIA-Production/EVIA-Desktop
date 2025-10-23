# 🔍 DESKTOP CONTEXT & TRANSCRIPTION ANALYSIS

**Date**: 2025-10-21  
**Status**: Analysis Complete - Issues Identified

---

## 📋 USER REPORTED ISSUES

### Issue 1: Ask has context from previous sessions ✅ EXPECTED BEHAVIOR

**Observation**:
- User presses Cmd+Ask BEFORE starting a recording session
- Asks: "What did I ask before?"
- Gets answer referencing previous topics (study time, Lerntechniken, family interactions)

**Questions**:
1. Does Glass do the same?
2. Does it have context on presets from EVIA-Frontend?

---

## ✅ ISSUE 1 ANALYSIS: Chat History Context (WORKING AS DESIGNED)

### How Glass Handles This

**File**: `glass/src/features/ask/askService.js` (lines 218-275)

```javascript
async sendMessage(userPrompt, conversationHistoryRaw=[]) {
    // ALWAYS gets or creates an active session
    sessionId = await sessionRepository.getOrCreateActive('ask');
    
    // Formats conversation history
    const conversationHistory = this._formatConversationForPrompt(conversationHistoryRaw);
    
    // Includes history in system prompt
    const systemPrompt = getSystemPrompt('pickle_glass_analysis', conversationHistory, false);
    
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}
```

**Key Logic in Glass**: `sessionRepository.getOrCreateActive('ask')`
- **ALWAYS finds or creates an active session**
- **Prefers existing 'listen' sessions** over 'ask' sessions for continuity
- If you had a previous listen session, Glass **re-uses it** for Ask

**Result**: Glass ALWAYS includes previous conversation history in Ask requests.

---

### How EVIA Handles This

**File**: `EVIA-Backend/backend/api/routes/ask.py` (lines 49-88)

```python
@ask_router.post("/ask")
async def ask_endpoint(
    body: AskRequest,
    current_user: BaseInteractionUser = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_session),
):
    # Verify chat ownership
    chat = await _authorize_chat_access(body.chat_id, current_user, session)
    
    # Sync active prompt (system prompt preset from frontend)
    await groq_service.sync_active_prompt_to_redis(session, current_user.id)
    
    # Session ID for chat history
    session_id = f"httpask:{current_user.id}:{body.chat_id}"
    
    # ... later in groq_service.generate_response_from_history() ...
    # Loads full history from Redis and includes in Groq request
```

**Key Logic in EVIA**:
1. **Session ID**: Deterministic based on `user_id:chat_id`
2. **History Loading**: `groq_service.generate_response_from_history()` loads full chat history from Redis
3. **System Prompt**: Line 59 syncs the **active system prompt (preset)** from frontend to Redis
4. **Context Inclusion**: History is included in every Ask request

**Result**: EVIA ALSO includes previous conversation history in Ask requests.

---

### Answer to User's Questions

**Q1: Does Glass do the same?**
✅ **YES** - Glass includes previous conversation history in Ask requests, even before starting a recording session.

**Q2: Does it have context on presets from EVIA-Frontend?**
✅ **YES** - Line 59 of `ask.py`: `await groq_service.sync_active_prompt_to_redis(session, current_user.id)`
- This syncs the **active system prompt (preset)** from the frontend
- Groq uses this preset when generating responses
- So your custom system prompts from the frontend ARE being used

**Conclusion**: This is **WORKING AS DESIGNED**. Both Glass and EVIA load chat history for Ask requests to provide context-aware responses.

---

## 🐛 ISSUE 2 ANALYSIS: Mic Transcription Stops After Few Minutes (CRITICAL BUG)

### User's Description

**Symptoms**:
1. Mic transcription works initially
2. After a few minutes:
   - First **delays a few words**
   - Then **fully misses some words**
   - Then **stops completely** (binary sending `00 00 00`)

**Language**: English (German works better)

---

### Terminal Log Analysis

**From attached terminal logs**:

**Lines 1-913**: Audio IS being sent successfully
```
Received 4800 bytes from Desktop (source=mic)
Sent 4800 bytes to Deepgram for language=en
```
**Audio is flowing**: Desktop → Backend → Deepgram ✅

**Lines 300-900**: Deepgram returns MANY empty results
```
[websocket.py:431] DEBUG - No transcript text found in Deepgram message.
[websocket.py:437] DEBUG - Skipping empty transcript (len=0), is_final=True
```
**Problem**: Deepgram is **receiving audio** but **not returning transcripts** ❌

**Lines 913-918**: User stops recording
```
[websocket.py:1079] INFO - User stopped.
```

**Conclusion from Logs**:
- Desktop IS sending audio (not `00 00 00` at this point)
- Deepgram IS receiving audio
- Deepgram is NOT returning transcripts (language detection failure?)

---

### Root Cause Analysis

#### Glass's Solution: Advanced Keepalive & Session Renewal

**File**: `glass/src/features/listen/stt/sttService.js` (lines 8-22, 475-491)

Glass has **TWO mechanisms** to prevent transcription stopping:

**1. Keep-Alive Messages (Every 60 seconds)**
```javascript
const KEEP_ALIVE_INTERVAL_MS = 60 * 1000; // 1 minute

this.keepAliveInterval = setInterval(() => {
    this._sendKeepAlive();
}, KEEP_ALIVE_INTERVAL_MS);
```
**Purpose**: Prevent provider from treating connection as idle

**2. Session Renewal (Every 20 minutes)**
```javascript
const SESSION_RENEW_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

this.sessionRenewTimeout = setTimeout(() => {
    this._renewSessions(); // Tear down and recreate sessions
}, SESSION_RENEW_INTERVAL_MS);
```
**Purpose**: Dodge 30-minute hard timeout enforced by providers (10-minute safety buffer)

---

#### EVIA's Current Implementation

**File**: `EVIA-Backend/backend/api/routes/websocket.py`

**Keepalive from Backend to Desktop (25 seconds)**:
```python
keepalive_interval = 25.0  # Send keepalive every 25s if no data

if elapsed_since_activity >= keepalive_interval:
    await websocket.send_json({"type": "keepalive", "data": {"timestamp": time.time()}})
```

**Keepalive from Backend to Deepgram (3 seconds)**:
```python
async def keepalive_loop():
    while True:
        await asyncio.sleep(3.0)
        if dg_connection:
            await dg_connection.send(json.dumps({"type": "KeepAlive"}))
```

**Missing**: Session renewal mechanism (no auto-reconnect to Deepgram after 20 minutes)

---

### The "00 00 00" Binary Issue

**User Reports**: Seeing binary `00 00 00` being sent

**Possible Causes**:

1. **Microphone Stops Sending Audio** (Desktop Issue)
   - macOS audio permissions revoked mid-session
   - AudioWorklet crashes/stops processing
   - Audio source disconnects

2. **Silence Detection** (Deepgram Issue)
   - Deepgram's English model is more aggressive with silence detection
   - Ambient noise not treated as speech
   - Mic sensitivity too low

3. **Deepgram Language Model Mismatch**
   - English model expects specific accents/patterns
   - German accent in English speech confuses model
   - Deepgram defaults to US English, but user might be speaking with German accent

---

### Verification Needed

**Question**: "Did the wav file work?"
- User is asking if a wav file test was run
- We need to check if Deepgram English transcription works with a **known-good audio file**

---

## 🔧 RECOMMENDED FIXES

### Fix 1: Implement Glass-Style Session Renewal (Backend)

**File**: `EVIA-Backend/backend/api/routes/websocket.py`

**Add**:
```python
# Constants
KEEP_ALIVE_INTERVAL_MS = 60_000  # 1 minute (match Glass)
SESSION_RENEW_INTERVAL_MS = 20 * 60_000  # 20 minutes

async def renew_deepgram_session():
    """Tear down and recreate Deepgram connection to avoid 30-min timeout"""
    nonlocal dg_connection, keepalive_task, reconnecting
    
    logger.info("[SESSION-RENEW] Proactively renewing Deepgram session after 20 minutes")
    reconnecting = True
    
    # Close old connection
    try:
        await dg_connection.finish()
    except Exception:
        pass
    
    # Create new connection
    dg_connection = deepgram_client.listen.asynclive.v("1")
    # ... (re-setup event handlers, start connection)
    
    reconnecting = False
    logger.info("[SESSION-RENEW] Deepgram session renewed successfully")
    
    # Schedule next renewal in 20 minutes
    asyncio.create_task(asyncio.sleep(SESSION_RENEW_INTERVAL_MS / 1000))
    asyncio.create_task(renew_deepgram_session())
```

**Impact**: Prevents 30-minute hard timeout from Deepgram

---

### Fix 2: Add Deepgram Language Hint for German-Accented English

**File**: `EVIA-Backend/backend/api/routes/websocket.py` (line 708+)

**Current**:
```python
dg_options = LiveOptions(
    language="en",  # or "de"
    # ...
)
```

**Improved**:
```python
# If English is selected but user might have German accent
if dg_lang == "en":
    dg_options = LiveOptions(
        language="en-US",  # Explicit US English
        detect_language=False,  # Disable auto-detection
        tier="nova-2",  # Better accuracy model
        # Add acoustic model hints if available
    )
else:
    # German works fine
    dg_options = LiveOptions(
        language="de",
        detect_language=False,
    )
```

**Impact**: More accurate transcription for German-accented English

---

### Fix 3: Desktop Audio Validation (Desktop)

**File**: `EVIA-Desktop/src/renderer/audio-processor.js`

**Add logging to detect `00 00 00` audio**:
```javascript
// In AudioWorklet process()
process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    
    const channelData = input[0]; // Float32Array
    
    // Check if audio is all zeros (silence/dead mic)
    const isAllZeros = channelData.every(sample => sample === 0);
    if (isAllZeros) {
        console.warn('[AudioWorklet] Detected all-zero audio frame (mic stopped?)');
        // Optionally: send diagnostic message to main process
    }
    
    // ... rest of processing
}
```

**Impact**: Detect when mic stops sending real audio

---

### Fix 4: Test with Known-Good Audio File

**Create test script**: `EVIA-Backend/test-wav-transcription.sh`

```bash
#!/bin/bash
# Test Deepgram English transcription with a known-good audio file

# Generate a test WAV file (or use existing)
# ffmpeg -f lavfi -i "sine=frequency=1000:duration=5" -ac 1 -ar 48000 test.wav

# Test with Deepgram API directly
curl -X POST "https://api.deepgram.com/v1/listen?language=en&punctuate=true" \
  -H "Authorization: Token ${DEEPGRAM_API_KEY}" \
  -H "Content-Type: audio/wav" \
  --data-binary @test-english-speech.wav

# Expected: Should return accurate transcript
# If it fails, Deepgram API key or account has issues
```

**Impact**: Isolate whether issue is Desktop audio or Deepgram API

---

## 📊 ISSUE PRIORITY

| Issue | Severity | Impact | Fix Complexity |
|-------|----------|--------|----------------|
| Chat history context | ✅ **NON-ISSUE** | None (working as designed) | N/A |
| Mic stops after few min | 🔴 **CRITICAL** | Unusable in English | Medium |
| `00 00 00` binary data | 🟡 **HIGH** | Diagnostic needed | Low |
| Session renewal missing | 🟡 **HIGH** | Long sessions fail | Medium |

---

## 🎯 NEXT STEPS

### Immediate (User)
1. ✅ **Test with WAV file**: Verify Deepgram English model works with known-good audio
2. 📊 **Check Desktop logs**: Look for AudioWorklet errors or `00 00 00` warnings
3. 🎤 **Test mic in macOS**: Verify mic permissions and audio levels in System Preferences

### Backend Agent
1. 🔧 **Implement session renewal**: Add Glass-style 20-minute reconnect logic
2. 🌍 **Improve English language handling**: Add `en-US` explicit model + tier=nova-2
3. 📝 **Add diagnostic logging**: Log when Deepgram returns empty results repeatedly

### Desktop Agent
1. 🔍 **Add audio validation**: Detect and log `00 00 00` frames
2. 📊 **Expose audio stats**: Show mic level, bytes sent, frames processed in DevTools
3. ⚠️ **Graceful degradation**: Warn user if mic stops sending real audio

---

## 🔬 DIAGNOSTIC COMMANDS

### Check if Desktop is sending audio
```bash
# In Desktop DevTools Console (Listen window)
# Look for: "Sent X bytes to backend" messages
# If bytes stop increasing → Desktop audio issue
```

### Check if Backend is receiving audio
```bash
# Backend logs
docker compose logs -f backend | grep "Received.*bytes from Desktop"
# If logs stop → Desktop stopped sending
# If logs continue but no transcripts → Deepgram issue
```

### Check if Deepgram is responding
```bash
# Backend logs
docker compose logs -f backend | grep "Deepgram"
# Look for: "No transcript text found" (means Deepgram returned empty)
# vs. no logs at all (means Deepgram not responding)
```

---

**Status**: Analysis complete, fixes proposed  
**Blocker**: Need to verify if WAV file transcription works  
**Next**: Implement session renewal + English model improvements

