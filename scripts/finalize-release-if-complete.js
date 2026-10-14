const { spawnSync } = require('child_process')

const tag = process.argv[2]
const repository = process.argv[3] || process.env.GITHUB_REPOSITORY

if (!tag || !repository) {
  console.error('Usage: node scripts/finalize-release-if-complete.js <tag> <owner/repo>')
  process.exit(2)
}

// GitHub's /releases/latest/download routes share one latest release across
// platforms. Publishing either platform alone breaks the other platform's URLs.
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
const assetNames = new Set(release.assets
  .filter((asset) => asset.state === 'uploaded' && asset.size > 0)
  .map((asset) => asset.name))

const status = Object.entries(PLATFORM_ASSETS).map(([platform, assets]) => ({
  platform,
  missing: assets.filter((asset) => !assetNames.has(asset)),
}))

const pending = status.filter((entry) => entry.missing.length > 0)

for (const entry of pending) {
  console.log(`[release-gate] ${entry.platform} pending; missing: ${entry.missing.join(', ')}`)
}

if (pending.length > 0) {
  const detail = status.map((e) => `${e.platform}: ${e.missing.join(', ')}`).join(' | ')
  if (!release.isDraft) {
    console.error(`[release-gate] Published release ${tag} is incomplete (${detail})`)
    process.exit(1)
  }
  console.log(`[release-gate] ${tag} remains draft until both platforms are complete`)
  process.exit(0)
}

if (release.isDraft) {
  gh(['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest'])
  console.log(`[release-gate] Published complete Mac + Windows release ${tag}`)
} else {
  console.log(`[release-gate] ${tag} is complete on every platform and already published`)
}
