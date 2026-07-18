#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
BUILD_DIR="$ROOT_DIR/build"
APP_NAME="Taylos"
VOLUME_NAME="Taylos Installer"
FINAL_DMG="$DIST_DIR/taylos.dmg"
FINAL_DMG_BASE="${FINAL_DMG%.dmg}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/taylos-dmg.XXXXXX")"
STAGE_DIR="$TEMP_DIR/stage"
RW_DMG="$TEMP_DIR/taylos-installer-rw.dmg"
MOUNT_DIR="/Volumes/$VOLUME_NAME"

run_with_retry() {
  local description="$1"
  shift
  local attempt
  local output
  local status

  for attempt in 1 2 3 4 5; do
    set +e
    output="$("$@" 2>&1)"
    status=$?
    set -e

    if [[ $status -eq 0 ]]; then
      printf '%s' "$output"
      return 0
    fi

    echo "$description failed (attempt $attempt/5, exit $status)." >&2
    if [[ -n "$output" ]]; then
      printf '%s\n' "$output" >&2
    fi
    sleep $((attempt * 2))
  done

  echo "$description failed after 5 attempts." >&2
  return "$status"
}

detach_stale_volume() {
  if mount | grep -Fq "$MOUNT_DIR"; then
    echo "Detaching stale installer volume at $MOUNT_DIR"
    run_with_retry \
      "Detach stale installer volume" \
      hdiutil detach "$MOUNT_DIR" -force >/dev/null
  fi
}

cleanup() {
  if mount | grep -Fq "$MOUNT_DIR"; then
    hdiutil detach "$MOUNT_DIR" -force >/dev/null 2>&1 || true
  fi
  rm -rf "$TEMP_DIR"
}

trap cleanup EXIT

find_app_path() {
  local candidates=(
    "$DIST_DIR/mac-universal/$APP_NAME.app"
    "$DIST_DIR/mac/$APP_NAME.app"
    "$DIST_DIR/mac-arm64/$APP_NAME.app"
    "$DIST_DIR/mac-x64/$APP_NAME.app"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

APP_PATH="$(find_app_path || true)"

if [[ -z "$APP_PATH" ]]; then
  echo "Could not find a built Taylos.app inside $DIST_DIR" >&2
  exit 1
fi

if [[ ! -f "$BUILD_DIR/icon.icns" ]]; then
  echo "Missing volume icon: $BUILD_DIR/icon.icns" >&2
  exit 1
fi

if [[ ! -f "$BUILD_DIR/background.tiff" ]]; then
  echo "Missing DMG background: $BUILD_DIR/background.tiff" >&2
  exit 1
fi

mkdir -p "$STAGE_DIR/.background"
ditto "$APP_PATH" "$STAGE_DIR/$APP_NAME.app"
ln -s /Applications "$STAGE_DIR/Applications"
cp "$BUILD_DIR/background.tiff" "$STAGE_DIR/.background/background.tiff"
SetFile -a V "$STAGE_DIR/.background"

STAGE_KB="$(du -sk "$STAGE_DIR" | awk '{print $1}')"
SIZE_MB="$(( (STAGE_KB + 1024 - 1) / 1024 + 64 ))"

rm -f "$FINAL_DMG" "$FINAL_DMG_BASE.dmg" "$DIST_DIR/taylos.dmg.blockmap"
detach_stale_volume

echo "Creating writable installer image (${SIZE_MB} MB)"
run_with_retry \
  "Create writable installer image" \
  hdiutil create \
  -volname "$VOLUME_NAME" \
  -fs HFS+ \
  -type UDIF \
  -size "${SIZE_MB}m" \
  "$RW_DMG" >/dev/null

echo "Attaching writable installer image"
ATTACH_OUTPUT="$(run_with_retry \
  "Attach writable installer image" \
  hdiutil attach -readwrite -noverify -noautoopen "$RW_DMG")"
DEVICE="$(printf '%s\n' "$ATTACH_OUTPUT" | awk '/^\/dev\// {print $1; exit}')"

if [[ -z "$DEVICE" ]]; then
  echo "Failed to attach writable DMG." >&2
  exit 1
fi

sleep 1
ditto "$STAGE_DIR" "$MOUNT_DIR"
SetFile -a V "$MOUNT_DIR/.background"

osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$VOLUME_NAME"
    open
    delay 1
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    try
      set pathbar visible of container window to false
    end try
    set bounds of container window to {400, 100, 1060, 500}

    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 180
    set text size of opts to 12
    set shows icon preview of opts to true
    set background picture of opts to file ".background:background.tiff"

    set position of item "$APP_NAME.app" of container window to {180, 172}
    set position of item "Applications" of container window to {480, 172}

    update without registering applications
    delay 1
    close
    open
    delay 1
  end tell
end tell
APPLESCRIPT

cp "$BUILD_DIR/icon.icns" "$MOUNT_DIR/.VolumeIcon.icns"
SetFile -c icnC "$MOUNT_DIR/.VolumeIcon.icns"
SetFile -t icns "$MOUNT_DIR/.VolumeIcon.icns"
SetFile -a C "$MOUNT_DIR"

chmod -Rf go-w "$MOUNT_DIR"
sync
run_with_retry \
  "Detach customized installer image" \
  hdiutil detach "$DEVICE" >/dev/null

echo "Compressing customized installer image"
run_with_retry \
  "Compress customized installer image" \
  hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$FINAL_DMG_BASE" >/dev/null

if [[ ! -f "$FINAL_DMG" ]]; then
  echo "Custom DMG conversion did not produce $FINAL_DMG" >&2
  exit 1
fi

echo "Created custom DMG:"
echo "  $FINAL_DMG"
