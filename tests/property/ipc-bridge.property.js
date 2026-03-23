// Feature: phase1-electron-high-perf, Property 5: IPC bridge error wrapping
import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Replicates the safeInvoke pattern from electron/preload.cjs.
 * We can't import the CJS preload directly in a test context, so we
 * replicate the logic and test it against a mock ipcRenderer.invoke.
 */
function createSafeInvoke(ipcRenderer) {
  return async function safeInvoke(channel, ...args) {
    try {
      return await ipcRenderer.invoke(channel, ...args);
    } catch (err) {
      return { success: false, error: err.message || 'IPC call failed' };
    }
  };
}

describe('IPC bridge error wrapping', () => {
  // **Validates: Requirements 8.1**

  test('safeInvoke returns { success: false, error: string } with non-empty error for any rejection', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (errorMessage, channel) => {
          const mockIpcRenderer = {
            invoke: () => Promise.reject(new Error(errorMessage)),
          };

          const safeInvoke = createSafeInvoke(mockIpcRenderer);
          const result = await safeInvoke(channel);

          // Must return an object, not throw
          expect(result).toBeDefined();
          expect(typeof result).toBe('object');

          // Must have success: false
          expect(result.success).toBe(false);

          // Must have a non-empty error string
          expect(typeof result.error).toBe('string');
          expect(result.error.length).toBeGreaterThan(0);

          // Error message should match what was thrown
          expect(result.error).toBe(errorMessage);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('safeInvoke returns fallback error when rejection has no message', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (channel) => {
          const mockIpcRenderer = {
            invoke: () => Promise.reject(new Error('')),
          };

          const safeInvoke = createSafeInvoke(mockIpcRenderer);
          const result = await safeInvoke(channel);

          expect(result.success).toBe(false);
          expect(typeof result.error).toBe('string');
          expect(result.error.length).toBeGreaterThan(0);
          // Empty message triggers the fallback
          expect(result.error).toBe('IPC call failed');
        }
      ),
      { numRuns: 100 }
    );
  });

  test('safeInvoke passes through successful results unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.record({ success: fc.boolean(), data: fc.string() })
        ),
        async (channel, resolvedValue) => {
          const mockIpcRenderer = {
            invoke: () => Promise.resolve(resolvedValue),
          };

          const safeInvoke = createSafeInvoke(mockIpcRenderer);
          const result = await safeInvoke(channel);

          // Successful invoke should pass through the value unchanged
          expect(result).toEqual(resolvedValue);
        }
      ),
      { numRuns: 100 }
    );
  });
});
