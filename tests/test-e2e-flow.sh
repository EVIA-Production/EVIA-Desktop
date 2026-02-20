#!/bin/bash
# EVIA Desktop E2E Flow Test Script
# Tests: Welcome → Login → Auth → Permissions → Ready

set -e  # Exit on error

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║        🧪 EVIA DESKTOP E2E FLOW TEST                           ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Log file
LOG_FILE="e2e-test-$(date +%Y%m%d-%H%M%S).log"

log() {
    echo "[$(date +%H:%M:%S)] $1" | tee -a "$LOG_FILE"
}

test_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1" | tee -a "$LOG_FILE"
    ((TESTS_PASSED++))
}

test_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1" | tee -a "$LOG_FILE"
    ((TESTS_FAILED++))
}

test_info() {
    echo -e "${BLUE}ℹ️  INFO${NC}: $1" | tee -a "$LOG_FILE"
}

test_warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1" | tee -a "$LOG_FILE"
}

# =============================================================================
# PRE-FLIGHT CHECKS
# =============================================================================

echo "📋 Phase 1: Pre-Flight Checks"
echo "================================"
echo ""

# Check if backend is running
log "Checking backend..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health | grep -q "200"; then
    test_pass "Backend is running (http://localhost:8000)"
else
    test_fail "Backend is not running"
    exit 1
fi

# Check if frontend is running
log "Checking frontend..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/ | grep -q "200"; then
    test_pass "Frontend is running (http://localhost:5173)"
else
    test_fail "Frontend is not running"
    exit 1
fi

# Check .env file
log "Checking .env configuration..."
if [ -f .env ]; then
    test_pass ".env file exists"
    if grep -q "VITE_FRONTEND_URL=http://localhost:5173" .env; then
        test_pass "VITE_FRONTEND_URL correctly set"
    else
        test_fail "VITE_FRONTEND_URL not set correctly"
    fi
else
    test_fail ".env file missing"
    exit 1
fi

# Check critical files exist
log "Checking critical files..."
CRITICAL_FILES=(
    "src/main/header-controller.ts"
    "src/main/overlay-windows.ts"
    "src/renderer/overlay/WelcomeHeader.tsx"
    "src/renderer/overlay/EviaBar.tsx"
    "src/main/preload.ts"
)

for file in "${CRITICAL_FILES[@]}"; do
    if [ -f "$file" ]; then
        test_pass "File exists: $file"
    else
        test_fail "File missing: $file"
    fi
done

echo ""
echo "📋 Phase 2: Code Verification"
echo "================================"
echo ""

# Verify HeaderController state machine
log "Verifying HeaderController..."
if grep -q "getCurrentState()" src/main/header-controller.ts; then
    test_pass "HeaderController has getCurrentState() method"
else
    test_fail "HeaderController missing getCurrentState() method"
fi

if grep -q "transitionTo.*welcome" src/main/header-controller.ts; then
    test_pass "HeaderController has welcome state transition"
else
    test_fail "HeaderController missing welcome state"
fi

# Verify header toggle blocking
log "Verifying header toggle blocking..."
if grep -q "currentState !== 'ready'" src/main/overlay-windows.ts; then
    test_pass "Header toggle checks auth state"
else
    test_fail "Header toggle doesn't check auth state"
fi

# Verify Welcome window
log "Verifying Welcome window..."
if grep -q "import.meta.env.VITE_FRONTEND_URL" src/renderer/overlay/WelcomeHeader.tsx; then
    test_pass "Welcome window uses correct env var"
else
    test_fail "Welcome window uses wrong env var"
fi

if grep -q "align-self: center" src/renderer/overlay/WelcomeHeader.tsx; then
    test_pass "Welcome button has align-self fix"
else
    test_warn "Welcome button might not have align-self fix"
fi

# Verify header border fix
log "Verifying header border fix..."
if grep -q "margin: 1px 0" src/renderer/overlay/EviaBar.tsx; then
    test_pass "Header has margin for border"
else
    test_fail "Header missing margin fix"
fi

if grep -q "overflow: visible" src/renderer/overlay/EviaBar.tsx; then
    test_pass "Header has overflow: visible"
else
    test_fail "Header missing overflow fix"
fi

# Verify IPC handlers
log "Verifying IPC handlers..."
IPC_HANDLERS=(
    "auth:logout"
    "shell:openExternal"
    "app:quit"
    "permissions:check"
)

for handler in "${IPC_HANDLERS[@]}"; do
    if grep -q "$handler" src/main/preload.ts; then
        test_pass "IPC handler exists: $handler"
    else
        test_fail "IPC handler missing: $handler"
    fi
done

echo ""
echo "📋 Phase 3: Frontend Integration Verification"
echo "================================================"
echo ""

# Check if frontend has desktop redirect logic
log "Checking frontend Login.tsx..."
FRONTEND_LOGIN="../EVIA-Frontend/src/pages/Login.tsx"
if [ -f "$FRONTEND_LOGIN" ]; then
    if grep -q "isDesktopSource" "$FRONTEND_LOGIN"; then
        test_pass "Frontend has desktop redirect logic"
    else
        test_fail "Frontend missing desktop redirect logic"
    fi
    
    if grep -q "taylos://auth-callback" "$FRONTEND_LOGIN"; then
        test_pass "Frontend has taylos:// protocol redirect"
    else
        test_fail "Frontend missing protocol redirect"
    fi
else
    test_warn "Frontend Login.tsx not found (might be in different branch)"
fi

# Check if frontend has auto-login after registration
log "Checking frontend Register.tsx..."
FRONTEND_REGISTER="../EVIA-Frontend/src/pages/Register.tsx"
if [ -f "$FRONTEND_REGISTER" ]; then
    if grep -q "auto-login" "$FRONTEND_REGISTER" || grep -q "await login" "$FRONTEND_REGISTER"; then
        test_pass "Frontend has auto-login after registration"
    else
        test_warn "Frontend might not have auto-login feature"
    fi
else
    test_warn "Frontend Register.tsx not found (might be in different branch)"
fi

echo ""
echo "📋 Phase 4: Protocol Handler Verification"
echo "==========================================="
echo ""

# Check if electron-builder.yml has protocol registered
log "Checking protocol registration..."
if [ -f "electron-builder.yml" ]; then
    if grep -q "taylos://" electron-builder.yml || grep -q "protocols:" electron-builder.yml; then
        test_pass "Protocol handler registered in electron-builder.yml"
    else
        test_warn "Protocol handler might not be registered"
    fi
else
    test_fail "electron-builder.yml not found"
fi

# Check if main.ts handles auth callback
log "Checking auth callback handler..."
if grep -q "handleAuthCallback" src/main/main.ts; then
    test_pass "Main process has handleAuthCallback"
else
    test_fail "Main process missing handleAuthCallback"
fi

echo ""
echo "📋 Phase 5: Build Verification"
echo "================================"
echo ""

# Check if package.json has correct scripts
log "Checking package.json scripts..."
if [ -f "package.json" ]; then
    if grep -q "\"dev:renderer\"" package.json; then
        test_pass "package.json has dev:renderer script"
    else
        test_fail "package.json missing dev:renderer script"
    fi
    
    if grep -q "\"dev:main\"" package.json; then
        test_pass "package.json has dev:main script"
    else
        test_fail "package.json missing dev:main script"
    fi
    
    if grep -q "\"build\"" package.json; then
        test_pass "package.json has build script"
    else
        test_fail "package.json missing build script"
    fi
else
    test_fail "package.json not found"
fi

# Check if vite.config.ts has welcome and permission windows
log "Checking vite.config.ts..."
if [ -f "vite.config.ts" ]; then
    if grep -q "welcome.html" vite.config.ts; then
        test_pass "Vite config includes welcome.html"
    else
        test_warn "Vite config might be missing welcome.html"
    fi
    
    if grep -q "permission.html" vite.config.ts; then
        test_pass "Vite config includes permission.html"
    else
        test_warn "Vite config might be missing permission.html"
    fi
else
    test_fail "vite.config.ts not found"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║                    📊 TEST RESULTS SUMMARY                       ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))
PASS_RATE=$((TESTS_PASSED * 100 / TOTAL_TESTS))

echo -e "${GREEN}✅ Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}❌ Tests Failed: $TESTS_FAILED${NC}"
echo "📊 Total Tests: $TOTAL_TESTS"
echo "📈 Pass Rate: $PASS_RATE%"
echo ""
echo "📝 Detailed log saved to: $LOG_FILE"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                                  ║${NC}"
    echo -e "${GREEN}║        ✅ ALL AUTOMATED TESTS PASSED!                           ║${NC}"
    echo -e "${GREEN}║                                                                  ║${NC}"
    echo -e "${GREEN}║        Ready for manual E2E testing with Desktop app            ║${NC}"
    echo -e "${GREEN}║                                                                  ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "🚀 Next Steps:"
    echo "1. Start renderer: npm run dev:renderer (in background)"
    echo "2. Start main: EVIA_DEV=1 npm run dev:main"
    echo "3. Verify Welcome window appears"
    echo "4. Click login button"
    echo "5. Test token redirect: open 'taylos://auth-callback?token=test123' in browser"
    echo "6. Verify main header appears"
    echo "7. Test error: open 'taylos://auth-callback?error=bad'"
    echo "8. Test logout"
    echo ""
    exit 0
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                                                                  ║${NC}"
    echo -e "${RED}║        ❌ SOME TESTS FAILED - REVIEW REQUIRED                   ║${NC}"
    echo -e "${RED}║                                                                  ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Please review the failed tests above and fix issues before proceeding."
    echo ""
    exit 1
fi

