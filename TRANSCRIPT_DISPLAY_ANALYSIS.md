# Transcript Display Issues - Complete Analysis

## Problem Summary

Multiple critical issues with transcript display identified by user:

1. **Massive duplication**: 9+ transcript lines for one spoken sentence
2. **Broken speaker identification**: Not all speaker 0 (system) shows grey/left, not all speaker 1 (mic) shows blue/right
3. **Inconsistent opacity**: Some transcripts bright, others transparent
4. **No message grouping**: Consecutive messages from same speaker should merge into one bubble

## Root Cause Analysis

### Issue #1: Duplication (9+ lines per sentence)

**Current EVIA behavior**: We **ADD** every interim and final transcript as a new line

**Example from logs**:
```
Status message: "And they"
Status message: "And they were in the"  
Status message: "And they were in their gym class and"
Final segment: "And they were in the gym class, and he was getting ready"
Final segment: "And they were in their gym class and you line up and getting ready for the next unit."
```

**Result**: All 5+ messages displayed as separate lines = MASSIVE DUPLICATION

### Glass Solution (CORRECT)

From `glass/src/ui/listen/stt/SttView.js` lines 116-176:

```javascript
handleSttUpdate(event, { speaker, text, isFinal, isPartial }) {
    const findLastPartialIdx = spk => {
        for (let i = this.sttMessages.length - 1; i >= 0; i--) {
            const m = this.sttMessages[i];
            if (m.speaker === spk && m.isPartial) return i;  // Find last PARTIAL from this speaker
        }
        return -1;
    };
    
    const newMessages = [...this.sttMessages];
    const targetIdx = findLastPartialIdx(speaker);
    
    if (isPartial) {
        if (targetIdx !== -1) {
            // REPLACE existing partial message with new text
            newMessages[targetIdx] = { ...newMessages[targetIdx], text, isPartial: true };
        } else {
            // CREATE new partial message
            newMessages.push({ id: this.messageIdCounter++, speaker, text, isPartial: true });
        }
    } else if (isFinal) {
        if (targetIdx !== -1) {
            // CONVERT partial to final
            newMessages[targetIdx] = { ...newMessages[targetIdx], text, isPartial: false, isFinal: true };
        } else {
            // CREATE new final message (shouldn't happen often)
            newMessages.push({ id: this.messageIdCounter++, speaker, text, isPartial: false, isFinal: true });
        }
    }
    
    this.sttMessages = newMessages;
}
```

**Key insight**: 
- Interim messages (`status` with `echo_text`) → **REPLACE** last partial from same speaker
- Final messages (`transcript_segment` with `is_final: true`) → **CONVERT** last partial to final
- Only **ONE** line per utterance, continuously updated

### Issue #2: Speaker Identification Broken

**Current problem**: Some system audio (speaker 0) shows as blue/right instead of grey/left

**Glass speaker logic** from `SttView.js` lines 54-68:

```css
.stt-message.them {
    background: rgba(255, 255, 255, 0.1);  /* Grey */
    color: rgba(255, 255, 255, 0.9);
    align-self: flex-start;  /* Left */
    border-bottom-left-radius: 4px;
    margin-right: auto;
}

.stt-message.me {
    background: rgba(0, 122, 255, 0.8);  /* Blue */
    color: white;
    align-self: flex-end;  /* Right */
    border-bottom-right-radius: 4px;
    margin-left: auto;
}
```

**Speaker mapping**:
- `speaker === 0` → System audio (them) → Grey, left-aligned
- `speaker === 1` → Microphone (me) → Blue, right-aligned

### Issue #3: Opacity Variations

**Likely cause**: In current EVIA code, we're checking `isFinal` to determine opacity:

```typescript
// Current EVIA logic (WRONG)
const opacity = isFinal ? 1.0 : 0.5;  // Partial messages look faded
```

**Glass approach**: All messages have same opacity once displayed. Partial messages are **replaced**, not shown as faded duplicates.

### Issue #4: No Message Grouping

Glass doesn't implement automatic message grouping in the code I found. Each message is a separate bubble. However, the **deduplication** logic makes this less critical since you don't have 9 lines per sentence.

If you want grouping (consecutive messages from same speaker merged):
- Would need to track speaker changes
- Merge consecutive messages from same speaker into one bubble
- This is a separate enhancement (not critical for MVP)

## EVIA Backend Message Flow

From user's Header console logs:

### Deepgram sends TWO types of messages:

1. **Interim transcripts** (`status` type):
   ```json
   {
     "type": "status",
     "data": {
       "echo_text": "And they were in their gym class and",
       "final": false
     }
   }
   ```

2. **Final transcripts** (`transcript_segment` type):
   ```json
   {
     "type": "transcript_segment",
     "data": {
       "text": "And they were in their gym class and you line up and getting ready for the next unit.",
       "speaker": 0,
       "is_final": true
     }
   }
   ```

**Current EVIA**: We display **BOTH**, causing duplication

**Correct approach**: Use `status`/`echo_text` for interim (partial), `transcript_segment` for final, and **REPLACE** not **ADD**

## Required Fixes

### Fix #1: Deduplication Logic (CRITICAL)

File: `src/renderer/overlay/ListenView.tsx`

**Current code** (lines 146-169):
```typescript
if (msg.type === 'transcript_segment' && msg.data) {
  setTranscripts(prev => [...prev, { text, speaker, isFinal: is_final }]);  // ALWAYS ADDS
} else if (msg.type === 'status' && msg.data?.echo_text) {
  setTranscripts(prev => [...prev, { text, speaker: null, isFinal }]);  // ALWAYS ADDS
}
```

**Should be** (Glass parity):
```typescript
if (msg.type === 'transcript_segment' && msg.data) {
  const { text = '', speaker = null, is_final = false } = msg.data;
  
  setTranscripts(prev => {
    // Find last partial message from this speaker
    const lastPartialIdx = prev.findIndex((t, i) => 
      i === prev.length - 1 - prev.slice().reverse().findIndex(t => 
        t.speaker === speaker && t.isPartial
      )
    );
    
    if (is_final) {
      if (lastPartialIdx !== -1) {
        // REPLACE partial with final
        const updated = [...prev];
        updated[lastPartialIdx] = { text, speaker, isFinal: true, isPartial: false };
        return updated;
      } else {
        // No partial found, ADD final
        return [...prev, { text, speaker, isFinal: true, isPartial: false }];
      }
    }
  });
  
} else if (msg.type === 'status' && msg.data?.echo_text) {
  const text = msg.data.echo_text;
  const isFinal = msg.data.final === true;
  
  // Infer speaker from message source (system vs mic WebSocket)
  // Backend should include speaker in status messages!
  const speaker = inferSpeakerFromMessage(msg);
  
  setTranscripts(prev => {
    // Find last partial message from this speaker
    const lastPartialIdx = [...prev].reverse().findIndex(t => 
      t.speaker === speaker && t.isPartial
    );
    
    if (lastPartialIdx !== -1) {
      // REPLACE existing partial
      const actualIdx = prev.length - 1 - lastPartialIdx;
      const updated = [...prev];
      updated[actualIdx] = { text, speaker, isFinal: false, isPartial: true };
      return updated;
    } else {
      // ADD new partial
      return [...prev, { text, speaker, isFinal: false, isPartial: true }];
    }
  });
}
```

### Fix #2: Speaker Styling (CRITICAL)

File: `src/renderer/overlay/ListenView.tsx`

**Current styling** (needs verification):
```typescript
// Speaker-based styling
const getSpeakerClass = (speaker: number | null) => {
  if (speaker === 0) return 'system-audio';  // Grey, left
  if (speaker === 1) return 'mic-audio';      // Blue, right
  return 'unknown';
};
```

**CSS** (needs to match Glass):
```css
.system-audio {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  align-self: flex-start;
  margin-right: auto;
}

.mic-audio {
  background: rgba(0, 122, 255, 0.8);
  color: white;
  align-self: flex-end;
  margin-left: auto;
}
```

### Fix #3: Backend Enhancement (RECOMMENDED)

File: `EVIA-Backend/backend/api/routes/websocket.py`

**Problem**: `status` messages don't include `speaker` field

**Current**:
```json
{"type": "status", "data": {"echo_text": "...", "final": false}}
```

**Should be**:
```json
{"type": "status", "data": {"echo_text": "...", "final": false, "speaker": 0}}
```

This allows frontend to properly track which speaker's partial message to replace.

### Fix #4: Message Grouping (OPTIONAL/MVP+)

Only implement if user explicitly requests. For MVP, deduplication is sufficient.

## Testing Checklist

After implementing fixes:

1. ✅ **One line per sentence**: Each spoken sentence shows as ONE line (updated in real-time)
2. ✅ **Correct speaker colors**: 
   - System audio (speaker 0) → Grey background, left-aligned
   - Microphone (speaker 1) → Blue background, right-aligned
3. ✅ **No opacity variations**: All displayed messages have full opacity
4. ✅ **Real-time updates**: Partial messages update smoothly as speaker talks
5. ✅ **Clean final state**: When sentence completes, partial converts to final (same text, same position)

## Files to Modify

1. **Frontend** (CRITICAL):
   - `EVIA-Desktop/src/renderer/overlay/ListenView.tsx` - Deduplication logic + speaker styling

2. **Backend** (RECOMMENDED):
   - `EVIA-Backend/backend/api/routes/websocket.py` - Add `speaker` to status messages

3. **CSS** (VERIFY):
   - `EVIA-Desktop/src/renderer/overlay/overlay-glass.css` - Speaker-specific styles

## Estimated Effort

- **Deduplication logic**: 1-2 hours (complex state management)
- **Speaker styling**: 30 minutes (verify CSS, fix any issues)
- **Backend enhancement**: 30 minutes (add speaker to status messages)
- **Testing**: 1 hour (verify all scenarios)

**Total**: ~3-4 hours for complete fix

## Next Steps

1. Coordinator review and approval
2. Implement fixes in priority order:
   - Fix #1 (Deduplication) - CRITICAL
   - Fix #2 (Speaker styling) - CRITICAL
   - Fix #3 (Backend speaker field) - RECOMMENDED
   - Fix #4 (Message grouping) - OPTIONAL

## References

- Glass implementation: `glass/src/ui/listen/stt/SttView.js` lines 116-176
- Glass speaker styles: `glass/src/ui/listen/stt/SttView.js` lines 54-68
- Current EVIA: `EVIA-Desktop/src/renderer/overlay/ListenView.tsx` lines 130-184
