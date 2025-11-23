#!/bin/bash
echo "🔄 Resetting EVIA environment to 'Fresh Install' state..."

# 1. Kill App
echo "🔪 Killing EVIA processes..."
pkill -f "EVIA.app"
pkill -f "SystemAudioDump"

# 2. Clear Storage/Cache (App Data)
echo "🧹 Clearing Application Support and Preferences..."
rm -rf "$HOME/Library/Application Support/EVIA"
rm -rf "$HOME/Library/Caches/com.evia.app"
rm -rf "$HOME/Library/Preferences/com.evia.app.plist"
rm -rf "$HOME/Library/Saved Application State/com.evia.app.savedState"

# 3. Clear Keychain (Passwords)
echo "🔐 Clearing stored passwords..."
security delete-generic-password -l "EVIA" 2>/dev/null
security delete-generic-password -s "com.evia.app" 2>/dev/null

# 4. Reset Permissions (Microphone & Camera)
echo "🎤 Resetting Microphone & Camera permissions..."
tccutil reset Microphone com.evia.app
tccutil reset Camera com.evia.app
tccutil reset Accessibility com.evia.app

echo ""
echo "⚠️  IMPORTANT: Screen Recording permission cannot be reset via command line on modern macOS."
echo "👉 ACTION REQUIRED: Open System Settings > Privacy & Security > Screen Recording"
echo "   and manually select 'EVIA' and click the '-' (minus) button to remove it."
echo ""
echo "✅ Environment reset complete. Launching EVIA will now look like a fresh install."

