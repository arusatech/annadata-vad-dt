import { AudioRecorder } from './audio-recorder.js';
import { saveRecording, getHistory } from './history-store.js';

// ── DOM ──
const recBtn = document.getElementById('recBtn');
const recIconMic = document.getElementById('recIconMic');
const recIconStop = document.getElementById('recIconStop');
const waveCanvas = document.getElementById('waveCanvas');
const textOverlay = document.getElementById('textOverlay');
const liveView = document.getElementById('liveView');
const historyView = document.getElementById('historyView');
const historyList = document.getElementById('historyList');
const historyBtn = document.getElementById('historyBtn');
const appEl = document.getElementById('app');
const ctx = waveCanvas.getContext('2d');

// ── State ──
const recorder = new AudioRecorder();
let recording = false;
let historyOpen = false;

// ── Scrolling waveform ──
let rafId = null;
const WAVE_COLOR = '#e33';
const WAVE_COLOR_DIM = '#822';
const waveHistory = [];
let waveWidth = 320;

// Volume source: 'recorder' for live mic, or a function for playback
let volumeSource = null;

function resizeCanvas() {
  const rect = waveCanvas.parentElement.getBoundingClientRect();
  waveCanvas.width = Math.floor(rect.width * devicePixelRatio);
  waveCanvas.height = Math.floor(rect.height * devicePixelRatio);
  waveWidth = Math.floor(rect.width);
}

function animateWaveform() {
  let vol = 0;
  if (volumeSource === 'recorder') {
    vol = recorder.getVolume();
  } else if (typeof volumeSource === 'function') {
    vol = volumeSource();
  }
  // Add jitter for organic look
  const jitter = vol > 0.05 ? (Math.random() * 0.15 - 0.075) : 0;
  waveHistory.push(Math.max(0, Math.min(1, vol + jitter)));

  const maxPoints = Math.floor(waveWidth / 2) + 1;
  while (waveHistory.length > maxPoints) waveHistory.shift();

  drawWaveform();
  rafId = requestAnimationFrame(animateWaveform);
}

function drawWaveform() {
  const w = waveCanvas.width;
  const h = waveCanvas.height;
  const midY = h / 2;
  ctx.clearRect(0, 0, w, h);
  if (waveHistory.length < 2) return;

  const step = w / (waveHistory.length - 1);
  ctx.beginPath();
  ctx.moveTo(0, midY);
  for (let i = 0; i < waveHistory.length; i++) {
    ctx.lineTo(i * step, midY - waveHistory[i] * midY * 0.85);
  }
  for (let i = waveHistory.length - 1; i >= 0; i--) {
    ctx.lineTo(i * step, midY + waveHistory[i] * midY * 0.85);
  }
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, WAVE_COLOR_DIM);
  grad.addColorStop(0.7, WAVE_COLOR);
  grad.addColorStop(1, WAVE_COLOR);
  ctx.fillStyle = grad;
  ctx.fill();
}

function startWaveform(source) {
  resizeCanvas();
  waveHistory.length = 0;
  volumeSource = source;
  waveCanvas.classList.add('active');
  if (!rafId) rafId = requestAnimationFrame(animateWaveform);
}

function stopWaveform() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  waveCanvas.classList.remove('active');
  waveHistory.length = 0;
  volumeSource = null;
  ctx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
}

// ── UI helpers ──
function setRecordingUI(on) {
  recBtn.classList.toggle('recording', on);
  recIconMic.style.display = on ? 'none' : 'block';
  recIconStop.style.display = on ? 'block' : 'none';
  if (!on) stopWaveform();
}

function setText(msg) { textOverlay.textContent = msg; }

// ── Record / Stop ──
recBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  console.log('[main] recBtn clicked, recording:', recording);
  if (recording) {
    doStop();
  } else {
    doStart();
  }
});

async function doStart() {
  if (recording) return;
  recording = true;
  setRecordingUI(true);
  setText('');
  if (historyOpen) toggleHistory();
  try {
    await recorder.start();
    if (!recording) {
      // User clicked stop before start finished
      recorder.stop().catch(() => {});
      return;
    }
    startWaveform('recorder');
  } catch (err) {
    console.error('[main] Start failed:', err);
    recording = false;
    setRecordingUI(false);
    setText(err.message || 'Audio error');
  }
}

async function doStop() {
  if (!recording) return;
  recording = false;
  setRecordingUI(false);
  setText('Saving...');
  try {
    const pcm = await recorder.stop();
    console.log('[main] Stopped, samples:', pcm.length);
    if (pcm.length > 0) {
      // Check if all zeros
      let maxAbs = 0;
      for (let i = 0; i < pcm.length; i++) {
        const a = Math.abs(pcm[i]);
        if (a > maxAbs) maxAbs = a;
      }
      if (maxAbs === 0) {
        setText('⚠ No mic audio — check permissions');
        // Try to open mic settings automatically
        if (globalThis.__electronBridge?.openMicSettings) {
          console.log('[main] Opening mic privacy settings...');
          globalThis.__electronBridge.openMicSettings();
        }
        return;
      }
      const dur = (pcm.length / 16000).toFixed(1);
      await saveRecording({ lang: 'en', audio: pcm, transcript: `Recording (${dur}s)` });
      setText(`Saved ${dur}s`);
    } else {
      setText('No audio captured');
    }
  } catch (err) {
    console.error('[main] Stop failed:', err);
    setText('Error saving');
  }
}

// ── History ──
historyBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleHistory();
});

function toggleHistory() {
  historyOpen = !historyOpen;
  historyBtn.classList.toggle('active', historyOpen);
  appEl.classList.toggle('history-open', historyOpen);
  if (historyOpen) {
    liveView.style.display = 'none';
    historyView.style.display = 'block';
    renderHistory();
    if (globalThis.__electronBridge?.resizeWindow) globalThis.__electronBridge.resizeWindow(480, 400);
  } else {
    liveView.style.display = 'flex';
    historyView.style.display = 'none';
    if (globalThis.__electronBridge?.resizeWindow) globalThis.__electronBridge.resizeWindow(480, 60);
  }
}

let playingCtx = null;
let playingSrc = null;
let playbackAnalyser = null;

function stopPlayback() {
  try { playingSrc?.stop(); } catch (_) {}
  try { playingCtx?.close(); } catch (_) {}
  playingCtx = null;
  playingSrc = null;
  playbackAnalyser = null;
  stopWaveform();
}

async function renderHistory() {
  const items = await getHistory(30);
  historyList.innerHTML = '';
  if (!items.length) {
    historyList.innerHTML = '<div class="hi-empty">No recordings yet</div>';
    return;
  }
  for (const item of items) {
    const dur = (item.audio.length / 16000).toFixed(1);
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="hi-time">${new Date(item.timestamp).toLocaleString()}</div>
      <div class="hi-text">${dur}s recording</div>
      <div class="hi-controls">
        <span class="hi-play" data-action="play">▶ Play</span>
        <span class="hi-stop-play" data-action="stop" style="display:none">■ Stop</span>
      </div>`;

    const playBtn = div.querySelector('[data-action="play"]');
    const stopBtn = div.querySelector('[data-action="stop"]');

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stopPlayback();

      playingCtx = new AudioContext();
      const buf = playingCtx.createBuffer(1, item.audio.length, 16000);
      buf.getChannelData(0).set(item.audio);
      playingSrc = playingCtx.createBufferSource();
      playingSrc.buffer = buf;

      // Gain boost
      const gain = playingCtx.createGain();
      gain.gain.value = 3.0;

      // Analyser for playback waveform
      playbackAnalyser = playingCtx.createAnalyser();
      playbackAnalyser.fftSize = 256;
      const dataArr = new Uint8Array(playbackAnalyser.frequencyBinCount);

      playingSrc.connect(gain);
      gain.connect(playbackAnalyser);
      playbackAnalyser.connect(playingCtx.destination);
      playingSrc.start();

      console.log('[playback] Playing', item.audio.length, 'samples, ctx rate:', playingCtx.sampleRate);

      // Start waveform with playback analyser as volume source
      startWaveform(() => {
        if (!playbackAnalyser) return 0;
        playbackAnalyser.getByteTimeDomainData(dataArr);
        let max = 0;
        for (let i = 0; i < dataArr.length; i++) {
          const v = Math.abs(dataArr[i] - 128) / 128;
          if (v > max) max = v;
        }
        return max;
      });

      playBtn.style.display = 'none';
      stopBtn.style.display = 'inline';

      playingSrc.onended = () => {
        playBtn.style.display = 'inline';
        stopBtn.style.display = 'none';
        stopPlayback();
      };
    });

    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stopPlayback();
      playBtn.style.display = 'inline';
      stopBtn.style.display = 'none';
    });

    historyList.appendChild(div);
  }
}

// ── Keyboard shortcut ──
if (globalThis.__electronBridge?.onRecordingState) {
  globalThis.__electronBridge.onRecordingState((active) => {
    if (active && !recording) doStart();
    else if (!active && recording) doStop();
  });
} else {
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      if (recording) doStop(); else doStart();
    }
  });
}

setText('Ready');
