#!/bin/bash
# E2E Auth Flow Quick Test Script
# Automates server startup and provides step-by-step test guidance

set -e  # Exit on error

echo "🧪 EVIA Desktop E2E Auth Flow Test"
echo "===================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_step() {
    echo -e "${BLUE}➤ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# Step 1: Clean slate
print_step "Step 1: Cleaning auth state..."
security delete-generic-password -s evia -a token 2>/dev/null && print_success "Token deleted from Keychain" || print_info "No existing token (OK)"
rm -f ~/Library/Application\ Support/EVIA\ Desktop/auth-state.json && print_success "Auth state file deleted" || print_info "No state file (OK)"
echo ""

# Step 2: Check Backend
print_step "Step 2: Checking Backend..."
if curl -s http://localhost:8000/health | grep -q "healthy"; then
    print_success "Backend is running at http://localhost:8000"
else
    print_warning "Backend not detected. Start it in another terminal:"
    echo "   cd /Users/benekroetz/EVIA/EVIA-backend && docker-compose up"
    echo ""
    read -p "Press Enter when Backend is running (or Ctrl+C to exit)..."
fi
echo ""

# Step 3: Check Frontend
print_step "Step 3: Checking Frontend..."
if curl -s http://localhost:5173 > /dev/null 2>&1; then
    print_success "Frontend is running at http://localhost:5173"
else
    print_warning "Frontend not detected. Start it in another terminal:"
    echo "   cd /Users/benekroetz/EVIA/EVIA-Frontend && npm run dev"
    echo ""
    read -p "Press Enter when Frontend is running (or Ctrl+C to exit)..."
fi
echo ""

# Step 4: Check Desktop Renderer
print_step "Step 4: Checking Desktop Renderer..."
if curl -s http://localhost:5174 > /dev/null 2>&1; then
    print_success "Desktop Renderer is running at http://localhost:5174"
else
    print_warning "Desktop Renderer not detected. Start it in another terminal:"
    echo "   cd /Users/benekroetz/EVIA/EVIA-Desktop && npm run dev:renderer"
    echo ""
    read -p "Press Enter when Desktop Renderer is running (or Ctrl+C to exit)..."
fi
echo ""

# Step 5: Build check (for protocol registration)
print_step "Step 5: Checking if built app exists (for protocol registration)..."
if [ -d "dist/mac-arm64/EVIA Desktop.app" ]; then
    print_success "Built app exists - protocol should be registered"
    print_info "If deep links don't work, run the built app once:"
    echo "   open dist/mac-arm64/EVIA\ Desktop.app"
    echo ""
else
    print_warning "No built app found. Building now for protocol registration..."
    print_info "This may take 1-2 minutes..."
    npm run build > /dev/null 2>&1 && print_success "Build complete!" || print_error "Build failed - check npm run build"
    echo ""
    print_info "Opening built app once to register protocol..."
    open "dist/mac-arm64/EVIA Desktop.app"
    sleep 3
    echo ""
    print_success "Protocol registered! You can now close the built app and use dev mode."
    echo ""
fi

# Step 6: Ready to test
print_step "Step 6: Starting Desktop in Dev Mode..."
echo ""
print_success "All prerequisites ready!"
echo ""
echo "===================================="
echo "📋 MANUAL TEST STEPS:"
echo "===================================="
echo ""
echo "1️⃣  WELCOME WINDOW should appear"
echo "   ✓ Glassmorphism UI with 'Open Browser to Log in' button"
echo ""
echo "2️⃣  CLICK 'Open Browser to Log in'"
echo "   ✓ Browser opens to http://localhost:5173/login?source=desktop"
echo "   ✓ Blue banner shows '🖥️ Logging in for EVIA Desktop'"
echo ""
echo "3️⃣  LOG IN on Frontend"
echo "   ✓ Enter credentials and click 'Sign In'"
echo "   ✓ After 1 second, browser redirects to taylos://auth-callback?token=..."
echo ""
echo "4️⃣  PERMISSION WINDOW appears in Desktop"
echo "   ✓ Welcome window closes automatically"
echo "   ✓ Shows microphone and screen recording permissions"
echo ""
echo "5️⃣  GRANT PERMISSIONS"
echo "   ✓ Click 'Grant Microphone Access' → macOS dialog → OK"
echo "   ✓ Click 'Grant Screen Recording Access' → System Prefs opens"
echo "   ✓ Enable EVIA Desktop in Screen Recording settings"
echo "   ✓ Return to EVIA Desktop"
echo ""
echo "6️⃣  MAIN HEADER appears"
echo "   ✓ Permission window closes"
echo "   ✓ EviaBar (main header) shows"
echo ""
echo "7️⃣  TEST PERSISTENCE"
echo "   ✓ Quit Desktop (Cmd+Q)"
echo "   ✓ Relaunch: EVIA_DEV=1 npm run dev:main"
echo "   ✓ Main header should appear IMMEDIATELY (no welcome/permissions)"
echo ""
echo "===================================="
echo ""
print_info "Watch console logs in all terminals for detailed flow information"
print_info "See E2E-AUTH-TEST-PROTOCOL.md for full test documentation"
echo ""
print_step "Launching Desktop in 3 seconds..."
sleep 1
echo "3..."
sleep 1
echo "2..."
sleep 1
echo "1..."
echo ""

# Launch Desktop
print_success "🚀 Launching EVIA Desktop..."
echo ""
EVIA_DEV=1 npm run dev:main

