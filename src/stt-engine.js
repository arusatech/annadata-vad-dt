const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

class SttEngine {
  constructor({ onInterim, onFinal }) {
    this._onInterim = onInterim;
    this._onFinal = onFinal;
    this._connection = null;
    this._prevInterim = '';
    this._ready = false;
    this._chunksSent = 0;
  }

  /** Connect to Deepgram. Returns a promise that resolves when the WS is open. */
  start() {
    return new Promise((resolve, reject) => {
      const apiKey = process.env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        console.error('❌ DEEPGRAM_API_KEY not set!');
        return reject(new Error('No API key'));
      }

      console.log('🔌 Connecting to Deepgram...');
      const deepgram = createClient(apiKey);
      this._chunksSent = 0;

      this._connection = deepgram.listen.live({
        model: 'nova-2',
        language: 'en',
        smart_format: true,
        interim_results: true,
        utterance_end_ms: 1500,
        vad_events: true,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
      });

      this._connection.on(LiveTranscriptionEvents.Open, () => {
        console.log('🔗 Deepgram WS open — ready for audio');
        this._ready = true;
        resolve(); // Signal that we're ready
      });

      this._connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        const alt = data.channel?.alternatives?.[0];
        if (!alt) return;

        const transcript = alt.transcript.trim();
        if (!transcript) return;

        console.log(`📝 [${data.is_final ? 'FINAL' : 'interim'}] "${transcript}"`);

        if (data.is_final) {
          this._onFinal(transcript);
          this._prevInterim = '';
        } else {
          this._onInterim(transcript, this._prevInterim);
          this._prevInterim = transcript;
        }
      });

      this._connection.on(LiveTranscriptionEvents.Error, (err) => {
        console.error('❌ Deepgram error:', err);
      });

      this._connection.on(LiveTranscriptionEvents.Close, () => {
        console.log('🔗 Deepgram connection closed');
        this._ready = false;
      });

      // Timeout if connection doesn't open in 5s
      setTimeout(() => {
        if (!this._ready) {
          console.error('❌ Deepgram connection timeout (5s)');
          reject(new Error('Connection timeout'));
        }
      }, 5000);
    });
  }

  /** Send a raw PCM audio chunk to Deepgram. */
  sendAudio(chunk) {
    if (!this._ready || !this._connection) {
      if (this._chunksSent === 0) {
        console.warn('⚠️ sendAudio called but Deepgram not ready');
      }
      return;
    }

    this._chunksSent++;
    try {
      // chunk from IPC may be ArrayBuffer, Buffer, or Uint8Array
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (this._chunksSent <= 3 || this._chunksSent % 50 === 0) {
        console.log(`📤 Sending chunk #${this._chunksSent} to Deepgram (${buf.length} bytes)`);
      }
      this._connection.send(buf);
    } catch (err) {
      console.error('❌ Error sending audio to Deepgram:', err.message);
    }
  }

  async stop() {
    console.log(`📊 Total chunks sent to Deepgram: ${this._chunksSent}`);
    this._ready = false;
    if (this._connection) {
      this._connection.requestClose();
      this._connection = null;
    }
    this._prevInterim = '';
  }
}

module.exports = { SttEngine };
