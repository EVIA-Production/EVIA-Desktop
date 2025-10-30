#!/bin/bash
# EVIA Desktop - Build Verification Script
# Checks if Vite is serving the latest diagnostic code

set -e

echo "🔍 EVIA Desktop Build Verification"
echo "=================================="
echo ""

# Check if Vite is running
echo "1️⃣  Checking if Vite dev server is running..."
if curl -s http://localhost:5174 > /dev/null 2>&1; then
    echo "✅ Vite dev server is running on port 5174"
else
    echo "❌ Vite dev server is NOT running"
    echo "   Run: npm run dev:renderer"
    exit 1
fi

echo ""
echo "2️⃣  Checking source files for diagnostic logs..."

# Check if diagnostic logs exist in source
if grep -q "🔍🔍🔍 COMPONENT FUNCTION EXECUTING" src/renderer/overlay/ListenView.tsx; then
    echo "✅ Diagnostic logs found in ListenView.tsx source"
else
    echo "❌ Diagnostic logs NOT found in source"
    echo "   This script should have added them. Check git diff."
    exit 1
fi

if grep -q "ENTRY POINT EXECUTING" src/renderer/overlay/overlay-entry.tsx; then
    echo "✅ Diagnostic logs found in overlay-entry.tsx source"
else
    echo "❌ Diagnostic logs NOT found in source"
    exit 1
fi

echo ""
echo "3️⃣  Checking if dist-electron is fresh..."
if [ -f dist-electron/main.js ]; then
    DIST_TIME=$(stat -f "%m" dist-electron/main.js 2>/dev/null || stat -c "%Y" dist-electron/main.js 2>/dev/null)
    CURRENT_TIME=$(date +%s)
    AGE=$((CURRENT_TIME - DIST_TIME))
    
    if [ $AGE -lt 300 ]; then
        echo "✅ dist-electron/main.js is fresh (${AGE}s old)"
    else
        echo "⚠️  dist-electron/main.js is old (${AGE}s old)"
        echo "   Run: npm run build:main"
    fi
else
    echo "❌ dist-electron/main.js not found"
    echo "   Run: npm run build:main"
    exit 1
fi

echo ""
echo "4️⃣  Checking Vite cache..."
if [ -d node_modules/.vite ]; then
    echo "⚠️  Vite cache exists at node_modules/.vite"
    echo "   If issues persist, run: rm -rf node_modules/.vite"
else
    echo "✅ Vite cache is clean"
fi

echo ""
echo "5️⃣  Testing if Vite serves the overlay HTML..."
if curl -s "http://localhost:5174/?view=listen" | grep -q "overlay-root"; then
    echo "✅ Vite serves overlay HTML with correct root element"
else
    echo "❌ Vite response doesn't contain overlay-root"
    echo "   Check Vite configuration"
    exit 1
fi

echo ""
echo "=================================="
echo "✅ Build verification PASSED"
echo ""
echo "Next steps:"
echo "  1. Start Electron: EVIA_DEV=1 npm run dev:main"
echo "  2. Click 'Zuhören' button"
echo "  3. Open Listen window DevTools"
echo "  4. Check for diagnostic logs (see REBUILD_AND_TEST.md)"
echo ""

