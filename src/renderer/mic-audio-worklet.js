// AudioWorklet processor to chunk audio into fixed-size 16kHz frames
// Emits Float32Array chunks via port.postMessage({ type: 'chunk', samples: Float32Array })

class MicChunkProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetChunk = (options?.processorOptions?.samplesPerChunk) || 1600; // 100ms @16k
    this.buffer = new Float32Array(0);
  }
  process(inputs, _outputs, _params) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    // Append to buffer
    const merged = new Float32Array(this.buffer.length + channel.length);
    merged.set(this.buffer);
    merged.set(channel, this.buffer.length);
    this.buffer = merged;
    // Emit full chunks
    while (this.buffer.length >= this.targetChunk) {
      const chunk = this.buffer.slice(0, this.targetChunk);
      this.buffer = this.buffer.slice(this.targetChunk);
      this.port.postMessage({ type: 'chunk', samples: chunk }, [chunk.buffer]);
    }
    return true; // keep alive
  }
}

registerProcessor('mic-chunk-processor', MicChunkProcessor);
