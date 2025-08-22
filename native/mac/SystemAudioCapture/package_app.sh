#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_BIN="$ROOT_DIR/.build/debug/SystemAudioCapture"
APP_DIR="$ROOT_DIR/SystemAudioCapture.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RES_DIR="$CONTENTS_DIR/Resources"

if [[ ! -f "$BUILD_BIN" ]]; then
  echo "error: expected built binary at $BUILD_BIN. Run: swift build -c debug"
  exit 1
fi

echo "Packaging app bundle at $APP_DIR"
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RES_DIR"

# Info.plist template
cat > "$CONTENTS_DIR/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.evia.SystemAudioCapture</string>
  <key>CFBundleName</key>
  <string>SystemAudioCapture</string>
  <key>CFBundleExecutable</key>
  <string>SystemAudioCapture</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>EVIA needs access to your microphone to capture your voice.</string>
  <key>NSAudioCaptureUsageDescription</key>
  <string>EVIA needs access to system audio for transcription.</string>
  <key>NSScreenCaptureDescription</key>
  <string>EVIA needs screen capture to access system audio via ScreenCaptureKit.</string>
</dict>
</plist>
PLIST

cp "$BUILD_BIN" "$MACOS_DIR/SystemAudioCapture"
chmod +x "$MACOS_DIR/SystemAudioCapture"

echo "Packaged: $APP_DIR"
echo "Launch path: $MACOS_DIR/SystemAudioCapture"

