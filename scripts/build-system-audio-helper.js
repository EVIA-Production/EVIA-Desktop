const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

if (process.platform !== 'darwin') {
  console.log('[system-audio] Skipping macOS helper build outside macOS')
  process.exit(0)
}

const root = path.resolve(__dirname, '..')
const packageDir = path.join(root, 'native', 'mac', 'SystemAudioCapture')
const destination = path.join(root, 'src', 'main', 'assets', 'SystemAudioDump')
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taylos-system-audio-'))
const architectureBinaries = []

function swift(args, captureOutput = false) {
  return execFileSync('swift', args, {
    cwd: packageDir,
    encoding: captureOutput ? 'utf8' : undefined,
    stdio: captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: {
      ...process.env,
      MACOSX_DEPLOYMENT_TARGET: '12.0',
    },
  })
}

function versionAtMost(value, maximum) {
  const actual = value.split('.').map(Number)
  const limit = maximum.split('.').map(Number)
  for (let index = 0; index < Math.max(actual.length, limit.length); index += 1) {
    const left = actual[index] || 0
    const right = limit[index] || 0
    if (left !== right) return left < right
  }
  return true
}

try {
  for (const architecture of ['arm64', 'x86_64']) {
    const scratchPath = path.join(temporaryRoot, architecture)
    const buildArgs = [
      'build',
      '-c',
      'release',
      '--arch',
      architecture,
      '--scratch-path',
      scratchPath,
    ]
    swift(buildArgs)
    const binPath = swift([...buildArgs, '--show-bin-path'], true).trim()
    const binary = path.join(binPath, 'SystemAudioCapture')
    if (!fs.existsSync(binary)) {
      throw new Error(`Swift completed without producing ${binary}`)
    }
    architectureBinaries.push(binary)
  }

  const merged = path.join(temporaryRoot, 'SystemAudioDump')
  execFileSync('lipo', ['-create', ...architectureBinaries, '-output', merged], { stdio: 'inherit' })

  const lipoInfo = execFileSync('lipo', ['-info', merged], { encoding: 'utf8' })
  for (const architecture of ['arm64', 'x86_64']) {
    if (!lipoInfo.includes(architecture)) {
      throw new Error(`SystemAudioDump is missing ${architecture}: ${lipoInfo.trim()}`)
    }
    const output = execFileSync('otool', ['-l', '-arch', architecture, merged], { encoding: 'utf8' })
    const minimum = output.match(/\bminos\s+([0-9.]+)/)?.[1]
    if (!minimum || !versionAtMost(minimum, '12.0')) {
      throw new Error(`SystemAudioDump ${architecture} has invalid minimum macOS ${minimum || 'unknown'}`)
    }
  }

  const strings = execFileSync('strings', [merged], { encoding: 'utf8' })
  for (const marker of ['capture_started', 'unsupported_os', 'first_audio_chunk', 'ndjson-float32-v1']) {
    if (!strings.includes(marker)) {
      throw new Error(`SystemAudioDump is missing protocol marker: ${marker}`)
    }
  }

  fs.copyFileSync(merged, destination)
  fs.chmodSync(destination, 0o755)
  console.log(`[system-audio] Built verified universal helper: ${destination}`)
  console.log(lipoInfo.trim())
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
