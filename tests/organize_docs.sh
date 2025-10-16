#!/bin/bash

# 📚 Organize EVIA-Desktop Documentation
# Creates clean directory structure for all documentation files

echo "============================================"
echo "📚 Organizing EVIA-Desktop Documentation"
echo "============================================"
echo ""

# Create directories
mkdir -p docs/current
mkdir -p docs/historical
mkdir -p scripts

# Move current/active documentation
echo "📘 Moving current documentation..."
mv COMPLETE_FIX_REPORT.md docs/current/ 2>/dev/null || echo "  ↳ COMPLETE_FIX_REPORT.md already moved or missing"
mv NEXT_STEPS.md docs/current/ 2>/dev/null || echo "  ↳ NEXT_STEPS.md already moved or missing"
mv QUICK_REFERENCE.md docs/current/ 2>/dev/null || echo "  ↳ QUICK_REFERENCE.md already moved or missing"
mv COORDINATOR_HANDOFF.md docs/current/ 2>/dev/null || echo "  ↳ COORDINATOR_HANDOFF.md already moved or missing"

# Move historical documentation
echo ""
echo "📗 Moving historical documentation..."
mv AUTH_FIX_TESTING.md docs/historical/ 2>/dev/null || echo "  ↳ AUTH_FIX_TESTING.md already moved or missing"
mv CRITICAL_FIX_APPLIED.md docs/historical/ 2>/dev/null || echo "  ↳ CRITICAL_FIX_APPLIED.md already moved or missing"
mv FINAL_IPC_FIX.md docs/historical/ 2>/dev/null || echo "  ↳ FINAL_IPC_FIX.md already moved or missing"
mv IPC_FIX_COMPLETE.md docs/historical/ 2>/dev/null || echo "  ↳ IPC_FIX_COMPLETE.md already moved or missing"
mv TOKEN_FIX_COMPLETE.md docs/historical/ 2>/dev/null || echo "  ↳ TOKEN_FIX_COMPLETE.md already moved or missing"
mv TRANSCRIPTION_FIX_COMPLETE.md docs/historical/ 2>/dev/null || echo "  ↳ TRANSCRIPTION_FIX_COMPLETE.md already moved or missing"
mv TRANSCRIPTION_FIX_SUMMARY.md docs/historical/ 2>/dev/null || echo "  ↳ TRANSCRIPTION_FIX_SUMMARY.md already moved or missing"
mv ULTRA_DEEP_E2E_FIX_REPORT.md docs/historical/ 2>/dev/null || echo "  ↳ ULTRA_DEEP_E2E_FIX_REPORT.md already moved or missing"
mv CRITICAL_BUGS_FIXED.md docs/historical/ 2>/dev/null || echo "  ↳ CRITICAL_BUGS_FIXED.md already moved or missing"
mv REBUILD_AND_TEST.md docs/historical/ 2>/dev/null || echo "  ↳ REBUILD_AND_TEST.md already moved or missing"
mv START_FIX_HERE.md docs/historical/ 2>/dev/null || echo "  ↳ START_FIX_HERE.md already moved or missing"
mv TEST_NOW.md docs/historical/ 2>/dev/null || echo "  ↳ TEST_NOW.md already moved or missing"
mv TRANSCRIPTION_WORKS_NOW.md docs/historical/ 2>/dev/null || echo "  ↳ TRANSCRIPTION_WORKS_NOW.md already moved or missing"

# Move scripts
echo ""
echo "🔧 Moving utility scripts..."
mv QUICK_FIX_COMMANDS.sh scripts/ 2>/dev/null || echo "  ↳ QUICK_FIX_COMMANDS.sh already moved or missing"
mv RESTART_AND_TEST.sh scripts/ 2>/dev/null || echo "  ↳ RESTART_AND_TEST.sh already moved or missing"
mv RESTART_ELECTRON.sh scripts/ 2>/dev/null || echo "  ↳ RESTART_ELECTRON.sh already moved or missing"
mv RESTART_NOW.sh scripts/ 2>/dev/null || echo "  ↳ RESTART_NOW.sh already moved or missing"
mv TEST_WITH_DEVTOOLS.sh scripts/ 2>/dev/null || echo "  ↳ TEST_WITH_DEVTOOLS.sh already moved or missing"
mv verify-build.sh scripts/ 2>/dev/null || echo "  ↳ verify-build.sh already moved or missing"

echo ""
echo "============================================"
echo "✅ Documentation organized!"
echo "============================================"
echo ""
echo "📁 Current Documentation (READ THESE):"
echo "   docs/current/COORDINATOR_HANDOFF.md - Start here for handoff"
echo "   docs/current/COMPLETE_FIX_REPORT.md - Full technical details"
echo "   docs/current/NEXT_STEPS.md - Implementation guide"
echo "   docs/current/QUICK_REFERENCE.md - Quick commands"
echo ""
echo "📁 Historical Documentation:"
echo "   docs/historical/ - All debug/fix documentation from session"
echo ""
echo "📁 Utility Scripts:"
echo "   scripts/ - Helper scripts for testing and debugging"
echo ""
echo "🚀 Ready for next phase!"

