const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '..')
const binary = path.join(ROOT, 'src', 'main', 'assets', 'SystemAudioDump')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

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

test('macOS releases remain drafts until every Mac updater asset exists', () => {
  const macWorkflow = read('.github/workflows/release-desktop.yml')
  const releaseGate = read('scripts/finalize-release-if-complete.js')

  assert.match(macWorkflow, /gh release create "\$TAG" --draft/)
  assert.match(macWorkflow, /finalize-release-if-complete\.js/)
  for (const asset of [
    'taylos.dmg',
    'taylos.zip',
    'latest-mac.yml',
  ]) {
    assert.match(releaseGate, new RegExp(asset.replaceAll('.', '\\.')))
  }
  assert.doesNotMatch(releaseGate, /Taylos\.exe/)
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
