#!/bin/bash

echo "Resetting Screen Recording permissions for EVIA..."

# Find the Electron app
ELECTRON_PATH=$(which electron)
if [ -z "$ELECTRON_PATH" ]; then
  echo "Electron not found in PATH. Trying default location..."
  ELECTRON_PATH="/Applications/Electron.app"
fi

# Get the bundle ID
BUNDLE_ID=$(osascript -e 'id of app "Electron"' 2>/dev/null)
if [ -z "$BUNDLE_ID" ]; then
  BUNDLE_ID="com.github.Electron"
  echo "Using default bundle ID: $BUNDLE_ID"
else
  echo "Found bundle ID: $BUNDLE_ID"
fi

# Reset Screen Recording permissions
echo "Attempting to reset Screen Recording permissions..."
echo "You may be prompted for your password."
sudo tccutil reset ScreenCapture $BUNDLE_ID
if [ $? -eq 0 ]; then
  echo "Successfully reset Screen Recording permissions."
else
  echo "Failed to reset permissions. You may need to manually grant permissions."
fi

# Reset Microphone permissions
echo "Attempting to reset Microphone permissions..."
sudo tccutil reset Microphone $BUNDLE_ID
if [ $? -eq 0 ]; then
  echo "Successfully reset Microphone permissions."
else
  echo "Failed to reset permissions. You may need to manually grant permissions."
fi

# Find the SystemAudioCapture helper
HELPER_PATH="$PWD/native/mac/SystemAudioCapture/.build/debug/SystemAudioCapture"
if [ -f "$HELPER_PATH" ]; then
  echo "Found SystemAudioCapture helper at: $HELPER_PATH"
  
  # Make sure it's executable
  chmod +x "$HELPER_PATH"
  
  echo "Please manually grant Screen Recording permissions to both Electron and the SystemAudioCapture helper."
  echo "1. Open System Settings > Privacy & Security > Screen Recording"
  echo "2. Add Electron and the SystemAudioCapture helper to the allowed apps"
  echo "3. Restart the EVIA Desktop app"
else
  echo "SystemAudioCapture helper not found at: $HELPER_PATH"
  echo "Please build it first with: cd native/mac/SystemAudioCapture && swift build -c debug"
fi

echo "Done. Please restart the EVIA Desktop app."
