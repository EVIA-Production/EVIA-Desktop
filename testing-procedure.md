# EVIA Desktop Audio Capture Testing Procedure

This document outlines the step-by-step procedure for testing the EVIA Desktop audio capture system after the recent fixes.

## Prerequisites

- macOS computer with Electron, Node.js, and Swift developer tools installed
- Screen Recording permission granted for both Electron and SystemAudioCapture
- Microphone permission granted for Electron

## Step 1: Kill Existing Processes

First, ensure no old processes are running:

```bash
pkill -f Electron
pkill -f SystemAudioCapture
```

## Step 2: Rebuild the Swift Helper

Always rebuild the Swift helper to ensure you have the latest version:

```bash
cd EVIA-Desktop/native/mac/SystemAudioCapture
swift build -c debug
```

## Step 3: Start the EVIA Desktop App

Start both the renderer and main processes in separate terminals:

```bash
# Terminal 1 (Renderer)
cd EVIA-Desktop
npm run dev:renderer | cat

# Terminal 2 (Main)
cd EVIA-Desktop
EVIA_DEV=1 NODE_ENV=development npm run dev:main
```

## Step 4: Test Audio Diagnostic Mode

1. Launch the app with the `--diagnostic` flag to use the diagnostic tool
2. Verify both visualizers are working
3. Start system audio capture and check for frames
4. Export WAVs and verify the audio quality
5. Run the full diagnostics and check for issues

## Step 5: Test Main App with Backend Connection

1. Launch the app normally
2. Fill in the connection details:
   - Backend: `http://localhost:8000` (or your backend URL)
   - Chat ID: (use a valid chat ID)
   - Token: (use a valid JWT token)
3. Click Connect and verify both WebSocket connections establish
4. Check the logs for `dg_open=1` messages
5. Verify that the status indicators show "Connected ✓" for both mic and system
6. Check that the buttons for "Toggle Mic", "Export Mic WAV", "Export Sys WAV", and "Test Tone" are visible and functional

## Step 6: Test Tone Verification

1. Click the "Test Tone" button to send a 1kHz tone
2. Verify in the logs that the tone was received by the backend
3. Check that the tone appears in the transcripts

## Step 7: System Audio Verification

1. Play some audio content (e.g., YouTube video or local audio file)
2. Verify that system audio is being captured:
   - Check RMS levels in the logs
   - Export a WAV and play it back to confirm quality
   - Verify transcripts are being generated

## Step 8: Microphone Verification

1. Speak into the microphone
2. Verify that microphone audio is being captured:
   - Check RMS levels in the logs
   - Export a WAV and play it back to confirm quality
   - Verify transcripts are being generated

## Troubleshooting

### System Audio Not Capturing
- Check Screen Recording permission in System Settings
- Ensure helper binary was rebuilt correctly
- Check logs for "permission_granted" and "capture_started" messages
- Verify the audio status indicator shows "Audio System: Ready"

### Distorted Audio
- Check WAV exports for correct sample rates
- Verify filter is being applied correctly
- Check for consistency in chunk sizes
- Look for "[Audio] Processing initialized successfully" in the console logs

### No Transcripts
- Check for "dg_open=1" messages
- Verify backend is receiving audio frames
- Check that audio has sufficient volume/RMS
- Verify the transcript status indicators show "Connected ✓"
- Check the console for WebSocket message logs

### AudioContext Initialization Issues
- Look for "[Audio] Failed to initialize processing" errors in the console
- Check if the fallback audio processing is being used
- Verify that the AudioWorklet is being loaded correctly

### Notes on Error Scenarios

1. **Binary issues**: If you see old sample rates or distortion, ensure you've rebuilt and killed old processes
2. **Filter instability**: If you see warnings about unstable filters, the system will now automatically fall back to a simpler filter
3. **WebSocket failures**: Verify CORS settings in the backend allow your origin
4. **Missing UI elements**: If buttons are not visible, check for CSS or DOM errors in the console

## Expected Results

When properly configured, you should observe:

- System audio captured and exported as clean 16kHz mono WAV files
- Audio frames consistently sized at 1600 samples per chunk
- Transcripts generated for both mic and system audio
- No distortion or "alien sounds" in the exported audio

## Data Collection and Reporting

When reporting issues, please include:

1. Exported WAV files from both mic and system audio
2. Console logs from both renderer and main processes
3. Diagnostic report from the audio-debug tool
4. Details of your macOS version and hardware configuration
