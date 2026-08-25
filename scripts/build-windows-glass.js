const { execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

if (process.platform !== 'win32') {
  console.log('[windows-glass] Skipping Windows Composition bridge outside Windows')
  process.exit(0)
}

const root = path.resolve(__dirname, '..')
const moduleDir = path.join(root, 'native', 'windows-liquid-glass')
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
const buildBinary = path.join(moduleDir, 'build', 'Release', 'taylos_windows_glass.node')
const effectHeader = path.join(
  moduleDir,
  'third_party',
  'microsoft',
  'microsoft.ui.composition.effects_impl.h',
)
const expectedEffectHeaderSha256 =
  '3dba14a490e58c8a07799581afc89ce67d3a70d31e02f8430dafbc1f4e9a0bdf'

// Git may materialize this text dependency as CRLF on Windows. Pin the
// canonical source content so checkout policy cannot create a false integrity
// failure while any actual header change still fails closed.
const canonicalEffectHeader = fs.readFileSync(effectHeader, 'utf8').replace(/\r\n/g, '\n')
const effectHeaderSha256 = crypto
  .createHash('sha256')
  .update(canonicalEffectHeader, 'utf8')
  .digest('hex')
if (effectHeaderSha256 !== expectedEffectHeaderSha256) {
  throw new Error(`Pinned Microsoft effect header checksum mismatch: ${effectHeaderSha256}`)
}

function readPeMachine(binaryPath) {
  const binary = fs.readFileSync(binaryPath)
  const peOffset = binary.readUInt32LE(0x3c)
  if (binary.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`${binaryPath} is not a PE binary`)
  }
  return binary.readUInt16LE(peOffset + 4)
}

for (const { architecture, machine } of [
  { architecture: 'x64', machine: 0x8664 },
  { architecture: 'arm64', machine: 0xaa64 },
]) {
  execFileSync(process.execPath, [nodeGyp, 'rebuild', '--directory', moduleDir, `--arch=${architecture}`], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_arch: architecture,
    },
  })

  if (!fs.existsSync(buildBinary)) {
    throw new Error(`Windows glass ${architecture} build completed without producing ${buildBinary}`)
  }

  const destinationDir = path.join(moduleDir, 'prebuilds', `win32-${architecture}`)
  fs.mkdirSync(destinationDir, { recursive: true })
  const destination = path.join(destinationDir, 'taylos_windows_glass.node')
  fs.copyFileSync(buildBinary, destination)
  const actualMachine = readPeMachine(destination)
  if (actualMachine !== machine) {
    throw new Error(
      `Windows glass ${architecture} PE machine mismatch: 0x${actualMachine.toString(16)}`,
    )
  }
  console.log(`[windows-glass] Built ${architecture} (PE 0x${machine.toString(16)})`)
}
