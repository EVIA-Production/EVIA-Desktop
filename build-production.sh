#!/bin/bash
# EVIA Desktop - Production Build Script
# Builds the app with Azure production URLs

set -e  # Exit on error

echo "🚀 EVIA Desktop - Production Build"
echo "=================================="
echo ""

# 1. Clean previous builds
echo "📦 Step 1/5: Cleaning previous builds..."
rm -rf dist
rm -rf dist-electron
echo "✅ Clean complete"
echo ""

# 2. Set production environment variables
echo "🌐 Step 2/5: Setting production environment..."
export NODE_ENV=production
export EVIA_BACKEND_URL=https://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io
export VITE_FRONTEND_URL=https://frontend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io
export EVIA_WS_URL=wss://backend.livelydesert-1db1c46d.westeurope.azurecontainerapps.io
echo "✅ Environment configured:"
echo "   Backend: $EVIA_BACKEND_URL"
echo "   Frontend: $VITE_FRONTEND_URL"
echo "   WebSocket: $EVIA_WS_URL"
echo ""

# 3. Install dependencies (if needed)
echo "📥 Step 3/5: Checking dependencies..."
if [ ! -d "node_modules" ]; then
  echo "   Installing dependencies..."
  npm install
else
  echo "   Dependencies already installed"
fi
echo "✅ Dependencies ready"
echo ""

# 4. Build TypeScript + Vite + Electron
echo "🔨 Step 4/5: Building application..."
echo "   - Compiling TypeScript (main process)..."
npm run build:main
echo "   - Building Vite (renderer)..."
npx cross-env NODE_ENV=production EVIA_BACKEND_URL="$EVIA_BACKEND_URL" VITE_FRONTEND_URL="$VITE_FRONTEND_URL" EVIA_WS_URL="$EVIA_WS_URL" vite build
echo "   - Building Electron app (DMG + ZIP)..."
npx cross-env NODE_ENV=production EVIA_BACKEND_URL="$EVIA_BACKEND_URL" VITE_FRONTEND_URL="$VITE_FRONTEND_URL" EVIA_WS_URL="$EVIA_WS_URL" electron-builder --mac --x64 --arm64
echo "✅ Build complete"
echo ""

# 5. Display build artifacts
echo "📦 Step 5/5: Build artifacts:"
echo ""
if [ -d "dist" ]; then
  echo "Distribution files:"
  ls -lh dist/ | grep -E '\.(dmg|zip|app)$' || echo "   (No DMG/ZIP found - check dist/ directory)"
fi
echo ""

# Display file sizes
if [ -f "dist/EVIA-0.1.0-arm64.dmg" ]; then
  echo "✅ ARM64 DMG: $(ls -lh dist/EVIA-0.1.0-arm64.dmg | awk '{print $5}')"
fi
if [ -f "dist/EVIA-0.1.0.dmg" ]; then
  echo "✅ Universal DMG: $(ls -lh dist/EVIA-0.1.0.dmg | awk '{print $5}')"
fi
if [ -f "dist/EVIA-0.1.0-mac.zip" ]; then
  echo "✅ ZIP Archive: $(ls -lh dist/EVIA-0.1.0-mac.zip | awk '{print $5}')"
fi

echo ""
echo "🎉 Production build complete!"
echo ""
echo "Next steps:"
echo "  1. Test the DMG: open dist/EVIA-*.dmg"
echo "  2. Create GitHub Release"
echo "  3. Upload DMG for download"
echo ""

