const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stt', {
  // Recording
  onRecordingState: (cb) => ipcRenderer.on('recording-state', (_, val) => cb(val)),
  onTranscript: (cb) => ipcRenderer.on('transcript', (_, data) => cb(data)),
  onSttError: (cb) => ipcRenderer.on('stt-error', (_, msg) => cb(msg)),

  // Whisper results from renderer → main
  sendInterim: (text) => ipcRenderer.send('whisper-interim', text),
  sendFinal: (text) => ipcRenderer.send('whisper-final', text),

  // Language
  setLanguage: (lang) => ipcRenderer.send('set-language', lang),
  getLanguage: () => ipcRenderer.invoke('get-language'),
  getLangOptions: () => ipcRenderer.invoke('get-lang-options'),

  // Model
  isModelDownloaded: (url) => ipcRenderer.invoke('is-model-downloaded', url),
  getModelPath: (url) => ipcRenderer.invoke('get-model-path', url),
  readModelFile: (localPath) => ipcRenderer.invoke('read-model-file', localPath),
  downloadModel: (url) => ipcRenderer.invoke('download-model', url),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, data) => cb(data)),
});
