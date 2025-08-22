#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/SystemAudioCapture.app/Contents/MacOS/SystemAudioCapture"
if [[ ! -x "$APP" ]]; then
  echo "error: $APP not found; run package_app.sh first"
  exit 1
fi
"$APP"

