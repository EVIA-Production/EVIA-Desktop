const { spawnSync } = require('child_process')

const tag = process.argv[2]
const repository = process.argv[3] || process.env.GITHUB_REPOSITORY

if (!tag || !repository) {
  console.error('Usage: node scripts/finalize-release-if-complete.js <tag> <owner/repo>')
  process.exit(2)
}

// PER PLATFORM, not all-or-nothing.
//
// This gate used to require all six assets before publishing anything, so one
// offline Windows signing runner held the mac release hostage: v1.0.98 sat as
// a draft for hours with a finished mac build in it, and nobody - on either
// platform - could update. Windows signing needs an interactive, human-
// authenticated HSM session, so that wait is measured in hours, not minutes.
//
// electron-updater reads a per-platform manifest: mac clients fetch
// latest-mac.yml, Windows clients fetch latest.yml. A release carrying only
// the mac assets is therefore complete FOR MAC - Windows clients ask for a
// manifest that is not there yet and simply see no update, which is the same
// thing they saw while the release was a draft. Nothing breaks; Windows just
// arrives later, and uploading its assets to an already-published release is
// what makes it visible.
const PLATFORM_ASSETS = {
  mac: ['taylos.dmg', 'taylos.zip', 'latest-mac.yml'],
  windows: ['Taylos.exe', 'Taylos.exe.blockmap', 'latest.yml'],
}

function gh(args, capture = false) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
  return result.stdout || ''
}

const release = JSON.parse(
  gh(['release', 'view', tag, '--repo', repository, '--json', 'isDraft,assets'], true),
)
const assetNames = new Set(release.assets.map((asset) => asset.name))

const status = Object.entries(PLATFORM_ASSETS).map(([platform, assets]) => ({
  platform,
  missing: assets.filter((asset) => !assetNames.has(asset)),
}))

const ready = status.filter((entry) => entry.missing.length === 0)
const pending = status.filter((entry) => entry.missing.length > 0)

for (const entry of pending) {
  console.log(`[release-gate] ${entry.platform} pending; missing: ${entry.missing.join(', ')}`)
}

if (ready.length === 0) {
  const detail = status.map((e) => `${e.platform}: ${e.missing.join(', ')}`).join(' | ')
  if (!release.isDraft) {
    console.error(`[release-gate] Published release ${tag} has no complete platform (${detail})`)
    process.exit(1)
  }
  console.log(`[release-gate] ${tag} remains draft; no platform is complete yet`)
  process.exit(0)
}

const readyNames = ready.map((entry) => entry.platform).join(', ')

if (release.isDraft) {
  gh(['release', 'edit', tag, '--repo', repository, '--draft=false'])
  console.log(`[release-gate] Published ${tag} for: ${readyNames}`)
  if (pending.length > 0) {
    console.log(
      `[release-gate] ${pending.map((e) => e.platform).join(', ')} will appear when its assets upload to this release.`,
    )
  }
} else if (pending.length === 0) {
  console.log(`[release-gate] ${tag} is complete on every platform and already published`)
} else {
  console.log(`[release-gate] ${tag} already published for ${readyNames}; still waiting on ${pending
    .map((e) => e.platform)
    .join(', ')}`)
}
