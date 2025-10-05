#!/bin/bash
# 🧪 Sprint 1 Test Script: System Audio Capture & Speaker Diarization
# Usage: ./TEST_SPRINT1.sh

echo "🧪 EVIA Desktop - Sprint 1 Test Script"
echo "========================================"
echo ""
echo "📋 Test Plan:"
echo "  1. Verify mic-only transcription (regression test)"
echo "  2. Verify system audio permission prompt"
echo "  3. Verify dual audio capture (mic + system)"
echo "  4. Verify speaker diarization UI"
echo "  5. Verify WebSocket dual streams"
echo "  6. Verify timer continuity"
echo "  7. Verify error handling"
echo ""
echo "⚠️  Prerequisites:"
echo "  - Backend running: cd ../EVIA-Backend && python main.py"
echo "  - Dev server: npm run dev:vite (port 5174)"
echo "  - Main process built: npm run build:main"
echo ""
echo "🔐 Checking macOS Screen Recording Permission..."
echo ""
echo "If you see 'Screen Recording permission denied', please:"
echo "1. Open System Preferences > Security & Privacy > Screen Recording"
echo "2. Enable permission for 'Electron'"
echo "3. Restart this test script"
echo ""
echo "💡 To reset permissions (if needed):"
echo "   tccutil reset ScreenCapture"
echo ""

# Kill any existing Electron processes
pkill -f "Electron.*evia-desktop" || true
sleep 1

# Build main process
echo "🔨 Building main process..."
npm run build:main

if [ $? -ne 0 ]; then
  echo "❌ Build failed! Fix compilation errors before testing."
  exit 1
fi

echo ""
echo "🚀 Launching Electron..."
echo ""
echo "📊 What to look for in console:"
echo "  Header Window:"
echo "    - '[AudioCapture] Starting dual capture (mic + system audio)...'"
echo "    - '[AudioCapture] Found X desktop sources'"
echo "    - '[AudioCapture] System audio tracks: [...]'"
echo "    - '[AudioCapture] Forwarding MIC message to Listen window: transcript_segment'"
echo "    - '[AudioCapture] Forwarding SYSTEM message to Listen window: transcript_segment'"
echo ""
echo "  Listen Window:"
echo "    - '[ListenView] ✅ Received WebSocket message: {type: transcript_segment, ...}'"
echo "    - '[ListenView] Adding transcript: text=..., speaker=0 (for system)'"
echo "    - '[ListenView] Adding transcript: text=..., speaker=1 (for mic)'"
echo "    - UI shows blue bubbles on right (mic) and grey bubbles on left (system)"
echo ""
echo "  Backend Terminal:"
echo "    - '[WebSocket] New connection: chat_id=X, source=mic, speaker=1'"
echo "    - '[WebSocket] New connection: chat_id=X, source=system, speaker=0'"
echo "    - '[Deepgram] Created stream for source=mic'"
echo "    - '[Deepgram] Created stream for source=system'"
echo ""
echo "Press Ctrl+C to stop testing"
echo "=============================================="
echo ""

# Start Electron
npm run dev:main
