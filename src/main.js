const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, screen } = require('electron');
const path = require('path');
const { GhostTyper } = require('./ghost-typer');
const { SttEngine } = require('./stt-engine');

let mainWindow = null;
let tray = null;
let isRecording = false;
let sttEngine = null;
let ghostTyper = null;
let audioChunkCount = 0;

function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 320,
    height: 120,
    x: Math.round((screenW - 320) / 2),
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

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'overlay.html'));

  // Log renderer console messages to main terminal
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
    console.log('🎙️ Recording started');
    audioChunkCount = 0;
    mainWindow.show();

    // Start Deepgram FIRST, wait for it to be ready, THEN start mic
    await sttEngine.start();
    console.log('📡 Deepgram ready, now starting mic in renderer...');
    mainWindow.webContents.send('recording-state', true);
    tray.setToolTip('Voice STT — Recording...');
  } else {
    console.log('⏹️ Recording stopped');
    console.log(`📊 Total audio chunks received from renderer: ${audioChunkCount}`);
    mainWindow.webContents.send('recording-state', false);
    tray.setToolTip('Voice STT — Idle');
    await sttEngine.stop();
    setTimeout(() => mainWindow.hide(), 800);
  }
}

app.whenReady().then(async () => {
  // Check and request microphone permission on macOS
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`🎤 macOS mic permission status: "${micStatus}"`);
    if (micStatus !== 'granted') {
      console.log('🎤 Requesting microphone access...');
      try {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        console.log(`🎤 Mic access ${granted ? 'GRANTED ✅' : 'DENIED ❌'}`);
        if (!granted) {
          console.error('❌ Microphone access denied. Go to System Settings > Privacy & Security > Microphone and enable it for Electron.');
        }
      } catch (err) {
        console.error('❌ Error requesting mic access:', err.message);
      }
    }
  }

  ghostTyper = new GhostTyper();
  sttEngine = new SttEngine({
    onInterim: (text, prevText) => {
      console.log(`🖊️ Ghost typing interim: "${text}"`);
      ghostTyper.handleInterim(text, prevText);
      mainWindow?.webContents.send('transcript', { text, isFinal: false });
    },
    onFinal: (text) => {
      console.log(`🖊️ Ghost typing FINAL: "${text}"`);
      ghostTyper.handleFinal(text);
      mainWindow?.webContents.send('transcript', { text, isFinal: true });
    },
  });

  createWindow();
  createTray();

  // Receive PCM audio chunks from renderer and forward to Deepgram
  ipcMain.on('audio-chunk', (_, data) => {
    audioChunkCount++;
    if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
      console.log(`🔈 Audio chunk #${audioChunkCount}, size: ${data?.byteLength || data?.length || 'unknown'} bytes`);
    }
    sttEngine.sendAudio(data);
  });

  // Global hotkey
  const registered = globalShortcut.register('CommandOrControl+Shift+Space', toggleRecording);
  if (registered) {
    console.log('✅ Hotkey Ctrl+Shift+Space registered successfully.');
  } else {
    console.error('⚠️  Failed to register Ctrl+Shift+Space — may be claimed by OS.');
    const fallback = globalShortcut.register('CommandOrControl+Shift+H', toggleRecording);
    if (fallback) console.log('✅ Fallback hotkey Ctrl+Shift+H registered.');
  }

  console.log('✅ App ready. Use the hotkey or tray icon to toggle recording.');
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());
