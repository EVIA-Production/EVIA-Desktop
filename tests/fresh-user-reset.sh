#!/bin/bash

# 🧹 EVIA Desktop - Complete Fresh User Reset
# Resets app to first-time user state for testing

set -e

echo "🧹 EVIA Desktop - Fresh User Reset"
echo "=================================="
echo ""

# 1. Kill any running instances
echo "1️⃣  Killing any running EVIA instances..."
pkill -f "EVIA.app" 2>/dev/null || true
pkill -f "EVIA Desktop.app" 2>/dev/null || true
pkill -f "evia-desktop" 2>/dev/null || true
sleep 1
echo "   ✅ Processes killed"
echo ""

# 2. Clear Application Support (both old and new names)
echo "2️⃣  Clearing Application Support data..."
rm -rf ~/Library/Application\ Support/evia-desktop/ 2>/dev/null || true
rm -rf ~/Library/Application\ Support/evia/ 2>/dev/null || true
echo "   ✅ App data cleared"
echo ""

# 3. Clear Caches
echo "3️⃣  Clearing cache data..."
rm -rf ~/Library/Caches/evia-desktop/ 2>/dev/null || true
rm -rf ~/Library/Caches/evia/ 2>/dev/null || true
echo "   ✅ Cache cleared"
echo ""

# 4. Clear Keychain tokens (try all possible service names)
echo "4️⃣  Clearing Keychain tokens..."
security delete-generic-password -s "evia-desktop-token" 2>/dev/null && echo "   ✅ Deleted 'evia-desktop-token'" || echo "   ℹ️  No 'evia-desktop-token' found"
security delete-generic-password -s "evia-token" 2>/dev/null && echo "   ✅ Deleted 'evia-token'" || echo "   ℹ️  No 'evia-token' found"
security delete-generic-password -s "evia" -a "token" 2>/dev/null && echo "   ✅ Deleted 'evia' token" || echo "   ℹ️  No 'evia' token found"
echo ""

# 5. Check for built app
echo "5️⃣  Checking for built app..."
if [ -d "dist/mac-arm64/EVIA.app" ]; then
    echo "   ✅ Found: dist/mac-arm64/EVIA.app"
    APP_PATH="$(pwd)/dist/mac-arm64/EVIA.app"
else
    echo "   ❌ App not found at dist/mac-arm64/EVIA.app"
    echo "   Run 'npm run build' first"
    exit 1
fi
echo ""

# 6. Manual permission reset instructions
echo "6️⃣  System Permissions - MANUAL STEP REQUIRED:"
echo "   ⚠️  You MUST manually remove permissions in System Settings:"
echo ""
echo "   📍 Open: System Settings → Privacy & Security"
echo "   📍 Remove 'EVIA' from:"
echo "      • Screen Recording"
echo "      • Microphone"
echo ""
echo "   (Also remove 'EVIA Desktop' and 'Electron' if present)"
echo ""
read -p "   Press Enter once you've removed permissions..." -r
echo ""

# 7. Verify backend is running
echo "7️⃣  Checking backend status..."
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "   ✅ Backend is running at http://localhost:8000"
else
    echo "   ⚠️  Backend NOT running!"
    echo "   Start it with: cd ../EVIA-Backend && docker compose up"
    echo ""
    read -p "   Continue anyway? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi
echo ""

# 8. Launch app
echo "8️⃣  Launching EVIA.app..."
echo "   Path: $APP_PATH"
echo ""

open "$APP_PATH"

echo "✅ FRESH USER RESET COMPLETE"
echo ""
echo "🎯 EXPECTED FIRST-TIME USER FLOW:"
echo "   1. Welcome window appears"
echo "   2. Click 'Open Browser to Log in'"
echo "   3. Browser opens to login page"
echo "   4. After login, return to app"
echo "   5. Permission window appears"
echo "   6. Grant Microphone permission (system popup)"
echo "   7. Grant Screen Recording permission (system popup)"
echo "   8. Header appears in selected language"
echo ""
echo "📋 TEST THE 6 PREP FIXES:"
echo "   ✅ #5: Cmd+Enter opens only Ask (not Settings)"
echo "   ✅ #9: Windows centered under header"
echo "   ✅ #10: Copy in German shows 'Frage/Antwort'"
echo "   ✅ #11: Welcome button doesn't overlap text"
echo "   ✅ Rename: App name shows 'EVIA' not 'EVIA Desktop'"
echo "   ✅ Delay: Settings hides faster (50ms)"
echo ""
echo "🐛 If you encounter issues, check Console.app for logs"
echo ""

