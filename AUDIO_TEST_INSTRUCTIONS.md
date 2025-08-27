# EVIA Desktop Audio Test Tool

This tool allows you to test system audio capture in isolation from Deepgram, helping diagnose and fix audio issues from first principles.

## How to Launch

There are two ways to launch the Audio Test Tool:

1. **From the main overlay**: Click the "Audio Test" button in the main EVIA Desktop overlay.

2. **From the application menu**: Go to Tools → Audio Test in the application menu.

## Using the Audio Test Tool

The Audio Test Tool provides a simple interface for testing system audio capture:

### Recording System Audio

1. Click the "Start Recording" button to begin capturing system audio.
2. Play some audio on your system (e.g., a YouTube video, music, etc.).
3. The level meter will show the audio level in real-time.
4. The waveform display will visualize the audio being captured.
5. Click "Stop Recording" when you're done.

### Testing Playback

1. After recording, click "Play Recorded Audio" to hear the last 5 seconds of captured audio.
2. This will play through your speakers, allowing you to verify the quality of the captured audio.
3. If the audio sounds distorted or has a "stuttering" effect, there are likely issues with buffer management.

### Exporting for Analysis

1. Click "Export to WAV" to save the captured audio as a WAV file.
2. Open this file in an audio editor or player to analyze it further.

## Troubleshooting Common Issues

### No Audio Captured

- Check that Screen Recording permission is granted for both Electron and the SystemAudioCapture helper.
- Verify that audio is actually playing on your system during recording.
- Check the Debug Log for any error messages.

### Distorted or Stuttering Audio

- This usually indicates buffer management issues.
- Check the Debug Log for sample count inconsistencies (should be consistent 2400 samples per chunk).
- If you see varying sample counts (e.g., 64, 240, etc.), the buffer management needs fixing.

### Audio Feedback Loop

- If you hear an echo or feedback when testing, the system may be capturing its own output.
- Try using headphones during testing to prevent this.
- The Audio Test Tool uses separate AudioContext instances for capture and playback to minimize feedback.

## Next Steps

After identifying issues with the Audio Test Tool:

1. Review the first principles analysis in `AUDIO_FIRST_PRINCIPLES.md`.
2. Implement the suggested fixes in the audio processing pipeline.
3. Test again to verify the improvements.

This approach allows you to validate the audio capture pipeline independently from Deepgram, making it easier to isolate and fix issues.
