#!/bin/bash

echo "🏗️  Building EVIA Production App with Presets & Insights Fixes"
echo "================================================================"
echo ""

# Step 1: Kill existing processes
echo "1️⃣  Killing any running EVIA processes..."
pkill -9 EVIA 2>/dev/null
pkill -9 "EVIA Helper" 2>/dev/null
sleep 2
echo "   ✅ Processes killed"
echo ""

# Step 2: Clean dist folder
echo "2️⃣  Cleaning previous build..."
rm -rf dist
echo "   ✅ Dist folder cleaned"
echo ""

# Step 3: Build
echo "3️⃣  Building production app (this takes ~2 minutes)..."
echo ""
npm run build

# Step 4: Verify
echo ""
echo "4️⃣  Verifying build..."
if [ -d "dist/mac-arm64/EVIA.app" ] || [ -d "dist/mac-x64/EVIA.app" ]; then
    echo "   ✅ EVIA.app created successfully!"
    echo ""
    echo "📦 App Locations:"
    ls -lh dist/*.zip dist/*.dmg 2>/dev/null
    echo ""
    echo "🚀 To test the app, run:"
    echo "   open dist/mac-arm64/EVIA.app (Apple Silicon)"
    echo "   or"
    echo "   open dist/mac-x64/EVIA.app (Intel)"
    echo ""
else
    echo "   ❌ Build failed - EVIA.app not found"
    echo ""
    echo "   Check the build output above for errors."
    exit 1
fi

