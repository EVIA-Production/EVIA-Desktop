#!/bin/bash

##############################################################################
# EVIA Desktop - Fix Wrong Electron.app in System Settings
# 
# ISSUE: Multiple Electron.app bundles exist (EVIA + Glass)
#        User likely added the wrong one to Screen Recording permissions
# 
# SOLUTION: Reset TCC, remove all Electron entries, guide user to add correct one
##############################################################################

set -e

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║     🔧 FIX WRONG ELECTRON.APP IN SCREEN RECORDING              ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Scanning for Electron.app bundles...${NC}"
echo ""

# Find all Electron.app bundles
ELECTRON_APPS=$(mdfind "kMDItemFSName == 'Electron.app'" 2>/dev/null)

echo "Found Electron.app bundles:"
echo "$ELECTRON_APPS" | nl
echo ""

# Highlight the correct one
CORRECT_PATH="/Users/benekroetz/EVIA/EVIA-Desktop/node_modules/electron/dist/Electron.app"
echo -e "${GREEN}✅ CORRECT ONE (EVIA):${NC}"
echo "   $CORRECT_PATH"
echo ""

# Check if it's signed
echo -e "${BLUE}🔍 Verifying EVIA Electron.app signature...${NC}"
if codesign -d --entitlements - "$CORRECT_PATH" 2>&1 | grep -q "screen-recording"; then
    echo -e "${GREEN}✅ Has screen-recording entitlement${NC}"
else
    echo -e "${RED}❌ Missing screen-recording entitlement${NC}"
    echo -e "${YELLOW}💡 Run: ./sign-dev-electron.sh${NC}"
    exit 1
fi
echo ""

# Step 1: Reset TCC
echo -e "${BLUE}📝 Step 1: Resetting Screen Recording permission for Electron...${NC}"
tccutil reset ScreenCapture com.github.Electron 2>/dev/null || true
echo -e "${GREEN}✅ Permission reset${NC}"
echo ""

# Step 2: Kill all Electron processes
echo -e "${BLUE}📝 Step 2: Killing all Electron processes...${NC}"
pkill -9 -f electron 2>/dev/null || true
pkill -9 -f Electron 2>/dev/null || true
sleep 1
echo -e "${GREEN}✅ All Electron processes killed${NC}"
echo ""

# Step 3: Instructions for System Settings
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║                    ⚠️  MANUAL STEPS REQUIRED                     ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${YELLOW}📝 Step 3: Remove ALL 'Electron' entries from System Settings${NC}"
echo ""
echo "1. Open System Settings"
echo "2. Go to: Privacy & Security → Screen Recording"
echo "3. Find ALL entries named 'Electron'"
echo "4. For each one:"
echo "   - Click to select"
echo "   - Press [-] (minus button)"
echo "   - Confirm removal"
echo ""
echo -e "${YELLOW}📝 Step 4: Add the CORRECT Electron.app (EVIA's)${NC}"
echo ""
echo "1. Still in Screen Recording settings"
echo "2. Click [+] (plus button)"
echo "3. Press Cmd+Shift+G (Go to Folder)"
echo "4. Paste this path:"
echo ""
echo -e "${GREEN}$CORRECT_PATH${NC}"
echo ""
echo "5. Press Enter"
echo "6. Select 'Electron.app'"
echo "7. Click 'Open'"
echo "8. Toggle it ON (blue)"
echo ""
echo -e "${YELLOW}📝 Step 5: Verify it was added correctly${NC}"
echo ""
echo "In Screen Recording list, you should see:"
echo "  - 'Electron' (toggled ON)"
echo "  - Only ONE 'Electron' entry"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT:${NC}"
echo "  - Make sure you used the EXACT path above"
echo "  - Not the Glass path: /Users/benekroetz/EVIA/glass/..."
echo "  - Both show as 'Electron' in the UI, so path is critical!"
echo ""
echo "Press Enter when you've completed steps 3-5..."
read -r

# Step 6: Restart EVIA
echo ""
echo -e "${BLUE}📝 Step 6: Restarting EVIA Desktop...${NC}"
echo ""
echo "Starting EVIA Desktop in 3 seconds..."
sleep 3

cd /Users/benekroetz/EVIA/EVIA-Desktop
exec ./start-e2e-test.sh

