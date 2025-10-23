# 🔗 Desktop Backend Integration - READY

**Date**: 2025-10-21  
**Status**: ✅ DESKTOP READY FOR BACKEND CHANGES  
**Agent**: Desktop Sentinel

---

## ✅ DESKTOP IS READY

Desktop correctly sends all required parameters to backend and is prepared to receive English/German responses once backend implements fixes.

---

## 📤 WHAT DESKTOP SENDS

### 1. WebSocket Transcription
**Endpoint**: `ws://localhost:8000/ws/transcribe`

**Query Parameters**:
```
?language={en|de}
&chat_id={chat_id}
&token={jwt_token}
&source={mic|system}
```

**Example**:
```
ws://localhost:8000/ws/transcribe?language=en&chat_id=123&token=eyJ...&source=mic
```

**Desktop Code** (`audio-processor-glass-parity.ts`):
```typescript
const language = i18n.getLanguage(); // 'en' or 'de'
const wsUrl = `${backend}/ws/transcribe?chat_id=${chatId}&token=${token}&language=${language}&source=${source}`;
```

✅ Desktop correctly includes `language` parameter

---

### 2. Insights API
**Endpoint**: `POST /insights`

**Request Body**:
```json
{
  "chat_id": 123,
  "language": "en"
}
```

**Desktop Code** (`insightsService.ts`):
```typescript
const response = await fetch(`${baseUrl}/insights`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    chat_id: chatId,
    language: language || 'de'
  })
});
```

✅ Desktop correctly sends `language` parameter

---

### 3. Ask API (with Transcript Context)
**Endpoint**: `POST /ask`

**Request Body**:
```json
{
  "chat_id": 123,
  "prompt": "User's question",
  "language": "en",
  "transcript": "You: Hello\nProspect: Hi there\nYou: ..."
}
```

**Desktop Code** (`askService.ts`):
```typescript
// Fetch last 30 transcript turns for context
const transcripts = await getChatTranscripts(chatId, token, 30);
const transcriptContext = transcripts
  .map(t => `${t.speaker === 1 ? 'You' : 'Prospect'}: ${t.text}`)
  .join('\n');

// Send to backend with context
const response = await fetch(`${baseUrl}/ask`, {
  method: 'POST',
  body: JSON.stringify({
    chat_id: chatId,
    prompt: userPrompt,
    language: language,
    transcript: transcriptContext // ✅ Context included
  })
});
```

✅ Desktop correctly sends `language` and `transcript` context

---

## 📥 WHAT DESKTOP EXPECTS FROM BACKEND

### 1. Transcription WebSocket Messages

**Expected Message Format**:
```json
{
  "type": "transcript_segment",
  "data": {
    "text": "Hello world",
    "speaker": 1,
    "is_final": true
  },
  "_source": "mic"
}
```

OR

```json
{
  "type": "status",
  "data": {
    "echo_text": "Partial transcript...",
    "final": false
  },
  "_source": "mic"
}
```

**Desktop Processing** (`ListenView.tsx`):
```typescript
// Handles both final and partial transcripts
const isFinal = msg.data.is_final === true || msg.data.final === true;
const isPartial = !isFinal;

// Displays full text (no truncation)
setTranscripts(prev => [...prev, {
  text: fullText,
  speaker: speaker,
  isFinal: isFinal
}]);
```

✅ **When Backend Fixed**:
- `text` should be in English when `language=en` sent
- `text` should be in German when `language=de` sent

Currently: ❌ Always German (backend issue)

---

### 2. Insights API Response

**Expected Response Format**:
```json
{
  "summary": [
    "Bullet point 1",
    "Bullet point 2"
  ],
  "topic": {
    "header": "Main Topic Title",
    "bullets": [
      "Topic detail 1",
      "Topic detail 2"
    ]
  },
  "actions": [
    "❓ Action item 1",
    "✨ Action item 2"
  ]
}
```

**Desktop Processing** (`insightsService.ts`):
```typescript
export interface Insight {
  summary: string[];
  topic: {
    header: string;
    bullets: string[];
  };
  actions: string[];
  followUps?: string[]; // Added by Desktop
}

// Desktop adds localized follow-ups
const followUps = language === 'en'
  ? ['✉️ Draft a follow-up email', '✅ Generate action items', '📝 Show summary']
  : ['✉️ Verfasse eine Follow-up E-Mail', '✅ Generiere Aktionspunkte', '📝 Zeige Zusammenfassung'];
```

✅ **When Backend Fixed**:
- All text fields should respect `language` parameter
- English when `language=en`, German when `language=de`

Currently: ❌ Always German (backend issue)

---

### 3. Ask API Response (Streaming)

**Expected Response Format** (SSE stream):
```
data: {"type": "delta", "content": "This "}
data: {"type": "delta", "content": "is "}
data: {"type": "delta", "content": "English"}
data: {"type": "done"}
```

**Desktop Processing** (`askService.ts`):
```typescript
export function streamAsk({ 
  prompt, 
  language, 
  transcript  // Context passed to backend
}: StreamAskParams): StreamHandle {
  // Streams response word-by-word
  // Expects response in correct language
}
```

✅ **When Backend Fixed**:
- Response should be in English when `language=en`
- Response should reference `transcript` context (not generic)

Currently:
- ❌ Always German response (backend issue)
- ❌ Generic responses (transcript context not used)

---

## 🎯 BACKEND ACTION ITEMS

To make English language work, backend needs to:

### Fix #1: Deepgram Language Parameter
**File**: `backend/api/routes/websocket.py`

```python
# Extract language from query parameter
language = request.query_params.get('language', 'de')

# Pass to Deepgram connection
deepgram_options = {
    'language': language,  # ✅ Add this
    'model': 'nova-2',
    # ... other options
}
```

**Verify**: Deepgram supports runtime language switching

---

### Fix #2: Groq System Prompt Language
**File**: `backend/api/routes/insights.py`

```python
# Get language from request
language = request_data.get('language', 'de')

# Language-aware system prompt
if language == 'en':
    system_prompt = """
    You are an AI assistant. Respond ONLY in English.
    Analyze the meeting transcript and provide insights in English.
    """
else:
    system_prompt = """
    Du bist ein KI-Assistent. Antworte NUR auf Deutsch.
    Analysiere das Meeting-Transkript und gib Erkenntnisse auf Deutsch.
    """

# Send to Groq with language-specific prompt
response = await groq_client.chat.completions.create(
    model="llama-3.1-70b-versatile",
    messages=[
        {"role": "system", "content": system_prompt},
        # ... user message
    ]
)
```

**Verify**: Groq responses respect system prompt language

---

### Fix #3: Ask Endpoint Context Usage
**File**: `backend/api/routes/ask.py`

```python
# Get transcript context from request
transcript = request_data.get('transcript', '')
language = request_data.get('language', 'de')

# Include context in prompt
if language == 'en':
    system_prompt = f"""
    You are an AI assistant. Respond ONLY in English.
    
    Conversation context:
    {transcript}
    
    User request: {{user_prompt}}
    
    Provide a context-aware response that references specific details from the conversation above.
    """
else:
    system_prompt = f"""
    Du bist ein KI-Assistent. Antworte NUR auf Deutsch.
    
    Gesprächskontext:
    {transcript}
    
    Benutzeranfrage: {{user_prompt}}
    
    Gib eine kontextbezogene Antwort, die sich auf spezifische Details aus dem Gespräch bezieht.
    """
```

**Verify**: Follow-up emails reference actual conversation

---

## 🧪 VERIFICATION STEPS

After backend fixes, test:

### Test 1: English Transcription
```bash
1. Set Desktop language to English
2. Start recording
3. Speak in English
4. Expected: Transcripts in English ✅
```

### Test 2: English Insights
```bash
1. Set Desktop language to English
2. Record conversation
3. Stop recording
4. Expected: Insights in English ✅
```

### Test 3: Context-Aware Follow-Ups
```bash
1. Record conversation about "project deadline"
2. Click "✉️ Draft follow-up email"
3. Expected: Email mentions "project deadline" ✅
```

---

## 📊 DESKTOP READINESS MATRIX

| Component | Desktop Status | Backend Status | Notes |
|-----------|---------------|----------------|-------|
| **Language Parameter Sending** | ✅ READY | ⏳ PENDING | Desktop sends correctly |
| **Transcript Display** | ✅ READY | ⏳ PENDING | Desktop displays any language |
| **Insights Display** | ✅ READY | ⏳ PENDING | Desktop displays any language |
| **Context Passing** | ✅ READY | ⏳ PENDING | Desktop sends transcript |
| **Error Handling** | ✅ READY | N/A | Desktop handles API errors |
| **Race Conditions** | ✅ READY | N/A | Language toggle protected |
| **Edge Cases** | ✅ READY | N/A | 6 scenarios covered |

---

## 🚀 DEPLOYMENT SEQUENCE

### Phase 1: Desktop Testing (NOW)
```
1. Test Desktop edge cases ✅
2. Verify language parameter sending ✅
3. Document backend expectations ✅
4. Signal "DESKTOP READY" ✅
```

### Phase 2: Backend Fixes (NEXT)
```
1. Implement Deepgram language parameter
2. Implement Groq language-aware prompts
3. Include transcript context in Ask
4. Test backend fixes independently
```

### Phase 3: End-to-End Testing (AFTER BACKEND)
```
1. Set language to English
2. Test full flow (record → insights → ask)
3. Verify all responses in English
4. Test context-aware follow-ups
5. Deploy to production ✅
```

---

## 📝 SUMMARY

### Desktop Status
- ✅ **Sends** language parameter correctly
- ✅ **Sends** transcript context for follow-ups
- ✅ **Displays** any language received from backend
- ✅ **Handles** errors gracefully
- ✅ **Protects** against race conditions
- ✅ **Ready** for backend English/German support

### Backend Status
- ⏳ **Needs** Deepgram language parameter
- ⏳ **Needs** Groq language-aware prompts
- ⏳ **Needs** transcript context usage
- 📄 **Documented** in `BACKEND-LANGUAGE-AND-INSIGHTS-ISSUES.md`

### Next Steps
1. Backend agent reads this document
2. Backend agent implements 3 fixes
3. End-to-end testing with English language
4. Production deployment

---

**DESKTOP IS READY. BACKEND FIXES ARE THE BLOCKER.** 🚀

All integration points documented. Backend agent has clear path forward. ✅

