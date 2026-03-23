/**
 * AudioWorklet processor that buffers incoming audio samples and posts
 * chunks to the main thread via MessagePort. Uses transferable ArrayBuffers
 * for zero-copy performance.
 *
 * The buffer size is 1 second worth of samples at the AudioContext's
 * sample rate (sampleRate is a global in AudioWorkletGlobalScope).
 *
 * Messages received:
 *   { command: 'flush' } — emit any partial buffer and stop processing
 *
 * Messages posted:
 *   { type: 'chunk', data: Float32Array } — a complete or partial (flush) chunk
 */
class ChunkProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // sampleRate is a global in AudioWorkletGlobalScope
    this._chunkSize = sampleRate; // 1 second at whatever the hardware rate is
    this._buffer = new Float32Array(this._chunkSize);
    this._writePos = 0;
    this._active = true;
    this.port.onmessage = (e) => {
      if (e.data.command === 'flush') {
        this._flush();
        this._active = false;
      }
    };
  }

  process(inputs) {
    if (!this._active) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;

    let readPos = 0;
    while (readPos < input.length) {
      const remaining = this._chunkSize - this._writePos;
      const available = input.length - readPos;
      const toCopy = Math.min(remaining, available);

      this._buffer.set(input.subarray(readPos, readPos + toCopy), this._writePos);
      this._writePos += toCopy;
      readPos += toCopy;

      if (this._writePos === this._chunkSize) {
        const chunk = this._buffer.slice(0);
        this.port.postMessage({ type: 'chunk', data: chunk }, [chunk.buffer]);
        this._writePos = 0;
      }
    }

    return true;
  }

  _flush() {
    if (this._writePos > 0) {
      const partial = this._buffer.slice(0, this._writePos);
      this.port.postMessage({ type: 'chunk', data: partial }, [partial.buffer]);
      this._writePos = 0;
    }
  }
}

registerProcessor('chunk-processor', ChunkProcessor);
