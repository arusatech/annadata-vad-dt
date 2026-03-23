/**
 * Whisper transcriber — Step 2 of the pipeline.
 *
 * Consumes 1-sec PCM chunk buffers produced by AudioRecorder.
 *
 * On web/Electron: uses whisper.wasm loaded via <script> tag (globalThis.WhisperModule).
 * On native (iOS/Android): uses whisper-cpp-capacitor Capacitor plugin.
 */

let wasmModule = null;
let wasmContextId = null;
let loadedModelFile = null;

function isNative() {
  try {
    // Capacitor native check
    return globalThis.Capacitor?.isNativePlatform?.() === true;
  } catch (_) {
    return false;
  }
}

/** Load whisper.wasm (web/electron only) */
async function getWasmModule() {
  if (wasmModule) return wasmModule;

  if (typeof globalThis.WhisperModule !== 'function') {
    throw new Error('Transcription engine failed to load');
  }

  try {
    wasmModule = await globalThis.WhisperModule({
      print: (t) => console.log('[whisper]', t),
      printErr: (t) => console.warn('[whisper]', t),
    });
  } catch (err) {
    throw new Error('Transcription engine failed to load');
  }
  try { wasmModule.FS.mkdir('/models'); } catch (_) { /* exists */ }
  console.log('✅ whisper.wasm ready');
  return wasmModule;
}

/** Load model into WASM FS */
async function ensureWasmModel(modelUrl) {
  const m = await getWasmModule();
  const filename = modelUrl.split('/').pop();
  const fsPath = '/models/' + filename;

  if (loadedModelFile === filename && wasmContextId !== null) return;

  let needsLoad = false;
  try { m.FS.stat(fsPath); } catch (_) { needsLoad = true; }

  if (needsLoad) {
    let data;
    if (globalThis.__electronBridge?.readModelFile) {
      const localPath = await globalThis.__electronBridge.getModelPath(modelUrl);
      if (!localPath) throw new Error('Model not on disk');
      const buf = await globalThis.__electronBridge.readModelFile(localPath);
      data = new Uint8Array(buf);
    } else {
      const resp = await fetch(modelUrl);
      data = new Uint8Array(await resp.arrayBuffer());
    }
    m.FS.writeFile(fsPath, data);
  }

  if (wasmContextId !== null) {
    m.free_context(wasmContextId);
    wasmContextId = null;
  }

  const jsonStr = m.init(fsPath, false, 1);
  if (!jsonStr || jsonStr === '{}') {
    throw new Error(`Model initialization failed: ${fsPath}`);
  }
  wasmContextId = JSON.parse(jsonStr).contextId;
  if (wasmContextId == null) {
    throw new Error(`Model initialization failed: ${fsPath}`);
  }
  loadedModelFile = filename;
}

/**
 * Transcribe a Float32Array PCM chunk (16kHz mono).
 * Returns the transcribed text string.
 */
export async function transcribeChunk(pcm, lang) {
  if (isNative()) {
    return transcribeNative(pcm, lang);
  }
  return transcribeWasm(pcm, lang);
}

async function transcribeWasm(pcm, lang) {
  if (wasmContextId === null || !wasmModule) return '';
  const m = wasmModule;
  const nSamples = pcm.length;
  if (nSamples < 1600) return '';

  let ptr = null;
  try {
    ptr = m.wasm_malloc(nSamples * 4);
    if (!ptr) {
      console.warn('WASM memory allocation failed');
      return '';
    }

    new Float32Array(m.HEAPU8.buffer, ptr, nSamples).set(pcm);
    const jsonStr = m.transcribe(
      wasmContextId, ptr, nSamples, 1,
      false, lang, false, false, false, 1, 1, 0.0, '', false
    );
    if (jsonStr && jsonStr !== '{}') {
      return (JSON.parse(jsonStr).text || '').trim();
    }
  } catch (err) {
    console.error('Transcription error:', err);
  } finally {
    if (ptr) {
      m.wasm_free(ptr);
    }
  }
  return '';
}

async function transcribeNative(pcm, lang) {
  try {
    const { WhisperCpp } = await import('whisper-cpp-capacitor');
    const bytes = new Uint8Array(pcm.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const result = await WhisperCpp.transcribe({
      audio_data: btoa(binary),
      params: { language: lang },
    });
    return result.text || '';
  } catch (err) {
    console.error('Native transcription error:', err);
    return '';
  }
}

/** Prepare the model for a given language + URL */
export async function loadModel(modelUrl, onProgress) {
  if (isNative()) {
    const { WhisperCpp } = await import('whisper-cpp-capacitor');
    await WhisperCpp.loadModel({ path: modelUrl });
    return;
  }
  if (onProgress) onProgress('Loading model...');
  await ensureWasmModel(modelUrl);
}

export function isModelLoaded() {
  if (isNative()) return true;
  return wasmContextId !== null;
}
