#!/bin/bash

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HELPER_PATH="$DIR/SystemAudioCapture/.build/debug/SystemAudioCapture"

echo "Launching SystemAudioCapture helper from: $HELPER_PATH" >&2

if [ -f "$HELPER_PATH" ]; then
  echo "Found helper executable. Launching..." >&2
  chmod +x "$HELPER_PATH"
  # Run the helper, keeping stdout clean for JSON only
  "$HELPER_PATH"
else
  echo "Helper not found at: $HELPER_PATH" >&2
  echo "Building helper first..." >&2
  cd "$DIR/SystemAudioCapture" && swift build -c debug
  
  if [ -f "$HELPER_PATH" ]; then
    echo "Helper built successfully. Launching..." >&2
    chmod +x "$HELPER_PATH"
    "$HELPER_PATH"
  else
    echo "Failed to build helper." >&2
    exit 1
  fi
fi
