#!/bin/bash
# 🎤 EVIA Desktop - Microphone Diagnostic Script
# Comprehensive microphone permission and audio system diagnostic for macOS

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  🎤 EVIA DESKTOP - MICROPHONE DIAGNOSTIC TOOL"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Tracking for issues
ISSUES_FOUND=0
WARNINGS=0

# Function to print status
print_status() {
    local status=$1
    local message=$2
    case $status in
        "OK")
            echo -e "${GREEN}✅ $message${NC}"
            ;;
        "WARN")
            echo -e "${YELLOW}⚠️  $message${NC}"
            ((WARNINGS++))
            ;;
        "ERROR")
            echo -e "${RED}❌ $message${NC}"
            ((ISSUES_FOUND++))
            ;;
        "INFO")
            echo -e "${BLUE}ℹ️  $message${NC}"
            ;;
    esac
}

# 1. Check macOS version
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  SYSTEM INFORMATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
MACOS_VERSION=$(sw_vers -productVersion)
print_status "INFO" "macOS Version: $MACOS_VERSION"

# Check if on macOS 10.14+ (where mic permissions are required)
if [[ "$MACOS_VERSION" < "10.14" ]]; then
    print_status "WARN" "macOS version < 10.14 - mic permissions may not apply"
fi

# 2. Check if EVIA Desktop app exists
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  APPLICATION CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

APP_PATHS=(
    "./dist/mac-arm64/EVIA Desktop.app"
    "./out/EVIA Desktop-darwin-arm64/EVIA Desktop.app"
    "/Applications/EVIA Desktop.app"
)

APP_FOUND=""
for path in "${APP_PATHS[@]}"; do
    if [ -d "$path" ]; then
        print_status "OK" "Found app at: $path"
        APP_FOUND="$path"
        break
    fi
done

if [ -z "$APP_FOUND" ]; then
    print_status "ERROR" "EVIA Desktop.app not found in expected locations"
    print_status "INFO" "Build the app first: npm run build"
fi

# 3. Check TCC (Transparency, Consent, and Control) database
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  MICROPHONE PERMISSIONS (TCC DATABASE)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TCC_DB="/Library/Application Support/com.apple.TCC/TCC.db"
USER_TCC_DB="$HOME/Library/Application Support/com.apple.TCC/TCC.db"

print_status "INFO" "Checking TCC database: $USER_TCC_DB"

# Check for EVIA Desktop mic permissions
MIC_PERMS=$(sqlite3 "$USER_TCC_DB" "SELECT service, client, allowed, prompt_count FROM access WHERE service='kTCCServiceMicrophone' AND client LIKE '%EVIA%' OR client LIKE '%Electron%';" 2>/dev/null || echo "")

if [ -z "$MIC_PERMS" ]; then
    print_status "WARN" "No microphone permission entries found for EVIA Desktop or Electron"
    print_status "INFO" "This might be normal if app hasn't requested permissions yet"
else
    print_status "INFO" "Found permissions:"
    echo "$MIC_PERMS" | while IFS='|' read -r service client allowed prompt_count; do
        if [ "$allowed" = "1" ]; then
            print_status "OK" "  $client: ALLOWED (prompted $prompt_count times)"
        else
            print_status "ERROR" "  $client: DENIED (prompted $prompt_count times)"
            print_status "INFO" "  → Reset: tccutil reset Microphone com.benekroetz.evia-desktop"
        fi
    done
fi

# 4. Check if microphone is available
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4️⃣  AUDIO SYSTEM CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# List audio devices
print_status "INFO" "Checking available audio input devices..."
if command -v system_profiler &> /dev/null; then
    INPUT_DEVICES=$(system_profiler SPAudioDataType | grep -A 5 "Input")
    if [ -n "$INPUT_DEVICES" ]; then
        print_status "OK" "Audio input devices found"
        echo "$INPUT_DEVICES" | head -10
    else
        print_status "ERROR" "No audio input devices found"
    fi
else
    print_status "WARN" "system_profiler not available"
fi

# Check if any process is using the microphone
echo ""
print_status "INFO" "Checking if other apps are using microphone..."
COREAUDIO_PROCESSES=$(lsof 2>/dev/null | grep "CoreAudio" | awk '{print $1}' | sort | uniq || echo "")
if [ -n "$COREAUDIO_PROCESSES" ]; then
    print_status "INFO" "Apps using CoreAudio:"
    echo "$COREAUDIO_PROCESSES"
else
    print_status "INFO" "No active CoreAudio processes detected"
fi

# 5. Check getUserMedia support (Electron/Chromium)
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5️⃣  ELECTRON/CHROMIUM COMPATIBILITY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -n "$APP_FOUND" ]; then
    # Check app bundle structure
    if [ -f "$APP_FOUND/Contents/MacOS/EVIA Desktop" ]; then
        print_status "OK" "App bundle structure valid"
        
        # Check for required entitlements
        ENTITLEMENTS=$(codesign -d --entitlements :- "$APP_FOUND" 2>&1 || echo "")
        if echo "$ENTITLEMENTS" | grep -q "com.apple.security.device.microphone"; then
            print_status "OK" "Microphone entitlement present"
        else
            print_status "ERROR" "Missing com.apple.security.device.microphone entitlement"
            print_status "INFO" "  → Check electron-builder config: entitlements.plist"
        fi
        
        if echo "$ENTITLEMENTS" | grep -q "com.apple.security.device.audio-input"; then
            print_status "OK" "Audio input entitlement present"
        else
            print_status "WARN" "Missing com.apple.security.device.audio-input entitlement"
        fi
    else
        print_status "ERROR" "App bundle executable not found"
    fi
else
    print_status "WARN" "Skipping Electron checks (app not found)"
fi

# 6. Check NSMicrophoneUsageDescription in Info.plist
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6️⃣  INFO.PLIST CONFIGURATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -n "$APP_FOUND" ]; then
    INFO_PLIST="$APP_FOUND/Contents/Info.plist"
    if [ -f "$INFO_PLIST" ]; then
        print_status "OK" "Info.plist found"
        
        # Check for NSMicrophoneUsageDescription
        MIC_DESC=$(/usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" "$INFO_PLIST" 2>/dev/null || echo "")
        if [ -n "$MIC_DESC" ]; then
            print_status "OK" "NSMicrophoneUsageDescription: \"$MIC_DESC\""
        else
            print_status "ERROR" "NSMicrophoneUsageDescription missing in Info.plist"
            print_status "INFO" "  → This is REQUIRED for macOS to show permission prompt"
        fi
        
        # Check for NSScreenCaptureDescription (for system audio)
        SCREEN_DESC=$(/usr/libexec/PlistBuddy -c "Print :NSScreenCaptureDescription" "$INFO_PLIST" 2>/dev/null || echo "")
        if [ -n "$SCREEN_DESC" ]; then
            print_status "OK" "NSScreenCaptureDescription: \"$SCREEN_DESC\""
        else
            print_status "WARN" "NSScreenCaptureDescription missing (needed for system audio)"
        fi
    else
        print_status "ERROR" "Info.plist not found at $INFO_PLIST"
    fi
fi

# 7. Diagnostic summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "7️⃣  DIAGNOSTIC SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $ISSUES_FOUND -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    print_status "OK" "No issues found! ✨"
    print_status "INFO" "If mic still doesn't work, check:"
    echo "     1. Open app DevTools: Cmd+Option+I"
    echo "     2. Run: navigator.mediaDevices.getUserMedia({audio: true})"
    echo "     3. Check Console for errors"
elif [ $ISSUES_FOUND -gt 0 ]; then
    print_status "ERROR" "Found $ISSUES_FOUND critical issue(s) ⚠️"
    echo ""
    echo "🔧 RECOMMENDED FIXES:"
    echo "   1. Reset permissions:"
    echo "      tccutil reset Microphone"
    echo "   2. Remove app from System Settings:"
    echo "      System Settings → Privacy & Security → Microphone"
    echo "   3. Rebuild app:"
    echo "      npm run build"
    echo "   4. Relaunch and grant permissions when prompted"
else
    print_status "WARN" "Found $WARNINGS warning(s) - mic might still work"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Diagnostic complete at $(date)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

exit $ISSUES_FOUND

