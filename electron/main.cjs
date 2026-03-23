/**
 * Electron main process for annadata-vad-dt.
 *
 * Loads the Vite-built web app (dist/index.html) in a frameless overlay window.
 * Provides IPC bridge for: ghost typing, model download, global hotkey.
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

// ── Chromium flags to fix audio capture on macOS ──
// Disable audio sandbox — prevents zero-filled buffers in dev mode
app.commandLine.appendSwitch('disable-features', 'AudioServiceSandbox');
// Use the system audio service instead of sandboxed one
app.commandLine.appendSwitch('enable-features', 'AudioServiceOutOfProcess');
// Disable audio output resampling to avoid potential issues
app.commandLine.appendSwitch('disable-audio-output-resampler');
// Use fake UI for media stream — this bypasses the permission prompt issue
// but still uses real devices
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

// ── Process-level error handlers (prevent crash on unhandled errors) ──
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

let mainWindow = null;
let tray = null;
let isRecording = false;

// ── Model storage ──
function getModelsDir() {
  const candidates = process.platform === 'darwin'
    ? [path.join('/Users/Shared', 'annadata-vad-dt', 'models')]
    : process.platform === 'win32'
      ? [path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'annadata-vad-dt', 'models')]
      : [path.join('/var/lib', 'annadata-vad-dt', 'models')];

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (_) { /* try next */ }
  }
  const fallback = path.join(os.homedir(), 'annadata-vad-dt', 'models');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

const modelsDir = getModelsDir();
console.log(`📁 Models: ${modelsDir}`);

function isModelDownloaded(url) {
  if (!url) return false;
  return fs.existsSync(path.join(modelsDir, url.split('/').pop()));
}

function getModelPath(url) {
  if (!url) return null;
  const p = path.join(modelsDir, url.split('/').pop());
  return fs.existsSync(p) ? p : null;
}

function downloadModel(url, onProgress) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('No URL'));
    const filename = url.split('/').pop();
    const dest = path.join(modelsDir, filename);
    if (fs.existsSync(dest)) return resolve(dest);

    const tmp = dest + '.tmp';
    // Delete stale .tmp file before starting download (Req 7.3)
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    const follow = (reqUrl) => {
      const mod = reqUrl.startsWith('https') ? https : require('http');
      mod.get(reqUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let loaded = 0;
        const file = fs.createWriteStream(tmp);
        res.on('data', (chunk) => {
          loaded += chunk.length;
          file.write(chunk);
          if (onProgress && total > 0) {
            onProgress({ loaded, total, percentage: Math.round((loaded / total) * 100) });
          }
        });
        res.on('end', () => {
          file.end(() => {
            fs.renameSync(tmp, dest);
            resolve(dest);
          });
        });
        res.on('error', (err) => { file.close(); reject(err); });
      }).on('error', reject);
    };
    follow(url);
  });
}

// ── Ghost Typer (macOS AppleScript, Windows nut-js) ──
const { exec } = require('child_process');
let lastTyped = '';

function ghostType(text) {
  if (!text) return;
  if (process.platform !== 'darwin') {
    console.debug('Ghost typing skipped: not macOS');
    return;
  }
  try {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `tell application "System Events" to keystroke "${escaped}"`;
    // Fire-and-forget: don't await, log errors silently
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
      if (err) console.error('Ghost type error:', err.message);
    });
  } catch (err) {
    console.error('Ghost type error:', err.message);
  }
}

function ghostBackspace(count) {
  if (count <= 0) return;
  if (process.platform !== 'darwin') {
    console.debug('Ghost backspace skipped: not macOS');
    return;
  }
  try {
    exec(`osascript -e 'tell application "System Events"\nrepeat ${count} times\nkey code 51\nend repeat\nend tell'`, (err) => {
      if (err) console.error('Ghost backspace error:', err.message);
    });
  } catch (err) {
    console.error('Ghost backspace error:', err.message);
  }
}

function handleTranscript(text) {
  if (!text) return;
  // Simple approach: clear previous, type new
  if (lastTyped) {
    ghostBackspace(lastTyped.length);
  }
  ghostType(text);
  lastTyped = text;
}

function handleFinalTranscript(text) {
  if (lastTyped) {
    ghostBackspace(lastTyped.length);
  }
  ghostType(text + ' ');
  lastTyped = '';
}

// ── Window ──
function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 480,
    height: 60,
    x: Math.round((screenW - 480) / 2),
    y: 8,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: true,
    hasShadow: true,
    backgroundColor: '#111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Auto-grant media (mic) permission without prompting
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Also handle permission checks (Chromium internal checks)
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') return true;
    return false;
  });

  // NOTE: COOP/COEP headers removed — they cause MediaStreamSource to deliver
  // zero-filled buffers. SharedArrayBuffer is not needed (nThreads=1).

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Load renderer directly (no build step)
  const indexPath = path.join(__dirname, '..', 'src', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.webContents.on('console-message', (_, level, message) => {
    console.log(`[renderer] ${message}`);
  });

  mainWindow.on('close', (e) => { e.preventDefault(); mainWindow.hide(); });
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'mic-off.png'));
  const menu = Menu.buildFromTemplate([
    { label: 'Toggle Recording (Ctrl+Shift+Space)', click: toggleRecording },
    { type: 'separator' },
    { label: 'Quit', click: () => app.exit(0) },
  ]);
  tray.setToolTip('annadata-vad-dt — Idle');
  tray.setContextMenu(menu);
}

function toggleRecording() {
  isRecording = !isRecording;
  if (isRecording) {
    mainWindow.show();
    mainWindow.webContents.send('recording-state', true);
    tray.setToolTip('annadata-vad-dt — Recording...');
  } else {
    mainWindow.webContents.send('recording-state', false);
    tray.setToolTip('annadata-vad-dt — Idle');
    lastTyped = '';
    setTimeout(() => mainWindow.hide(), 800);
  }
}

// ── App ready ──
app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    const { systemPreferences, shell } = require('electron');
    const { exec: execCb } = require('child_process');

    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log('🎤 Mic permission status:', micStatus);

    // Always request — even if status says 'granted', it may be lying
    const granted = await systemPreferences.askForMediaAccess('microphone');
    console.log('🎤 askForMediaAccess result:', granted);

    const finalStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log('🎤 Final mic status:', finalStatus);

    if (!granted) {
      console.error('🎤 Microphone access DENIED.');
      console.error('🎤 Try: tccutil reset Microphone com.github.Electron');
      console.error('🎤 Then restart the app.');
      // Open privacy settings
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    } else {
      console.log('🎤 Microphone access granted. If audio is still zeros:');
      console.log('🎤   1. Check System Settings > Sound > Input — volume not zero');
      console.log('🎤   2. Run: tccutil reset Microphone');
      console.log('🎤   3. Restart the app to get a fresh permission prompt');
    }
  }

  createWindow();
  createTray();

  // IPC handlers — wrapped in try-catch returning structured errors (Req 8.2)
  ipcMain.handle('is-model-downloaded', (_, url) => {
    try {
      return isModelDownloaded(url);
    } catch (err) {
      console.error('IPC is-model-downloaded error:', err);
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('get-model-path', (_, url) => {
    try {
      return getModelPath(url);
    } catch (err) {
      console.error('IPC get-model-path error:', err);
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('read-model-file', (_, localPath) => {
    try {
      if (!localPath || !fs.existsSync(localPath)) return null;
      return fs.readFileSync(localPath);
    } catch (err) {
      console.error('IPC read-model-file error:', err);
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('delete-model-file', (_, url) => {
    try {
      if (!url) return { success: false, error: 'No URL provided' };
      const filename = url.split('/').pop();
      const filePath = path.join(modelsDir, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { success: true };
    } catch (err) {
      console.error('IPC delete-model-file error:', err);
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('download-model', async (_, url) => {
    try {
      await downloadModel(url, (progress) => {
        mainWindow?.webContents.send('download-progress', progress);
      });
      return { success: true };
    } catch (err) {
      console.error('IPC download-model error:', err);
      return { success: false, error: err.message };
    }
  });
  ipcMain.on('transcript', (_, text) => {
    try { handleTranscript(text); } catch (err) { console.error('IPC transcript error:', err); }
  });
  ipcMain.on('final-transcript', (_, text) => {
    try { handleFinalTranscript(text); } catch (err) { console.error('IPC final-transcript error:', err); }
  });
  ipcMain.on('resize-window', (_, w, h) => {
    try { if (mainWindow) mainWindow.setSize(w, h); } catch (err) { console.error('IPC resize-window error:', err); }
  });

  // Open macOS microphone privacy settings (called from renderer when zeros detected)
  ipcMain.handle('open-mic-settings', async () => {
    if (process.platform === 'darwin') {
      const { shell, systemPreferences } = require('electron');
      const status = systemPreferences.getMediaAccessStatus('microphone');
      console.log('🎤 open-mic-settings called, current status:', status);
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
      return { status };
    }
    return { status: 'not-darwin' };
  });

  // Check mic permission status from renderer
  ipcMain.handle('get-mic-status', () => {
    if (process.platform === 'darwin') {
      const { systemPreferences } = require('electron');
      return systemPreferences.getMediaAccessStatus('microphone');
    }
    return 'granted';
  });

  const registered = globalShortcut.register('CommandOrControl+Shift+Space', toggleRecording);
  if (!registered) globalShortcut.register('CommandOrControl+Shift+H', toggleRecording);

  console.log('✅ App ready.');
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());
