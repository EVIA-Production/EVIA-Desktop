#!/bin/bash

# Quick script to help grant Terminal.app Screen Recording permission

echo "🔧 EVIA System Audio Permission Helper"
echo "======================================"
echo ""
echo "Opening System Settings → Privacy & Security → Screen & System Audio Recording..."
echo ""

# Open the Screen Recording privacy settings
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

echo "✅ System Settings opened!"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. In the window that just opened:"
echo "   - Look for 'Screen & System Audio Recording' or 'Screen Recording'"
echo "   - Click the lock icon (🔒) if needed and enter your password"
echo ""
echo "2. Add Terminal.app:"
echo "   - Click the '+' button (or 'Edit' button)"
echo "   - Press ⌘⇧G (Cmd+Shift+G) to open 'Go to folder'"
echo "   - Type: /Applications/Utilities/"
echo "   - Select 'Terminal.app'"
echo "   - Click 'Open'"
echo ""
echo "3. Enable the permission:"
echo "   - Find 'Terminal' in the list"
echo "   - Toggle the switch ON (should turn blue/green)"
echo "   - Click 'Done' or close the window"
echo ""
echo "4. Verify the permission:"
echo "   ./TEST_SYSTEM_AUDIO_DEBUG.sh"
echo ""
echo "5. Restart EVIA:"
echo "   pkill -f 'EVIA'; pkill -f 'Electron'"
echo "   npm run dev"
echo ""
echo "🎉 Then click 'Zuhören' and system audio should work!"
echo ""

