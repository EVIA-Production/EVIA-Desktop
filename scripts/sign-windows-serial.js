const { spawn } = require('child_process')

const primaryTimestamp = 'http://timestamp.digicert.com'
const fallbackTimestamp = 'http://time.certum.pl'
const retryDelaysMs = [1500, 3000, 6000, 10000]

let signingQueue = Promise.resolve()

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function runSignTool(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''

    const forward = (stream, destination) => {
      stream.on('data', chunk => {
        const text = chunk.toString()
        output += text
        destination.write(text)
      })
    }
    forward(child.stdout, process.stdout)
    forward(child.stderr, process.stderr)
    child.once('error', reject)
    child.once('close', code => resolve({ code, output }))
  })
}

function withTimestamp(args, timestampUrl) {
  const next = [...args]
  const timestampIndex = next.findIndex(value => value === '/tr' || value === '/t')
  if (timestampIndex !== -1 && timestampIndex + 1 < next.length) {
    next[timestampIndex + 1] = timestampUrl
  }
  return next
}

function isTransientSigningFailure(output) {
  return /0x80090020|SignerSign\(\) failed|unexpected internal error|timestamp|timed?\s*out|connection/i.test(output)
}

async function signOne(configuration) {
  const signTool = process.env.SIGNTOOL_PATH
  if (!signTool) throw new Error('SIGNTOOL_PATH is required for serialized Windows signing')

  const baseArgs = configuration.computeSignToolArgs(true)
  const target = configuration.path
  const attempts = retryDelaysMs.length + 1

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timestamp = attempt === attempts ? fallbackTimestamp : primaryTimestamp
    const args = withTimestamp(baseArgs, timestamp)
    process.stdout.write(
      `[windows-sign] ${attempt}/${attempts} ${target} (${timestamp})\n`,
    )
    const result = await runSignTool(signTool, args)
    if (result.code === 0) return

    const transient = isTransientSigningFailure(result.output)
    if (!transient || attempt === attempts) {
      throw new Error(
        `SignTool failed for ${target} with exit code ${result.code}`,
      )
    }
    await delay(retryDelaysMs[attempt - 1])
  }
}

module.exports = configuration => {
  const task = signingQueue.then(() => signOne(configuration))
  signingQueue = task.catch(() => {})
  return task
}
