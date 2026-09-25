/**
 * Signs one Windows file with the SSL.com eSigner cloud key through jsign.
 *
 * Why this exists: the Certum SimplySign certificate needs an elevated,
 * logged-in Windows session unlocked with a code from a phone, so Windows
 * releases only happened while one PC was switched on (1.0.114 while the Mac
 * was at 1.0.116). eSigner keeps the key in SSL.com's HSM and authorises each
 * signature with a TOTP code this script computes, so GitHub's own Windows
 * runners can sign: no hardware token, no interactive session, no phone.
 *
 * electron-builder calls the hook once per file, 16 files per release (the app,
 * the audio and glass helpers and keytar for x64 and arm64, the uninstaller,
 * the installer). SSL.com rejects a one-time code that was already used, and
 * repeated rejections can LOCK the credential. So signatures run strictly one
 * at a time, and each waits for a TOTP time step (30 s) no earlier signature
 * used: about 8 minutes per release, and never a reused code.
 *
 * Environment:
 *   JSIGN_JAR               path to jsign-7.5.jar (the workflow pins its SHA-256)
 *   ESIGNER_USERNAME        SSL.com account username
 *   ESIGNER_PASSWORD        SSL.com account password
 *   ESIGNER_TOTP_SECRET     base32 TOTP secret shown once at eSigner enrollment
 *   ESIGNER_CREDENTIAL_ID   the certificate's eSigner credential ID
 *   ESIGNER_TSA_URL         optional, RFC 3161 timestamp server (default SSL.com)
 */
const { spawn } = require('node:child_process')

const TOTP_STEP_MS = 30_000
const STEP_MARGIN_MS = 1_500
const TSA_URL = process.env.ESIGNER_TSA_URL || 'http://ts.ssl.com'
// A rejected code is retried once, in a fresh time step. More would risk the lock.
const MAX_ATTEMPTS = 2

let queue = Promise.resolve()
let lastStep = -1

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function required(name) {
  const value = process.env[name]
  if (!value || !value.trim()) throw new Error(`${name} is required for eSigner signing`)
  return value.trim()
}

/** Wait until the clock is in a TOTP step no earlier signature has used. */
async function waitForFreshStep() {
  for (;;) {
    const now = Date.now()
    const step = Math.floor(now / TOTP_STEP_MS)
    const intoStep = now - step * TOTP_STEP_MS
    // Not at the very end of a step either: the code must still be valid when
    // SSL.com checks it after the request's round trip.
    if (step > lastStep && intoStep < TOTP_STEP_MS - 5_000) {
      lastStep = step
      return
    }
    const nextStepAt = (step + 1) * TOTP_STEP_MS + STEP_MARGIN_MS
    await delay(nextStepAt - now)
  }
}

function runJsign(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('java', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const forward = (stream, destination) => {
      stream.on('data', (chunk) => {
        const text = chunk.toString()
        output += text
        destination.write(text)
      })
    }
    forward(child.stdout, process.stdout)
    forward(child.stderr, process.stderr)
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, output }))
  })
}

function jsignArgs(file) {
  return [
    '-jar', required('JSIGN_JAR'),
    '--storetype', 'ESIGNER',
    '--storepass', `${required('ESIGNER_USERNAME')}|${required('ESIGNER_PASSWORD')}`,
    '--keypass', required('ESIGNER_TOTP_SECRET'),
    '--alias', required('ESIGNER_CREDENTIAL_ID'),
    '--alg', 'SHA-256',
    '--tsaurl', TSA_URL,
    '--tsmode', 'RFC3161',
    '--name', 'Taylos',
    '--url', 'https://taylos.ai',
    '--replace',
    file,
  ]
}

async function signOne(configuration) {
  const target = configuration.path
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await waitForFreshStep()
    process.stdout.write(`[esigner] ${attempt}/${MAX_ATTEMPTS} ${target}\n`)
    const result = await runJsign(jsignArgs(target))
    if (result.code === 0) return
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`jsign (eSigner) failed for ${target} with exit code ${result.code}`)
    }
  }
}

module.exports = (configuration) => {
  const task = queue.then(() => signOne(configuration))
  queue = task.catch(() => {})
  return task
}

// For tests: the gate without the network.
module.exports._waitForFreshStep = waitForFreshStep
module.exports._jsignArgs = jsignArgs
module.exports._reset = () => { lastStep = -1 }
