#!/bin/bash
# Test EVIA Desktop with DevTools enabled

echo "🚀 Testing EVIA Desktop with DevTools..."
echo ""
echo "OPTION 1: Dev Mode (Recommended - DevTools auto-open)"
echo "=========================================="
echo "Terminal 1: npm run dev:renderer"
echo "Terminal 2: EVIA_DEV=1 npm run dev:main"
echo ""
echo "OPTION 2: Production Mode (No DevTools)"
echo "=========================================="
echo "./TEST_WITH_DEVTOOLS.sh prod"
echo ""

if [ "$1" = "prod" ]; then
  echo "🔧 Opening production build..."
  echo "⚠️  DevTools NOT available in prod mode!"
  echo "   Use Cmd+Option+I to try opening DevTools"
  open "dist/mac-arm64/EVIA Desktop.app"
  exit 0
fi

echo "📋 WHAT TO CHECK:"
echo "1. Console logs:"
echo "   ✅ '[AudioCapture] Starting capture'"
echo "   ✅ '[AudioCapture] Sending PCM16 chunk: X bytes'"
echo "2. Network tab (filter: WS):"
echo "   ✅ /ws/transcribe connected"
echo "   ✅ Green arrows = data sent"
echo "3. Backend logs:"
echo "   ✅ 'frames_sent > 0'"
echo "   ✅ 'bytes_sent > 0'"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Run dev mode with renderer server
npm run dev:main

