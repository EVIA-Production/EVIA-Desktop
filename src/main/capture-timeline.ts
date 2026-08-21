export type CaptureSource = 'mic' | 'system'

export type AudioChunkMetadata = {
  schema_version: 1
  capture_session_id: string
  capture_generation: number
  source: CaptureSource
  chunk_seq: number
  capture_start_ms: number
  capture_end_ms: number
  session_epoch_ms: number
  sample_rate: number
  channel_count: number
  bytes_per_sample: number
  sample_count: number
  byte_length: number
}

export type AudioChunkMetaControlEnvelope = AudioChunkMetadata & {
  command: 'audio_chunk_meta'
}

export type CaptureSessionTimelineOptions = {
  id?: string
  generation: number
  epochUnixMs?: number
  originPerformanceMs?: number
  maxPtsAgeMs?: number
  maxFuturePtsSkewMs?: number
  maxClockDomainSkewMs?: number
  maxCaptureClockJitterMs?: number
}

export type PcmChunkShape = {
  sampleRate: number
  byteLength: number
  channelCount?: number
  bytesPerSample?: number
}

export type MonotonicAudioChunk = PcmChunkShape & {
  source: CaptureSource
  startPerformanceMs: number
  endPerformanceMs: number
}

export type SystemEpochPtsAudioChunk = PcmChunkShape & {
  capturedAtUnixMs: number
  observedAtUnixMs: number
  observedAtPerformanceMs: number
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAMPLE_DURATION_EPSILON_MS = 0.001
// Jitter this far back is CLAMPED, not dropped.
//
// The old value was 10 ms, on the belief that ScreenCaptureKit jitter sits
// "just above 5ms". Measured on a real machine 2026-08-22: 24 rejections in a
// single session, backwards movement of 5 / 10 / 15 / 18 / 27 / 46.8 ms -
// median 10.0, exactly on the threshold. Every rejection threw away a chunk of
// the PROSPECT's voice, and the mic side had none, so the loss was one-sided.
//
// The consequences are visible in the same log: the AEC reference reads
// -120 dBFS (digital silence) with "REFERENCE UNRELATED TO MIC", because the
// far-end audio it needs kept being discarded.
//
// Real callback jitter is not a clock reversal and must never cost audio. The
// existing clamp - start the interval at the previous end - already handles it
// correctly; it was simply gated too tightly. 250 ms matches
// maxClockDomainSkewMs and still catches a genuine reset, which is the only
// thing worth throwing for.
const DEFAULT_MAX_CAPTURE_CLOCK_JITTER_MS = 250

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and nonnegative`)
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
}

function assertSessionId(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new TypeError('capture session id must be a UUID')
  }
}

function normalizeChunkShape(shape: PcmChunkShape): {
  sampleRate: number
  byteLength: number
  channelCount: number
  bytesPerSample: number
  sampleCount: number
  durationMs: number
} {
  const channelCount = shape.channelCount ?? 1
  const bytesPerSample = shape.bytesPerSample ?? 2

  assertPositiveInteger('sampleRate', shape.sampleRate)
  assertPositiveInteger('byteLength', shape.byteLength)
  assertPositiveInteger('channelCount', channelCount)
  assertPositiveInteger('bytesPerSample', bytesPerSample)

  const bytesPerFrame = channelCount * bytesPerSample
  if (shape.byteLength % bytesPerFrame !== 0) {
    throw new RangeError('byteLength must contain an exact number of PCM frames')
  }

  const sampleCount = shape.byteLength / bytesPerFrame
  const durationMs = (sampleCount * 1_000) / shape.sampleRate
  assertFiniteNonNegative('durationMs', durationMs)

  return {
    sampleRate: shape.sampleRate,
    byteLength: shape.byteLength,
    channelCount,
    bytesPerSample,
    sampleCount,
    durationMs,
  }
}

/**
 * One clock domain and identity for a single physical capture generation.
 *
 * Chunks from different sources may overlap, but each source must advance
 * chronologically. Capture APIs report timestamps through clock conversions
 * that can jitter by a few milliseconds, so a small overlap is snapped to the
 * previous boundary. Larger reversals fail closed instead of relabelling
 * out-of-order audio as chronological.
 */
export class CaptureSessionTimeline {
  readonly id: string
  readonly generation: number
  readonly epochUnixMs: number
  readonly originPerformanceMs: number

  private readonly maxPtsAgeMs: number
  private readonly maxFuturePtsSkewMs: number
  private readonly maxClockDomainSkewMs: number
  private readonly maxCaptureClockJitterMs: number
  private readonly nextSequence: Record<CaptureSource, number> = {
    mic: 0,
    system: 0,
  }
  private readonly lastCaptureEndMs: Record<CaptureSource, number | null> = {
    mic: null,
    system: null,
  }

  constructor(options: CaptureSessionTimelineOptions) {
    const hasEpoch = options.epochUnixMs !== undefined
    const hasOrigin = options.originPerformanceMs !== undefined
    if (hasEpoch !== hasOrigin) {
      throw new TypeError('epochUnixMs and originPerformanceMs must be supplied together')
    }

    const sampledOrigin = hasOrigin ? options.originPerformanceMs! : globalThis.performance.now()
    const sampledEpoch = hasEpoch ? options.epochUnixMs! : Date.now()

    this.id = options.id ?? globalThis.crypto.randomUUID()
    this.generation = options.generation
    this.epochUnixMs = sampledEpoch
    this.originPerformanceMs = sampledOrigin
    this.maxPtsAgeMs = options.maxPtsAgeMs ?? 10_000
    this.maxFuturePtsSkewMs = options.maxFuturePtsSkewMs ?? 100
    this.maxClockDomainSkewMs = options.maxClockDomainSkewMs ?? 250
    this.maxCaptureClockJitterMs =
      options.maxCaptureClockJitterMs ?? DEFAULT_MAX_CAPTURE_CLOCK_JITTER_MS

    assertSessionId(this.id)
    if (!Number.isSafeInteger(this.generation) || this.generation < 0) {
      throw new RangeError('generation must be a nonnegative safe integer')
    }
    assertFiniteNonNegative('epochUnixMs', this.epochUnixMs)
    assertFiniteNonNegative('originPerformanceMs', this.originPerformanceMs)
    assertFiniteNonNegative('maxPtsAgeMs', this.maxPtsAgeMs)
    assertFiniteNonNegative('maxFuturePtsSkewMs', this.maxFuturePtsSkewMs)
    assertFiniteNonNegative('maxClockDomainSkewMs', this.maxClockDomainSkewMs)
    assertFiniteNonNegative('maxCaptureClockJitterMs', this.maxCaptureClockJitterMs)
  }

  createFromMonotonicInterval(chunk: MonotonicAudioChunk): AudioChunkMetadata {
    assertFiniteNonNegative('startPerformanceMs', chunk.startPerformanceMs)
    assertFiniteNonNegative('endPerformanceMs', chunk.endPerformanceMs)
    if (chunk.endPerformanceMs < chunk.startPerformanceMs) {
      throw new RangeError('endPerformanceMs must not precede startPerformanceMs')
    }

    const shape = normalizeChunkShape(chunk)
    const intervalDurationMs = chunk.endPerformanceMs - chunk.startPerformanceMs
    if (Math.abs(intervalDurationMs - shape.durationMs) > SAMPLE_DURATION_EPSILON_MS) {
      throw new RangeError('monotonic interval does not exactly match PCM duration')
    }

    return this.createMetadata(
      chunk.source,
      chunk.startPerformanceMs - this.originPerformanceMs,
      chunk.endPerformanceMs - this.originPerformanceMs,
      shape,
    )
  }

  createSystemFromEpochPts(chunk: SystemEpochPtsAudioChunk): AudioChunkMetadata {
    assertFiniteNonNegative('capturedAtUnixMs', chunk.capturedAtUnixMs)
    assertFiniteNonNegative('observedAtUnixMs', chunk.observedAtUnixMs)
    assertFiniteNonNegative('observedAtPerformanceMs', chunk.observedAtPerformanceMs)

    const observedUnixRelativeMs = chunk.observedAtUnixMs - this.epochUnixMs
    const observedMonotonicRelativeMs =
      chunk.observedAtPerformanceMs - this.originPerformanceMs
    if (observedUnixRelativeMs < 0 || observedMonotonicRelativeMs < 0) {
      throw new RangeError('observation predates the capture session')
    }
    if (
      Math.abs(observedUnixRelativeMs - observedMonotonicRelativeMs) >
      this.maxClockDomainSkewMs
    ) {
      throw new RangeError('Unix and monotonic observations are from foreign clock domains')
    }

    const ptsAgeMs = chunk.observedAtUnixMs - chunk.capturedAtUnixMs
    if (ptsAgeMs > this.maxPtsAgeMs || ptsAgeMs < -this.maxFuturePtsSkewMs) {
      throw new RangeError('system PTS has an implausible age')
    }

    const captureStartMs = chunk.capturedAtUnixMs - this.epochUnixMs
    const shape = normalizeChunkShape(chunk)
    return this.createMetadata(
      'system',
      captureStartMs,
      captureStartMs + shape.durationMs,
      shape,
    )
  }

  private createMetadata(
    source: CaptureSource,
    captureStartMs: number,
    captureEndMs: number,
    shape: ReturnType<typeof normalizeChunkShape>,
  ): AudioChunkMetadata {
    assertFiniteNonNegative('captureStartMs', captureStartMs)
    assertFiniteNonNegative('captureEndMs', captureEndMs)
    if (captureEndMs < captureStartMs) {
      throw new RangeError('captureEndMs must not precede captureStartMs')
    }

    const previousEndMs = this.lastCaptureEndMs[source]
    let normalizedStartMs = captureStartMs
    if (previousEndMs !== null && captureStartMs < previousEndMs) {
      const overlapMs = previousEndMs - captureStartMs
      if (overlapMs > this.maxCaptureClockJitterMs) {
        throw new RangeError(
          `${source} capture interval moved backwards by ${overlapMs.toFixed(3)}ms`,
        )
      }
      normalizedStartMs = previousEndMs
    }
    const normalizedEndMs = normalizedStartMs + shape.durationMs

    const metadata: AudioChunkMetadata = {
      schema_version: 1,
      capture_session_id: this.id,
      capture_generation: this.generation,
      source,
      chunk_seq: this.nextSequence[source],
      capture_start_ms: normalizedStartMs,
      capture_end_ms: normalizedEndMs,
      session_epoch_ms: this.epochUnixMs,
      sample_rate: shape.sampleRate,
      channel_count: shape.channelCount,
      bytes_per_sample: shape.bytesPerSample,
      sample_count: shape.sampleCount,
      byte_length: shape.byteLength,
    }

    this.nextSequence[source] += 1
    this.lastCaptureEndMs[source] = normalizedEndMs
    return metadata
  }
}

export function createAudioChunkMetaControlEnvelope(
  metadata: AudioChunkMetadata,
): AudioChunkMetaControlEnvelope {
  return { command: 'audio_chunk_meta', ...metadata }
}

export function serializeAudioChunkMetaControlEnvelope(metadata: AudioChunkMetadata): string {
  return JSON.stringify(createAudioChunkMetaControlEnvelope(metadata))
}
