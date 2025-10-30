#!/bin/bash

echo "🔨 EVIA Desktop - Complete Build & System Audio Test"
echo "===================================================="
echo ""
echo "This script will:"
echo "  1. Clean previous builds"
echo "  2. Build with proper entitlements"
echo "  3. Verify entitlements are embedded"
echo "  4. Clear old TCC permissions"
echo "  5. Launch for testing"
echo ""

set -e  # Exit on error

# Step 1: Clean
echo "Step 1: Cleaning previous builds..."
rm -rf dist/
rm -rf dist-electron/
echo "  ✅ Clean complete"
echo ""

# Step 2: Build
echo "Step 2: Building with entitlements..."
npm run build
echo "  ✅ Build complete"
echo ""

# Step 3: Find the built app
echo "Step 3: Locating built app..."
APP_PATH=""
for path in "dist/mac/EVIA Desktop.app" "dist/mac-arm64/EVIA Desktop.app" "dist/mac-x64/EVIA Desktop.app"; do
    if [ -d "$path" ]; then
        APP_PATH="$path"
        echo "  ✅ Found app at: $APP_PATH"
        break
    fi
done

if [ -z "$APP_PATH" ]; then
    echo "  ❌ Built app not found!"
    echo "  Checked:"
    echo "    - dist/mac/EVIA Desktop.app"
    echo "    - dist/mac-arm64/EVIA Desktop.app"
    echo "    - dist/mac-x64/EVIA Desktop.app"
    exit 1
fi
echo ""

# Step 4: Verify entitlements
echo "Step 4: Verifying entitlements are embedded..."
ENTITLEMENTS_OUTPUT=$(codesign -d --entitlements :- "$APP_PATH" 2>&1 || echo "FAILED")

if echo "$ENTITLEMENTS_OUTPUT" | grep -q "com.apple.security.device.screen-recording\|com.apple.security.personal-information.screen-recording"; then
    echo "  ✅ Screen recording entitlement found!"
else
    echo "  ❌ WARNING: Screen recording entitlement NOT found in built app!"
    echo "  This means electron-builder didn't embed entitlements correctly."
    echo ""
    echo "  Entitlements output:"
    echo "$ENTITLEMENTS_OUTPUT"
    echo ""
    echo "  Attempting ad-hoc re-signing as workaround..."
    codesign -s - --deep --force --entitlements build/entitlements.mac.plist "$APP_PATH"
    echo "  ✅ Re-signed with entitlements"
fi
echo ""

# Step 5: Remove quarantine
echo "Step 5: Removing quarantine attribute..."
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
echo "  ✅ Quarantine removed"
echo ""

# Step 6: Clear old TCC entries
echo "Step 6: Clearing old TCC permissions for EVIA Desktop..."
APP_BUNDLE_ID="com.evia.desktop"

# Try to reset using tccutil (requires Full Disk Access for Terminal)
echo "  Attempting tccutil reset..."
tccutil reset ScreenCapture "$APP_BUNDLE_ID" 2>/dev/null && echo "    ✅ Reset via tccutil" || echo "    ⚠️  tccutil reset failed (may need Full Disk Access)"

echo ""

# Step 7: Display instructions
echo "=========================================="
echo "🚨 CRITICAL: MANUAL PERMISSION SETUP 🚨"
echo "=========================================="
echo ""
echo "Before testing, you MUST:"
echo ""
echo "1. Open: System Settings > Privacy & Security > Screen & System Audio Recording"
echo ""
echo "2. Remove ALL existing 'EVIA Desktop' entries:"
echo "   - Select each 'EVIA Desktop' entry"
echo "   - Click the '-' button"
echo "   - Repeat for all entries"
echo ""
echo "3. Add the newly built app:"
echo "   - Click the '+' button"
echo "   - Press Cmd+Shift+G"
echo "   - Paste this path: $PWD/$APP_PATH"
echo "   - Click 'Open'"
echo "   - Check the checkbox next to 'EVIA Desktop'"
echo ""
echo "4. If macOS prompts to 'Quit & Reopen', click it"
echo ""

read -p "Press Enter AFTER you've completed steps 1-4..."

echo ""
echo "Step 8: Verifying TCC entry..."
TCC_CHECK=$(sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
  "SELECT service, client, auth_value FROM access WHERE client='$APP_BUNDLE_ID' AND service='kTCCServiceScreenCapture';" \
  2>/dev/null || echo "")

if [ -n "$TCC_CHECK" ]; then
    echo "  ✅ TCC entry found: $TCC_CHECK"
    if echo "$TCC_CHECK" | grep -q "|2$\||2|"; then
        echo "  ✅ Permission is GRANTED (auth_value=2)"
    else
        echo "  ⚠️  Permission exists but may not be granted"
        echo "     Expected auth_value=2, got: $TCC_CHECK"
    fi
else
    echo "  ⚠️  WARNING: No TCC entry found for $APP_BUNDLE_ID"
    echo "  This may mean macOS hasn't registered the permission yet."
    echo "  The app will prompt on first launch."
fi
echo ""

# Step 9: Launch with logging
echo "=========================================="
echo "🚀 LAUNCHING EVIA DESKTOP"
echo "=========================================="
echo ""
echo "Watch for these in the output:"
echo "  ✅ '[Main] macOS Screen Recording permission status: granted'"
echo "  ✅ '[Main] ✅ Found X desktop sources'"
echo "  ✅ '[AudioCapture] Sent SYSTEM chunk'"
echo "  ❌ '[Main] ❌ desktopCapturer.getSources ERROR'"
echo ""
echo "In the Listen window, you should see:"
echo "  🔵 Blue bubbles (right side) = Your voice (mic)"
echo "  ⚪ Grey bubbles (left side) = System audio"
echo ""
echo "Press Ctrl+C to quit when done testing."
echo ""

# Launch and stream logs
"$APP_PATH/Contents/MacOS/EVIA Desktop"

echo ""
echo "App exited."

