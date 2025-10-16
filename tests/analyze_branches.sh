#!/bin/bash
echo "=== BRANCH ANALYSIS REPORT ===" > branch_analysis.md
echo "" >> branch_analysis.md
echo "## Key Branches Comparison" >> branch_analysis.md
echo "" >> branch_analysis.md

# Analyze each priority branch
for branch in desktop-build-fix desktop-mac-production desktop-mvp-finish desktop-ux-fixes windows-v2 dev-c-windows-compatibility; do
  echo "### Branch: $branch" >> branch_analysis.md
  
  # Check if branch exists
  if git show-ref --verify --quiet refs/heads/$branch || git show-ref --verify --quiet refs/remotes/origin/$branch; then
    # Get commit count ahead of main
    if git show-ref --verify --quiet refs/heads/$branch; then
      ref="$branch"
    else
      ref="origin/$branch"
    fi
    
    commits_ahead=$(git rev-list --count main..$ref 2>/dev/null || echo "N/A")
    last_commit=$(git log -1 --format="%h - %s (%ar)" $ref 2>/dev/null || echo "N/A")
    
    echo "- **Commits ahead of main:** $commits_ahead" >> branch_analysis.md
    echo "- **Last commit:** $last_commit" >> branch_analysis.md
    echo "" >> branch_analysis.md
  else
    echo "- **Status:** Branch not found" >> branch_analysis.md
    echo "" >> branch_analysis.md
  fi
done

cat branch_analysis.md
