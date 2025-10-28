#!/bin/bash
# Generate macOS ICNS icon from PNG source
# Requires: macOS with sips and iconutil (built-in)

set -e

echo "🎨 Generating macOS ICNS Icon"
echo "==============================="
echo ""

# Source PNG
SOURCE_ICON="src/main/assets/icon.png"
ICONSET_DIR="src/main/assets/icon.iconset"
OUTPUT_ICNS="src/main/assets/icon.icns"

# Check if source exists
if [ ! -f "$SOURCE_ICON" ]; then
  echo "❌ Error: Source icon not found: $SOURCE_ICON"
  exit 1
fi

# Check source dimensions
echo "📏 Checking source icon dimensions..."
DIMENSIONS=$(sips -g pixelWidth -g pixelHeight "$SOURCE_ICON" | grep -E 'pixelWidth|pixelHeight' | awk '{print $2}')
WIDTH=$(echo "$DIMENSIONS" | sed -n '1p')
HEIGHT=$(echo "$DIMENSIONS" | sed -n '2p')

echo "   Source: ${WIDTH}x${HEIGHT}"

if [ "$WIDTH" -lt 1024 ] || [ "$HEIGHT" -lt 1024 ]; then
  echo "⚠️  Warning: Source icon should be at least 1024x1024 for best quality"
fi

# Create iconset directory
echo ""
echo "📁 Creating iconset directory..."
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"
echo "   Created: $ICONSET_DIR"

# Generate all required sizes
echo ""
echo "🔧 Generating icon sizes..."

generate_size() {
  SIZE=$1
  FILENAME=$2
  sips -z $SIZE $SIZE "$SOURCE_ICON" --out "$ICONSET_DIR/$FILENAME" > /dev/null 2>&1
  echo "   ✅ $FILENAME (${SIZE}x${SIZE})"
}

generate_size 16 "icon_16x16.png"
generate_size 32 "icon_16x16@2x.png"
generate_size 32 "icon_32x32.png"
generate_size 64 "icon_32x32@2x.png"
generate_size 128 "icon_128x128.png"
generate_size 256 "icon_128x128@2x.png"
generate_size 256 "icon_256x256.png"
generate_size 512 "icon_256x256@2x.png"
generate_size 512 "icon_512x512.png"
generate_size 1024 "icon_512x512@2x.png"

# Convert to ICNS
echo ""
echo "🔨 Converting to ICNS format..."
iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICNS"

# Check output
if [ -f "$OUTPUT_ICNS" ]; then
  ICNS_SIZE=$(du -h "$OUTPUT_ICNS" | awk '{print $1}')
  echo "   ✅ Created: $OUTPUT_ICNS ($ICNS_SIZE)"
else
  echo "   ❌ Error: Failed to create ICNS"
  exit 1
fi

# Clean up
echo ""
echo "🧹 Cleaning up..."
rm -rf "$ICONSET_DIR"
echo "   ✅ Removed temporary iconset directory"

echo ""
echo "✅ ICNS Generation Complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Update electron-builder.yml:"
echo "      mac:"
echo "        icon: src/main/assets/icon.icns"
echo "   2. Rebuild: ./build-production.sh"
echo ""

