#!/bin/bash
# EVIA Desktop - Quick Fix Commands
# Copy-paste these commands into your terminal

echo "🚀 EVIA Desktop Transcription Fix - Quick Commands"
echo "=================================================="
echo ""
echo "📖 For detailed explanation, see:"
echo "   - TRANSCRIPTION_FIX_SUMMARY.md (overview)"
echo "   - REBUILD_AND_TEST.md (detailed procedure)"
echo ""
echo "=================================================="
echo ""

read -p "Press ENTER to start, or Ctrl+C to cancel..."

echo ""
echo "Step 1/5: Cleaning processes..."
pkill -f node || true
pkill -f electron || true
sleep 1
echo "✅ Processes killed"

echo ""
echo "Step 2/5: Cleaning caches..."
cd /Users/benekroetz/EVIA/EVIA-Desktop
rm -rf node_modules/.vite
rm -rf dist-electron
echo "✅ Caches cleared"

echo ""
echo "Step 3/5: Rebuilding main process..."
npm run build:main
if [ $? -eq 0 ]; then
    echo "✅ Main process built"
else
    echo "❌ Build failed! Check errors above."
    exit 1
fi

echo ""
echo "Step 4/5: Starting Vite dev server..."
echo ""
echo "⚠️  MANUAL STEP REQUIRED:"
echo "   Open a NEW terminal and run:"
echo ""
echo "     cd /Users/benekroetz/EVIA/EVIA-Desktop && npm run dev:renderer"
echo ""
echo "   WAIT for the message: '➜  ready in X ms'"
echo ""
read -p "Press ENTER when Vite is ready..."

echo ""
echo "Step 5/5: Running verification..."
if [ -f ./verify-build.sh ]; then
    ./verify-build.sh
    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ Verification PASSED!"
    else
        echo ""
        echo "❌ Verification failed. Check output above."
        exit 1
    fi
else
    echo "⚠️  verify-build.sh not found, skipping verification"
fi

echo ""
echo "=================================================="
echo "✅ Setup complete!"
echo ""
echo "🚀 NEXT STEP: Start Electron"
echo ""
echo "   In another terminal, run:"
echo ""
echo "     cd /Users/benekroetz/EVIA/EVIA-Desktop"
echo "     EVIA_DEV=1 npm run dev:main"
echo ""
echo "   Then:"
echo "   1. Click 'Zuhören' button"
echo "   2. Open Listen window DevTools"
echo "   3. Check console for diagnostic logs"
echo ""
echo "📊 Expected output: 25+ log lines starting with:"
echo "   [OverlayEntry] 🔍 ENTRY POINT EXECUTING"
echo "   [ListenView] 🔍🔍🔍 COMPONENT FUNCTION EXECUTING"
echo "   [ListenView] 🔍 WebSocket useEffect STARTED"
echo ""
echo "=================================================="

