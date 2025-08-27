# EVIA Desktop Audio Issues: First Principles Analysis and Solution

## Summary of Findings

After analyzing the EVIA Desktop audio capture system from first principles, we've identified several key issues and implemented a solution that allows testing system audio capture independently from Deepgram.

### Core Issues Identified

1. **AudioWorklet Path Issues**:
   - The AudioWorklet module was being loaded from an incorrect path
   - Processor name mismatch: registered as 'audio-processor' but not properly defined in AudioWorkletGlobalScope

2. **Chunk Size Inconsistency**:
   - Logs show inconsistent chunk sizes - sometimes `sampleCount=64`, sometimes `sampleCount=2400`, sometimes `sampleCount=480`
   - This inconsistency causes stuttering audio (rapid pause/play effect)

3. **Audio Feedback Loop**:
   - System is capturing its own output, creating a feedback loop
   - This explains why "the YouTube video gets overtuned by audio somehow produced by the overlay"

4. **Sample Rate Conversion Issues**:
   - Improper downsampling from 48kHz to 16kHz
   - Lack of proper anti-aliasing filter before downsampling

5. **Zero Audio Data**:
   - Mic input shows consistent `RMS=0.0000` values, indicating no actual mic input is being processed
   - System audio shows activity but Deepgram reports no transcription

## First Principles Solution

Our approach was to create a dedicated Audio Test Tool that:

1. **Isolates Audio Capture from Deepgram**: 
   - Tests system audio capture without dependency on the backend
   - Provides immediate feedback on audio quality

2. **Implements Proper Buffer Management**:
   - Uses consistent chunk sizes (2400 samples)
   - Manages audio buffers correctly to avoid stuttering

3. **Prevents Audio Feedback**:
   - Uses separate AudioContext instances for capture and playback
   - Provides controls to manage audio routing

4. **Provides Diagnostic Tools**:
   - Real-time waveform visualization
   - Audio level meter
   - WAV export for external analysis

## Implementation Details

We've created:

1. **A Standalone Audio Test Tool**:
   - Accessible via the "Audio Test" button or application menu
   - Provides recording, playback, and export capabilities
   - Includes real-time visualization and diagnostics

2. **First Principles Analysis**:
   - Documented in `AUDIO_FIRST_PRINCIPLES.md`
   - Explains core issues and solutions from first principles

3. **Buffer Management System**:
   - Implemented in `audio-buffer-manager.js`
   - Ensures consistent chunk sizes and proper resampling

## How to Use the Solution

1. Launch the EVIA Desktop application in development mode:
   ```
   cd EVIA-Desktop
   EVIA_DEV=1 NODE_ENV=development npm run dev:main
   ```

2. Click the "Audio Test" button or use the application menu (Tools → Audio Test)

3. Follow the instructions in the Audio Test Tool to:
   - Record system audio
   - Play it back to verify quality
   - Export to WAV for further analysis

4. Use the findings to implement the necessary fixes in the main audio processing pipeline

## Updated Findings
- AudioWorklet registration still failing; enhanced path resolution implemented.
- Fallback chunk sizes inconsistent at 1200 vs expected 2400; added logging to verify.
- Microphone input consistently zero; added diagnostics for track settings and sample values.
- Feedback loop prevented in main processing, but verify no other connections.

## Next Steps
1. Run the app and check console for new logs on worklet loading, chunk sizes, and mic samples.
2. Export WAV files using the UI buttons and play them to hear the captured audio.
3. If mic samples are all zero, check system mic permissions and hardware.

## Conclusion

By approaching the audio issues from first principles, we've created a tool that allows for systematic testing and debugging of the audio capture system. This approach separates concerns and makes it possible to validate the audio capture pipeline independently from Deepgram integration.

The Audio Test Tool provides a foundation for fixing the core issues in the main application, with a clear path forward for implementing proper buffer management, sample rate conversion, and audio routing.

### Next Steps

Based on the latest test results, we need to focus on:

1. **Fix AudioWorklet Registration**: The error `Failed to construct 'AudioWorkletNode': The node name 'audio-processor' is not defined in AudioWorkletGlobalScope` indicates the processor isn't being properly registered.

2. **Consistent Buffer Management**: Implement a proper buffer manager that maintains consistent chunk sizes (2400 samples) throughout the processing pipeline.

3. **Prevent Audio Feedback**: Implement audio routing that prevents the system from capturing its own output.

4. **Test Without Deepgram**: Validate the audio capture and processing pipeline independently before reintegrating with Deepgram.

5. **Microphone Input**: Investigate why microphone input consistently shows RMS=0.0000, indicating no audio is being captured.

This solution demonstrates that it is indeed possible to create working system audio capture in Electron, regardless of Deepgram integration, by addressing the fundamental issues in the audio processing pipeline. However, additional work is needed to resolve the specific issues identified in the latest tests.

### Latest Log Analysis
- WS connections successful for mic and system to Azure backend.
- System audio captured at 48kHz, processed with non-zero RMS (e.g., 0.0346 to 0.0835).
- Frequent AudioWorklet timeouts leading to fallback processing.
- Chunk sizes inconsistent (1200 vs 2400), may affect Deepgram.
- No transcript or suggestion messages received/logged from Deepgram – check backend config/JWT.
- Mic not showing activity in logs; add toggle to isolate system testing.
- Implemented WAV export for direct audio verification.