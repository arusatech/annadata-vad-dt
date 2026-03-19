const { exec } = require('child_process');
const os = require('os');

/**
 * Ghost Typer — injects keystrokes into the focused application.
 *
 * On macOS: uses AppleScript `keystroke` (reliable, no extra deps).
 * On Windows: uses nut-js synthetic keystrokes.
 *
 * Flow:
 *  1. On interim results, diff against previous interim text.
 *  2. Backspace the difference, then type the new suffix.
 *  3. On final result, clean up any remaining diff.
 */
class GhostTyper {
  constructor() {
    this._lastTyped = '';
    this._platform = os.platform();
    this._nutKeyboard = null;
    this._nutKey = null;

    if (this._platform === 'win32') {
      try {
        const nut = require('@nut-tree-fork/nut-js');
        this._nutKeyboard = nut.keyboard;
        this._nutKey = nut.Key;
        this._nutKeyboard.config.autoDelayMs = 0;
      } catch (e) {
        console.error('nut-js load failed:', e.message);
      }
    }
  }

  async handleInterim(current, previous) {
    try {
      if (!previous) {
        await this._type(current);
        this._lastTyped = current;
        return;
      }

      const common = this._commonPrefixLen(previous, current);
      const charsToDelete = previous.length - common;
      const newSuffix = current.slice(common);

      if (charsToDelete > 0) {
        await this._backspace(charsToDelete);
      }
      if (newSuffix.length > 0) {
        await this._type(newSuffix);
      }
      this._lastTyped = current;
    } catch (err) {
      console.error('GhostTyper interim error:', err.message);
    }
  }

  async handleFinal(finalText) {
    try {
      const common = this._commonPrefixLen(this._lastTyped, finalText);
      const charsToDelete = this._lastTyped.length - common;
      const newSuffix = finalText.slice(common);

      if (charsToDelete > 0) {
        await this._backspace(charsToDelete);
      }
      if (newSuffix.length > 0) {
        await this._type(newSuffix);
      }
      await this._type(' ');
      this._lastTyped = '';
    } catch (err) {
      console.error('GhostTyper final error:', err.message);
    }
  }

  /** Type text into the focused app. */
  async _type(text) {
    if (!text) return;

    if (this._platform === 'darwin') {
      return this._osascriptType(text);
    } else if (this._nutKeyboard) {
      return this._nutKeyboard.type(text);
    }
  }

  /** Send N backspace keystrokes. */
  async _backspace(count) {
    if (count <= 0) return;

    if (this._platform === 'darwin') {
      return this._osascriptBackspace(count);
    } else if (this._nutKeyboard) {
      for (let i = 0; i < count; i++) {
        await this._nutKeyboard.pressKey(this._nutKey.Backspace);
        await this._nutKeyboard.releaseKey(this._nutKey.Backspace);
      }
    }
  }

  /** macOS: type text via AppleScript. */
  _osascriptType(text) {
    return new Promise((resolve, reject) => {
      // Escape backslashes and double quotes for AppleScript string
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = `tell application "System Events" to keystroke "${escaped}"`;
      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  /** macOS: send backspaces via AppleScript. */
  _osascriptBackspace(count) {
    return new Promise((resolve, reject) => {
      exec(`osascript -e 'tell application "System Events"\nrepeat ${count} times\nkey code 51\nend repeat\nend tell'`, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  _commonPrefixLen(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }
}

module.exports = { GhostTyper };
