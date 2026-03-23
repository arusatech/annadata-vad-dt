// Feature: phase1-electron-high-perf, Property 7: Ghost typing never throws
import { describe, test, expect, vi } from 'vitest';
import * as fc from 'fast-check';

/**
 * Replicates the ghostType function logic from electron/main.cjs.
 * We can't import the CJS main in a test context, so we replicate
 * the core logic and test it against a mock exec.
 */
function createGhostType(execFn, platform) {
  return function ghostType(text) {
    if (!text) return;
    if (platform !== 'darwin') {
      console.debug('Ghost typing skipped: not macOS');
      return;
    }
    try {
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = `tell application "System Events" to keystroke "${escaped}"`;
      execFn(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
        if (err) console.error('Ghost type error:', err.message);
      });
    } catch (err) {
      console.error('Ghost type error:', err.message);
    }
  };
}

describe('Ghost typing never throws', () => {
  // **Validates: Requirements 11.2, 11.3**

  test('ghostType never throws for any arbitrary string on macOS', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (text) => {
          const mockExec = vi.fn((_cmd, cb) => { cb(null); });
          const ghostType = createGhostType(mockExec, 'darwin');

          expect(() => ghostType(text)).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('ghostType never throws for any arbitrary string on non-macOS', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom('win32', 'linux', 'freebsd'),
        (text, platform) => {
          const mockExec = vi.fn();
          const ghostType = createGhostType(mockExec, platform);

          expect(() => ghostType(text)).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('ghostType never throws when exec callback reports an error', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (text, errorMsg) => {
          const mockExec = vi.fn((_cmd, cb) => { cb(new Error(errorMsg)); });
          const ghostType = createGhostType(mockExec, 'darwin');

          expect(() => ghostType(text)).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('ghostType never throws when exec itself throws synchronously', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        (text) => {
          const mockExec = vi.fn(() => { throw new Error('exec crashed'); });
          const ghostType = createGhostType(mockExec, 'darwin');

          expect(() => ghostType(text)).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('ghostType never throws for strings with special characters', () => {
    const specialChars = ['"', "'", '\\', '\n', '\r', '\t', '`', '$', '!',
      '(', ')', '{', '}', '[', ']', '<', '>', '|', '&', ';'];
    const specialCharArb = fc.array(
      fc.constantFrom(...specialChars),
      { minLength: 1, maxLength: 50 }
    ).map(arr => arr.join(''));

    fc.assert(
      fc.property(
        specialCharArb,
        (text) => {
          const mockExec = vi.fn((_cmd, cb) => { cb(null); });
          const ghostType = createGhostType(mockExec, 'darwin');

          expect(() => ghostType(text)).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('ghostType never throws for unicode strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200, unit: 'grapheme' }),
        (text) => {
          const mockExec = vi.fn((_cmd, cb) => { cb(null); });
          const ghostType = createGhostType(mockExec, 'darwin');

          expect(() => ghostType(text)).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('ghostType handles empty string without calling exec', () => {
    const mockExec = vi.fn();
    const ghostType = createGhostType(mockExec, 'darwin');

    expect(() => ghostType('')).not.toThrow();
    expect(mockExec).not.toHaveBeenCalled();
  });

  test('ghostType skips exec on non-macOS platforms', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.constantFrom('win32', 'linux'),
        (text, platform) => {
          const mockExec = vi.fn();
          const ghostType = createGhostType(mockExec, platform);

          ghostType(text);
          expect(mockExec).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});
