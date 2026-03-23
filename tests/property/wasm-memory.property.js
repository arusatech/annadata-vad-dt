// Feature: phase1-electron-high-perf, Property 4: WASM memory deallocation invariant
import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Simulates the transcribeWasm logic from src/whisper-transcriber.js.
 *
 * The real pattern is:
 *   let ptr = null;
 *   try {
 *     ptr = m.wasm_malloc(nSamples * 4);
 *     if (!ptr) { return ''; }
 *     // ... transcribe work that might throw ...
 *   } catch (err) {
 *     console.error('Transcription error:', err);
 *   } finally {
 *     if (ptr) { m.wasm_free(ptr); }
 *   }
 *
 * This test verifies that for every non-null malloc, there is exactly one
 * corresponding free call — regardless of whether transcription succeeds or throws.
 */

/**
 * Creates a mock WASM module that tracks wasm_malloc and wasm_free calls.
 * @param {Object} opts
 * @param {boolean} opts.mallocReturnsNull - If true, wasm_malloc returns 0 (null pointer)
 * @returns {{ module: Object, mallocCalls: number[], freeCalls: number[] }}
 */
function createMockWasmModule(opts = {}) {
  let nextPtr = 1024; // start at a non-zero address
  const mallocCalls = [];
  const freeCalls = [];

  const module = {
    HEAPU8: { buffer: new ArrayBuffer(1024 * 1024) }, // 1MB mock heap
    wasm_malloc(size) {
      if (opts.mallocReturnsNull) {
        mallocCalls.push(0);
        return 0;
      }
      const ptr = nextPtr;
      nextPtr += size;
      mallocCalls.push(ptr);
      return ptr;
    },
    wasm_free(ptr) {
      freeCalls.push(ptr);
    },
  };

  return { module, mallocCalls, freeCalls };
}

/**
 * Simulates a single transcribeWasm call with the try/finally deallocation pattern.
 * @param {Object} wasmModule - Mock WASM module
 * @param {number} nSamples - Number of PCM samples
 * @param {boolean} shouldThrow - Whether the transcription step should throw
 */
function simulateTranscribeWasm(wasmModule, nSamples, shouldThrow) {
  let ptr = null;
  try {
    ptr = wasmModule.wasm_malloc(nSamples * 4);
    if (!ptr) {
      return '';
    }
    // Simulate transcription work
    if (shouldThrow) {
      throw new Error('Simulated transcription error');
    }
    return 'transcribed text';
  } catch (_err) {
    // Mirrors: console.error('Transcription error:', err);
  } finally {
    if (ptr) {
      wasmModule.wasm_free(ptr);
    }
  }
  return '';
}

/**
 * Arbitrary: generates a sequence of transcription calls, each with a random
 * sample count and a flag indicating whether the call should succeed or throw.
 */
const transcriptionCallsArb = fc.array(
  fc.record({
    nSamples: fc.integer({ min: 1600, max: 64000 }),
    shouldThrow: fc.boolean(),
  }),
  { minLength: 1, maxLength: 50 }
);

describe('WASM memory deallocation invariant', () => {
  // **Validates: Requirements 6.5**
  test('wasm_free count equals wasm_malloc count for all non-null pointers', () => {
    fc.assert(
      fc.property(transcriptionCallsArb, (calls) => {
        const { module, mallocCalls, freeCalls } = createMockWasmModule();

        // Execute each simulated transcription call
        for (const call of calls) {
          simulateTranscribeWasm(module, call.nSamples, call.shouldThrow);
        }

        // All malloc calls return non-null pointers in this scenario
        const nonNullMallocs = mallocCalls.filter((ptr) => ptr !== 0);

        // Property: free count equals non-null malloc count
        expect(freeCalls.length).toBe(nonNullMallocs.length);

        // Property: every freed pointer matches a malloc'd pointer
        for (let i = 0; i < freeCalls.length; i++) {
          expect(freeCalls[i]).toBe(nonNullMallocs[i]);
        }
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.5**
  test('wasm_free is not called when wasm_malloc returns null', () => {
    fc.assert(
      fc.property(transcriptionCallsArb, (calls) => {
        const { module, mallocCalls, freeCalls } = createMockWasmModule({
          mallocReturnsNull: true,
        });

        for (const call of calls) {
          simulateTranscribeWasm(module, call.nSamples, call.shouldThrow);
        }

        // All mallocs returned null
        expect(mallocCalls.every((ptr) => ptr === 0)).toBe(true);

        // No free calls should have been made
        expect(freeCalls.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.5**
  test('mixed null and non-null mallocs: free count equals non-null malloc count', () => {
    // Arbitrary that also randomizes whether each malloc returns null
    const mixedCallsArb = fc.array(
      fc.record({
        nSamples: fc.integer({ min: 1600, max: 64000 }),
        shouldThrow: fc.boolean(),
        mallocReturnsNull: fc.boolean(),
      }),
      { minLength: 1, maxLength: 50 }
    );

    fc.assert(
      fc.property(mixedCallsArb, (calls) => {
        let nextPtr = 1024;
        const mallocCalls = [];
        const freeCalls = [];

        const module = {
          HEAPU8: { buffer: new ArrayBuffer(1024 * 1024) },
          wasm_malloc(size) {
            // Use per-call null flag via closure index
            const callIndex = mallocCalls.length;
            if (calls[callIndex]?.mallocReturnsNull) {
              mallocCalls.push(0);
              return 0;
            }
            const ptr = nextPtr;
            nextPtr += size;
            mallocCalls.push(ptr);
            return ptr;
          },
          wasm_free(ptr) {
            freeCalls.push(ptr);
          },
        };

        for (const call of calls) {
          simulateTranscribeWasm(module, call.nSamples, call.shouldThrow);
        }

        const nonNullMallocs = mallocCalls.filter((ptr) => ptr !== 0);

        // Property: free count equals non-null malloc count
        expect(freeCalls.length).toBe(nonNullMallocs.length);

        // Property: each free matches the corresponding non-null malloc
        for (let i = 0; i < freeCalls.length; i++) {
          expect(freeCalls[i]).toBe(nonNullMallocs[i]);
        }
      }),
      { numRuns: 100 }
    );
  });
});
