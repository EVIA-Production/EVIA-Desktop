#!/bin/bash
# Force macOS to show microphone permission dialog for Terminal.app

echo "🎤 Requesting Microphone Permission for Terminal.app"
echo "======================================================"
echo ""
echo "This script will attempt to access your microphone,"
echo "which should trigger the macOS permission dialog."
echo ""
echo "When the dialog appears:"
echo "  1. Click 'OK' or 'Allow'"
echo "  2. Terminal.app will then appear in System Settings"
echo ""
echo "Press Enter to continue..."
read

echo ""
echo "🔊 Attempting to access microphone..."
echo ""

# Use sox to record a 1-second audio sample (will trigger permission dialog)
# If sox is not installed, use ffmpeg as fallback
if command -v sox &> /dev/null; then
    echo "Using sox to trigger permission..."
    sox -d -n trim 0 1 2>&1 || echo "Permission dialog should have appeared!"
elif command -v ffmpeg &> /dev/null; then
    echo "Using ffmpeg to trigger permission..."
    ffmpeg -f avfoundation -i ":0" -t 1 /tmp/test.wav 2>&1 || echo "Permission dialog should have appeared!"
else
    echo "⚠️  Neither sox nor ffmpeg found."
    echo "Attempting with macOS native tools..."
    
    # Create a temporary AppleScript to request mic permission
    osascript <<EOF
tell application "System Events"
    -- This will trigger mic permission request
    do shell script "afplay /System/Library/Sounds/Ping.aiff"
end tell
EOF
    
    echo ""
    echo "If you didn't see a permission dialog, you can install sox or ffmpeg:"
    echo "  brew install sox"
    echo "  or"
    echo "  brew install ffmpeg"
fi

echo ""
echo "======================================================"
echo "✅ Done! Check if Terminal.app now appears in:"
echo "   System Settings → Privacy & Security → Microphone"
echo ""
echo "If it DOES appear:"
echo "  1. Enable the checkbox for Terminal.app"
echo "  2. Run: npm run dev"
echo ""
echo "If it DOESN'T appear, try:"
echo "  brew install sox"
echo "  ./request-mic-permission.sh"
echo "======================================================"

