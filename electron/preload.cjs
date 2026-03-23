/**
 * Electron preload — exposes __electronBridge to the renderer.
 * The web app checks for this global to detect Electron environment.
 */
const { contextBridge, ipcRenderer } = require('electron');

/**
 * Wraps ipcRenderer.invoke in try-catch, returning a structured error
 * object { success: false, error: message } on failure instead of throwing.
 */
async function safeInvoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (err) {
    return { success: false, error: err.message || 'IPC call failed' };
  }
}

contextBridge.exposeInMainWorld('__electronBridge', {
  // Recording state from main process
  onRecordingState: (cb) => ipcRenderer.on('recording-state', (_, val) => cb(val)),

  // Ghost typing
  sendTranscript: (text) => ipcRenderer.send('transcript', text),
  sendFinalTranscript: (text) => ipcRenderer.send('final-transcript', text),

  // Window resize
  resizeWindow: (w, h) => ipcRenderer.send('resize-window', w, h),

  // Microphone diagnostics
  openMicSettings: () => safeInvoke('open-mic-settings'),
  getMicStatus: () => safeInvoke('get-mic-status'),

  // Model management — wrapped with safeInvoke for error resilience
  isModelDownloaded: (url) => safeInvoke('is-model-downloaded', url),
  getModelPath: (url) => safeInvoke('get-model-path', url),
  readModelFile: (localPath) => safeInvoke('read-model-file', localPath),
  downloadModel: (url) => safeInvoke('download-model', url),
  deleteModelFile: (url) => safeInvoke('delete-model-file', url),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, data) => cb(data)),
});
