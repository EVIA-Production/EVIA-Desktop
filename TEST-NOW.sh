#!/bin/bash
# Quick test script for EVIA Desktop

echo "🚀 EVIA Desktop - Build & Test"
echo "================================"
echo ""

# Check if backend is running
echo "📡 Checking backend..."
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "✅ Backend is running"
else
    echo "❌ Backend not running!"
    echo "   Start it with: cd ../EVIA-Backend && docker compose up"
    exit 1
fi

echo ""
echo "🔨 Building EVIA Desktop..."
npm run build

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build complete!"
    echo ""
    echo "🚀 Opening app..."
    open "dist/mac-arm64/EVIA.app"
    echo ""
    echo "================================"
    echo "✨ App launched!"
    echo ""
    echo "📋 Test checklist:"
    echo "  1. Login with your credentials"
    echo "  2. Press 'Fragen' (Ask button)"
    echo "  3. Type 'Hi' and press Enter"
    echo "  4. Check window sizes correctly immediately"
    echo "  5. Try language toggle (settings)"
    echo "  6. Check new app icon (in dock)"
    echo ""
else
    echo "❌ Build failed!"
    exit 1
fi

