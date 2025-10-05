#!/bin/bash

# Force macOS to refresh Screen Recording permission for EVIA Desktop
# This works around the TCC database sync issue where System Settings shows
# the permission as granted but macOS hasn't actually registered it

set -e

echo "🔄 Force Refresh Screen Recording Permission for EVIA Desktop"
echo "=============================================================="
echo ""

APP_PATH="/Users/benekroetz/EVIA/EVIA-Desktop/dist/mac-arm64/EVIA Desktop.app"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ Production app not found at: $APP_PATH"
    exit 1
fi

echo "✅ App found: $APP_PATH"
echo ""

# Step 1: Kill System Settings to force TCC refresh
echo "📍 Step 1: Killing System Settings to force TCC refresh..."
echo "-----------------------------------------------------------"
killall "System Settings" 2>/dev/null || true
sleep 2
echo "✅ System Settings killed (this forces macOS to reload TCC database)"
echo ""

# Step 2: Re-sign the app to reset its permission state
echo "📍 Step 2: Re-signing the app with entitlements..."
echo "-----------------------------------------------------------"
codesign -s - --deep --force --entitlements entitlements.plist "$APP_PATH" 2>/dev/null
echo "✅ App re-signed (this clears any cached permission state)"
echo ""

# Step 3: Touch the app to update its modification time
echo "📍 Step 3: Updating app modification time..."
echo "-----------------------------------------------------------"
touch "$APP_PATH"
echo "✅ App touched (this triggers macOS to re-evaluate permissions)"
echo ""

# Step 4: Open System Settings and wait
echo "📍 Step 4: Opening System Settings..."
echo "-----------------------------------------------------------"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
sleep 3
echo ""

echo "📍 Step 5: CRITICAL - Remove and Re-add the Permission"
echo "-----------------------------------------------------------"
echo ""
echo "  🚨 IMPORTANT: You MUST remove and re-add the permission!"
echo ""
echo "  In the System Settings window that just opened:"
echo ""
echo "  1. Find 'EVIA Desktop' in the list"
echo "     (If you don't see it, skip to step 3)"
echo ""
echo "  2. SELECT it and click the '-' (minus) button to REMOVE it"
echo "     ⚠️  This step is CRITICAL - the toggle alone doesn't work!"
echo ""
echo "  3. Click the '+' (plus) button"
echo ""
echo "  4. Press: Cmd + Shift + G"
echo ""
echo "  5. Paste this path:"
echo "     $APP_PATH"
echo ""
echo "  6. Click 'Open'"
echo ""
echo "  7. Toggle the switch to ON"
echo ""
echo "  8. If prompted, click 'Quit & Reopen'"
echo ""
echo ""
echo "⏸️  Waiting for you to complete the steps above..."
echo ""
read -p "Press ENTER when you've REMOVED and RE-ADDED the permission..."
echo ""

# Step 5: Kill System Settings again to force commit
echo "📍 Step 6: Forcing TCC to commit changes..."
echo "-----------------------------------------------------------"
killall "System Settings" 2>/dev/null || true
sleep 2
echo "✅ System Settings killed (forces TCC write to disk)"
echo ""

# Step 6: Verify using indirect method (since we can't access TCC directly)
echo "📍 Step 7: Indirect verification..."
echo "-----------------------------------------------------------"
echo ""
echo "Testing if the helper binary can run (this tests actual permission):"
echo ""

HELPER_PATH="$APP_PATH/Contents/Resources/app.asar.unpacked/src/main/assets/SystemAudioDump"

if [ -f "$HELPER_PATH" ]; then
    echo "Running: $HELPER_PATH (should exit immediately if permission OK)"
    # Run for 1 second - if it starts without error, permission is granted
    timeout 1 "$HELPER_PATH" 2>&1 | head -n 5 || true
    RESULT=$?
    
    if [ $RESULT -eq 124 ] || [ $RESULT -eq 0 ]; then
        echo ""
        echo "✅ Binary ran without immediate exit"
        echo "   This suggests permission is granted!"
    else
        echo ""
        echo "⚠️  Binary exited with code: $RESULT"
        echo "   This might mean permission is still not granted"
    fi
else
    echo "⚠️  Helper binary not found at: $HELPER_PATH"
fi

echo ""
echo "📍 Step 8: Final steps..."
echo "-----------------------------------------------------------"
echo ""
echo "1. Fully quit EVIA Desktop if it's running:"
echo "   Cmd+Q or right-click > Quit"
echo ""
echo "2. Launch it fresh"
echo ""
echo "3. Test system audio capture"
echo ""
echo "4. If still not working, try:"
echo "   - Restart your Mac (forces full TCC reload)"
echo "   - Run ./TEST_PRODUCTION_SYSTEM_AUDIO.sh to diagnose"
echo ""
echo "🎯 Expected behavior after fix:"
echo "   - System audio should appear in transcriptions"
echo "   - No more silent failures"
echo ""


