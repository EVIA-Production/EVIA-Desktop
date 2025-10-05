#!/bin/bash
# Run EVIA Desktop in dev mode with system audio support
# This script launches from Terminal, which needs Screen Recording permission

echo "🚀 Starting EVIA Desktop (Dev Mode with System Audio)"
echo ""
echo "⚠️  IMPORTANT: Terminal.app must have Screen Recording permission!"
echo "   Go to: System Settings → Privacy & Security → Screen Recording"
echo "   Enable: Terminal (or iTerm if you use that)"
echo ""
echo "Press Enter to continue..."
read

# Start backend if not running
if ! lsof -i:8000 -sTCP:LISTEN > /dev/null 2>&1; then
    echo "📦 Starting backend..."
    cd ../EVIA-Backend
    docker compose up -d
    cd ../EVIA-Desktop
    echo "✅ Backend started"
else
    echo "✅ Backend already running"
fi

# Build main process
echo "🔨 Building main process..."
npm run build:main

# Start Electron
echo "🎬 Launching Electron..."
export NODE_ENV=development
export ELECTRON_DISABLE_SECURITY_WARNINGS=1
npm run dev
