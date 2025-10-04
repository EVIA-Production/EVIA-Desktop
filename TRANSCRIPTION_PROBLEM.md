# 🔴 NO TRANSCRIPTION DESPITE AUDIO SENDING - ROOT CAUSE ANALYSIS

## **Problem Statement for Expert**

**Context**: Electron app captures microphone audio and sends it via WebSocket to FastAPI backend, which should forward it to Deepgram for transcription.

**Issue**: Audio is successfully captured and sent (4800-byte chunks at 24kHz), backend receives the binary data, BUT transcription never appears in the UI. Backend logs show `frames_sent=0`, meaning audio is NOT being forwarded to Deepgram.

---

## **Technical Setup**

### **Frontend (Electron - Audio Capture)**
File: `src/renderer/audio-processor-glass-parity.ts`

```typescript
// ScriptProcessorNode (Glass parity approach)
const SAMPLE_RATE = 24000;  // ← 24 kHz
const BUFFER_SIZE = 2048;
const AUDIO_CHUNK_DURATION = 0.1;  // 100ms
const samplesPerChunk = Math.floor(SAMPLE_RATE * AUDIO_CHUNK_DURATION);  // 2400 samples

// Capture microphone audio
audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
micProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

micProcessor.onaudioprocess = (e) => {
  const inputData = e.inputBuffer.getChannelData(0);  // Float32Array
  
  // Accumulate into buffer
  for (let i = 0; i < inputData.length; i++) {
    audioBuffer.push(inputData[i]);
  }
  
  // Send when we have 2400 samples (100ms at 24kHz)
  while (audioBuffer.length >= samplesPerChunk) {
    const chunk = audioBuffer.splice(0, samplesPerChunk);
    const pcm16 = convertFloat32ToInt16(new Float32Array(chunk));  // 4800 bytes
    
    // Send via WebSocket
    wsInstance.sendBinaryAudio(pcm16.buffer);
    console.log('[AudioCapture] Sent chunk: 4800 bytes');
  }
};

function convertFloat32ToInt16(buffer) {
  const output = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output;
}
```

**Frontend Logs (Confirm Audio Works)**:
```
[AudioCapture] Starting capture (Glass parity: ScriptProcessorNode)...
[AudioCapture] Microphone permission granted
[AudioCapture] Sample rate: 24000 Hz, Chunk size: 2400 samples
[Audio Logger] Audio detected - Level: 0.2008
[Audio Logger] Audio data sent - Size: 4800 bytes, Level: 0.2008
[AudioCapture] Sent chunk: 4800 bytes
```

---

### **Backend (FastAPI - WebSocket Endpoint)**
File: `EVIA-Backend/api/routes/websocket.py`

**WebSocket Configuration**:
```python
@router.websocket("/ws/transcribe")
async def websocket_transcribe_endpoint(
    websocket: WebSocket,
    chat_id: int,
    token: str,
    source: str = "mic"
):
    # Accept WebSocket
    await websocket.accept()
    
    # Configure Deepgram
    options = LiveOptions(
        encoding="linear16",          # PCM16
        sample_rate=16000,            # ← MISMATCH: Frontend sends 24kHz!
        channels=1,
        language="en",
        model="nova-2-conversational",
        # ...
    )
    
    # Connect to Deepgram
    dg_connection = deepgram.listen.asyncwebsocket.v("1")
    await dg_connection.start(options)
    
    # Receive audio from frontend
    async for message in websocket.iter_bytes():
        # Forward to Deepgram
        await dg_connection.send(message)
```

**Backend Logs (Confirm Audio Received)**:
```
WebSocket /ws/transcribe?chat_id=76&token=...&source=mic" [accepted]
DEBUG: < BINARY 01 00 00 00 01 00 00 00 ... [4800 bytes]  ← Audio arrives!
DEBUG: < BINARY 00 00 00 00 00 00 00 00 ... [4800 bytes]
DEBUG: < BINARY ff ff 00 00 00 00 00 00 ... [4800 bytes]

Speech started detected.  ← Deepgram VAD detects speech!

No transcript text found in Deepgram message.  ← BUT NO TRANSCRIPTION!

Session summary: frames_enqueued=0 frames_sent=0 bytes_sent=0B
                 ^^^^^^^^^^^^^^^^^^ ← CRITICAL: ZERO frames forwarded!
```

---

## **THE CRITICAL ERROR**

**Backend Logs Show Deepgram Connection Failure**:
```
WebSocketException in AbstractAsyncWebSocketClient.start: 
  server rejected WebSocket connection: HTTP 403
                                         ^^^^^^^^ FORBIDDEN!

AsyncListenWebSocketClient.start failed

Retrying Deepgram start with fallback model=nova-2

Deepgram connection opened  ← Retry succeeds BUT...

Session summary: frames_sent=0 bytes_sent=0B  ← Still sends NOTHING!
```

---

## **Root Causes Identified**

### **1. ❌ Deepgram API Key Invalid/Expired**

**Evidence**:
- First connection attempt: `HTTP 403`
- Backend retries with fallback model, connection opens
- BUT `frames_sent=0` suggests authentication or quota issue

**Question**: Where is the Deepgram API key configured?
- Environment variable: `DEEPGRAM_API_KEY` in `.env`?
- Is it expired or invalid?
- Can we verify with: `curl -H "Authorization: Token $DEEPGRAM_API_KEY" https://api.deepgram.com/v1/projects`

### **2. 🟡 Sample Rate Mismatch**

**Frontend sends**: 24kHz audio (2400 samples = 4800 bytes @ 100ms)
**Backend configures Deepgram**: 16kHz (`sample_rate=16000`)

**Effect**:
- Deepgram expects 1600 samples per 100ms (16kHz)
- Receives 2400 samples per 100ms (24kHz)
- Audio plays back at wrong speed (1.5x faster)
- Transcription quality degraded or fails

**Question**: Why does Glass use 24kHz but backend uses 16kHz? Should we:
- Change frontend to 16kHz?
- Change backend config to 24kHz?

### **3. 🟡 Frames Not Being Forwarded**

**Evidence**: `frames_sent=0` despite receiving audio

**Possible Causes**:
- Deepgram connection opens AFTER audio starts arriving (race condition)
- Audio arrives during Deepgram connection retry (dropped frames)
- Backend queues frames but never flushes to Deepgram
- WebSocket forwarding logic has a bug

**Backend Code Question** (need to see):
```python
# Where is the logic that forwards `message` to Deepgram?
async for message in websocket.iter_bytes():
    await dg_connection.send(message)  # ← Is this being called?
    frames_sent += 1  # ← Is this counter incremented?
```

---

## **THE QUESTIONS**

### **For Deepgram Expert:**

1. **API Key**:
   - How do I verify my Deepgram API key is valid?
   - What does `HTTP 403` mean? (Expired key? Quota exceeded? Wrong permissions?)
   - Can I test the key with curl?

2. **Sample Rate**:
   - If I send 24kHz audio but configure `sample_rate=16000`, what happens?
   - Does Deepgram automatically resample, or does it reject/fail silently?
   - Should I match frontend (24kHz) or use Deepgram's recommended 16kHz?

3. **Frames Not Forwarded**:
   - Why would `frames_sent=0` when the backend clearly receives binary audio?
   - Is there a queuing mechanism that never flushes?
   - How can I debug if `dg_connection.send(message)` is being called?

### **For Backend Developer:**

4. **Race Condition**:
   - Does Deepgram connection open BEFORE or AFTER frontend starts sending audio?
   - Are frames queued during connection retry? (Logs say "frames_enqueued=0")
   - How can I ensure audio buffering during Deepgram connection?

5. **Logging**:
   - Where is `frames_sent` incremented?
   - Can I add debug logs to confirm `dg_connection.send()` is called?
   - Are there any exceptions swallowed silently?

---

## **Proposed Debug Steps**

### **Step 1: Verify Deepgram API Key**

```bash
# Check if key is set
echo $DEEPGRAM_API_KEY

# Test key with Deepgram API
curl -X GET "https://api.deepgram.com/v1/projects" \
  -H "Authorization: Token $DEEPGRAM_API_KEY"

# Expected: 200 OK with project details
# If 401/403: Key is invalid/expired
```

### **Step 2: Fix Sample Rate Mismatch**

**Option A**: Change frontend to 16kHz (Deepgram standard)
```typescript
const SAMPLE_RATE = 16000;  // Match Deepgram
```

**Option B**: Change backend to 24kHz (Glass parity)
```python
sample_rate=24000,  # Match frontend
```

### **Step 3: Add Debug Logging**

```python
async for message in websocket.iter_bytes():
    logger.info(f"Received {len(message)} bytes from frontend")
    
    if dg_connection and dg_connection.is_open:
        await dg_connection.send(message)
        frames_sent += 1
        logger.info(f"Forwarded to Deepgram (total: {frames_sent})")
    else:
        logger.warning(f"Deepgram not ready, dropping frame")
        frames_enqueued += 1
```

### **Step 4: Create WAV File for Testing**

**Frontend**: Save captured audio to WAV file to verify it's valid:
```typescript
// Accumulate audio chunks
const allChunks: Int16Array[] = [];

function saveWAV() {
  const combined = concatenateInt16Arrays(allChunks);
  const wav = createWAV(combined, 24000, 1);
  downloadBlob(wav, 'captured-audio.wav');
}
```

Then test manually:
```bash
curl -X POST "https://api.deepgram.com/v1/listen" \
  -H "Authorization: Token $DEEPGRAM_API_KEY" \
  -H "Content-Type: audio/wav" \
  --data-binary @captured-audio.wav
```

---

## **Current Status**

- ✅ Frontend captures audio (24kHz, PCM16)
- ✅ Frontend sends 4800-byte chunks via WebSocket
- ✅ Backend receives binary audio data
- ❌ Deepgram connection fails with HTTP 403 (first attempt)
- ⚠️ Deepgram connection succeeds (retry) but `frames_sent=0`
- ❌ No transcription appears in UI

**Most Likely Root Cause**: **Invalid/Expired Deepgram API Key** (403 error)

**Secondary Issue**: Sample rate mismatch (24kHz frontend vs 16kHz backend config)

---

## **User's Request**

> "Check backend logs to see if Deepgram transcribes. You can run commands to check whether transcription is there but just not displayed. We could for example install a button to create a WAV file to check what data we send to Deepgram."

**My Assessment**:
1. Backend logs show Deepgram does NOT receive audio (`frames_sent=0`)
2. Problem is NOT UI display, it's backend → Deepgram forwarding
3. First priority: Fix Deepgram API key (403 error)
4. Second priority: Fix sample rate mismatch
5. Then: Add debug logging to confirm forwarding works

