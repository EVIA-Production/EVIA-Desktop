/**
 * An AudioWorkletProcessor that forwards raw PCM audio data (16-bit integer)
 * from the microphone and system audio to the main thread.
 * It also handles downsampling if the AudioContext sample rate is not 16kHz.
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    // Target sample rate expected by Deepgram
    this.targetSampleRate = 16000;
    this.inputBuffer = []; // Buffer to hold audio data for resampling
    this.resampleRatio = 1; // Default if sample rates match
    this.lastSentTime = 0;
    this.sendInterval = 100; // Send data roughly every 100ms

    // Calculate resampling ratio once upon initialization
    // `sampleRate` is the global variable available in AudioWorkletGlobalScope
    if (sampleRate !== this.targetSampleRate) {
      this.resampleRatio = sampleRate / this.targetSampleRate;
      console.log(`AudioContext sample rate: ${sampleRate}Hz. Resampling to ${this.targetSampleRate}Hz.`);
    } else {
       console.log(`AudioContext sample rate is already ${this.targetSampleRate}Hz. No resampling needed.`);
    }
  }

  // Simple linear interpolation for resampling
  resample(inputBuffer) {
    const outputLength = Math.floor(inputBuffer.length / this.resampleRatio);
    if (outputLength === 0) {
        return new Float32Array(0);
    }
    const outputBuffer = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
        const inputIndex = i * this.resampleRatio;
        const indexPrev = Math.floor(inputIndex);
        const indexNext = Math.min(indexPrev + 1, inputBuffer.length - 1);
        const fraction = inputIndex - indexPrev;
        outputBuffer[i] = inputBuffer[indexPrev] + (inputBuffer[indexNext] - inputBuffer[indexPrev]) * fraction;
    }
    return outputBuffer;
  }

  // Convert Float32Array samples ranging from -1.0 to 1.0
  // to Int16Array samples ranging from -32768 to 32767
  float32ToInt16(buffer) {
    const int16Buffer = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const val = Math.max(-1, Math.min(1, buffer[i])); // Clamp values
      int16Buffer[i] = val * 32767; // Scale to Int16 range
    }
    return int16Buffer;
  }

  process(inputs, outputs, parameters) {
    // We expect a single input with a single channel (mono).
    // If multiple inputs/channels exist, we might need to mix them down.
    // For simplicity, let's assume the input connection handles mixing (e.g., from MediaStreamAudioDestinationNode).
    const input = inputs[0];
    if (!input || !input[0]) {
      // No input data, Processor might be idle
      return true; // Keep processor alive
    }

    // input[0] is the Float32Array for the first channel
    const inputData = input[0];

    // Append new data to our internal buffer
    this.inputBuffer.push(...inputData);

    // Check if enough time has passed to send a chunk
    const now = currentTime * 1000; // currentTime is in seconds
     if (now - this.lastSentTime >= this.sendInterval) {
        let dataToSend = new Float32Array(this.inputBuffer);
        this.inputBuffer = []; // Clear the buffer

        // Resample if needed
        if (this.resampleRatio !== 1) {
            dataToSend = this.resample(dataToSend);
        }

        if(dataToSend.length > 0){
           // Convert to Int16 PCM
           const pcmData = this.float32ToInt16(dataToSend);
           // Send the Int16Array buffer back to the main thread
           // Transferable objects (like ArrayBuffer) can be sent efficiently
           this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
        }
         this.lastSentTime = now;
     }

    // Return true to keep the processor alive
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
