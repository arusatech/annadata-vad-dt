const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, screen } = require('electron');
const path = require('path');
const { GhostTyper } = require('./ghost-typer');
const { SttEngine } = require('./stt-engine');
const { ModelManager } = require('./model-manager');
const { langOptions } = require('./lang-options');

let mainWindow = null;
let tray = null;
let isRecording = false;
let sttEngine = null;
let ghostTyper = null;
let modelManager = null;

function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 280,
    height: 80,
    x: Math.round((screenW - 280) / 2),
    y: 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Enable SharedArrayBuffer for whisper.wasm pthreads
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    });
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'overlay.html'));

  mainWindow.webContents.on('console-message', (_, level, message) => {
    console.log(`[renderer] ${message}`);
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'mic-off.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Toggle Recording (Ctrl+Shift+Space)', click: toggleRecording },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.exit(0); } },
  ]);
  tray.setToolTip('Voice STT — Idle');
  tray.setContextMenu(contextMenu);
}

async function toggleRecording() {
  isRecording = !isRecording;

  if (isRecording) {
    try {
      await sttEngine.start();
    } catch (err) {
      console.error('❌ Failed to start STT:', err.message);
      mainWindow?.webContents.send('stt-error', err.message);
      isRecording = false;
      return;
    }
    mainWindow.show();
    mainWindow.webContents.send('recording-state', true);
    tray.setToolTip('Voice STT — Recording...');
  } else {
    mainWindow.webContents.send('recording-state', false);
    tray.setToolTip('Voice STT — Idle');
    await sttEngine.stop();
    setTimeout(() => mainWindow.hide(), 800);
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    if (micStatus !== 'granted') {
      try { await systemPreferences.askForMediaAccess('microphone'); } catch (_) {}
    }
  }

  modelManager = new ModelManager();
  ghostTyper = new GhostTyper();

  sttEngine = new SttEngine({
    onInterim: (text, prevText) => {
      ghostTyper.handleInterim(text, prevText);
      mainWindow?.webContents.send('transcript', { text, isFinal: false });
    },
    onFinal: (text) => {
      ghostTyper.handleFinal(text);
      mainWindow?.webContents.send('transcript', { text, isFinal: true });
    },
  });

  createWindow();
  createTray();

  // ── IPC ──

  ipcMain.on('whisper-interim', (_, text) => sttEngine.handleInterim(text));
  ipcMain.on('whisper-final', (_, text) => sttEngine.handleFinal(text));
  ipcMain.on('set-language', (_, lang) => sttEngine.setLanguage(lang));

  ipcMain.handle('get-language', () => sttEngine.getLanguage());
  ipcMain.handle('get-lang-options', () => langOptions);

  // Check if a model URL is already downloaded locally
  ipcMain.handle('is-model-downloaded', (_, url) => modelManager.isDownloaded(url));
  ipcMain.handle('get-model-path', (_, url) => modelManager.getModelPath(url));

  // Read model file bytes from disk → renderer (avoids file:// fetch issues)
  ipcMain.handle('read-model-file', (_, localPath) => {
    const fs = require('fs');
    if (!localPath || !fs.existsSync(localPath)) return null;
    return fs.readFileSync(localPath);
  });

  // Download model by URL, sends progress events
  ipcMain.handle('download-model', async (_, url) => {
    try {
      const localPath = await modelManager.downloadModel(url, (progress) => {
        mainWindow?.webContents.send('download-progress', progress);
      });
      return { success: true, path: localPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  const registered = globalShortcut.register('CommandOrControl+Shift+Space', toggleRecording);
  if (!registered) {
    globalShortcut.register('CommandOrControl+Shift+H', toggleRecording);
  }

  console.log('✅ App ready.');
  console.log(`📁 Models: ${modelManager.getModelsDir()}`);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());
