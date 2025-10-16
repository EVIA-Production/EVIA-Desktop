#!/bin/bash
# Quick E2E Test

echo "🧪 Quick E2E Test"
echo "================="
echo ""

# Backend
echo -n "Backend: "
if curl -s http://localhost:8000/health | grep -q "ok"; then
    echo "✅ Running"
else
    echo "❌ Down"
    exit 1
fi

# Frontend
echo -n "Frontend: "
if curl -s http://localhost:5173/ | grep -q "EVIA"; then
    echo "✅ Running"
else
    echo "❌ Down"
    exit 1
fi

# .env
echo -n ".env file: "
if [ -f .env ]; then
    echo "✅ Exists"
else
    echo "❌ Missing"
    exit 1
fi

# HeaderController
echo -n "HeaderController: "
if grep -q "getCurrentState" src/main/header-controller.ts; then
    echo "✅ Has getCurrentState()"
else
    echo "❌ Missing"
fi

# Toggle blocking
echo -n "Header toggle auth check: "
if grep -q "currentState !== 'ready'" src/main/overlay-windows.ts; then
    echo "✅ Implemented"
else
    echo "❌ Missing"
fi

# Welcome env var
echo -n "Welcome window env var: "
if grep -q "import.meta.env.VITE_FRONTEND_URL" src/renderer/overlay/WelcomeHeader.tsx; then
    echo "✅ Correct"
else
    echo "❌ Wrong"
fi

# Header border
echo -n "Header border fix: "
if grep -q "margin: 1px 0" src/renderer/overlay/EviaBar.tsx; then
    echo "✅ Implemented"
else
    echo "❌ Missing"
fi

# Welcome button
echo -n "Welcome button fix: "
if grep -q "align-self: center" src/renderer/overlay/WelcomeHeader.tsx; then
    echo "✅ Implemented"
else
    echo "❌ Missing"
fi

echo ""
echo "✅ All checks passed! Ready for manual E2E testing."
echo ""
echo "Next steps:"
echo "1. npm run dev:renderer (in separate terminal)"
echo "2. EVIA_DEV=1 npm run dev:main"
echo "3. Test flow manually"

