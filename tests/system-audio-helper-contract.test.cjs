const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '..')
const binary = path.join(ROOT, 'src', 'main', 'assets', 'SystemAudioDump')
// Windows checkouts may carry CRLF; the contracts below are about content, not line endings.
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n')

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

test('macOS release build regenerates the system-audio helper', () => {
  const packageJson = JSON.parse(read('package.json'))
  assert.match(packageJson.scripts['build:release:mac'], /build:native:audio/)
  assert.match(packageJson.scripts['build:native:audio'], /build-system-audio-helper\.js/)
})

test('a latest release stays draft until both platform feeds and installers exist', () => {
  const macWorkflow = read('.github/workflows/release-desktop.yml')
  const releaseGate = read('scripts/finalize-release-if-complete.js')

  // Drafts, created in the release target (this repo, or RELEASES_REPO once set).
  assert.match(macWorkflow, /gh release create "\$TAG"( --repo "\$repo")? --draft/)
  assert.match(macWorkflow, /finalize-release-if-complete\.js/)

  // Every latest-download route must exist before the release becomes public.
  for (const asset of [
    'taylos.dmg',
    'taylos.zip',
    'latest-mac.yml',
    'Taylos.exe',
    'Taylos.exe.blockmap',
    'latest.yml',
  ]) {
    assert.match(releaseGate, new RegExp(asset.replaceAll('.', '\\.')))
  }

  assert.match(releaseGate, /PLATFORM_ASSETS/)
  assert.match(releaseGate, /mac:\s*\[/)
  assert.match(releaseGate, /windows:\s*\[/)
  assert.match(releaseGate, /pending\.length > 0/)
  assert.match(macWorkflow, /ws_url: \$\{\{ vars\.VITE_BACKEND_WS_URL \|\| 'wss:\/\/api\.taylos\.ai' \}\}/)
})

const releaseAssets = ['taylos.dmg', 'taylos.zip', 'latest-mac.yml', 'Taylos.exe', 'Taylos.exe.blockmap', 'latest.yml']

function finalizeRelease(names, isDraft = true, overrides = {}) {
  const calls = []
  const exit = {}
  let exitCode = 0
  const release = {
    isDraft,
    assets: names.map((name) => ({name, state: 'uploaded', size: 100, ...overrides[name]})),
  }
  try {
    vm.runInNewContext(read('scripts/finalize-release-if-complete.js'), {
      require(name) {
        assert.equal(name, 'child_process')
        return {spawnSync(command, args) {
          assert.equal(command, 'gh')
          calls.push(Array.from(args))
          return {status: 0, stdout: JSON.stringify(release)}
        }}
      },
      process: {
        argv: ['node', 'finalize', 'v1.0.129', 'owner/repo'],
        env: {},
        exit(code) { exitCode = code; throw exit },
      },
      console: {log() {}, error() {}},
    })
  } catch (error) {
    if (error !== exit) throw error
  }
  return {exitCode, edits: calls.filter((args) => args[1] === 'edit')}
}

test('empty, Mac-only and Windows-only releases remain unpublished drafts', () => {
  for (const names of [[], releaseAssets.slice(0, 3), releaseAssets.slice(3)]) {
    const result = finalizeRelease(names)
    assert.equal(result.exitCode, 0)
    assert.equal(result.edits.length, 0)
  }
})

test('every required asset independently blocks incomplete publication', () => {
  for (const missing of releaseAssets) {
    const names = releaseAssets.filter((name) => name !== missing)
    assert.equal(finalizeRelease(names).edits.length, 0, missing)
    const published = finalizeRelease(names, false)
    assert.equal(published.exitCode, 1, missing)
    assert.equal(published.edits.length, 0, missing)
  }
})

test('zero-sized or unfinished uploads cannot satisfy the release gate', () => {
  for (const name of releaseAssets) {
    for (const override of [{size: 0}, {state: 'starter'}]) {
      assert.equal(finalizeRelease(releaseAssets, true, {[name]: override}).edits.length, 0)
    }
  }
})

test('only a complete draft is published and explicitly promoted to Latest', () => {
  const result = finalizeRelease(releaseAssets)
  assert.equal(result.exitCode, 0)
  assert.deepEqual(result.edits, [['release', 'edit', 'v1.0.129', '--repo', 'owner/repo', '--draft=false', '--latest']])
  assert.equal(finalizeRelease(releaseAssets, false).edits.length, 0)
})

test('system-audio helper source and Electron share a typed protocol', () => {
  const swiftSource = read('native/mac/SystemAudioCapture/Sources/SystemAudioCapture/main.swift')
  const serviceSource = read('src/main/system-audio-mac-service.ts')
  for (const marker of ['capture_started', 'unsupported_os', 'first_audio_chunk']) {
    assert.match(swiftSource, new RegExp(marker))
    assert.match(serviceSource, new RegExp(marker))
  }
  assert.match(swiftSource, /ndjson-float32-v1/)
  assert.match(serviceSource, /audio\\\/float32/)
  assert.match(swiftSource, /CMSampleBufferGetPresentationTimeStamp/)
  assert.match(swiftSource, /capturedAtUnixMs/)
  assert.match(swiftSource, /sampleHandlerQueue: audioSampleQueue/)
  assert.doesNotMatch(
    swiftSource,
    /addStreamOutput\(output, type: \.audio, sampleHandlerQueue: \.global\(\)\)/,
  )
  assert.match(serviceSource, /capturedAtUnixMs/)
  assert.match(read('src/main/preload.ts'), /capturedAtUnixMs/)
  assert.match(read('src/renderer/audio-processor-glass-parity.ts'), /capturedAtPerformanceMs/)
})

test('audio failures persist content-free rotating diagnostics', () => {
  const diagnosticSource = read('src/main/audio-diagnostics.ts')
  const systemAudioSource = read('src/main/system-audio-mac-service.ts')
  const overlaySource = read('src/main/overlay-windows.ts')

  assert.match(diagnosticSource, /audio-diagnostics\.log/)
  assert.match(diagnosticSource, /2 \* 1024 \* 1024/)
  assert.match(diagnosticSource, /renameSync/)
  assert.doesNotMatch(diagnosticSource, /transcript|audioData|base64/i)
  assert.match(systemAudioSource, /appendAudioDiagnostic/)
  assert.match(overlaySource, /appendAudioDiagnostic/)
  assert.match(overlaySource, /\[AudioCapture\]/)
  assert.match(overlaySource, /\[MIC-DIAGNOSTIC\]/)
})

test('the helper ships ScreenCaptureKit; the Core Audio tap (macOS 14.4+) stays opt-in', () => {
  const swiftSource = read('native/mac/SystemAudioCapture/Sources/SystemAudioCapture/main.swift')
  assert.match(swiftSource, /CATapDescription\(stereoGlobalTapButExcludeProcesses: \[\]\)/)
  assert.match(swiftSource, /kAudioAggregateDeviceTapAutoStartKey/)
  assert.match(swiftSource, /if #available\(macOS 14\.4, \*\), selectedBackend\(\) == "tap"/)
  // 1.0.115 made the tap the default and listening produced no usable audio:
  // without the explicit opt-in both sides must choose ScreenCaptureKit.
  assert.match(swiftSource, /if forced == "tap", #available\(macOS 14\.4, \*\) \{ return "tap" \}\n    return "screencapturekit"/)
  assert.match(read('src/main/system-audio-permission-mac.ts'), /TAYLOS_SYSTEM_AUDIO_BACKEND !== 'tap'\) return false/)
  // Both permission questions Electron asks, and the denial the tap would otherwise hide as silence.
  for (const marker of ['--audio-permission-status', '--request-audio-permission', 'kTCCServiceAudioCapture', 'system_audio_permission_denied']) {
    assert.match(swiftSource, new RegExp(marker.replace(/[-]/g, '\\-')))
  }
  const permission = read('src/main/system-audio-permission-mac.ts')
  assert.match(permission, /major > 23 \|\| \(major === 23 && minor >= 4\)/)
  assert.match(read('src/main/system-audio-mac-service.ts'), /macSupportsAudioTap\(\)/)
  assert.match(read('src/main/native-onboarding.ts'), /probeAudioCapturePermission/)
  assert.match(read('electron-builder.yml'), /NSAudioCaptureUsageDescription/)
})

test('bundled system-audio helper is universal and launches on macOS 12', { skip: process.platform !== 'darwin' }, () => {
  const lipo = execFileSync('lipo', ['-info', binary], { encoding: 'utf8' })
  assert.match(lipo, /arm64/)
  assert.match(lipo, /x86_64/)

  for (const architecture of ['arm64', 'x86_64']) {
    const output = execFileSync('otool', ['-l', '-arch', architecture, binary], { encoding: 'utf8' })
    const minimum = output.match(/\bminos\s+([0-9.]+)/)?.[1]
    assert.ok(minimum, `${architecture} must declare an LC_BUILD_VERSION minimum`)
    assert.ok(
      versionAtMost(minimum, '12.0'),
      `${architecture} helper must launch on macOS 12 to return a typed unsupported response; got ${minimum}`,
    )
  }

  const strings = execFileSync('strings', [binary], { encoding: 'utf8' })
  for (const marker of [
    'capture_started',
    'unsupported_os',
    'first_audio_chunk',
    'ndjson-float32-v1',
    'capturedAtUnixMs',
  ]) {
    assert.match(strings, new RegExp(marker))
  }
})
