// AudioWorklet processor for audio filtering and resampling
// This provides more stable processing than OfflineAudioContext

class AudioProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'cutoff',
        defaultValue: 12000, // Half of output sample rate (24kHz)
        minValue: 3000,
        maxValue: 20000,
        automationRate: 'k-rate'
      },
      {
        name: 'q',
        defaultValue: 0.7071, // Butterworth response
        minValue: 0.1,
        maxValue: 10.0,
        automationRate: 'k-rate'
      }
    ];
  }

  constructor() {
    super();
    // Initialize lowpass filter coefficients
    this.biquadCoeffs = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 };
    this.x1 = 0; this.x2 = 0; // Input history
    this.y1 = 0; this.y2 = 0; // Output history
    
    // For resampling
    this.resampleRatio = 1.0;
    this.resampleBuffer = new Float32Array(128);
    this.resamplePos = 0;
    
    // For consistent chunk sizes
    this.accumulatedSamples = new Float32Array(0);
    this.targetChunkSize = 2400; // 100ms at 24kHz
    
    this.port.onmessage = (e) => {
      if (e.data.type === 'setResampleRatio') {
        this.resampleRatio = e.data.ratio;
        console.log(`Resampling ratio set to ${this.resampleRatio}`);
      } else if (e.data.type === 'setTargetChunkSize') {
        this.targetChunkSize = e.data.size;
        console.log(`Target chunk size set to ${this.targetChunkSize}`);
      }
    };
    
    // Update filter coefficients for default params
    this.updateFilterCoefficients(44100, 12000, 0.7071);
    
    console.log('AudioProcessor initialized');
  }
  
  updateFilterCoefficients(sampleRate, cutoff, q) {
    // Calculate normalized frequency
    const omega = 2 * Math.PI * cutoff / sampleRate;
    const alpha = Math.sin(omega) / (2 * q);
    const cosw = Math.cos(omega);
    
    // Biquad lowpass filter coefficients (Direct Form I)
    const b0 = (1 - cosw) / 2;
    const b1 = 1 - cosw;
    const b2 = (1 - cosw) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw;
    const a2 = 1 - alpha;
    
    // Normalize by a0
    this.biquadCoeffs = {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0
    };
  }
  
  // Apply biquad filter to a single sample
  applyFilter(x) {
    const { b0, b1, b2, a1, a2 } = this.biquadCoeffs;
    
    // Direct Form I implementation
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    
    // Update state
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    
    return y;
  }
  
  // Linear interpolation resampler
  resample(inputBuffer, ratio) {
    if (ratio === 1.0) return inputBuffer;
    
    const outputLength = Math.floor(inputBuffer.length / ratio);
    const output = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const srcPos = i * ratio;
      const srcIdx = Math.floor(srcPos);
      const frac = srcPos - srcIdx;
      
      // Linear interpolation
      if (srcIdx + 1 < inputBuffer.length) {
        output[i] = inputBuffer[srcIdx] * (1 - frac) + inputBuffer[srcIdx + 1] * frac;
      } else {
        output[i] = inputBuffer[srcIdx];
      }
    }
    
    return output;
  }

  process(inputs, outputs, parameters) {
    // Get parameters (may be arrays if automationRate is 'a-rate')
    const cutoff = parameters.cutoff[0];
    const q = parameters.q[0];
    
    // Update filter coefficients
    this.updateFilterCoefficients(sampleRate, cutoff, q);
    
    // Get input and output
    const input = inputs[0];
    const output = outputs[0];
    
    // Process if we have input data
    if (input.length > 0) {
      const inChannel = input[0];
      const outChannel = output[0];
      
      // Apply filter to each sample
      for (let i = 0; i < inChannel.length; i++) {
        outChannel[i] = this.applyFilter(inChannel[i]);
      }
      
      // Accumulate filtered samples
      const newLength = this.accumulatedSamples.length + outChannel.length;
      const newAccumulated = new Float32Array(newLength);
      newAccumulated.set(this.accumulatedSamples);
      newAccumulated.set(outChannel, this.accumulatedSamples.length);
      this.accumulatedSamples = newAccumulated;
      
      // Extract complete chunks and send them
      while (this.accumulatedSamples.length >= this.targetChunkSize) {
        // Extract a chunk
        const chunk = this.accumulatedSamples.slice(0, this.targetChunkSize);
        
        // Remove the extracted chunk from accumulated samples
        this.accumulatedSamples = this.accumulatedSamples.slice(this.targetChunkSize);
        
        // Apply resampling if needed
        const processedChunk = this.resampleRatio !== 1.0 
          ? this.resample(chunk, this.resampleRatio) 
          : chunk;
        
        // Send the chunk
        this.port.postMessage({
          type: 'processedChunk',
          buffer: processedChunk,
          sampleCount: this.targetChunkSize
        });
      }
    }
    
    // Return true to keep the processor alive
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);