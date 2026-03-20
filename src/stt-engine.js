/**
 * Local whisper.cpp STT engine — runs in the main process.
 *
 * Receives Float32 PCM audio from the renderer, buffers it,
 * and delegates transcription to the renderer (which runs whisper.wasm).
 * The renderer calls back with results via IPC.
 */
class SttEngine {
  /**
   * @param {object} opts
   * @param {(text: string, prevText: string) => void} opts.onInterim
   * @param {(text: string) => void} opts.onFinal
   */
  constructor({ onInterim, onFinal }) {
    this._onInterim = onInterim;
    this._onFinal = onFinal;
    this._language = 'en';
    this._prevInterim = '';
    this._active = false;
  }

  setLanguage(lang) {
    this._language = lang;
    console.log(`🌐 STT language set: ${lang}`);
  }

  getLanguage() {
    return this._language;
  }

  async start() {
    this._prevInterim = '';
    this._active = true;
    console.log('🎙️ Whisper STT engine started');
  }

  /** Called by main process when renderer sends an interim result. */
  handleInterim(text) {
    if (!this._active) return;
    if (text && text !== this._prevInterim) {
      this._onInterim(text, this._prevInterim);
      this._prevInterim = text;
    }
  }

  /** Called by main process when renderer sends a final result. */
  handleFinal(text) {
    if (text) {
      this._onFinal(text);
    }
    this._prevInterim = '';
  }

  async stop() {
    this._active = false;
    this._prevInterim = '';
    console.log('⏹️ Whisper STT engine stopped');
  }
}

module.exports = { SttEngine };
