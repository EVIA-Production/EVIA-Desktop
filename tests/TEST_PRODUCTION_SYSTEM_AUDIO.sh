#!/bin/bash

echo "🔍 EVIA Desktop Production - System Audio Diagnostics"
echo "======================================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_PATH="$REPO_ROOT/dist/mac-arm64/EVIA Desktop.app"
BINARY_PATH="$APP_PATH/Contents/Resources/app.asar.unpacked/src/main/assets/SystemAudioDump"

echo "📍 Step 1: Check if production app exists"
echo "----------------------------------------"
if [ -d "$APP_PATH" ]; then
    echo -e "${GREEN}✅ Production app found${NC}"
else
    echo -e "${RED}❌ Production app NOT found at: $APP_PATH${NC}"
    echo "Run: npm run build"
    exit 1
fi

echo ""
echo "📍 Step 2: Check SystemAudioDump binary"
echo "----------------------------------------"
if [ -f "$BINARY_PATH" ]; then
    echo -e "${GREEN}✅ Binary exists${NC}"
    ls -lh "$BINARY_PATH"
else
    echo -e "${RED}❌ Binary NOT found at: $BINARY_PATH${NC}"
    exit 1
fi

echo ""
echo "📍 Step 3: Check binary is executable"
echo "----------------------------------------"
if [ -x "$BINARY_PATH" ]; then
    echo -e "${GREEN}✅ Binary is executable${NC}"
else
    echo -e "${RED}❌ Binary is NOT executable${NC}"
    echo "Run: chmod +x \"$BINARY_PATH\""
fi

echo ""
echo "📍 Step 4: Check binary type"
echo "----------------------------------------"
file "$BINARY_PATH"

echo ""
echo "📍 Step 5: Check App Code Signature"
echo "----------------------------------------"
codesign -dvvv "$APP_PATH" 2>&1 | grep -E "(Identifier|Authority|Signature|Sealed Resources)"

echo ""
echo "📍 Step 6: Check App Entitlements"
echo "----------------------------------------"
ENTITLEMENTS=$(codesign -d --entitlements :- "$APP_PATH" 2>&1)
if echo "$ENTITLEMENTS" | grep -q "com.apple.security.personal-information.screen-recording"; then
    echo -e "${GREEN}✅ App has screen-recording entitlement${NC}"
else
    echo -e "${RED}❌ App is MISSING screen-recording entitlement${NC}"
    echo "Run: codesign -s - --deep --force --entitlements $REPO_ROOT/build/entitlements.mac.plist \"$APP_PATH\""
fi

if echo "$ENTITLEMENTS" | grep -q "com.apple.security.device.audio-input"; then
    echo -e "${GREEN}✅ App has audio-input entitlement${NC}"
else
    echo -e "${YELLOW}⚠️  App is MISSING audio-input entitlement${NC}"
fi

echo ""
echo "📍 Step 7: Check Binary Code Signature"
echo "----------------------------------------"
codesign -dvvv "$BINARY_PATH" 2>&1 | grep -E "(Identifier|Authority|Signature)"

echo ""
echo "📍 Step 8: Check Binary Entitlements"
echo "----------------------------------------"
BINARY_ENTITLEMENTS=$(codesign -d --entitlements :- "$BINARY_PATH" 2>&1)
if echo "$BINARY_ENTITLEMENTS" | grep -q "com.apple.security.personal-information.screen-recording"; then
    echo -e "${GREEN}✅ Binary has screen-recording entitlement${NC}"
else
    echo -e "${RED}❌ Binary is MISSING screen-recording entitlement${NC}"
    echo "Run: codesign -s - --force --entitlements $REPO_ROOT/build/entitlements.mac.plist \"$BINARY_PATH\""
fi

echo ""
echo "📍 Step 9: Check macOS Permissions for EVIA Desktop"
echo "----------------------------------------"
EVIA_PERMISSION=$(sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
    "SELECT service, client, auth_value, last_modified FROM access WHERE client='com.evia.desktop' AND service='kTCCServiceScreenCapture';" 2>/dev/null)

if [ -n "$EVIA_PERMISSION" ]; then
    echo -e "${GREEN}✅ EVIA Desktop has Screen Recording permission in TCC database${NC}"
    echo "$EVIA_PERMISSION"
else
    echo -e "${RED}❌ EVIA Desktop does NOT have Screen Recording permission${NC}"
    echo ""
    echo "🔧 To fix:"
    echo "   1. Open System Settings > Privacy & Security > Screen Recording"
    echo "   2. Click the + button"
    echo "   3. Press Cmd+Shift+G and paste: $(pwd)/$APP_PATH"
    echo "   4. Select 'EVIA Desktop.app' and click Open"
    echo "   5. Toggle it ON"
fi

echo ""
echo "📍 Step 10: Test Binary Directly (as production app would)"
echo "----------------------------------------"
echo "Running: $BINARY_PATH"
echo "This will test if the binary can capture audio when run directly..."
echo ""

# Run binary for 2 seconds to test
timeout 2 "$BINARY_PATH" 2>&1 || true

echo ""
echo "📍 Step 11: Check if EVIA Desktop app is running"
echo "----------------------------------------"
if pgrep -f "EVIA Desktop" > /dev/null; then
    echo -e "${YELLOW}⚠️  EVIA Desktop is currently running${NC}"
    echo "PID: $(pgrep -f "EVIA Desktop")"
    echo ""
    echo "To see real-time logs while app is running:"
    echo "  log stream --predicate 'process == \"EVIA Desktop\"' --level info | grep -i 'audio\\|permission\\|system'"
else
    echo -e "${GREEN}✅ EVIA Desktop is not running${NC}"
fi

echo ""
echo "📍 Summary"
echo "----------------------------------------"
echo "If you see permission issues above:"
echo "  1. Sign both app and binary with entitlements"
echo "  2. Grant Screen Recording permission in System Settings"
echo "  3. Restart the app"
echo ""
echo "To monitor audio capture in real-time:"
echo "  ./MONITOR_PRODUCTION_AUDIO.sh"

