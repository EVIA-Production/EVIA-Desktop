#!/bin/bash

# EVIA Desktop - Build and Launch Script
# Automates the build process and pre-flight checks

set -e  # Exit on error

echo "🚀 EVIA Desktop - Build & Launch Script"
echo "======================================="
echo ""

# Color codes
RED='\033[0.31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo -e "${RED}❌ Error: package.json not found${NC}"
  echo "Please run this script from the EVIA-Desktop directory"
  exit 1
fi

echo -e "${GREEN}✅ In correct directory${NC}"
echo ""

# Step 2: Check if backend is running
echo "📡 Checking backend health..."
if curl -s -f http://localhost:8000/health > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Backend is running${NC}"
else
  echo -e "${YELLOW}⚠️  Backend not responding${NC}"
  echo "Starting backend..."
  cd ../EVIA-Backend
  docker compose up -d
  echo "Waiting for backend to be healthy (30 seconds)..."
  sleep 30
  cd ../EVIA-Desktop
  
  # Check again
  if curl -s -f http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend started successfully${NC}"
  else
    echo -e "${RED}❌ Backend failed to start${NC}"
    echo "Please check backend logs: docker logs evia-backend-backend-1"
    exit 1
  fi
fi
echo ""

# Step 3: Check Node.js version
echo "🔍 Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo -e "${RED}❌ Node.js 20+ required (found: $(node -v))${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Node.js version: $(node -v)${NC}"
echo ""

# Step 4: Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
  echo -e "${GREEN}✅ Dependencies installed${NC}"
else
  echo -e "${GREEN}✅ Dependencies already installed${NC}"
fi
echo ""

# Step 5: Clean previous build
echo "🧹 Cleaning previous build..."
npm run clean > /dev/null 2>&1 || true
echo -e "${GREEN}✅ Cleaned${NC}"
echo ""

# Step 6: Build
echo "🔨 Building application..."
npm run build

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Build successful${NC}"
else
  echo -e "${RED}❌ Build failed${NC}"
  exit 1
fi
echo ""

# Step 7: Check if app exists
if [ ! -d "dist/mac-arm64/EVIA.app" ]; then
  echo -e "${RED}❌ App not found at dist/mac-arm64/EVIA.app${NC}"
  exit 1
fi
echo -e "${GREEN}✅ App bundle created${NC}"
echo ""

# Step 8: Launch app
echo "🚀 Launching EVIA Desktop..."
open dist/mac-arm64/EVIA.app

echo ""
echo "======================================="
echo -e "${GREEN}✨ Launch complete!${NC}"
echo ""
echo "📋 Next steps:"
echo "  1. Grant permissions when prompted"
echo "  2. Login with your credentials"
echo "  3. Test basic workflow (Listen → Speak → Insights)"
echo "  4. Test language switching (Settings → English/German)"
echo ""
echo "🐛 If issues occur:"
echo "  - Check backend: curl http://localhost:8000/health"
echo "  - View logs: docker logs evia-backend-backend-1 --tail 50"
echo "  - See manual: FIRST-LAUNCH-MANUAL.md"
echo ""
echo "Happy testing! 🎉"

