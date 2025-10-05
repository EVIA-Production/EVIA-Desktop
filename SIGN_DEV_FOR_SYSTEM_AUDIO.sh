#!/bin/bash
# Sign development Electron and SystemAudioDump binary for macOS system audio capture
# Based on Glass's system-audio-capture-permissions.md

set -e  # Exit on error

echo "🔐 Signing EVIA Desktop for System Audio Capture (Dev Mode)"
echo "============================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Paths
ELECTRON_APP="./node_modules/electron/dist/Electron.app"
BINARY_PATH="./src/main/assets/SystemAudioDump"
ENTITLEMENTS="./build/entitlements.mac.plist"

# Step 1: Verify files exist
echo "Step 1: Verifying files..."
if [ ! -d "$ELECTRON_APP" ]; then
  echo -e "${RED}❌ Electron.app not found at: $ELECTRON_APP${NC}"
  echo "Run: npm install"
  exit 1
fi

if [ ! -f "$BINARY_PATH" ]; then
  echo -e "${RED}❌ SystemAudioDump binary not found at: $BINARY_PATH${NC}"
  echo "Run the main implementation script first."
  exit 1
fi

if [ ! -f "$ENTITLEMENTS" ]; then
  echo -e "${RED}❌ Entitlements file not found at: $ENTITLEMENTS${NC}"
  exit 1
fi

echo -e "${GREEN}✅ All files found${NC}"
echo ""

# Step 2: Remove quarantine attribute
echo "Step 2: Removing quarantine attribute from Electron.app..."
xattr -dr com.apple.quarantine "$ELECTRON_APP" 2>/dev/null || true
echo -e "${GREEN}✅ Quarantine removed${NC}"
echo ""

# Step 3: Ensure binary is executable
echo "Step 3: Making SystemAudioDump executable..."
chmod +x "$BINARY_PATH"
echo -e "${GREEN}✅ Binary is executable${NC}"
echo ""

# Step 4: Sign SystemAudioDump with entitlements
echo "Step 4: Signing SystemAudioDump binary with screen recording entitlements..."
codesign -s - --entitlements "$ENTITLEMENTS" --force "$BINARY_PATH"
echo -e "${GREEN}✅ SystemAudioDump signed${NC}"
echo ""

# Step 5: Deep sign Electron.app
echo "Step 5: Deep signing Electron.app with screen recording entitlements..."
codesign -s - --deep --force --entitlements "$ENTITLEMENTS" "$ELECTRON_APP"
echo -e "${GREEN}✅ Electron.app signed${NC}"
echo ""

# Step 6: Verify signatures
echo "Step 6: Verifying signatures..."
echo ""
echo "SystemAudioDump entitlements:"
codesign -d --entitlements :- "$BINARY_PATH" 2>&1 | grep -A 3 "screen-recording" || echo -e "${YELLOW}⚠️  Could not verify entitlements${NC}"
echo ""
echo "Electron.app signature:"
codesign -d --verbose "$ELECTRON_APP" 2>&1 | grep -i "Authority" | head -1 || echo "Ad-hoc signed"
echo ""

# Step 7: Check TCC database for existing entries
echo "Step 7: Checking macOS TCC (permissions) database..."
TCC_RESULT=$(sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
  "SELECT client, auth_value FROM access WHERE service='kTCCServiceScreenCapture' AND client LIKE '%Electron%';" 2>/dev/null || echo "")

if [ -z "$TCC_RESULT" ]; then
  echo -e "${YELLOW}⚠️  No TCC entry found for Electron${NC}"
  echo "This is normal on first run."
else
  echo -e "${GREEN}✅ Found existing TCC entry:${NC}"
  echo "$TCC_RESULT"
fi
echo ""

# Step 8: Instructions for user
echo "============================================================"
echo -e "${GREEN}🎉 Signing Complete!${NC}"
echo "============================================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Open System Settings → Privacy & Security → Screen & System Audio Recording"
echo ""
echo "2. Add Electron.app to the list:"
echo "   Click '+' button"
echo "   Press ⌘⇧G (Cmd+Shift+G)"
echo "   Paste this path:"
echo "   $(pwd)/node_modules/electron/dist/"
echo "   Select 'Electron.app' and click 'Open'"
echo "   Toggle it ON"
echo ""
echo "3. Restart EVIA Desktop:"
echo "   npm run dev"
echo ""
echo "4. Click 'Zuhören' and test system audio capture"
echo ""
echo -e "${YELLOW}📝 Note: After npm install or Electron version change, re-run this script${NC}"
echo ""

# Step 9: Optional - Reset TCC if needed (commented out for safety)
# Uncomment if you need to reset permissions
# echo "To reset permissions (if needed):"
# echo "sqlite3 ~/Library/Application\\ Support/com.apple.TCC/TCC.db \\"
# echo "  \"DELETE FROM access WHERE service='kTCCServiceScreenCapture' AND client IN ('com.github.Electron','com.github.electron.electron');\""
# echo ""

exit 0

