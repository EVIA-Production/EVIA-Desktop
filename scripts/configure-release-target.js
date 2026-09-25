/**
 * Points a release build at the public releases repository and names the
 * Windows publishers installed apps accept, from the environment.
 *
 * Installers and update feeds move out of EVIA-Desktop (public, and it holds
 * the source) into a releases-only repository, so the source can go private.
 * electron-builder bakes the feed (publish owner/repo) and the accepted
 * Windows signers (win.signtoolOptions.publisherName) into every build's
 * app-update.yml, so both are set here, per build, instead of by editing
 * electron-builder.yml by hand at the switch.
 *
 *   RELEASES_REPO        owner/repo that holds installers and update feeds
 *   WIN_PUBLISHER_NAMES  comma-separated certificate names (CN) installed
 *                        Windows apps accept for later updates. The bridge
 *                        build lists the old and the new certificate.
 *   WIN_SIGN_MODE        "esigner": the key lives in SSL.com's HSM, so the
 *                        Certum thumbprint (certificateSha1) must not send
 *                        electron-builder looking for it in the local store.
 *
 * Unset, it changes nothing: today's release flow is untouched. It rewrites
 * electron-builder.yml in place (comments dropped), so it is for CI checkouts.
 */
const fs = require('node:fs')
const path = require('node:path')

const file = path.join(__dirname, '..', 'electron-builder.yml')

function configure(env = process.env, source = fs.readFileSync(file, 'utf8')) {
  const repo = (env.RELEASES_REPO || '').trim()
  const publishers = (env.WIN_PUBLISHER_NAMES || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const esigner = (env.WIN_SIGN_MODE || '').trim() === 'esigner'
  if (!repo && publishers.length === 0 && !esigner) return null

  // Loaded only when there is something to change, so a run with nothing set
  // works even before dependencies are installed.
  const yaml = require('js-yaml')
  const config = yaml.load(source)
  if (repo) {
    const [owner, name, extra] = repo.split('/')
    if (!owner || !name || extra !== undefined) {
      throw new Error(`RELEASES_REPO must be owner/repo, got "${repo}"`)
    }
    config.publish = { ...(config.publish || {}), provider: 'github', owner, repo: name }
  }
  if (publishers.length > 0) {
    config.win = config.win || {}
    config.win.signtoolOptions = { ...(config.win.signtoolOptions || {}), publisherName: publishers }
  }
  if (esigner && config.win && config.win.signtoolOptions) {
    delete config.win.signtoolOptions.certificateSha1
    delete config.win.signtoolOptions.certificateSubjectName
  }
  return yaml.dump(config, { lineWidth: -1, noRefs: true })
}

if (require.main === module) {
  const next = configure()
  if (next === null) {
    console.log('[release-target] no RELEASES_REPO or WIN_PUBLISHER_NAMES; electron-builder.yml unchanged')
  } else {
    fs.writeFileSync(file, next)
    const config = require('js-yaml').load(next)
    console.log(
      `[release-target] feed ${config.publish.owner}/${config.publish.repo}; ` +
      `Windows publishers ${JSON.stringify(config.win.signtoolOptions.publisherName)}; ` +
      `certificate thumbprint ${config.win.signtoolOptions.certificateSha1 ? 'kept' : 'none (eSigner)'}`,
    )
  }
}

module.exports = { configure }
