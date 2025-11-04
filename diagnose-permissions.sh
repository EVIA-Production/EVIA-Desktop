#!/bin/bash
# EVIA Permission Diagnostic Tool
# Helps diagnose permission detection issues

echo "═══════════════════════════════════════════════════════════"
echo "🔍 EVIA Permission Diagnostic"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if EVIA is running
if pgrep -f "EVIA.app" > /dev/null; then
    echo "✅ EVIA is currently running"
    EVIA_RUNNING=true
else
    echo "⚠️  EVIA is not running"
    EVIA_RUNNING=false
fi

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "📋 EVIA App Identifier:"
echo "─────────────────────────────────────────────────────────────"
echo ""
echo "  Bundle ID: com.evia.app"
echo "  Product Name: EVIA"
echo ""
echo "─────────────────────────────────────────────────────────────"
echo "🔐 Manual Permission Check (System Settings):"
echo "─────────────────────────────────────────────────────────────"
echo ""
echo "⚠️  TCC Database is protected on macOS - can't query directly"
echo ""
echo "✅ TO CHECK MANUALLY:"
echo ""
echo "1. Open System Settings"
echo "2. Go to: Privacy & Security"
echo "3. Click 'Screen Recording' (left sidebar)"
echo "   → Look for: 'EVIA' with checkmark ✓"
echo "4. Click 'Microphone' (left sidebar)"
echo "   → Look for: 'EVIA' with checkmark ✓"
echo ""
echo "If you see 'EVIA' listed with checkmarks, permissions ARE granted!"
echo ""

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "📁 EVIA Internal State:"
echo "─────────────────────────────────────────────────────────────"

# Check auth-state.json for permissionsCompleted flag
AUTH_STATE="$HOME/Library/Application Support/evia/auth-state.json"

if [ -f "$AUTH_STATE" ]; then
    echo ""
    echo "📄 auth-state.json:"
    cat "$AUTH_STATE" | jq . 2>/dev/null || cat "$AUTH_STATE"
    
    if grep -q '"permissionsCompleted":true' "$AUTH_STATE"; then
        echo ""
        echo "  ⚠️  permissionsCompleted flag is TRUE"
        echo "  → EVIA thinks permissions are already granted"
    elif grep -q '"permissionsCompleted":false' "$AUTH_STATE"; then
        echo ""
        echo "  ℹ️  permissionsCompleted flag is FALSE"
        echo "  → EVIA will show permission window on next launch"
    fi
else
    echo "  ℹ️  No auth-state.json found (fresh install)"
fi

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "🔧 Diagnostic Results:"
echo "─────────────────────────────────────────────────────────────"
echo ""

# Show how to check permissions from running app
if $EVIA_RUNNING; then
    echo "─────────────────────────────────────────────────────────────"
    echo "🔍 Check Real-Time Permission Status (Running App):"
    echo "─────────────────────────────────────────────────────────────"
    echo ""
    echo "EVIA is running! Check permissions from within the app:"
    echo ""
    echo "METHOD 1: DevTools Console Logs"
    echo "--------------------------------"
    echo "1. Focus any EVIA window"
    echo "2. Press: Cmd+Option+I (open DevTools)"
    echo "3. Go to Console tab"
    echo "4. Look for recent logs:"
    echo "   [PermissionHeader] ✅ Check result - Mic: granted | Screen: granted"
    echo "   [HeaderController] 🔍 Permission check - Mic: granted | Screen: granted"
    echo ""
    echo "METHOD 2: Query Permissions (Run in Console)"
    echo "---------------------------------------------"
    echo "1. Open DevTools (Cmd+Option+I)"
    echo "2. In Console tab, paste this:"
    echo ""
    echo "   window.electron.getPermissions().then(p => console.log('🔐 Permissions:', p))"
    echo ""
    echo "3. You should see:"
    echo "   🔐 Permissions: { microphone: 'granted', screen: 'granted' }"
    echo ""
    echo "If you see 'granted' for both → Permissions ARE working!"
    echo "If you see 'denied' or 'not-determined' → Permission issue exists"
    echo ""
else
    echo "─────────────────────────────────────────────────────────────"
    echo "⚠️  Cannot Check Live Permissions (App Not Running)"
    echo "─────────────────────────────────────────────────────────────"
    echo ""
    echo "To check live permission status, you need to:"
    echo "1. Launch EVIA"
    echo "2. Run this script again"
    echo "3. Follow the 'Running App' instructions"
    echo ""
fi

echo "💡 To reset permissions completely:"
echo "   bash scripts/reset-to-new-user.sh"
echo ""

echo "💡 To manually reset permissionsCompleted flag:"
echo "   rm '$AUTH_STATE'"
echo ""

echo "💡 To force EVIA to recheck System Settings:"
echo "   1. Quit EVIA (Cmd+Q)"
echo "   2. Wait 2 seconds"
echo "   3. Relaunch EVIA"
echo "   4. Permission window will check every 200ms (real-time)"
echo ""

echo "═══════════════════════════════════════════════════════════"

