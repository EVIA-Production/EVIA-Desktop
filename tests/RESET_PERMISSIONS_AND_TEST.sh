#!/bin/bash

echo "🔄 EVIA Desktop - Complete Permission Reset"
echo "============================================"
echo ""
echo "This will:"
echo "  1. Remove ALL EVIA Desktop from Screen Recording permissions"
echo "  2. Clear TCC database entries"
echo "  3. Re-sign the app"
echo "  4. Launch for testing"
echo ""

read -p "Press Enter to continue..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_PATH="$REPO_ROOT/dist/mac-arm64/EVIA Desktop.app"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ App not found at $APP_PATH"
    echo "Run 'npm run build' first"
    exit 1
fi

echo ""
echo "Step 1: Clearing TCC database..."
echo "================================="

# Try to clear ALL possible bundle identifiers
echo "Attempting to clear TCC entries for various bundle IDs..."

# Try with sudo (might fail but worth a try)
sudo tccutil reset ScreenCapture com.evia.desktop 2>/dev/null && echo "  ✅ Cleared com.evia.desktop" || echo "  ⚠️  Could not clear com.evia.desktop"
sudo tccutil reset ScreenCapture com.electron.evia-desktop 2>/dev/null && echo "  ✅ Cleared com.electron.evia-desktop" || echo "  ⚠️  Could not clear com.electron.evia-desktop"

echo ""
echo "Step 2: Re-signing the app..."
echo "=============================="

# Remove quarantine
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null
echo "  ✅ Quarantine removed"

# Deep sign with entitlements
codesign -s - --deep --force --entitlements "$REPO_ROOT/build/entitlements.mac.plist" "$APP_PATH"
if [ $? -eq 0 ]; then
    echo "  ✅ App signed successfully"
else
    echo "  ❌ Signing failed"
    exit 1
fi

echo ""
echo "Step 3: MANUAL PERMISSION CLEANUP"
echo "=================================="
echo ""
echo "⚠️  IMPORTANT: You MUST do this manually:"
echo ""
echo "1. Open: System Preferences > Privacy & Security > Screen & System Audio Recording"
echo "2. Find ALL 'EVIA Desktop' entries (there might be 2 or more)"
echo "3. Select EACH one and click the '-' button to remove them ALL"
echo "4. Close System Preferences completely"
echo ""
echo "This ensures we start with a clean slate."
echo ""

read -p "Press Enter AFTER you've removed all EVIA Desktop entries..."

echo ""
echo "Step 4: Launching app..."
echo "========================"
echo ""
echo "The app will now launch. When you click 'Zuhören', macOS should"
echo "show a permission dialog. If it doesn't, the issue is deeper."
echo ""

# Launch with logs
"$APP_PATH/Contents/MacOS/EVIA Desktop" &
APP_PID=$!

echo ""
echo "✅ App launched (PID: $APP_PID)"
echo ""
echo "📋 TESTING CHECKLIST:"
echo "===================="
echo ""
echo "1. Click 'Zuhören' button"
echo "2. Watch for macOS permission dialog"
echo "3. If dialog appears: Click 'Allow'"
echo "4. Check terminal for: '[Main] ✅ Found X desktop sources'"
echo "5. Check if timer starts in Listen window"
echo "6. Speak and check for blue transcript bubbles"
echo ""
echo "🐛 If permission dialog does NOT appear:"
echo "   - System audio will not work in production builds"
echo "   - This is a macOS/Electron limitation with ad-hoc signing"
echo "   - We'll need to test in dev mode or use a Developer ID"
echo ""
echo "Press Ctrl+C to quit when done testing..."
echo ""

# Wait for app to exit
wait $APP_PID

