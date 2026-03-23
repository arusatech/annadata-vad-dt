# annadata-vad-dt

Global voice-to-text with ghost typing. Cross-platform: Electron (desktop), Capacitor (iOS/Android).

Uses [whisper.cpp](https://github.com/ggerganov/whisper.cpp) compiled to WebAssembly for fully offline speech recognition.

## Architecture

```
src/                  # Shared web app (Vite)
  main.js             # App entry — dual pipeline orchestration
  audio-recorder.js   # Step 1: mic → 1-sec PCM chunks
  whisper-transcriber.js  # Step 2: chunks → whisper.wasm → text
  history-store.js    # IndexedDB storage for audio + transcripts
  lang-options.js     # Language definitions + model URLs
  index.html / styles.css

electron/             # Desktop (Electron main process)
  main.cjs            # Window, tray, hotkey, ghost typing, model download
  preload.cjs         # IPC bridge → __electronBridge

libs/wasm/            # Pre-built whisper.wasm (single-file, embedded binary)
public/wasm/          # Copied here for Vite static serving
```

### Dual Pipeline

1. **Step 1 — Record**: Captures mic audio at 16kHz mono, fills 1-second PCM buffers into a queue
2. **Step 2 — Transcribe**: Starts 1 sec after recording begins, consumes buffers from the queue, runs whisper.wasm on each chunk

Both steps run in parallel. On stop, remaining queued chunks are processed. Audio + transcript are saved to IndexedDB history.

## Quick Start

```bash
npm install
npm run electron    # builds web app + launches Electron
```

Hotkey: `Ctrl+Shift+Space` (or `Cmd+Shift+Space` on macOS) to toggle recording.

## Mobile (Capacitor)

```bash
npm run build
npx cap add android   # first time only
npx cap add ios       # first time only
npm run cap:android
npm run cap:ios
```

On native platforms, `whisper-cpp-capacitor` plugin provides native whisper.cpp integration.

## Building whisper.wasm

```bash
cd ref-code/whisper-cpp-capacitor
git submodule update --init
./build-native-web.sh

cp -r dist/wasm ../../libs/wasm
cp -r dist/wasm ../../public/wasm
```

## Models

Downloaded on demand from Hugging Face. Stored in a shared system location:
- macOS: `/Users/Shared/annadata-vad-dt/models/`
- Windows: `C:\ProgramData\annadata-vad-dt\models\`
- Fallback: `~/annadata-vad-dt/models/`
