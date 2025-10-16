#!/bin/bash

echo "🔐 EVIA Desktop - System Audio Permission Fix (Glass Parity)"
echo "============================================================="
echo ""
echo "This script applies the same TCC permission fix from Glass."
echo "It will:"
echo "  1. Ad-hoc sign the production app with Screen Recording entitlements"
echo "  2. Clear stale TCC database entries"
echo "  3. Guide you through re-granting permissions"
echo ""
echo "Press Enter to continue..."
read

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_PATH="$REPO_ROOT/dist/mac-arm64/EVIA Desktop.app"

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ App not found at: $APP_PATH"
    echo "Run 'npm run build' first!"
    exit 1
fi

echo ""
echo "Step 1: Ad-hoc signing the production app with entitlements..."
echo "================================================================"

# Remove quarantine attribute
echo "Removing quarantine attribute..."
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true

# Ad-hoc sign with entitlements
echo "Signing app with Screen Recording entitlements..."
codesign -s - --deep --force --entitlements "$REPO_ROOT/build/entitlements.mac.plist" "$APP_PATH"

if [ $? -eq 0 ]; then
    echo "✅ App signed successfully"
else
    echo "❌ Signing failed"
    exit 1
fi

# Verify signature
echo ""
echo "Verifying entitlements..."
codesign -d --entitlements :- "$APP_PATH" 2>&1 | grep -A 10 "<dict>"

echo ""
echo "Step 2: Clearing stale TCC database entries..."
echo "==============================================="

# Close System Preferences if open (interferes with TCC database)
osascript -e 'tell application "System Settings" to quit' 2>/dev/null || true
sleep 1

# Clear TCC entries for EVIA Desktop
echo "Clearing TCC entries for 'com.evia.desktop'..."
sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
  "DELETE FROM access WHERE service='kTCCServiceScreenCapture' AND client LIKE '%evia%';" 2>/dev/null || true

echo "✅ TCC entries cleared"

echo ""
echo "Step 3: Grant Screen Recording permission in System Preferences"
echo "================================================================"
echo ""
echo "IMPORTANT: You MUST manually grant permission now!"
echo ""
echo "1. Open: System Preferences > Privacy & Security > Screen & System Audio Recording"
echo "2. Click the '+' button"
echo "3. Press Cmd+Shift+G and paste this path:"
echo "   $(pwd)/$APP_PATH"
echo "4. Select 'EVIA Desktop.app' and click 'Open'"
echo "5. Toggle the checkbox next to 'EVIA Desktop' to ON"
echo ""
echo "Opening System Preferences for you..."

# Open System Preferences to the correct pane
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

echo ""
echo "Waiting for you to grant permission..."
echo "Press Enter AFTER you've enabled 'EVIA Desktop' in System Preferences..."
read

echo ""
echo "Step 4: Verifying TCC database entry..."
echo "========================================"

# Check TCC entry
TCC_ENTRY=$(sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
  "SELECT service, client, auth_value FROM access WHERE service='kTCCServiceScreenCapture' AND client LIKE '%evia%';" 2>/dev/null)

if [ -z "$TCC_ENTRY" ]; then
    echo "⚠️  WARNING: No TCC entry found for EVIA Desktop!"
    echo "The app might not have the correct bundle identifier."
    echo ""
    echo "Let's check what macOS sees..."
    echo ""
    echo "All Screen Recording permissions:"
    sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
      "SELECT client, auth_value FROM access WHERE service='kTCCServiceScreenCapture';" 2>/dev/null | tail -10
    echo ""
    echo "Look for an entry related to EVIA Desktop above."
else
    echo "✅ TCC Entry Found:"
    echo "$TCC_ENTRY"
    
    # Check if auth_value is 2 (allowed)
    AUTH_VALUE=$(echo "$TCC_ENTRY" | cut -d'|' -f3)
    if [ "$AUTH_VALUE" = "2" ]; then
        echo "✅ Permission is GRANTED (auth_value=2)"
    else
        echo "⚠️  Permission status: $AUTH_VALUE (should be 2)"
    fi
fi

echo ""
echo "Step 5: Test system audio capture"
echo "=================================="
echo ""
echo "Now run the app and test:"
echo ""
echo "  open \"$APP_PATH\""
echo ""
echo "Then:"
echo "  1. Login (if needed)"
echo "  2. Click 'Zuhören'"
echo "  3. Play system audio (YouTube, Spotify, etc.)"
echo "  4. Check the terminal logs for:"
echo "     [Main] ✅ Screen Recording permission already granted"
echo "     [Main] ✅ Found X desktop sources"
echo ""
echo "Press Enter to launch the app now..."
read

# Launch app
open "$APP_PATH"

echo ""
echo "🔍 Watch the terminal output above for permission status!"
echo ""
echo "If you see:"
echo "  ✅ '[Main] ✅ Screen Recording permission already granted'"
echo "  ✅ '[Main] ✅ Found X desktop sources'"
echo ""
echo "Then system audio capture should work!"
echo ""
echo "If you still see '[Main] ❌ Screen Recording permission DENIED':"
echo "  1. Quit the app (Cmd+Q)"
echo "  2. Run this script again"
echo "  3. Make sure you toggle EVIA Desktop ON in System Preferences"
echo ""

