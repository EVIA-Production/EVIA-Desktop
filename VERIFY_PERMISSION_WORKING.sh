#!/bin/bash

# Quick verification that Screen Recording permission is actually working
# Since we can't access TCC database directly, we test the actual behavior

echo "🧪 Quick Permission Test - EVIA Desktop"
echo "========================================"
echo ""

APP_PATH="/Users/benekroetz/EVIA/EVIA-Desktop/dist/mac-arm64/EVIA Desktop.app"
HELPER_PATH="$APP_PATH/Contents/Resources/app.asar.unpacked/src/main/assets/SystemAudioDump"

if [ ! -f "$HELPER_PATH" ]; then
    echo "❌ Helper binary not found"
    exit 1
fi

echo "Testing if SystemAudioDump can start (indicates permission is granted)..."
echo ""

# Try to run the binary for 1 second
# If permission is granted: it runs and captures audio
# If permission is denied: it exits immediately with code 1

timeout 1 "$HELPER_PATH" > /tmp/audio_test.log 2>&1 &
HELPER_PID=$!
sleep 0.5

# Check if process is still running
if ps -p $HELPER_PID > /dev/null 2>&1; then
    echo "✅ SUCCESS: Binary is running (permission granted!)"
    kill $HELPER_PID 2>/dev/null || true
    echo ""
    echo "Output from helper:"
    head -n 5 /tmp/audio_test.log 2>/dev/null || echo "(no output)"
    echo ""
    echo "🎉 Screen Recording permission is working!"
    echo ""
    echo "Next steps:"
    echo "  1. Launch EVIA Desktop"
    echo "  2. Start system audio capture"
    echo "  3. Check for transcriptions"
    exit 0
else
    # Check if it exited with error
    wait $HELPER_PID 2>/dev/null
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 1 ]; then
        echo "❌ FAILED: Binary exited immediately (permission denied)"
        echo ""
        echo "This means macOS is still blocking Screen Recording."
        echo ""
        echo "Try this:"
        echo "  1. Open System Settings > Privacy & Security > Screen Recording"
        echo "  2. REMOVE 'EVIA Desktop' from the list (click - button)"
        echo "  3. RE-ADD it (click + button, navigate to app)"
        echo "  4. Toggle it ON"
        echo "  5. Restart your Mac if still not working"
        echo ""
        echo "Or run: ./FORCE_PERMISSION_REFRESH.sh"
        exit 1
    else
        echo "⚠️  Unexpected exit code: $EXIT_CODE"
        echo "Output:"
        cat /tmp/audio_test.log 2>/dev/null || echo "(no output)"
        exit 1
    fi
fi

