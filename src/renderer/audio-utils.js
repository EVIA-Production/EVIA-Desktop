// Audio utilities for Taylos

/**
 * Calculate the RMS (Root Mean Square) value of an audio buffer
 * @param {Float32Array|Int16Array} buffer - Audio buffer (Float32Array for raw audio, Int16Array for PCM16)
 * @returns {number} - RMS value between 0 and 1
 */
function calculateRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    // Normalize to -1..1 range if Int16Array
    const sample = buffer instanceof Int16Array ? buffer[i] / 32768.0 : buffer[i];
    sum += sample * sample;
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * Downsample audio using linear interpolation
 * @param {Float32Array} input - Input audio buffer
 * @param {number} inputRate - Input sample rate
 * @param {number} outputRate - Output sample rate
 * @returns {Float32Array} - Downsampled audio buffer
 */
function downsampleLinear(input, inputRate, outputRate) {
  if (outputRate === inputRate) return input;
  const ratio = inputRate / outputRate;
  const newLength = Math.floor(input.length / ratio);
  const output = new Float32Array(newLength);
  
  for (let i = 0; i < newLength; i++) {
    const srcPos = i * ratio;
    const srcIndex = Math.floor(srcPos);
    const fraction = srcPos - srcIndex;
    
    // Linear interpolation between samples
    if (srcIndex + 1 < input.length) {
      output[i] = input[srcIndex] * (1 - fraction) + input[srcIndex + 1] * fraction;
    } else {
      output[i] = input[srcIndex];
    }
  }
  
  return output;
}

/**
 * Convert Float32Array to Int16Array for PCM16 output
 * @param {Float32Array} input - Float32Array with values between -1 and 1
 * @returns {Int16Array} - Int16Array with values between -32768 and 32767
 */
function floatTo16BitPCM(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    // Clamp to -1..1 range
    const s = Math.max(-1, Math.min(1, input[i]));
    // Convert to 16-bit PCM (different scaling for negative vs positive to match standard PCM16 behavior)
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output;
}

/**
 * Create a Butterworth low-pass filter
 * @param {AudioContext} audioContext - Web Audio API context
 * @param {number} cutoffFreq - Cutoff frequency in Hz
 * @returns {BiquadFilterNode} - Configured filter node
 */
function createLowPassFilter(audioContext, cutoffFreq) {
  const filter = audioContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoffFreq;
  filter.Q.value = 0.7071; // Butterworth response (1/sqrt(2))
  return filter;
}

/**
 * Apply a soft limiter to avoid clipping
 * @param {Float32Array} buffer - Audio buffer to process
 * @param {number} gain - Gain to apply before limiting
 * @returns {Float32Array} - Processed buffer
 */
function applySoftLimiter(buffer, gain = 1.0) {
  const output = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    // Apply gain
    const amplified = buffer[i] * gain;
    // Soft limiting using tanh (smoother than hard clipping)
    output[i] = Math.tanh(amplified * 0.8) * 1.2;
  }
  return output;
}

// Export utilities
export {
  calculateRMS,
  downsampleLinear,
  floatTo16BitPCM,
  createLowPassFilter,
  applySoftLimiter
};
