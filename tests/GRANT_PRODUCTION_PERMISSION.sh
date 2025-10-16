#!/bin/bash

echo "🔐 Grant Screen Recording Permission to EVIA Desktop (Production)"
echo "==================================================================="
echo ""
echo "This script will help you grant the necessary permissions for"
echo "system audio capture in the production EVIA Desktop app."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

APP_PATH="$(pwd)/dist/mac-arm64/EVIA Desktop.app"

echo "📍 Step 1: Opening System Settings..."
echo "----------------------------------------"
echo ""
echo -e "${YELLOW}⏳ Opening Privacy & Security > Screen Recording...${NC}"
sleep 1

# Open System Settings to Screen Recording
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

echo ""
echo -e "${GREEN}✅ System Settings opened${NC}"
echo ""
echo "📍 Step 2: Add EVIA Desktop to Screen Recording"
echo "----------------------------------------"
echo ""
echo "In the System Settings window that just opened:"
echo ""
echo "  1. Look for the 'Screen Recording' section"
echo "     (if you don't see it, navigate to: Privacy & Security > Screen Recording)"
echo ""
echo "  2. Click the '+' button at the bottom of the app list"
echo ""
echo "  3. In the file picker that opens:"
echo "     - Press: Cmd + Shift + G"
echo "     - Paste this path:"
echo ""
echo -e "     ${GREEN}$APP_PATH${NC}"
echo ""
echo "  4. Click 'Open'"
echo ""
echo "  5. Toggle the switch next to 'EVIA Desktop' to ON (enabled)"
echo ""
echo "  6. If prompted, click 'Quit & Reopen' or 'Later'"
echo ""
echo ""
echo -e "${YELLOW}⏸️  Waiting for you to complete the steps above...${NC}"
echo ""
read -p "Press ENTER when you've granted the permission..."

echo ""
echo "📍 Step 3: Verifying permission..."
echo "----------------------------------------"

# Check if permission was granted
sleep 1
EVIA_PERMISSION=$(sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
    "SELECT service, client, auth_value FROM access WHERE client='com.evia.desktop' AND service='kTCCServiceScreenCapture';" 2>/dev/null)

if [ -n "$EVIA_PERMISSION" ] && echo "$EVIA_PERMISSION" | grep -q "2"; then
    echo -e "${GREEN}✅ SUCCESS! EVIA Desktop now has Screen Recording permission${NC}"
    echo ""
    echo "Permission details:"
    echo "$EVIA_PERMISSION"
    echo ""
    echo "📍 Step 4: Launch the app"
    echo "----------------------------------------"
    echo ""
    echo "You can now launch EVIA Desktop and test system audio:"
    echo ""
    echo -e "  ${GREEN}open \"$APP_PATH\"${NC}"
    echo ""
    echo "To monitor audio capture in real-time:"
    echo ""
    echo -e "  ${GREEN}./MONITOR_PRODUCTION_AUDIO.sh${NC}"
    echo ""
elif [ -n "$EVIA_PERMISSION" ]; then
    echo -e "${RED}❌ Permission was added but is set to DENIED (auth_value != 2)${NC}"
    echo ""
    echo "Please ensure the toggle is switched ON in System Settings."
else
    echo -e "${RED}❌ Permission not found in TCC database${NC}"
    echo ""
    echo "This could mean:"
    echo "  - The permission wasn't added yet"
    echo "  - You need to fully quit and reopen System Settings"
    echo "  - macOS needs a moment to update the database"
    echo ""
    echo "Try running this script again, or manually check:"
    echo "  System Settings > Privacy & Security > Screen Recording"
fi

echo ""
echo "🎯 Quick Test"
echo "----------------------------------------"
echo ""
echo "Run the full diagnostic again to verify everything:"
echo ""
echo "  ./TEST_PRODUCTION_SYSTEM_AUDIO.sh"
echo ""

