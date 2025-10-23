#!/bin/bash

# EVIA Desktop - Complete Fresh Start
# Simulates first-time user experience
# Run this before each test session to ensure clean state

set -e

echo "╔═══════════════════════════════════════════════════════╗"
echo "║                                                       ║"
echo "║     EVIA DESKTOP - COMPLETE FRESH START              ║"
echo "║                                                       ║"
echo "║  This will reset EVERYTHING to first-time user state ║"
echo "║                                                       ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# Confirm
read -p "⚠️  This will DELETE all app data, auth tokens, and caches. Continue? [y/N]: " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Aborted"
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "STEP 1: Kill All Running Instances"
echo "═══════════════════════════════════════════════════════"

pkill -9 "EVIA Desktop" 2>/dev/null && echo "✅ Killed EVIA Desktop" || echo "ℹ️  EVIA Desktop not running"
pkill -9 "Electron" 2>/dev/null && echo "✅ Killed Electron" || echo "ℹ️  Electron not running"
sleep 2
echo "✅ All instances terminated"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "STEP 2: Delete All App Data"
echo "═══════════════════════════════════════════════════════"

# Application Support
if [ -d ~/Library/Application\ Support/evia-desktop/ ]; then
    rm -rf ~/Library/Application\ Support/evia-desktop/
    echo "✅ Deleted Application Support"
else
    echo "ℹ️  Application Support not found"
fi

# Caches
if [ -d ~/Library/Caches/evia-desktop/ ]; then
    rm -rf ~/Library/Caches/evia-desktop/
    echo "✅ Deleted Caches"
else
    echo "ℹ️  Caches not found"
fi

# Preferences
if [ -f ~/Library/Preferences/com.evia.evia-desktop.plist ]; then
    rm ~/Library/Preferences/com.evia.evia-desktop.plist
    echo "✅ Deleted Preferences"
else
    echo "ℹ️  Preferences not found"
fi

# Logs
if [ -d ~/Library/Logs/evia-desktop/ ]; then
    rm -rf ~/Library/Logs/evia-desktop/
    echo "✅ Deleted Logs"
else
    echo "ℹ️  Logs not found"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "STEP 3: Delete Keychain Tokens"
echo "═══════════════════════════════════════════════════════"

# Try both possible keychain formats
security delete-generic-password -s "evia-desktop-token" 2>/dev/null && echo "✅ Deleted evia-desktop-token" || echo "ℹ️  evia-desktop-token not found"
security delete-generic-password -a "evia" -s "token" 2>/dev/null && echo "✅ Deleted evia/token" || echo "ℹ️  evia/token not found"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "STEP 4: Verify Backend is Running"
echo "═══════════════════════════════════════════════════════"

# Check if backend is up
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "✅ Backend is running"
    echo "   URL: http://localhost:8000"
else
    echo "❌ Backend is NOT running!"
    echo ""
    read -p "   Start backend now? [Y/n]: " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        echo "   Starting backend..."
        cd /Users/benekroetz/EVIA/EVIA-Backend
        docker compose up -d
        echo "   Waiting for backend to start..."
        sleep 5
        
        if curl -s http://localhost:8000/health > /dev/null 2>&1; then
            echo "✅ Backend started successfully"
        else
            echo "❌ Backend failed to start - check Docker logs"
            exit 1
        fi
    else
        echo "⚠️  WARNING: Testing without backend will fail"
    fi
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "STEP 5: Rebuild Desktop App (with latest fixes)"
echo "═══════════════════════════════════════════════════════"

cd /Users/benekroetz/EVIA/EVIA-Desktop

echo "🔨 Building..."
npm run build 2>&1 | grep -E "built in|✓|error" || echo "Building..."

if [ -d "dist/mac-arm64/EVIA Desktop.app" ]; then
    echo "✅ Desktop app built successfully"
    ls -lh "dist/mac-arm64/EVIA Desktop.app" | head -1
else
    echo "❌ Desktop app build failed!"
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "STEP 6: Manual Permission Removal"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "⚠️  CRITICAL: You must manually remove permissions"
echo ""
echo "1. Open: System Settings → Privacy & Security"
echo "2. Click: Microphone"
echo "3. Remove: 'EVIA Desktop' and 'Electron' (if present)"
echo "4. Click: Screen Recording"
echo "5. Remove: 'EVIA Desktop' and 'Electron' (if present)"
echo ""
echo "This ensures the permission flow is tested fresh."
echo ""
read -p "Press Enter once you've removed all permissions..."

echo ""
echo "═══════════════════════════════════════════════════════"
echo "STEP 7: Launch App"
echo "═══════════════════════════════════════════════════════"

echo ""
echo "🚀 Launching EVIA Desktop..."
open -a "/Users/benekroetz/EVIA/EVIA-Desktop/dist/mac-arm64/EVIA Desktop.app"

sleep 2

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║                                                       ║"
echo "║              ✅ FRESH START COMPLETE                  ║"
echo "║                                                       ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
echo "📋 WHAT TO EXPECT:"
echo ""
echo "1. ✅ Welcome window should appear"
echo "   - \"Welcome to EVIA\" title"
echo "   - \"Log in\" button (NO overlap with text)"
echo ""
echo "2. ✅ Click \"Log in\" → Browser opens"
echo "   - Login with your credentials"
echo "   - Browser redirects back to desktop"
echo ""
echo "3. ✅ Permission window should appear"
echo "   - \"Grant Microphone Access\" button"
echo "   - \"Grant Screen Recording Access\" button"
echo ""
echo "4. ✅ Click \"Grant Microphone Access\""
echo "   - macOS dialog should appear"
echo "   - Grant permission"
echo "   - Button shows \"Microphone Access Granted\""
echo ""
echo "5. ✅ Click \"Grant Screen Recording Access\""
echo "   - System Settings opens"
echo "   - Toggle on \"EVIA Desktop\""
echo "   - Return to app"
echo "   - Both icons show green checkmarks"
echo ""
echo "6. ✅ Main header should appear automatically"
echo "   - No \"Continue\" button needed"
echo "   - No intermediate windows"
echo "   - Smooth transition (~200ms)"
echo ""
echo "═══════════════════════════════════════════════════════"
echo "🔍 DEBUGGING"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "If something goes wrong:"
echo ""
echo "1. View DevTools:"
echo "   - Click any EVIA window"
echo "   - Press Cmd+Option+I"
echo "   - Look for errors in Console"
echo ""
echo "2. View Backend Logs:"
echo "   cd /Users/benekroetz/EVIA/EVIA-Backend"
echo "   docker compose logs -f backend | grep -E 'ERROR|LANG|PROMPT'"
echo ""
echo "3. Kill app:"
echo "   pkill -9 'EVIA Desktop'"
echo ""
echo "4. Re-run this script:"
echo "   ./fresh-start-complete.sh"
echo ""
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Happy testing! 🚀"
echo ""

