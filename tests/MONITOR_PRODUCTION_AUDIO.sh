#!/bin/bash

echo "🎧 Monitoring EVIA Desktop Production - System Audio Logs"
echo "=========================================================="
echo ""
echo "This will show real-time logs related to audio capture."
echo "Start system audio capture in the app, then watch for logs here."
echo ""
echo "Press Ctrl+C to stop monitoring."
echo ""

# Monitor logs in real-time, filtering for relevant keywords
log stream \
    --predicate 'process == "EVIA Desktop"' \
    --level info \
    --style compact \
    2>&1 | grep -i --line-buffered -E "(audio|system|permission|capture|dump|binary|spawn|websocket|deepgram|transcript)" | \
    while IFS= read -r line; do
        # Highlight errors in red, success in green
        if echo "$line" | grep -qi "error\|fail\|denied\|missing"; then
            echo -e "\033[0;31m$line\033[0m"  # Red
        elif echo "$line" | grep -qi "success\|started\|connected\|capturing"; then
            echo -e "\033[0;32m$line\033[0m"  # Green
        else
            echo "$line"
        fi
    done

