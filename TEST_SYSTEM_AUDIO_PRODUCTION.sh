#!/bin/bash
# 🧪 System Audio Test Script (Production Build Required)
# Usage: ./TEST_SYSTEM_AUDIO_PRODUCTION.sh

echo "🧪 EVIA Desktop - System Audio Test (Production Build)"
echo "========================================================"
echo ""
echo "⚠️  System audio requires a PRODUCTION BUILD to work properly!"
echo "    Dev mode has permission issues with Electron running inside Cursor."
echo ""
echo "📋 This script will:"
echo "  1. Build the production app"
echo "  2. Launch it for you"
echo "  3. Guide you through testing"
echo ""
echo "🔐 macOS will prompt for Screen Recording permission."
echo "    You MUST grant it for system audio to work."
echo ""

read -p "Press Enter to continue..."

# Kill any existing Electron processes
echo ""
echo "🧹 Cleaning up existing processes..."
pkill -f "EVIA Desktop" || true
pkill -f "Electron.*evia-desktop" || true
sleep 1

# Check if backend is running
echo ""
echo "📡 Checking if backend is running..."
if ! curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "❌ Backend is NOT running!"
    echo ""
    echo "Please start it in another terminal:"
    echo "  cd ../EVIA-Backend"
    echo "  docker compose up"
    echo ""
    read -p "Press Enter once backend is running..."
fi

echo "✅ Backend is running"

# Check if dev server is running
echo ""
echo "📡 Checking if dev server is running..."
if ! curl -s http://localhost:5174 > /dev/null 2>&1; then
    echo "❌ Dev server is NOT running!"
    echo ""
    echo "Please start it in another terminal:"
    echo "  npm run dev:vite"
    echo ""
    read -p "Press Enter once dev server is running..."
fi

echo "✅ Dev server is running"

# Build the app
echo ""
echo "🔨 Building production app..."
npm run build

if [ $? -ne 0 ]; then
  echo "❌ Build failed! Fix compilation errors before testing."
  exit 1
fi

echo ""
echo "✅ Build complete!"
echo ""

# Find the built app (check both universal and architecture-specific paths)
APP_PATH="dist/mac/EVIA Desktop.app"

if [ ! -d "$APP_PATH" ]; then
    # Try ARM64 path
    APP_PATH="dist/mac-arm64/EVIA Desktop.app"
    if [ ! -d "$APP_PATH" ]; then
        # Try x64 path
        APP_PATH="dist/mac-x64/EVIA Desktop.app"
        if [ ! -d "$APP_PATH" ]; then
            echo "❌ App not found in any expected location:"
            echo "   - dist/mac/EVIA Desktop.app"
            echo "   - dist/mac-arm64/EVIA Desktop.app"
            echo "   - dist/mac-x64/EVIA Desktop.app"
            echo ""
            echo "Available paths:"
            ls -la dist/
            exit 1
        fi
    fi
fi

echo "📱 Found app at: $APP_PATH"
echo ""

# Launch the app
echo "🚀 Launching EVIA Desktop..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 TESTING INSTRUCTIONS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. macOS Permission Prompt:"
echo "   - You'll see: \"EVIA Desktop would like to record your screen\""
echo "   - ✅ Click 'Allow'"
echo ""
echo "2. Login (if needed):"
echo "   - Open DevTools (Cmd+Option+I on Header window)"
echo "   - Run: await window.evia.auth.login('admin', 'Admin123!')"
echo ""
echo "3. Test Mic + System Audio:"
echo "   - Play YouTube video or Spotify"
echo "   - Click 'Zuhören' button"
echo "   - Speak into microphone"
echo ""
echo "4. Check Console Logs (Header Window DevTools):"
echo "   - Should see: '[AudioCapture] Found X desktop sources'"
echo "   - Should see: '[AudioCapture] System audio tracks: [...]'"
echo "   - Should see: '[AudioCapture] Sent MIC chunk: 4800 bytes'"
echo "   - Should see: '[AudioCapture] Sent SYSTEM chunk: 4800 bytes'"
echo ""
echo "5. Check UI (Listen Window):"
echo "   - Blue bubbles on RIGHT = Your mic (\"Me\")"
echo "   - Grey bubbles on LEFT = System audio (\"Them\")"
echo ""
echo "6. Test Timer:"
echo "   - Timer should START when you click 'Zuhören'"
echo "   - Timer should STOP when you click 'Stopp'"
echo "   - Check console for: '[ListenView] 🛑 Recording stopped'"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop the app when done testing"
echo ""

open "$APP_PATH"

# Wait for user to finish testing
echo "App is running. Monitor the console logs..."
echo ""
echo "When you're done testing:"
echo "1. Take screenshots of the UI with separated bubbles"
echo "2. Save console logs from Header and Listen windows"
echo "3. Note any errors or unexpected behavior"
echo ""
echo "Press Ctrl+C to exit this script (app will keep running)"

# Keep script running so user can read instructions
while true; do
    sleep 1
done

