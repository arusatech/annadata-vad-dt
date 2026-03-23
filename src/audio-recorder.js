/**
 * Audio recorder with multiple capture strategies.
 *
 * Strategy 1: ScriptProcessorNode — direct PCM from Web Audio API
 * Strategy 2: MediaRecorder — collect encoded blobs, decode on stop
 *
 * Both are attempted. If ScriptProcessor delivers non-zero audio, we use it
 * (gives us real-time waveform data). Otherwise we fall back to MediaRecorder
 * decoded output.
 *
 * Public API:
 *   async start()          — begin recording
 *   async stop()           — stop + return full session PCM (16kHz Float32Array)
 *   isRecording()          — true while mic is live
 *   getVolume()            — 0..1 for waveform animation
 *   onError                — optional error callback
 */

const TARGET_RATE = 16000;

export class AudioRecorder {
  constructor() {
    this._stream = null;
    this._audioCtx = null;
    this._sourceNode = null;
    this._scriptNode = null;
    this._mediaRecorder = null;
    this._mrChunks = [];
    this._spChunks = [];       // ScriptProcessor PCM chunks (48kHz)
    this._recording = false;
    this._starting = false;
    this._volume = 0;
    this._spHasAudio = false;  // Did ScriptProcessor get non-zero data?
    this._startTime = 0;

    /** @type {((error: Error) => void) | null} */
    this.onError = null;
  }

  isRecording() { return this._recording; }
  isStarting() { return this._starting; }
  getVolume() { return this._volume; }

  async start() {
    if (this._recording || this._starting) return;
    this._starting = true;
    this._spChunks = [];
    this._mrChunks = [];
    this._volume = 0;
    this._spHasAudio = false;

    try {
      console.log('[AudioRecorder] Requesting getUserMedia...');
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const track = this._stream.getAudioTracks()[0];
      const settings = track.getSettings();
      console.log('[AudioRecorder] Got stream:', track.label,
        'enabled:', track.enabled, 'readyState:', track.readyState,
        'sampleRate:', settings.sampleRate);

      // Create AudioContext at hardware sample rate
      this._audioCtx = new AudioContext();
      const hwRate = this._audioCtx.sampleRate;
      console.log('[AudioRecorder] AudioContext sampleRate:', hwRate, 'state:', this._audioCtx.state);

      // Resume if suspended
      if (this._audioCtx.state === 'suspended') {
        await this._audioCtx.resume();
        console.log('[AudioRecorder] AudioContext resumed:', this._audioCtx.state);
      }

      this._sourceNode = this._audioCtx.createMediaStreamSource(this._stream);

      // Strategy 1: ScriptProcessorNode for real-time PCM
      this._scriptNode = this._audioCtx.createScriptProcessor(4096, 1, 1);
      let spCallCount = 0;
      this._scriptNode.onaudioprocess = (e) => {
        if (!this._recording) return;
        const input = e.inputBuffer.getChannelData(0);
        // Copy the buffer (it gets reused)
        const copy = new Float32Array(input.length);
        copy.set(input);
        this._spChunks.push(copy);

        // Calculate volume
        let maxAbs = 0;
        for (let i = 0; i < input.length; i++) {
          const a = Math.abs(input[i]);
          if (a > maxAbs) maxAbs = a;
        }

        if (maxAbs > 0.001) this._spHasAudio = true;
        this._volume = Math.min(1, maxAbs * 5); // Scale up for visibility

        spCallCount++;
        if (spCallCount <= 3 || spCallCount % 50 === 0) {
          console.log(`[AudioRecorder] SP #${spCallCount} maxAbs: ${maxAbs.toFixed(6)}`);
        }
      };

      // Connect: source → scriptProcessor → destination
      this._sourceNode.connect(this._scriptNode);
      this._scriptNode.connect(this._audioCtx.destination);

      // Strategy 2: MediaRecorder as backup
      try {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus' : '';
        this._mediaRecorder = new MediaRecorder(this._stream,
          mimeType ? { mimeType } : {});
        this._mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) this._mrChunks.push(e.data);
        };
        this._mediaRecorder.onerror = (e) => {
          console.error('[AudioRecorder] MediaRecorder error:', e.error);
        };
        this._mediaRecorder.start(500);
        console.log('[AudioRecorder] MediaRecorder started as backup');
      } catch (mrErr) {
        console.warn('[AudioRecorder] MediaRecorder not available:', mrErr.message);
      }

      this._recording = true;
      this._startTime = Date.now();
      console.log('[AudioRecorder] Recording started (dual capture)');
    } catch (err) {
      console.error('[AudioRecorder] start() failed:', err);
      this._teardown();
      if (err.name === 'NotAllowedError') throw new Error('Microphone access denied');
      if (err.name === 'NotFoundError') throw new Error('No microphone found');
      throw new Error('Audio system error: ' + err.message);
    } finally {
      this._starting = false;
    }
  }

  async stop() {
    if (!this._recording && !this._starting) {
      return new Float32Array(0);
    }
    this._recording = false;
    this._volume = 0;

    const durationMs = Date.now() - this._startTime;
    console.log('[AudioRecorder] Stopping after', (durationMs / 1000).toFixed(1) + 's');

    // Stop MediaRecorder
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      await new Promise((resolve) => {
        this._mediaRecorder.onstop = resolve;
        this._mediaRecorder.stop();
      });
    }

    let pcm16k;

    // Prefer ScriptProcessor data if it has actual audio
    if (this._spHasAudio && this._spChunks.length > 0) {
      console.log('[AudioRecorder] Using ScriptProcessor data (' + this._spChunks.length + ' chunks)');
      pcm16k = this._resampleChunks(this._spChunks, this._audioCtx?.sampleRate || 48000);
    } else if (this._mrChunks.length > 0) {
      // Fall back to MediaRecorder
      console.log('[AudioRecorder] SP had no audio, trying MediaRecorder (' + this._mrChunks.length + ' chunks)');
      pcm16k = await this._decodeMRChunks();
    } else {
      console.log('[AudioRecorder] No audio data from either source');
      pcm16k = new Float32Array(0);
    }

    // Check final result
    let maxAbs = 0;
    for (let i = 0; i < pcm16k.length; i++) {
      const a = Math.abs(pcm16k[i]);
      if (a > maxAbs) maxAbs = a;
    }
    console.log('[AudioRecorder] Final PCM: samples:', pcm16k.length,
      'maxAbs:', maxAbs.toFixed(6), 'duration:', (pcm16k.length / TARGET_RATE).toFixed(1) + 's');

    if (maxAbs === 0 && pcm16k.length > 0) {
      console.warn('[AudioRecorder] ⚠️ ALL ZEROS — microphone may not be working.');
      console.warn('[AudioRecorder] Check: System Settings > Privacy & Security > Microphone');
      console.warn('[AudioRecorder] Check: System Settings > Sound > Input volume is not zero');
      console.warn('[AudioRecorder] The Electron app must appear in the Microphone privacy list');
    }

    this._teardown();
    return pcm16k;
  }

  _resampleChunks(chunks, srcRate) {
    // Concatenate all chunks
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const raw = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      raw.set(chunk, offset);
      offset += chunk.length;
    }

    // Resample to 16kHz
    if (srcRate === TARGET_RATE) return raw;
    const ratio = TARGET_RATE / srcRate;
    const outLen = Math.round(raw.length * ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i / ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, raw.length - 1);
      const frac = srcIdx - lo;
      out[i] = raw[lo] * (1 - frac) + raw[hi] * frac;
    }
    return out;
  }

  async _decodeMRChunks() {
    try {
      const fullBlob = new Blob(this._mrChunks, { type: 'audio/webm' });
      console.log('[AudioRecorder] MediaRecorder blob size:', fullBlob.size);
      const arrayBuf = await fullBlob.arrayBuffer();
      const decodeCtx = new AudioContext();
      const audioBuf = await decodeCtx.decodeAudioData(arrayBuf);
      await decodeCtx.close();
      const rawPcm = audioBuf.getChannelData(0);
      return this._resampleChunks([rawPcm], audioBuf.sampleRate);
    } catch (err) {
      console.error('[AudioRecorder] MediaRecorder decode failed:', err);
      return new Float32Array(0);
    }
  }

  _teardown() {
    try { this._scriptNode?.disconnect(); } catch (_) {}
    try { this._sourceNode?.disconnect(); } catch (_) {}
    try { this._audioCtx?.close(); } catch (_) {}
    this._scriptNode = null;
    this._sourceNode = null;
    this._audioCtx = null;
    this._mediaRecorder = null;
    if (this._stream) {
      this._stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      this._stream = null;
    }
  }
}
