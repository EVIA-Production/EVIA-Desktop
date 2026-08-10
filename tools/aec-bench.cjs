/**
 * Drive the real Speex canceller against a synthetic echo, offline and silent.
 *
 * The live telemetry can say the canceller is doing nothing, but it cannot say
 * WHY: a filter that never converges and a filter fed a misaligned reference
 * look identical from outside. This removes every unknown except the canceller
 * itself - the echo path is constructed, so the correct answer is known exactly.
 *
 * If ERLE is high here, the canceller works and any live failure is alignment.
 * If it is ~0dB here, the Speex integration is broken and no alignment fix
 * would ever have helped.
 */
const createAec = require('../src/renderer/aec/aec.js')
const { requiredFilterSamples, AEC_SAMPLE_RATE } = require('../dist/main/aec-reference.js')

const RATE = AEC_SAMPLE_RATE      // 24000
const FRAME = 160                 // Speex frame, as the pipeline uses
const SECONDS = 12

// Speech-like: a few formants with an amplitude envelope, so the filter has
// realistic spectral content rather than white noise it can trivially fit.
function voice(n, seed, f0) {
  const out = new Float32Array(n)
  let s = seed
  for (let i = 0; i < n; i += 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const t = i / RATE
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.7 * t + seed)
    out[i] = env * (
      0.6 * Math.sin(2 * Math.PI * f0 * t) +
      0.3 * Math.sin(2 * Math.PI * f0 * 2.4 * t) +
      0.1 * ((s / 0x7fffffff) * 2 - 1)
    ) * 0.4
  }
  return out
}

/** Echo: far end delayed, attenuated, with a short reverb tail. */
function echoOf(far, delaySamples, gain) {
  const out = new Float32Array(far.length)
  const taps = [[0, 1], [Math.round(RATE * 0.013), 0.35], [Math.round(RATE * 0.031), 0.18],
                [Math.round(RATE * 0.055), 0.09]]
  for (const [off, a] of taps) {
    for (let i = delaySamples + off; i < far.length; i += 1) {
      out[i] += far[i - delaySamples - off] * gain * a
    }
  }
  return out
}

const energy = (a, from = 0) => {
  let s = 0
  for (let i = from; i < a.length; i += 1) s += a[i] * a[i]
  return s / Math.max(1, a.length - from)
}
const db = (x) => 10 * Math.log10(Math.max(x, 1e-12))

async function run({ delayMs, filterSamples, label }) {
  const M = await createAec()
  const cancel = M.cwrap('AecCancelEcho', null, ['number','number','number','number','number'])
  const ptr = M._AecNew(FRAME, filterSamples, RATE, 1)
  if (!ptr) throw new Error('AecNew failed')

  const n = SECONDS * RATE
  const far = voice(n, 1, 130)                                  // the prospect
  const near = voice(n, 7, 210)                                 // the rep
  const echo = echoOf(far, Math.round((delayMs / 1000) * RATE), 0.14)
  const mic = Float32Array.from(near, (v, i) => v + echo[i])

  const out = new Float32Array(n)
  const micPtr = M._malloc(FRAME * 2), refPtr = M._malloc(FRAME * 2), outPtr = M._malloc(FRAME * 2)
  const toI16 = (src, off, p) => {
    const h = new Int16Array(M.HEAP16.buffer, p, FRAME)
    for (let i = 0; i < FRAME; i += 1) h[i] = Math.max(-32768, Math.min(32767, (src[off + i] || 0) * 32767))
  }
  for (let off = 0; off + FRAME <= n; off += FRAME) {
    toI16(mic, off, micPtr); toI16(far, off, refPtr)
    cancel(ptr, micPtr, refPtr, outPtr, FRAME)
    const h = new Int16Array(M.HEAP16.buffer, outPtr, FRAME)
    for (let i = 0; i < FRAME; i += 1) out[off + i] = h[i] / 32768
  }
  M._AecDestroy(ptr)

  // Judge on the last third, after the filter has had time to converge.
  const from = Math.floor(n * 2 / 3)
  const echoBefore = db(energy(echo, from))
  // Residual echo = output minus the near end we know we put in.
  const residual = Float32Array.from(out, (v, i) => v - near[i])
  const echoAfter = db(energy(residual, from))
  const nearKept = db(energy(out, from)) - db(energy(near, from))

  console.log(
    `${label.padEnd(28)} echo ${echoBefore.toFixed(1)} -> ${echoAfter.toFixed(1)} dB ` +
    `(ERLE ${(echoBefore - echoAfter).toFixed(1)} dB)  near-end change ${nearKept >= 0 ? '+' : ''}${nearKept.toFixed(1)} dB`,
  )
  return echoBefore - echoAfter
}

;(async () => {
  const full = requiredFilterSamples()
  console.log(`filter = ${full} taps (${((full / RATE) * 1000).toFixed(0)}ms), frame = ${FRAME}\n`)
  const erle = []
  erle.push(await run({ delayMs: 60, filterSamples: full, label: '60ms delay, full filter' }))
  erle.push(await run({ delayMs: 0,  filterSamples: full, label: '0ms delay, full filter' }))
  erle.push(await run({ delayMs: 150, filterSamples: full, label: '150ms delay, full filter' }))
  await run({ delayMs: 60, filterSamples: 1600, label: '60ms delay, OLD 1600 taps' })
  console.log(`\nbest ERLE at the measured 60ms path: ${erle[0].toFixed(1)} dB`)
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
