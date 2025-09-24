// AudioWorklet global scope
class AudioProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'cutoff', defaultValue: 12000, minValue: 3000, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'q', defaultValue: 0.7071, minValue: 0.1, maxValue: 10.0, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    this.biquadCoeffs = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 }
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0
    this.resampleRatio = 1.0
    this.accumulatedSamples = new Float32Array(0)
    this.targetChunkSize = 2400
    this.updateFilterCoefficients(sampleRate, 12000, 0.7071)
    this.port.onmessage = (e) => {
      if (e.data?.type === 'setResampleRatio') this.resampleRatio = e.data.ratio
      else if (e.data?.type === 'setTargetChunkSize') this.targetChunkSize = e.data.size
    }
  }
  updateFilterCoefficients(sampleRate, cutoff, q) {
    const omega = 2 * Math.PI * cutoff / sampleRate
    const alpha = Math.sin(omega) / (2 * q)
    const cosw = Math.cos(omega)
    const b0 = (1 - cosw) / 2
    const b1 = 1 - cosw
    const b2 = (1 - cosw) / 2
    const a0 = 1 + alpha
    const a1 = -2 * cosw
    const a2 = 1 - alpha
    this.biquadCoeffs = { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
  }
  applyFilter(x) {
    const { b0, b1, b2, a1, a2 } = this.biquadCoeffs
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y
    return y
  }
  resample(inputBuffer, ratio) {
    if (ratio === 1.0) return inputBuffer
    const outputLength = Math.floor(inputBuffer.length / ratio)
    const output = new Float32Array(outputLength)
    for (let i = 0; i < outputLength; i++) {
      const srcPos = i * ratio
      const srcIdx = Math.floor(srcPos)
      const frac = srcPos - srcIdx
      output[i] = inputBuffer[srcIdx + 1] !== undefined
        ? inputBuffer[srcIdx] * (1 - frac) + inputBuffer[srcIdx + 1] * frac
        : inputBuffer[srcIdx]
    }
    return output
  }
  process(inputs, outputs, parameters) {
    const cutoff = parameters.cutoff[0]
    const q = parameters.q[0]
    this.updateFilterCoefficients(sampleRate, cutoff, q)
    if (inputs.length >= 1) { // At least mic
      const micChannel = inputs[0][0] || new Float32Array(128)
      const systemChannel = inputs.length > 1 ? inputs[1][0] : new Float32Array(micChannel.length)
      
      // Basic AEC: subtract system from mic
      const aecChannel = new Float32Array(micChannel.length)
      for (let i = 0; i < micChannel.length; i++) {
        aecChannel[i] = micChannel[i] - (systemChannel[i] * 0.8) // Gain adjust
      }
      
      // Apply filter
      const outChannel = outputs[0][0]
      for (let i = 0; i < aecChannel.length; i++) outChannel[i] = this.applyFilter(aecChannel[i])
      
      // Accumulate ...
      const newAccum = new Float32Array(this.accumulatedSamples.length + outChannel.length)
      newAccum.set(this.accumulatedSamples)
      newAccum.set(outChannel, this.accumulatedSamples.length)
      this.accumulatedSamples = newAccum
      while (this.accumulatedSamples.length >= this.targetChunkSize) {
        const chunk = this.accumulatedSamples.slice(0, this.targetChunkSize)
        this.accumulatedSamples = this.accumulatedSamples.slice(this.targetChunkSize)
        const processed = this.resampleRatio !== 1.0 ? this.resample(chunk, this.resampleRatio) : chunk
        this.port.postMessage({ type: 'processedChunk', buffer: processed, sampleCount: this.targetChunkSize }, [])
      }
    }
    return true
  }
}

registerProcessor('audio-processor', AudioProcessor)


