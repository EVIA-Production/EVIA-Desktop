#!/bin/bash
# EVIA Desktop E2E Test Launcher
# Starts both renderer and main processes for manual testing

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║        🚀 EVIA DESKTOP E2E TEST LAUNCHER                        ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Check if in correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Not in EVIA-Desktop directory"
    echo "Please run: cd /Users/benekroetz/EVIA/EVIA-Desktop"
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found"
    echo "Run quick-test.sh first to create it"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

echo "📋 Pre-Flight Checks:"
echo "--------------------"

# Backend check
echo -n "Backend: "
if curl -s -o /dev/null http://localhost:8000/health; then
    echo "✅ Running"
else
    echo "❌ Not running - Start backend first!"
    exit 1
fi

# Frontend check
echo -n "Frontend: "
if curl -s -o /dev/null http://localhost:5173/; then
    echo "✅ Running"
else
    echo "❌ Not running - Start frontend first!"
    exit 1
fi

echo ""
echo "🎬 Starting Desktop App..."
echo "-------------------------"
echo ""

# Kill any existing processes
pkill -f "electron.*EVIA" || true
pkill -f "vite.*5174" || true

echo "📌 This will open 2 processes:"
echo "  1. Renderer (Vite dev server on port 5174)"
echo "  2. Main (Electron app)"
echo ""
echo "⚠️  Do NOT close this terminal - both processes will run here"
echo ""
echo "📖 Manual Testing Guide: MANUAL-E2E-TEST-GUIDE.md"
echo ""
echo "Starting in 3 seconds..."
sleep 3

# Start renderer in background
echo "🔷 Starting renderer..."
npm run dev:renderer > renderer.log 2>&1 &
RENDERER_PID=$!
echo "✅ Renderer started (PID: $RENDERER_PID, log: renderer.log)"

# Wait for renderer to be ready
echo "⏳ Waiting for renderer to be ready..."
sleep 5

# Check if renderer is running
if ! curl -s -o /dev/null http://localhost:5174/; then
    echo "❌ Renderer failed to start"
    echo "Check renderer.log for errors"
    kill $RENDERER_PID 2>/dev/null || true
    exit 1
fi

echo "✅ Renderer ready at http://localhost:5174/"
echo ""

# Start main process in foreground
echo "🔷 Starting main process (Electron app)..."
echo "👀 App window should appear shortly..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "                    ELECTRON CONSOLE OUTPUT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run main process (this will block until app closes)
EVIA_DEV=1 npm run dev:main

# Cleanup when app closes
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🛑 App closed. Cleaning up..."
kill $RENDERER_PID 2>/dev/null || true
echo "✅ Renderer stopped"
echo ""
echo "📝 Logs saved to: renderer.log"
echo ""
echo "Thanks for testing! 🎉"

