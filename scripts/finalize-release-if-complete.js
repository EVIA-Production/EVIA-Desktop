const { spawnSync } = require('child_process')

const tag = process.argv[2]
const repository = process.argv[3] || process.env.GITHUB_REPOSITORY

if (!tag || !repository) {
  console.error('Usage: node scripts/finalize-release-if-complete.js <tag> <owner/repo>')
  process.exit(2)
}

const requiredAssets = [
  'taylos.dmg',
  'taylos.zip',
  'latest-mac.yml',
  'Taylos.exe',
  'Taylos.exe.blockmap',
  'latest.yml',
]

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
const missing = requiredAssets.filter((asset) => !assetNames.has(asset))

if (missing.length > 0) {
  if (!release.isDraft) {
    console.error(`[release-gate] Published release ${tag} is incomplete; missing: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log(`[release-gate] ${tag} remains draft; missing: ${missing.join(', ')}`)
  process.exit(0)
}

if (release.isDraft) {
  gh(['release', 'edit', tag, '--repo', repository, '--draft=false'])
  console.log(`[release-gate] Published complete desktop release ${tag}`)
} else {
  console.log(`[release-gate] ${tag} is complete and already published`)
}
