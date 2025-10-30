#!/bin/bash

# EVIA Desktop - Fresh User Test Setup
# This script performs a complete reset to simulate a brand new user experience

set -e  # Exit on error

echo "🧹 EVIA Desktop - Fresh User Test Setup"
echo "========================================"
echo ""
echo "⚠️  WARNING: This will DELETE all EVIA data, caches, and permissions!"
echo "Press Ctrl+C to cancel, or Enter to continue..."
read

echo ""
echo "📦 Step 1/5: Removing EVIA application data..."
rm -rf ~/Library/Application\ Support/EVIA\ Desktop
rm -rf ~/Library/Application\ Support/com.evia.desktop
echo "✅ App data removed"

echo ""
echo "🗑️  Step 2/5: Clearing caches..."
rm -rf ~/Library/Caches/EVIA\ Desktop
rm -rf ~/Library/Caches/com.evia.desktop
echo "✅ Caches cleared"

echo ""
echo "🔑 Step 3/5: Removing Keychain tokens..."
security delete-generic-password -s "EVIA Desktop" -a "auth-token" 2>/dev/null || echo "ℹ️  No keychain entry found (OK)"
security delete-generic-password -s "com.evia.desktop" -a "auth-token" 2>/dev/null || echo "ℹ️  No keychain entry found (OK)"
echo "✅ Keychain cleared"

echo ""
echo "🔒 Step 4/5: Resetting macOS permissions..."
echo "ℹ️  Attempting to reset Screen Recording permissions..."
tccutil reset ScreenCapture com.evia.desktop 2>/dev/null || echo "⚠️  Could not reset Screen Recording (may need manual reset)"
tccutil reset ScreenCapture com.github.Electron 2>/dev/null || echo "⚠️  Could not reset Electron Screen Recording"

echo "ℹ️  Attempting to reset Microphone permissions..."
tccutil reset Microphone com.evia.desktop 2>/dev/null || echo "⚠️  Could not reset Microphone (may need manual reset)"
tccutil reset Microphone com.github.Electron 2>/dev/null || echo "⚠️  Could not reset Electron Microphone"
echo "✅ Permissions reset attempted"

echo ""
echo "🛑 Step 5/5: Killing any running EVIA/Electron processes..."
pkill -9 "EVIA Desktop" 2>/dev/null || echo "ℹ️  No EVIA Desktop process running"
pkill -9 "Electron" 2>/dev/null || echo "ℹ️  No Electron process running"
echo "✅ Processes killed"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ RESET COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 NEXT STEPS:"
echo ""
echo "1. ⚙️  MANUAL STEP REQUIRED: Open System Settings and remove:"
echo "   - System Settings > Privacy & Security > Screen Recording"
echo "     → Remove 'EVIA Desktop' or 'Electron' (toggle OFF)"
echo "   - System Settings > Privacy & Security > Microphone"
echo "     → Remove 'EVIA Desktop' or 'Electron' (toggle OFF)"
echo ""
echo "2. 🏗️  Build fresh DMG:"
echo "   cd EVIA-Desktop"
echo "   npm run build"
echo ""
echo "3. 📦 Install fresh app:"
echo "   rm -rf /Applications/EVIA\\ Desktop.app"
echo "   open out/EVIA\\ Desktop-0.1.0-arm64.dmg"
echo "   (Drag to Applications)"
echo ""
echo "4. 🚀 Launch and test as a fresh user!"
echo ""
echo "📚 See QUICK-START-TESTING.md for full testing protocol"
echo ""

