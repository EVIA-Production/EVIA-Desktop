#!/bin/bash

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HELPER_PATH="$DIR/SystemAudioCapture/.build/debug/SystemAudioCapture"

echo "=== SystemAudioCapture Test ==="
echo "This script will test the SystemAudioCapture helper directly."
echo "It will capture system audio and save it to a WAV file."
echo ""

# Check if helper exists
if [ ! -f "$HELPER_PATH" ]; then
  echo "Helper not found at: $HELPER_PATH"
  echo "Building helper first..."
  cd "$DIR/SystemAudioCapture" && swift build -c debug
  
  if [ ! -f "$HELPER_PATH" ]; then
    echo "Failed to build helper."
    exit 1
  fi
fi

chmod +x "$HELPER_PATH"

# Create a temporary directory
TEMP_DIR=$(mktemp -d)
PCM_FILE="$TEMP_DIR/audio.pcm"
WAV_FILE="$HOME/Desktop/system_audio_test.wav"

echo "1. Testing permissions..."
echo "   If macOS asks for Screen Recording permission, please grant it."
echo ""

# Run the helper for 5 seconds and capture output
echo "2. Capturing 5 seconds of system audio..."
timeout 5 "$HELPER_PATH" > "$TEMP_DIR/output.json" 2> "$TEMP_DIR/debug.log" || true

# Check if any output was captured
if [ ! -s "$TEMP_DIR/output.json" ]; then
  echo "ERROR: No output captured from helper."
  echo "Debug log:"
  cat "$TEMP_DIR/debug.log"
  rm -rf "$TEMP_DIR"
  exit 1
fi

echo "3. Processing captured audio..."
# Extract PCM data from JSON output
cat "$TEMP_DIR/output.json" | while read -r line; do
  if [[ "$line" == *"data"* ]]; then
    echo "$line" | python3 -c "
import json, base64, sys
try:
    data = json.loads(sys.stdin.read())
    if 'data' in data:
        decoded = base64.b64decode(data['data'])
        with open('$PCM_FILE', 'ab') as f:
            f.write(decoded)
except Exception as e:
    print(f'Error processing line: {e}', file=sys.stderr)
"
  fi
done

# Check if PCM file was created
if [ ! -s "$PCM_FILE" ]; then
  echo "ERROR: Failed to extract PCM data."
  echo "Debug log:"
  cat "$TEMP_DIR/debug.log"
  rm -rf "$TEMP_DIR"
  exit 1
fi

echo "4. Converting to WAV..."
# Create WAV header and combine with PCM data
python3 -c "
import struct, os, sys

pcm_file = '$PCM_FILE'
wav_file = '$WAV_FILE'

# PCM parameters
sample_rate = 16000
num_channels = 1
bits_per_sample = 16

# Get PCM file size
pcm_size = os.path.getsize(pcm_file)

# Create WAV header
with open(wav_file, 'wb') as f:
    # RIFF header
    f.write(b'RIFF')
    f.write(struct.pack('<I', pcm_size + 36))  # File size - 8
    f.write(b'WAVE')
    
    # Format chunk
    f.write(b'fmt ')
    f.write(struct.pack('<I', 16))  # Chunk size
    f.write(struct.pack('<H', 1))   # PCM format
    f.write(struct.pack('<H', num_channels))
    f.write(struct.pack('<I', sample_rate))
    f.write(struct.pack('<I', sample_rate * num_channels * bits_per_sample // 8))  # Byte rate
    f.write(struct.pack('<H', num_channels * bits_per_sample // 8))  # Block align
    f.write(struct.pack('<H', bits_per_sample))
    
    # Data chunk
    f.write(b'data')
    f.write(struct.pack('<I', pcm_size))
    
    # Copy PCM data
    with open(pcm_file, 'rb') as pcm:
        f.write(pcm.read())

print(f'WAV file created: {wav_file}')
"

echo ""
echo "5. Test completed!"
if [ -f "$WAV_FILE" ]; then
  echo "   WAV file saved to: $WAV_FILE"
  echo "   Please play this file to verify system audio capture is working."
else
  echo "   ERROR: Failed to create WAV file."
fi

# Clean up
rm -rf "$TEMP_DIR"
