#!/bin/bash
echo "=== BRANCH RELATIONSHIP ANALYSIS ===" > branch_relationships.md
echo "" >> branch_relationships.md

# Check if desktop-build-fix contains commits from other branches
echo "## Does desktop-build-fix include work from other branches?" >> branch_relationships.md
echo "" >> branch_relationships.md

for branch in desktop-mac-production desktop-mvp-finish desktop-ux-fixes; do
  echo "### Checking: $branch → desktop-build-fix" >> branch_relationships.md
  
  # Find merge base
  merge_base=$(git merge-base desktop-build-fix $branch 2>/dev/null)
  branch_tip=$(git rev-parse $branch 2>/dev/null)
  
  if [ "$merge_base" = "$branch_tip" ]; then
    echo "✅ **FULLY MERGED** - desktop-build-fix contains all commits from $branch" >> branch_relationships.md
  else
    unique_commits=$(git log --oneline $merge_base..$branch 2>/dev/null | wc -l | tr -d ' ')
    echo "⚠️ **$unique_commits unique commits** in $branch not in desktop-build-fix" >> branch_relationships.md
    echo "" >> branch_relationships.md
    echo "Sample unique commits:" >> branch_relationships.md
    git log --oneline $merge_base..$branch 2>/dev/null | head -5 >> branch_relationships.md
  fi
  echo "" >> branch_relationships.md
done

# Check ancestry
echo "## Branch Ancestry" >> branch_relationships.md
echo "" >> branch_relationships.md
echo "desktop-build-fix based on:" >> branch_relationships.md
git log --oneline desktop-build-fix | tail -5 >> branch_relationships.md
echo "" >> branch_relationships.md

cat branch_relationships.md
