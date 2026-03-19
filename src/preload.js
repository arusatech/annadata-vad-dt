const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stt', {
  onRecordingState: (cb) => ipcRenderer.on('recording-state', (_, val) => cb(val)),
  onTranscript: (cb) => ipcRenderer.on('transcript', (_, data) => cb(data)),
  sendAudio: (pcmBuffer) => ipcRenderer.send('audio-chunk', pcmBuffer),
});
