#!/bin/bash

# EVIA Desktop Quick Test Script
# Tests the built .app directly without needing DMG

set -e

echo "=============================================="
echo "🚀 EVIA DESKTOP QUICK TEST"
echo "=============================================="
echo ""

APP_PATH="/Users/benekroetz/EVIA/EVIA-Desktop/dist/mac-arm64/EVIA Desktop.app"

# 1. Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ App not found at: $APP_PATH"
    echo "Run 'npm run build' first"
    exit 1
fi

echo "✅ App found: $APP_PATH"
echo ""

# 2. Kill any running instances
echo "🧹 Killing any running EVIA instances..."
pkill -9 "EVIA Desktop" 2>/dev/null || true
pkill -9 "Electron" 2>/dev/null || true
sleep 1
echo "✅ Clean slate"
echo ""

# 3. Optional: Fresh user reset
read -p "🔄 Reset to fresh user state? (clears auth, permissions, cache) [y/N]: " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🧹 Resetting user state..."
    
    # Clear app data
    rm -rf ~/Library/Application\ Support/evia-desktop/ 2>/dev/null || true
    rm -rf ~/Library/Caches/evia-desktop/ 2>/dev/null || true
    
    # Clear Keychain tokens
    security delete-generic-password -s "evia-desktop-token" 2>/dev/null || true
    
    echo "✅ User state reset complete"
    echo ""
    echo "⚠️  MANUAL STEP REQUIRED:"
    echo "   1. Open System Settings → Privacy & Security"
    echo "   2. Remove 'EVIA Desktop' and 'Electron' from:"
    echo "      - Screen Recording"
    echo "      - Microphone"
    echo ""
    read -p "Press Enter once you've removed permissions..."
fi

# 4. Launch app
echo ""
echo "🚀 Launching EVIA Desktop..."
echo "   (Watch for Welcome window)"
echo ""
open -a "$APP_PATH"

echo ""
echo "=============================================="
echo "✅ APP LAUNCHED"
echo "=============================================="
echo ""
echo "📋 WHAT TO TEST (from COMPLETE-TEST-PROCEDURE.md):"
echo ""
echo "CRITICAL (MUST WORK):"
echo "  - Issue #3: Transcription language (EN/DE)"
echo "  - Issue #6: Insight click auto-submit"
echo "  - Issue #7: Ask window shows output"
echo "  - Issue #9: Ask prompt separation"
echo ""
echo "HIGH PRIORITY:"
echo "  - Issue #2: Language toggle animation"
echo "  - Issue #8: Ask window sizing"
echo "  - Issue #12: Settings functionality"
echo ""
echo "MEDIUM PRIORITY:"
echo "  - Issue #1: Welcome button overlap"
echo "  - Issue #11: Hide/show speed"
echo "  - Issue #14: Window positioning"
echo ""
echo "📄 Full checklist: COMPLETE-TEST-PROCEDURE.md"
echo ""
echo "🔍 To view DevTools for debugging:"
echo "   1. Click on any EVIA window"
echo "   2. Press Cmd+Option+I"
echo ""
echo "🛑 To stop app:"
echo "   pkill -9 'EVIA Desktop'"
echo ""
