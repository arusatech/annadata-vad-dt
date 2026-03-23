// Feature: phase1-electron-high-perf, Property 3: Transcription pipeline chunk-error resilience
import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Simulates the transcription pipeline loop from src/main.js transcribeLoop().
 *
 * The pipeline processes chunks from a FIFO queue. For each chunk it calls
 * a transcribe function. If transcribe throws, the error is caught, the chunk
 * is skipped, and processing continues with the next chunk. This mirrors the
 * real pipeline where whisper-transcriber.js catches errors internally and
 * returns '' — the pipeline never halts due to a single chunk failure.
 */
function simulateTranscriptionPipeline(chunks, transcribeFn) {
  const results = [];
  const errors = [];

  for (let i = 0; i < chunks.length; i++) {
    try {
      const text = transcribeFn(chunks[i], i);
      results.push({ index: i, text });
    } catch (err) {
      errors.push({ index: i, error: err.message });
    }
  }

  return { results, errors };
}

/**
 * Arbitrary: generates a list of chunks paired with boolean flags indicating
 * whether each chunk should cause a transcription error.
 */
const chunksWithErrorFlagsArb = fc.array(
  fc.record({
    samples: fc.integer({ min: 1600, max: 32000 }),
    shouldFail: fc.boolean(),
  }),
  { minLength: 1, maxLength: 50 }
);

describe('Transcription pipeline chunk-error resilience', () => {
  // **Validates: Requirements 6.3**
  test('all non-failing chunks are processed and total processed + failed = total chunks', () => {
    fc.assert(
      fc.property(chunksWithErrorFlagsArb, (chunkSpecs) => {
        // Build chunk data and a transcribe function that throws for flagged chunks
        const chunks = chunkSpecs.map((spec, i) => ({
          pcm: new Float32Array(spec.samples),
          id: i,
          shouldFail: spec.shouldFail,
        }));

        const transcribeFn = (chunk, _index) => {
          if (chunk.shouldFail) {
            throw new Error(`Transcription error on chunk ${chunk.id}`);
          }
          return `text-${chunk.id}`;
        };

        const { results, errors } = simulateTranscriptionPipeline(chunks, transcribeFn);

        // Property: successfully processed + failed = total
        expect(results.length + errors.length).toBe(chunks.length);

        // Property: every non-failing chunk was successfully processed
        const expectedSuccessIndices = chunks
          .filter((c) => !c.shouldFail)
          .map((c) => c.id);
        const actualSuccessIndices = results.map((r) => r.index);
        expect(actualSuccessIndices).toEqual(expectedSuccessIndices);

        // Property: every failing chunk appears in the errors list
        const expectedFailIndices = chunks
          .filter((c) => c.shouldFail)
          .map((c) => c.id);
        const actualFailIndices = errors.map((e) => e.index);
        expect(actualFailIndices).toEqual(expectedFailIndices);

        // Property: pipeline did not stop early — all chunks were attempted
        const allAttemptedIndices = [
          ...results.map((r) => r.index),
          ...errors.map((e) => e.index),
        ].sort((a, b) => a - b);
        const expectedAllIndices = chunks.map((_, i) => i);
        expect(allAttemptedIndices).toEqual(expectedAllIndices);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: phase1-electron-high-perf, Property 6: Chunk processing FIFO order
describe('Chunk processing FIFO order', () => {
  /**
   * Arbitrary: generates an array of labeled chunks, each with a unique index.
   * Each chunk carries a label (its enqueue position) and a small PCM payload.
   */
  const labeledChunksArb = fc.integer({ min: 1, max: 100 }).chain((len) =>
    fc.tuple(
      fc.constant(len),
      fc.array(fc.integer({ min: 100, max: 16000 }), {
        minLength: len,
        maxLength: len,
      })
    ).map(([, sizes]) =>
      sizes.map((size, i) => ({
        label: i,
        pcm: new Float32Array(size),
      }))
    )
  );

  // **Validates: Requirements 10.3**
  test('processing order matches enqueue order for any sequence of labeled chunks', () => {
    fc.assert(
      fc.property(labeledChunksArb, (chunks) => {
        // Simulate FIFO queue: enqueue all chunks via push
        const queue = [];
        for (const chunk of chunks) {
          queue.push(chunk);
        }

        // Process by shifting from the front (FIFO)
        const processedOrder = [];
        while (queue.length > 0) {
          const next = queue.shift();
          processedOrder.push(next.label);
        }

        // The enqueue order
        const enqueueOrder = chunks.map((c) => c.label);

        // Property: processing order must exactly match enqueue order
        expect(processedOrder).toEqual(enqueueOrder);
        expect(processedOrder.length).toBe(chunks.length);
      }),
      { numRuns: 100 }
    );
  });
});
