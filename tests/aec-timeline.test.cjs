// Reproduce the live timing offline, because the live symptom is unexplained:
//
//   ref=-120dBFS  refGap=0%   REFERENCE SILENT - window filled, but with no audio
//
// refGap=0% says every requested position was inside the written range, yet the
// samples came back as digital silence. Those two facts cannot both be true if
// the ring is being read where the audio is. One of the assumptions in the
// timeline must be wrong, so rebuild the timeline exactly and find out which.
//
// From the session log: the mic handler registers first, and the macOS helper
// reports "Native capture ready after 409ms".

const assert = require('node:assert/strict')
const test = require('node:test')

const { ReferenceRing, AEC_SAMPLE_RATE } = require('../dist/main/aec-reference.js')

const RATE = AEC_SAMPLE_RATE          // 24000
const MIC_CHUNK = 2400                // 100ms, the pipeline's chunk
const RESERVE_CHUNKS = 2              // held back so the reference has arrived
const SYS_CHUNK = 480                 // 20ms, ~50 chunks/sec as logged
const SYSTEM_START_DELAY_MS = 409     // measured

// Non-zero everywhere, so any silence in a read is the ring's doing.
const audible = (start, length) =>
  Float32Array.from({ length }, (_, i) => 0.5 + ((start + i) % 100) / 1000)

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length))

function runSession(seconds) {
  const ring = new ReferenceRing()
  const T0 = 1_000_000

  // System audio starts late and then runs in real time.
  let written = 0
  const sysEvents = []
  for (let t = SYSTEM_START_DELAY_MS; t < seconds * 1000; t += (SYS_CHUNK / RATE) * 1000) {
    sysEvents.push({ at: t, start: written })
    written += SYS_CHUNK
  }

  // Mic runs from zero, cutting a chunk every 100ms.
  // The pipeline holds RESERVE_CHUNKS behind before cutting, so a chunk is
  // processed only once that much further audio exists. Its labelled capture
  // time is unchanged - only when it is handled moves.
  const reserveMs = (MIC_CHUNK / RATE) * 1000 * RESERVE_CHUNKS
  const micEvents = []
  let consumed = 0
  for (let t = 0; t < seconds * 1000; t += (MIC_CHUNK / RATE) * 1000) {
    micEvents.push({ at: t + reserveMs, consumed })
    consumed += MIC_CHUNK
  }

  // Interleave in real time, exactly as the two callbacks would fire.
  const all = [...sysEvents.map((e) => ({ ...e, kind: 'sys' })),
               ...micEvents.map((e) => ({ ...e, kind: 'mic' }))]
    .sort((a, b) => a.at - b.at)

  let micOriginMs = null
  const reads = []
  for (const event of all) {
    if (event.kind === 'sys') {
      ring.write(audible(event.start, SYS_CHUNK), T0 + event.at)
    } else {
      // The pipeline derives the origin by subtracting the audio still pending
      // when a chunk is cut, which with the reserve in place is the reserve
      // itself. Model that, or the origin lands a reserve too late.
      if (micOriginMs === null) micOriginMs = T0 + event.at - reserveMs
      const micChunkStartedAtMs = micOriginMs + (event.consumed / RATE) * 1000
      const { samples, missingSamples } = ring.referenceFor(micChunkStartedAtMs, MIC_CHUNK)
      reads.push({ atMs: event.at, rms: rms(samples), missingSamples })
    }
  }
  return reads
}

test('the live symptom reproduces: silent reference with no reported gap', () => {
  const reads = runSession(20)
  // Ignore the opening second, where the system genuinely has not started.
  const settled = reads.filter((r) => r.atMs > 1500)
  const silentWithoutGap = settled.filter((r) => r.rms < 1e-6 && r.missingSamples === 0)

  console.log(`    settled reads: ${settled.length}`)
  console.log(`    silent yet refGap=0: ${silentWithoutGap.length}`)
  console.log(`    first few:`, settled.slice(0, 3).map(
    (r) => `t=${r.atMs.toFixed(0)}ms rms=${r.rms.toFixed(4)} missing=${r.missingSamples}`))

  assert.equal(
    silentWithoutGap.length, 0,
    `${silentWithoutGap.length} reads returned digital silence while reporting no gap - ` +
    `this is the live failure, reproduced offline`,
  )
})

test('every settled read returns the audio actually written', () => {
  const reads = runSession(20).filter((r) => r.atMs > 1500)
  const bad = reads.filter((r) => r.rms < 0.4)
  assert.equal(bad.length, 0, `${bad.length}/${reads.length} reads were not real audio`)
})
