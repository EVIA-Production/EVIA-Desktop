const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

if (process.platform !== 'win32') {
  console.log('[windows-audio] Skipping WASAPI helper build outside Windows')
  process.exit(0)
}

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'src', 'main', 'assets', 'WASAPILoopback.cpp')
const outputRoot = path.join(root, 'native', 'windows', 'build')
const vswhere = path.join(
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Microsoft Visual Studio',
  'Installer',
  'vswhere.exe',
)

function findVisualStudio(component) {
  if (!fs.existsSync(vswhere)) {
    throw new Error(`vswhere.exe is missing at ${vswhere}`)
  }
  try {
    return execFileSync(vswhere, [
      '-latest', '-products', '*', '-requires', component, '-property', 'installationPath',
    ], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function readPeMachine(executable) {
  const bytes = fs.readFileSync(executable)
  const peOffset = bytes.readUInt32LE(0x3c)
  if (bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`${executable} is not a PE executable`)
  }
  return bytes.readUInt16LE(peOffset + 4)
}

const x64Install = findVisualStudio('Microsoft.VisualStudio.Component.VC.Tools.x86.x64')
const arm64Install = findVisualStudio('Microsoft.VisualStudio.Component.VC.Tools.ARM64')
if (!x64Install) throw new Error('Visual Studio C++ x64 build tools are not installed')
if (!arm64Install) {
  throw new Error(
    'Visual Studio ARM64 C++ build tools are not installed. Add Microsoft.VisualStudio.Component.VC.Tools.ARM64.',
  )
}
if (x64Install !== arm64Install) {
  throw new Error(`x64 and ARM64 toolsets must share one Visual Studio installation: ${x64Install} != ${arm64Install}`)
}

const vcvarsall = path.join(x64Install, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat')
if (!fs.existsSync(vcvarsall)) throw new Error(`vcvarsall.bat is missing at ${vcvarsall}`)
if (!fs.existsSync(source)) throw new Error(`WASAPI source is missing at ${source}`)

const targets = [
  { name: 'x64', vcvars: 'amd64', machine: 0x8664 },
  { name: 'arm64', vcvars: 'amd64_arm64', machine: 0xaa64 },
]

for (const target of targets) {
  const outputDir = path.join(outputRoot, target.name)
  const output = path.join(outputDir, 'WASAPILoopback.exe')
  fs.mkdirSync(outputDir, { recursive: true })
  fs.rmSync(output, { force: true })

  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), `taylos-wasapi-${target.name}-`))
  const commandFile = path.join(temporaryDir, 'build.cmd')
  const command = [
    '@echo off',
    `call "${vcvarsall}" ${target.vcvars}`,
    'if errorlevel 1 exit /b %errorlevel%',
    `cl.exe /nologo /O2 /EHsc /std:c++17 /Fe:"${output}" "${source}" ole32.lib uuid.lib avrt.lib user32.lib`,
    'if errorlevel 1 exit /b %errorlevel%',
  ].join('\r\n')

  try {
    fs.writeFileSync(commandFile, command, 'ascii')
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/q', '/c', commandFile], {
      cwd: temporaryDir,
      stdio: 'inherit',
    })
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true })
  }

  if (!fs.existsSync(output)) throw new Error(`Compiler completed without producing ${output}`)
  const machine = readPeMachine(output)
  if (machine !== target.machine) {
    throw new Error(`${output} has PE machine 0x${machine.toString(16)}, expected 0x${target.machine.toString(16)}`)
  }
  console.log(`[windows-audio] Built ${target.name}: ${output}`)
}
