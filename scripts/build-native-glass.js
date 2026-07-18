const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

if (process.platform !== 'darwin') {
  console.log('[native-glass] Skipping AppKit bridge outside macOS')
  process.exit(0)
}

const root = path.resolve(__dirname, '..')
const moduleDir = path.join(root, 'native', 'macos-liquid-glass')
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
const binary = path.join(moduleDir, 'build', 'Release', 'taylos_liquid_glass.node')
const architectureBuilds = []

for (const architecture of ['arm64', 'x64']) {
  execFileSync(process.execPath, [nodeGyp, 'rebuild', '--directory', moduleDir, `--arch=${architecture}`], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_arch: architecture,
    },
  })

  if (!fs.existsSync(binary)) {
    throw new Error(`Native glass ${architecture} build completed without producing ${binary}`)
  }

  const architectureBinary = path.join(moduleDir, `taylos_liquid_glass.${architecture}.node`)
  fs.copyFileSync(binary, architectureBinary)
  architectureBuilds.push(architectureBinary)
}

execFileSync('lipo', ['-create', ...architectureBuilds, '-output', binary], { stdio: 'inherit' })
architectureBuilds.forEach((architectureBinary) => fs.rmSync(architectureBinary, { force: true }))
execFileSync('file', [binary], { stdio: 'inherit' })
