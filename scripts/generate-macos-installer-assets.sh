#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="$ROOT_DIR/src/main/assets/icon-mac.png"
BUILD_DIR="$ROOT_DIR/build"
ICONSET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/taylos-iconset.XXXXXX.iconset")"

cleanup() {
  rm -rf "$ICONSET_DIR"
}

trap cleanup EXIT

mkdir -p "$BUILD_DIR"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

render_icon() {
  local width="$1"
  local height="$2"
  local output="$3"
  sips -z "$height" "$width" "$SOURCE_ICON" --out "$output" >/dev/null
}

render_icon 16 16 "$ICONSET_DIR/icon_16x16.png"
render_icon 32 32 "$ICONSET_DIR/icon_16x16@2x.png"
render_icon 32 32 "$ICONSET_DIR/icon_32x32.png"
render_icon 64 64 "$ICONSET_DIR/icon_32x32@2x.png"
render_icon 128 128 "$ICONSET_DIR/icon_128x128.png"
render_icon 256 256 "$ICONSET_DIR/icon_128x128@2x.png"
render_icon 256 256 "$ICONSET_DIR/icon_256x256.png"
render_icon 512 512 "$ICONSET_DIR/icon_256x256@2x.png"
render_icon 512 512 "$ICONSET_DIR/icon_512x512.png"
render_icon 1024 1024 "$ICONSET_DIR/icon_512x512@2x.png"

iconutil -c icns "$ICONSET_DIR" -o "$BUILD_DIR/icon.icns"

generate_background() {
  local output_path="$1"
  local width="$2"
  local height="$3"

  swift - "$output_path" "$width" "$height" <<'SWIFT'
import AppKit

let args = CommandLine.arguments
let outputPath = args[1]
let width = Int(args[2])!
let height = Int(args[3])!

let canvasSize = NSSize(width: width, height: height)
let image = NSImage(size: canvasSize)

image.lockFocus()

NSColor(calibratedRed: 0.957, green: 0.957, blue: 0.969, alpha: 1).setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: canvasSize)).fill()

let chevronPath = NSBezierPath()
let center = NSPoint(x: CGFloat(width) / 2.0 + 2.0, y: CGFloat(height) * 0.54)
let arm = CGFloat(width) * 0.028
chevronPath.move(to: NSPoint(x: center.x - arm, y: center.y + arm))
chevronPath.line(to: center)
chevronPath.line(to: NSPoint(x: center.x - arm, y: center.y - arm))
chevronPath.lineWidth = max(CGFloat(width) * 0.0105, 6.5)
chevronPath.lineCapStyle = .round
chevronPath.lineJoinStyle = .round
NSColor(calibratedRed: 0.188, green: 0.188, blue: 0.2, alpha: 1).setStroke()
chevronPath.stroke()

image.unlockFocus()

guard
  let tiffData = image.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiffData),
  let pngData = bitmap.representation(using: .png, properties: [:])
else {
  fputs("Failed to render DMG background.\n", stderr)
  exit(1)
}

try pngData.write(to: URL(fileURLWithPath: outputPath))
SWIFT
}

generate_background "$BUILD_DIR/background.png" 660 400
sips -s format tiff "$BUILD_DIR/background.png" --out "$BUILD_DIR/background.tiff" >/dev/null
rm -f "$BUILD_DIR/background@2x.png"

echo "Generated:"
echo "  $BUILD_DIR/icon.icns"
echo "  $BUILD_DIR/background.png"
echo "  $BUILD_DIR/background.tiff"
