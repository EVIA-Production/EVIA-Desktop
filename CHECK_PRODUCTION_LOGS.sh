#!/bin/bash

echo "📋 EVIA Desktop Production Logs"
echo "================================"
echo ""
echo "Checking Console.app logs for EVIA Desktop..."
echo ""

# Get logs from the last 5 minutes
log show --predicate 'process == "EVIA Desktop"' --info --last 5m

echo ""
echo "✅ To see real-time logs, run:"
echo "   log stream --predicate 'process == \"EVIA Desktop\"' --level debug"

