#!/bin/bash

##############################################################################
# EVIA Desktop - Dev Electron Bundle Signing Script
# 
# PURPOSE: Fix macOS Screen Recording permission issue in development
# 
# ISSUE: When running via `npm run dev:main`, Electron launches with bundle ID
#        "com.github.Electron" which doesn't have Screen Recording permission.
#        macOS checks THIS bundle's permissions, not Cursor's.
# 
# SOLUTION: Ad-hoc sign the dev Electron bundle with Screen Recording entitlements
#           so it can request and use Screen Recording permission.
# 
# BASED ON: Glass system-audio-capture-permissions.md (lines 37-68)
# 
# USAGE: 
#   1. Run this script once: ./sign-dev-electron.sh
#   2. Go to System Settings > Privacy & Security > Screen Recording
#   3. Click [+] and add: node_modules/electron/dist/Electron.app
#   4. Toggle it ON
#   5. Restart EVIA Desktop dev server
# 
# NOTE: Must be re-run after `npm install` or Electron version changes
##############################################################################

set -e  # Exit on error

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║         🔐 EVIA DESKTOP - DEV ELECTRON BUNDLE SIGNING           ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Paths (make paths robust regardless of CWD)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Robust paths
ENTITLEMENTS="$REPO_ROOT/build/entitlements.mac.plist"
ELECTRON_APP="$REPO_ROOT/node_modules/electron/dist/Electron.app"

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}❌ Error: This script only runs on macOS${NC}"
    exit 1
fi

# Check if Electron.app exists
if [ ! -d "$ELECTRON_APP" ]; then
    echo -e "${RED}❌ Error: Electron.app not found at: $ELECTRON_APP${NC}"
    echo -e "${YELLOW}💡 Run 'npm install' first${NC}"
    exit 1
fi

# Check if entitlements file exists
if [ ! -f "$ENTITLEMENTS" ]; then
    echo -e "${RED}❌ Error: Entitlements file not found: $ENTITLEMENTS${NC}"
    exit 1
fi

echo "📝 Step 1: Removing quarantine attribute..."
xattr -dr com.apple.quarantine "$ELECTRON_APP" 2>/dev/null || true
echo -e "${GREEN}✅ Quarantine removed${NC}"
echo ""

echo "📝 Step 2: Ad-hoc signing Electron.app with entitlements..."
echo "   Bundle: $ELECTRON_APP"
echo "   Entitlements: $ENTITLEMENTS"
echo ""

codesign -s - \
    --deep \
    --force \
    --entitlements "$ENTITLEMENTS" \
    "$ELECTRON_APP"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Electron.app signed successfully${NC}"
else
    echo -e "${RED}❌ Failed to sign Electron.app${NC}"
    exit 1
fi
echo ""

echo "📝 Step 3: Verifying signature..."
codesign -d --entitlements - "$ELECTRON_APP" 2>&1 | grep -q "com.apple.security.personal-information.screen-recording"
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Screen Recording entitlement verified${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: Could not verify entitlements (may still work)${NC}"
fi
echo ""

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║                    ✅ SIGNING COMPLETE                           ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${YELLOW}📋 NEXT STEPS (REQUIRED):${NC}"
echo ""
echo "1️⃣  Open System Settings:"
echo "   System Settings → Privacy & Security → Screen Recording"
echo ""
echo "2️⃣  Add Electron.app to the list:"
echo "   - Click the [+] button"
echo "   - Press Cmd+Shift+G"
echo "   - Paste this path:"
echo "     $(pwd)/$ELECTRON_APP"
echo "   - Click [Open]"
echo "   - Toggle it ON"
echo ""
echo "3️⃣  Restart EVIA Desktop:"
echo "   - Kill current dev server (Ctrl+C)"
echo "   - Run: ./start-e2e-test.sh"
echo ""
echo "4️⃣  Test Screen Recording permission:"
echo "   - Permission window should show screen as 'granted'"
echo "   - Terminal should show: screen: 'granted'"
echo ""
echo -e "${RED}⚠️  IMPORTANT:${NC}"
echo "   - Re-run this script after 'npm install'"
echo "   - Re-run if Electron version changes"
echo "   - This is a DEV-ONLY workaround"
echo "   - Production builds use proper code signing"
echo ""
echo "Bundle ID: com.github.Electron"
echo "Signed: $(date)"
echo ""

