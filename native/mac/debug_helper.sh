#!/bin/bash

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HELPER_PATH="$DIR/SystemAudioCapture/.build/debug/SystemAudioCapture"

echo "Launching SystemAudioCapture helper with debug output from: $HELPER_PATH"

if [ -f "$HELPER_PATH" ]; then
  echo "Found helper executable. Launching..."
  chmod +x "$HELPER_PATH"
  
  echo "Current macOS version:"
  sw_vers
  
  echo "Checking permissions:"
  tccutil reset ScreenCapture
  
  echo "Running helper with debug output:"
  "$HELPER_PATH" 2>&1
else
  echo "Helper not found at: $HELPER_PATH"
  echo "Building helper first..."
  cd "$DIR/SystemAudioCapture" && swift build -c debug
  
  if [ -f "$HELPER_PATH" ]; then
    echo "Helper built successfully. Launching..."
    chmod +x "$HELPER_PATH"
    "$HELPER_PATH" 2>&1
  else
    echo "Failed to build helper."
    exit 1
  fi
fi
