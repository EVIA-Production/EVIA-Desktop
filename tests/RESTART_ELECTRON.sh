#!/bin/bash
# EVIA Desktop - Restart Electron with Token Fix
# Run this after the token fix to apply changes

echo "🔧 Restarting Electron with Token Fix"
echo "======================================"
echo ""

# Check if Vite is still running
if lsof -ti:5174 > /dev/null 2>&1; then
    echo "✅ Vite dev server is running on port 5174"
else
    echo "❌ WARNING: Vite dev server is NOT running!"
    echo "   Please start it in another terminal:"
    echo "   npm run dev:renderer"
    echo ""
    read -p "Press ENTER once Vite is running, or Ctrl+C to cancel..."
fi

echo ""
echo "🔄 Rebuilding main process and restarting Electron..."
echo ""

cd "$(dirname "$0")"
EVIA_DEV=1 npm run dev:main

