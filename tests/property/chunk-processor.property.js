// Feature: phase1-electron-high-perf, Property 1: AudioWorklet chunk boundary invariant
import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Testable simulation of the ChunkProcessor buffering logic from
 * src/audio-worklet-processor.js. Replicates the exact same algorithm
 * without depending on the AudioWorkletProcessor API (unavailable in Node.js).
 */
class ChunkProcessorSim {
  constructor(chunkSize = 16000) {
    this._chunkSize = chunkSize;
    this._buffer = new Float32Array(chunkSize);
    this._writePos = 0;
    this._active = true;
    this.emitted = [];
  }

  /** Simulate a process() call with a single input buffer. */
  process(input) {
    if (!this._active) return false;
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
        this.emitted.push(this._buffer.slice(0));
        this._writePos = 0;
      }
    }
    return true;
  }

  /** Simulate flush — emit any partial buffer. */
  flush() {
    if (this._writePos > 0) {
      this.emitted.push(this._buffer.slice(0, this._writePos));
      this._writePos = 0;
    }
    this._active = false;
  }
}

/**
 * Arbitrary: generates an array of variably-sized Float32Array input buffers,
 * simulating the unpredictable buffer sizes delivered by the Web Audio API
 * process() callback (typically 128 samples, but we test a wider range).
 */
const inputBuffersArb = fc.array(
  fc.integer({ min: 1, max: 2048 }).chain((len) =>
    fc.float32Array({ minLength: len, maxLength: len, noNaN: true })
  ),
  { minLength: 1, maxLength: 50 }
);

describe('AudioWorklet chunk boundary invariant', () => {
  // **Validates: Requirements 3.2, 3.3**
  // Tests with various sample rates (16000, 44100, 48000) to match real worklet behavior
  test('all emitted chunks except the final flush are exactly chunkSize samples', () => {
    const sampleRateArb = fc.constantFrom(16000, 44100, 48000);
    fc.assert(
      fc.property(sampleRateArb, inputBuffersArb, (sampleRate, inputBuffers) => {
        const processor = new ChunkProcessorSim(sampleRate);

        for (const buf of inputBuffers) {
          processor.process(buf);
        }
        processor.flush();

        const chunks = processor.emitted;

        // Must emit at least one chunk (we have at least 1 non-empty input)
        expect(chunks.length).toBeGreaterThanOrEqual(1);

        // All chunks except the last must be exactly chunkSize samples
        for (let i = 0; i < chunks.length - 1; i++) {
          expect(chunks[i].length).toBe(sampleRate);
        }

        // The last chunk (flush) must be between 1 and chunkSize samples
        const lastChunk = chunks[chunks.length - 1];
        expect(lastChunk.length).toBeGreaterThanOrEqual(1);
        expect(lastChunk.length).toBeLessThanOrEqual(sampleRate);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: phase1-electron-high-perf, Property 2: Audio capture sample conservation
describe('Audio capture sample conservation', () => {
  // **Validates: Requirements 3.4**
  test('sum of all emitted chunk lengths equals total input samples', () => {
    const sampleRateArb = fc.constantFrom(16000, 44100, 48000);
    fc.assert(
      fc.property(
        sampleRateArb,
        fc.array(
          fc.integer({ min: 1, max: 2048 }).chain((len) =>
            fc.float32Array({ minLength: len, maxLength: len, noNaN: true })
          ),
          { minLength: 1, maxLength: 50 }
        ),
        (sampleRate, inputBuffers) => {
          const processor = new ChunkProcessorSim(sampleRate);

          for (const buf of inputBuffers) {
            processor.process(buf);
          }
          processor.flush();

          const totalInputSamples = inputBuffers.reduce((sum, buf) => sum + buf.length, 0);
          const totalEmittedSamples = processor.emitted.reduce((sum, chunk) => sum + chunk.length, 0);

          expect(totalEmittedSamples).toBe(totalInputSamples);
        }
      ),
      { numRuns: 100 }
    );
  });
});
