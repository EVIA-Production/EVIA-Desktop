#!/bin/bash

###############################################################################
# EVIA: Reset to New User State
# 
# This script removes all EVIA permissions and data to simulate a fresh install
# Perfect for demo videos and testing the first-run experience
###############################################################################

set -e  # Exit on error

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "🔄 EVIA: Reset to New User State"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "This will:"
echo "  ❌ Remove macOS permissions (Screen Recording, Microphone)"
echo "  ❌ Clear localStorage data"
echo "  ❌ Remove keychain credentials"
echo "  ❌ Kill running EVIA processes"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled."
    exit 0
fi

echo ""
echo "🔄 Starting reset..."
echo ""

# 1. Kill any running EVIA processes
echo "1️⃣  Killing EVIA processes..."
pkill -f "EVIA.app" 2>/dev/null || echo "   ℹ️  No EVIA processes running"
sleep 1

# 2. Reset macOS permissions (requires restarting the app)
echo ""
echo "2️⃣  Resetting macOS permissions..."
echo "   📹 Screen Recording..."
tccutil reset ScreenCapture com.evia.desktop 2>/dev/null || echo "   ℹ️  Screen Recording permission not set"

echo "   🎤 Microphone..."
tccutil reset Microphone com.evia.desktop 2>/dev/null || echo "   ℹ️  Microphone permission not set"

echo "   ✅ Permissions reset (will be requested on next launch)"

# 3. Clear localStorage (if app data exists)
echo ""
echo "3️⃣  Clearing localStorage data..."
LOCAL_STORAGE_PATH="$HOME/Library/Application Support/evia"
if [ -d "$LOCAL_STORAGE_PATH" ]; then
    rm -rf "$LOCAL_STORAGE_PATH"
    echo "   ✅ Cleared: $LOCAL_STORAGE_PATH"
else
    echo "   ℹ️  No localStorage found"
fi

# 4. Clear keychain credentials
echo ""
echo "4️⃣  Clearing keychain credentials..."
security delete-generic-password -s "evia-auth-token" 2>/dev/null && echo "   ✅ Removed auth token" || echo "   ℹ️  No auth token found"
security delete-generic-password -s "evia-backend-url" 2>/dev/null && echo "   ✅ Removed backend URL" || echo "   ℹ️  No backend URL found"

# 5. Clear browser cache/cookies for frontend (optional - user can do manually)
echo ""
echo "5️⃣  Browser data (manual step):"
echo "   ℹ️  To fully reset, also clear browser cache for:"
echo "      https://frontend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io"
echo ""
echo "   In Chrome/Safari: Cmd+Shift+Delete → Clear browsing data"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Reset Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📌 What happens on next launch:"
echo "   1. EVIA will ask for Screen Recording permission"
echo "   2. EVIA will ask for Microphone permission"
echo "   3. User will need to log in again"
echo "   4. Fresh localStorage (no saved sessions)"
echo ""
echo "🎬 Perfect state for recording demo video!"
echo ""

