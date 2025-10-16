#!/bin/bash

# Comprehensive diagnostic script for SystemAudioDump binary
# This will help identify why system audio capture is failing

set -e

echo "🔍 EVIA System Audio Diagnostic Tool"
echo "===================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Check binary exists
echo -e "${BLUE}Step 1: Checking SystemAudioDump binary...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BINARY_PATH="$REPO_ROOT/src/main/assets/SystemAudioDump"

if [ -f "$BINARY_PATH" ]; then
  echo -e "${GREEN}✅ Binary exists${NC}"
  echo "   Path: $BINARY_PATH"
  ls -lh "$BINARY_PATH"
else
  echo -e "${RED}❌ Binary NOT found at $BINARY_PATH${NC}"
  exit 1
fi

# Step 2: Check binary is executable
echo ""
echo -e "${BLUE}Step 2: Checking binary permissions...${NC}"
if [ -x "$BINARY_PATH" ]; then
  echo -e "${GREEN}✅ Binary is executable${NC}"
else
  echo -e "${RED}❌ Binary is NOT executable${NC}"
  echo "   Fixing permissions..."
  chmod +x "$BINARY_PATH"
  echo -e "${GREEN}✅ Fixed${NC}"
fi

# Step 3: Check binary type
echo ""
echo -e "${BLUE}Step 3: Checking binary type...${NC}"
file "$BINARY_PATH"

# Step 4: Check code signature
echo ""
echo -e "${BLUE}Step 4: Checking code signature...${NC}"
codesign -dv "$BINARY_PATH" 2>&1 || echo -e "${YELLOW}⚠️  Binary is not signed${NC}"

# Step 5: Check entitlements
echo ""
echo -e "${BLUE}Step 5: Checking entitlements...${NC}"
codesign -d --entitlements :- "$BINARY_PATH" 2>&1 || echo -e "${YELLOW}⚠️  No entitlements found${NC}"

# Step 6: Check macOS Screen Recording permission for Terminal
echo ""
echo -e "${BLUE}Step 6: Checking Screen Recording permissions...${NC}"
echo "   Checking TCC database for Terminal.app..."
TCC_DB="$HOME/Library/Application Support/com.apple.TCC/TCC.db"

if [ -f "$TCC_DB" ]; then
  # Check for Terminal.app
  TERMINAL_ENTRY=$(sqlite3 "$TCC_DB" "SELECT service, client, auth_value, auth_reason FROM access WHERE service='kTCCServiceScreenCapture' AND (client LIKE '%Terminal%' OR client LIKE '%iTerm%');" 2>/dev/null || echo "")
  
  if [ -z "$TERMINAL_ENTRY" ]; then
    echo -e "${RED}❌ Terminal.app does NOT have Screen Recording permission${NC}"
    echo ""
    echo -e "${YELLOW}🔧 REQUIRED FIX:${NC}"
    echo "   1. Open System Settings"
    echo "   2. Go to Privacy & Security → Screen & System Audio Recording"
    echo "   3. Click the '+' button"
    echo "   4. Navigate to /Applications/Utilities/"
    echo "   5. Select Terminal.app (or iTerm2.app if you use that)"
    echo "   6. Toggle it ON"
    echo "   7. Quit and restart this test"
  else
    echo -e "${GREEN}✅ Terminal/iTerm has Screen Recording permission${NC}"
    echo "   $TERMINAL_ENTRY"
  fi
else
  echo -e "${YELLOW}⚠️  TCC database not accessible${NC}"
fi

# Step 7: Test binary execution directly
echo ""
echo -e "${BLUE}Step 7: Testing direct binary execution...${NC}"
echo "   Running binary for 2 seconds..."
echo "   (You should hear a brief system sound if it's working)"

# Try to run the binary with a timeout
timeout 2s "$BINARY_PATH" > /tmp/system_audio_test.raw 2>&1 &
BINARY_PID=$!

sleep 2.5

# Check if process is still running
if ps -p $BINARY_PID > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Binary is running${NC}"
  kill $BINARY_PID 2>/dev/null || true
else
  echo -e "${RED}❌ Binary exited immediately${NC}"
  
  # Check for error output
  if [ -f /tmp/system_audio_test.raw ]; then
    echo "   Binary output:"
    cat /tmp/system_audio_test.raw
  fi
fi

# Check if any data was captured
if [ -f /tmp/system_audio_test.raw ] && [ -s /tmp/system_audio_test.raw ]; then
  FILE_SIZE=$(wc -c < /tmp/system_audio_test.raw)
  echo -e "${GREEN}✅ Binary captured $FILE_SIZE bytes of audio${NC}"
else
  echo -e "${YELLOW}⚠️  No audio data captured (file is empty or doesn't exist)${NC}"
fi

# Cleanup
rm -f /tmp/system_audio_test.raw

# Step 8: Check for running SystemAudioDump processes
echo ""
echo -e "${BLUE}Step 8: Checking for existing SystemAudioDump processes...${NC}"
EXISTING_PROCS=$(pgrep -f SystemAudioDump || echo "")
if [ -z "$EXISTING_PROCS" ]; then
  echo -e "${GREEN}✅ No existing processes${NC}"
else
  echo -e "${YELLOW}⚠️  Found existing SystemAudioDump processes: $EXISTING_PROCS${NC}"
  echo "   Kill them with: pkill -f SystemAudioDump"
fi

# Summary
echo ""
echo "===================================="
echo -e "${BLUE}Diagnostic Summary:${NC}"
echo "===================================="
echo ""
echo "If all checks passed, the binary should work in EVIA."
echo "If Step 6 showed missing Terminal permissions, fix that first."
echo "If Step 7 failed, check the error messages above."
echo ""
echo "Next: Run 'npm run dev' and check the main process terminal logs"
echo "      Look for lines starting with '[SystemAudioService]'"
echo ""

