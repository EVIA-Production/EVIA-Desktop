#!/bin/bash

# Reset EVIA Desktop authentication state for E2E testing
# This simulates a fresh user experience

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║         🔄 RESETTING EVIA DESKTOP AUTH STATE                    ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Kill any running EVIA processes
echo "🛑 Stopping EVIA Desktop processes..."
pkill -f "electron.*EVIA" 2>/dev/null
pkill -f "vite.*5174" 2>/dev/null
sleep 1

# Path to auth state file
AUTH_STATE_DIR="$HOME/Library/Application Support/evia-desktop"
AUTH_STATE_FILE="$AUTH_STATE_DIR/auth-state.json"

# Check if state file exists
if [ -f "$AUTH_STATE_FILE" ]; then
    echo "📄 Found auth state file: $AUTH_STATE_FILE"
    echo "🗑️  Deleting persisted state..."
    rm "$AUTH_STATE_FILE"
    echo "✅ Auth state file deleted"
else
    echo "ℹ️  No auth state file found (already clean)"
fi

# Clear token from keychain (macOS)
echo ""
echo "🔐 Clearing token from macOS Keychain..."
security delete-generic-password -s "evia-desktop" -a "auth-token" 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ Keychain token deleted"
else
    echo "ℹ️  No token in keychain (already clean)"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║         ✅ AUTH STATE RESET COMPLETE                            ║"
echo "║                                                                  ║"
echo "║  Next launch will show:                                         ║"
echo "║  1. Welcome window (fresh user)                                 ║"
echo "║  2. Login flow                                                  ║"
echo "║  3. Permission window                                           ║"
echo "║  4. Main header                                                 ║"
echo "║                                                                  ║"
echo "║  Start E2E test: ./start-e2e-test.sh                           ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
