#!/bin/bash

echo "🔍 Checking if SystemAudioDump is running..."
echo "=============================================="
echo ""

# Check if process is running
PROCESSES=$(ps aux | grep SystemAudioDump | grep -v grep)

if [ -z "$PROCESSES" ]; then
    echo "❌ SystemAudioDump is NOT running"
    echo ""
    echo "This means one of:"
    echo "  1. Permission is still denied (macOS blocking it silently)"
    echo "  2. Desktop isn't spawning the process"
    echo "  3. Process crashes immediately"
    echo ""
    echo "Check Electron main terminal for:"
    echo "  - '[SystemAudioService] SystemAudioDump started with PID: ...'"
    echo "  - 'SystemAudioDump process closed with code: 1' (permission denied)"
    echo ""
else
    echo "✅ SystemAudioDump IS running!"
    echo ""
    echo "Processes found:"
    echo "$PROCESSES"
    echo ""
    echo "If audio still isn't being captured, the issue is elsewhere"
    echo "(check logs for audio data flow)"
fi

