#!/usr/bin/env bash
set -euo pipefail

repo="EVIA-Production/EVIA-Desktop"
workflow="release-windows-self-hosted.yml"
ref="main"
upload="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)
      ref="${2:?--ref requires a branch or tag}"
      shift 2
      ;;
    --upload)
      upload="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: bash scripts/trigger-windows-release.sh [--ref BRANCH_OR_TAG] [--upload]" >&2
      exit 2
      ;;
  esac
done

gh auth status >/dev/null

online="$({
  gh api "repos/${repo}/actions/runners" \
    --jq '[.runners[] | select(.status == "online") | select(any(.labels[]; .name == "windows-signing"))] | length'
} 2>/dev/null)" || {
  echo "Cannot read repository runners with the current Mac gh login." >&2
  echo "Authenticate an owner/admin using: gh auth login" >&2
  exit 1
}

if [[ "$online" -lt 1 ]]; then
  echo "No online runner with label windows-signing." >&2
  echo "On Windows: connect SimplySign, open PowerShell as Administrator, then run:" >&2
  echo "  cd D:\\actions-runner\\taylos-desktop" >&2
  echo "  .\\run.cmd" >&2
  exit 1
fi

echo "Dispatching Windows release workflow from ref ${ref} (upload=${upload})"
previous_run_id="$(gh run list --repo "$repo" --workflow "$workflow" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // 0')"
gh workflow run "$workflow" --repo "$repo" --ref "$ref" -f "upload=${upload}"

run_id=""
for _ in $(seq 1 30); do
  candidate="$(gh run list --repo "$repo" --workflow "$workflow" --event workflow_dispatch --limit 1 --json databaseId,headBranch --jq '.[0] | [.databaseId, .headBranch] | @tsv')"
  candidate_id="${candidate%%$'\t'*}"
  candidate_ref="${candidate#*$'\t'}"
  if [[ -n "$candidate_id" && "$candidate_id" != "$previous_run_id" && "$candidate_ref" == "$ref" ]]; then
    run_id="$candidate_id"
    break
  fi
  sleep 2
done

if [[ -z "$run_id" ]]; then
  echo "The dispatched workflow run did not appear within 60 seconds." >&2
  exit 1
fi

echo "Watching GitHub Actions run ${run_id}"
gh run watch "$run_id" --repo "$repo" --exit-status --interval 10
