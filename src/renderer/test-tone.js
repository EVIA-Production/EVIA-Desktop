// Test tone generator for EVIA
// Creates a 16kHz PCM16 mono sine wave for testing

/**
 * Generate a sine wave test tone as PCM16 mono at 16kHz
 * @param {number} frequency - Frequency in Hz
 * @param {number} durationMs - Duration in milliseconds
 * @returns {ArrayBuffer} - PCM16 buffer with the test tone
 */
function generateTestTone(frequency = 1000, durationMs = 200) {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const buffer = new Int16Array(numSamples);
  
  // Generate sine wave
  for (let i = 0; i < numSamples; i++) {
    // Amplitude: 0.5 of max (to avoid clipping)
    const amplitude = 0.5 * 32767;
    buffer[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
  }
  
  return buffer.buffer;
}

// Export for use in main.ts
export { generateTestTone };
