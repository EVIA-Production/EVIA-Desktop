/**
 * Audio Buffer Manager for Taylos Desktop
 * Handles accumulation and processing of audio chunks
 */

// Constants
const SAMPLE_RATE = 16000; // Target sample rate for Deepgram, matching web app
const AUDIO_CHUNK_DURATION = 0.1; // 100ms chunks
const SAMPLES_PER_CHUNK = SAMPLE_RATE * AUDIO_CHUNK_DURATION; // 1600 samples per chunk

/**
 * Manages audio buffer accumulation to ensure consistent chunk sizes
 */
class AudioBufferManager {
  constructor(targetSampleRate = SAMPLE_RATE, targetChunkDuration = AUDIO_CHUNK_DURATION) {
    this.targetSampleRate = targetSampleRate;
    this.targetChunkDuration = targetChunkDuration;
    this.targetChunkSize = Math.floor(targetSampleRate * targetChunkDuration);
    this.buffer = [];
    this.maxBufferSamples = this.targetSampleRate * 12; // cap at ~12 seconds to avoid stalls
    this.debugMode = true; // Enable debug mode by default
    
    // Store the last few seconds of audio for diagnostic purposes
    this.recentSamples = new Float32Array(targetSampleRate * 10); // 10 seconds of audio
    this.recentSamplesIndex = 0;
    
    console.log(`[BufferManager] Initialized with target chunk size: ${this.targetChunkSize}`);
  }

  /**
   * Enable or disable debug mode
   * @param {boolean} enabled - Whether to enable debug mode
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
  }

  /**
   * Add audio samples to the buffer
   * @param {Float32Array} samples - Audio samples to add
   * @param {number} sampleRate - Sample rate of the input samples
   * @returns {boolean} - Whether the buffer now has enough samples for a chunk
   */
  addSamples(samples, sampleRate) {
    // Add all samples to the buffer
    for (let i = 0; i < samples.length; i++) {
      this.buffer.push(samples[i]);
      
      // Also add to recent samples buffer (circular)
      this.recentSamples[this.recentSamplesIndex] = samples[i];
      this.recentSamplesIndex = (this.recentSamplesIndex + 1) % this.recentSamples.length;
    }

    // Calculate how many samples we need for a complete chunk
    const samplesNeeded = this.getSamplesNeededForChunk(sampleRate);
    
    if (this.debugMode) {
      console.log(`[BufferManager] Added ${samples.length} samples, buffer now has ${this.buffer.length}/${samplesNeeded} samples`);
    }

    if (this.buffer.length > this.maxBufferSamples) {
      const excess = this.buffer.length - this.maxBufferSamples;
      this.buffer.splice(0, excess);
      if (this.debugMode) {
        console.warn(`[BufferManager] Buffer exceeded max size, trimmed ${excess} samples to prevent stalls`);
      }
    }
    
    return this.buffer.length >= samplesNeeded;
  }

  /**
   * Get the number of samples needed for a complete chunk at the given sample rate
   * @param {number} sampleRate - Sample rate of the input
   * @returns {number} - Number of samples needed
   */
  getSamplesNeededForChunk(sampleRate) {
    // Calculate how many samples at the input sample rate are needed
    // to produce a chunk of the target size after resampling
    return Math.ceil(this.targetChunkSize * (sampleRate / this.targetSampleRate));
  }

  /**
   * Extract a complete chunk from the buffer if available
   * @param {number} sampleRate - Sample rate of the input
   * @returns {Float32Array|null} - A chunk of audio or null if not enough samples
   */
  extractChunk(sampleRate) {
    const samplesNeeded = this.getSamplesNeededForChunk(sampleRate);
    
    if (this.buffer.length >= samplesNeeded) {
      // Extract exactly the number of samples needed for a chunk
      const chunkSamples = this.buffer.splice(0, samplesNeeded);
      const chunk = new Float32Array(chunkSamples);
      
      if (this.debugMode) {
        console.log(`[BufferManager] Extracted chunk with ${chunk.length} samples, ${this.buffer.length} samples remaining`);
      }
      
      return chunk;
    }
    
    return null;
  }
  
  /**
   * Get the last N seconds of audio from the recent samples buffer
   * @param {number} seconds - Number of seconds to retrieve
   * @returns {Float32Array} - Audio samples
   */
  getLastNSeconds(seconds) {
    const numSamples = Math.min(this.targetSampleRate * seconds, this.recentSamples.length);
    const result = new Float32Array(numSamples);
    
    // Copy from the circular buffer, starting from the current position and wrapping around
    for (let i = 0; i < numSamples; i++) {
      const index = (this.recentSamplesIndex - numSamples + i + this.recentSamples.length) % this.recentSamples.length;
      result[i] = this.recentSamples[index];
    }
    
    return result;
  }
  
  /**
   * Get all samples currently in the buffer
   * @returns {Float32Array} - All buffered samples
   */
  getAllSamples() {
    return new Float32Array(this.buffer);
  }

  /**
   * Clear the buffer
   */
  clear() {
    this.buffer = [];
    if (this.debugMode) {
      console.log('[BufferManager] Buffer cleared');
    }
  }

  /**
   * Get the current buffer length
   * @returns {number} - Current buffer length
   */
  getBufferLength() {
    return this.buffer.length;
  }
}

export {
  AudioBufferManager,
  SAMPLE_RATE,
  AUDIO_CHUNK_DURATION,
  SAMPLES_PER_CHUNK
};
