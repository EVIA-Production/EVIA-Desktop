#!/bin/bash
# EVIA Desktop - E2E Automated Test Helper
# Usage: ./test-e2e-flows.sh [flow_number]
# Example: ./test-e2e-flows.sh 1  (test Flow 1: Backend Health)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
PASSED=0
FAILED=0

echo "=================================="
echo "EVIA Desktop E2E Test Suite"
echo "=================================="
echo ""

# Function: Print test result
test_result() {
  if [ $1 -eq 0 ]; then
    echo -e "${GREEN}✅ PASS${NC}: $2"
    ((PASSED++))
  else
    echo -e "${RED}❌ FAIL${NC}: $2"
    ((FAILED++))
  fi
}

# Function: Test backend health
test_backend_health() {
  echo "🔍 Testing Backend Health..."
  
  # Check if backend is running
  response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health 2>/dev/null || echo "000")
  
  if [ "$response" = "200" ]; then
    test_result 0 "Backend health endpoint responds"
  else
    test_result 1 "Backend health endpoint (got HTTP $response)"
    echo "   ⚠️  Run: cd EVIA-Backend && docker-compose up -d"
  fi
  
  # Check Docker containers
  cd ../EVIA-Backend
  backend_running=$(docker-compose ps backend 2>/dev/null | grep -c "Up" || echo "0")
  db_running=$(docker-compose ps db 2>/dev/null | grep -c "Up" || echo "0")
  redis_running=$(docker-compose ps redis 2>/dev/null | grep -c "Up" || echo "0")
  
  test_result $((1 - backend_running)) "Backend container running"
  test_result $((1 - db_running)) "Database container running"
  test_result $((1 - redis_running)) "Redis container running"
  
  cd ../EVIA-Desktop
}

# Function: Test backend authentication
test_backend_auth() {
  echo ""
  echo "🔍 Testing Backend Authentication..."
  
  # Attempt login with test credentials
  login_response=$(curl -s -X POST http://localhost:8000/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@evia.com","password":"test123"}' 2>/dev/null || echo "{}")
  
  token=$(echo "$login_response" | jq -r '.access_token // empty' 2>/dev/null)
  
  if [ -n "$token" ] && [ "$token" != "null" ]; then
    test_result 0 "Backend authentication (token received)"
    export EVIA_TOKEN="$token"
    echo "   📝 Token saved to EVIA_TOKEN env var"
  else
    test_result 1 "Backend authentication (no token)"
    echo "   ⚠️  Check credentials or create user first"
  fi
}

# Function: Test chat creation
test_chat_creation() {
  echo ""
  echo "🔍 Testing Chat Creation..."
  
  if [ -z "$EVIA_TOKEN" ]; then
    test_result 1 "Chat creation (no auth token available)"
    return
  fi
  
  chat_response=$(curl -s -X POST http://localhost:8000/chat/ \
    -H "Authorization: Bearer $EVIA_TOKEN" \
    -H "Content-Type: application/json" 2>/dev/null || echo "{}")
  
  chat_id=$(echo "$chat_response" | jq -r '.id // empty' 2>/dev/null)
  
  if [ -n "$chat_id" ] && [ "$chat_id" != "null" ] && [ "$chat_id" != "{}" ]; then
    test_result 0 "Chat creation (got ID: $chat_id)"
    export CHAT_ID="$chat_id"
  else
    test_result 1 "Chat creation (response: $chat_response)"
  fi
}

# Function: Test insights endpoint
test_insights_endpoint() {
  echo ""
  echo "🔍 Testing Insights Endpoint..."
  
  if [ -z "$EVIA_TOKEN" ] || [ -z "$CHAT_ID" ]; then
    test_result 1 "Insights endpoint (missing token or chat_id)"
    return
  fi
  
  insights_response=$(curl -s -X POST http://localhost:8000/insights \
    -H "Authorization: Bearer $EVIA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\":$CHAT_ID,\"k\":3,\"language\":\"de\"}" 2>/dev/null || echo "[]")
  
  insights_count=$(echo "$insights_response" | jq '. | length' 2>/dev/null || echo "0")
  
  if [ "$insights_count" -ge 1 ]; then
    test_result 0 "Insights endpoint (returned $insights_count insights)"
    
    # Check if insights are stubs or real
    first_title=$(echo "$insights_response" | jq -r '.[0].title // empty' 2>/dev/null)
    
    if [ "$first_title" = "Frage nach Budget klären" ]; then
      echo "   ⚠️  ${YELLOW}WARNING${NC}: Received STUB insights (FAST_MODE may be enabled)"
      echo "   📝 Check EVIA-Backend/.env for FAST_MODE=true"
    else
      echo "   ✅ Insights appear to be REAL (not stubs)"
      echo "   📝 First insight: $first_title"
    fi
  else
    test_result 1 "Insights endpoint (no insights returned)"
  fi
}

# Function: Test ask endpoint
test_ask_endpoint() {
  echo ""
  echo "🔍 Testing Ask Endpoint..."
  
  if [ -z "$EVIA_TOKEN" ] || [ -z "$CHAT_ID" ]; then
    test_result 1 "Ask endpoint (missing token or chat_id)"
    return
  fi
  
  # Test non-streaming ask
  ask_response=$(curl -s -X POST http://localhost:8000/ask \
    -H "Authorization: Bearer $EVIA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\":$CHAT_ID,\"prompt\":\"Was ist ROI?\",\"stream\":false}" 2>/dev/null || echo "{}")
  
  answer=$(echo "$ask_response" | jq -r '.answer // empty' 2>/dev/null)
  latency=$(echo "$ask_response" | jq -r '.latency_ms // empty' 2>/dev/null)
  
  if [ -n "$answer" ] && [ "$answer" != "null" ]; then
    test_result 0 "Ask endpoint (received answer)"
    
    if [ -n "$latency" ] && [ "$latency" != "null" ]; then
      echo "   📊 Latency: ${latency}ms"
      
      if [ "$latency" -lt 500 ]; then
        echo "   ✅ Latency < 500ms (GOOD)"
      else
        echo "   ⚠️  Latency >= 500ms (slower than target)"
      fi
    fi
    
    echo "   📝 Answer preview: ${answer:0:60}..."
  else
    test_result 1 "Ask endpoint (no answer returned)"
  fi
}

# Function: Test FAST_MODE configuration
test_fast_mode_config() {
  echo ""
  echo "🔍 Testing FAST_MODE Configuration..."
  
  cd ../EVIA-Backend
  
  if [ -f .env ]; then
    fast_mode=$(grep -i "FAST_MODE" .env 2>/dev/null || echo "")
    
    if [ -z "$fast_mode" ]; then
      test_result 0 "FAST_MODE not set (real insights enabled)"
    elif echo "$fast_mode" | grep -qi "true\|1\|yes"; then
      test_result 1 "FAST_MODE is enabled (will return stub insights)"
      echo "   ⚠️  Edit .env and remove or set FAST_MODE=false"
    else
      test_result 0 "FAST_MODE is disabled"
    fi
  else
    test_result 1 ".env file not found"
  fi
  
  cd ../EVIA-Desktop
}

# Function: Test Desktop build
test_desktop_build() {
  echo ""
  echo "🔍 Testing Desktop Build..."
  
  # Check if dist exists
  if [ -d "dist" ]; then
    test_result 0 "dist/ directory exists"
    
    # Check for main.js
    if [ -f "dist/main/main.js" ]; then
      test_result 0 "Main process compiled (dist/main/main.js)"
    else
      test_result 1 "Main process not compiled"
    fi
    
    # Check for renderer build
    if [ -d "dist/renderer" ]; then
      test_result 0 "Renderer build exists"
    else
      test_result 1 "Renderer build not found"
    fi
    
    # Check for Mac app bundle
    if [ -d "dist/mac"/*.app 2>/dev/null ] || [ -f "dist/mac"/*.dmg 2>/dev/null ]; then
      test_result 0 "Mac app bundle or DMG exists"
    else
      echo "   ⚠️  No Mac .app or .dmg found (run: npm run build)"
    fi
  else
    test_result 1 "dist/ directory not found (run: npm run build)"
  fi
}

# Function: Test TypeScript compilation
test_typescript() {
  echo ""
  echo "🔍 Testing TypeScript Compilation..."
  
  # Run typecheck (non-blocking)
  if npm run typecheck > /tmp/evia-typecheck.log 2>&1; then
    test_result 0 "TypeScript typecheck passed"
  else
    test_result 1 "TypeScript typecheck failed"
    echo "   📝 See /tmp/evia-typecheck.log for details"
  fi
}

# Main test execution
echo "Starting test suite..."
echo ""

# Determine which flow to test
FLOW=${1:-all}

case $FLOW in
  1|backend)
    echo "Running Flow 1: Backend Tests"
    test_backend_health
    test_backend_auth
    test_chat_creation
    test_fast_mode_config
    ;;
  2|api)
    echo "Running Flow 2: API Tests"
    test_backend_health
    test_backend_auth
    test_chat_creation
    test_insights_endpoint
    test_ask_endpoint
    ;;
  3|build)
    echo "Running Flow 3: Build Tests"
    test_typescript
    test_desktop_build
    ;;
  all|*)
    echo "Running All Tests"
    test_backend_health
    test_backend_auth
    test_chat_creation
    test_fast_mode_config
    test_insights_endpoint
    test_ask_endpoint
    test_typescript
    test_desktop_build
    ;;
esac

# Summary
echo ""
echo "=================================="
echo "Test Summary"
echo "=================================="
echo -e "${GREEN}Passed:${NC} $PASSED"
echo -e "${RED}Failed:${NC} $FAILED"

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
  exit 0
else
  echo -e "${YELLOW}⚠️  SOME TESTS FAILED${NC}"
  exit 1
fi

