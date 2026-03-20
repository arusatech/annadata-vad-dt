# annadata-vad-dt — Voice-to-Text with Ghost Typing

A local, privacy-focused Electron app that captures your microphone via a global hotkey and types transcribed text directly into whatever app has focus. Powered by whisper.cpp compiled to WebAssembly — no cloud APIs, no native binaries, no internet required for transcription.

## How It Works

1. Download a whisper model from the overlay UI (fetched from Hugging Face, stored locally).
2. Select your language from the dropdown (30+ languages supported).
3. Press `Ctrl+Shift+Space` (or `Cmd+Shift+Space` on macOS) to start recording.
4. Audio is buffered and transcribed locally via whisper.wasm with periodic interim results.
5. Text is "ghost typed" into the currently focused application.
6. Press the hotkey again to stop — a final transcription runs on all captured audio.

## Architecture

Transcription runs entirely in the Electron renderer process using whisper.cpp compiled to WebAssembly (via Emscripten). Models are loaded into the WASM virtual filesystem from disk. No native binaries or CLI tools needed.

```
Renderer (whisper.wasm)          Main Process
┌─────────────────────┐         ┌──────────────────┐
│ Mic → AudioContext   │         │                  │
│ Buffer Float32 PCM   │         │                  │
│ whisper.wasm transcr.│──IPC──→│ Ghost Typer       │
│ Model management     │         │ (keystroke inject)│
│ Language selection    │         │                  │
└─────────────────────┘         └──────────────────┘
```

## Ghost Typing

Diffs interim results against what's already been typed, sending backspaces and new characters as needed.

- macOS: AppleScript (`System Events` keystroke/key code)
- Windows: [nut-js](https://github.com/nut-tree/nut.js) synthetic keystrokes

## Prerequisites

- Node.js 18+
- Emscripten SDK (to build whisper.wasm) — see below
- macOS: Accessibility and Microphone permissions for Electron

## Building whisper.wasm

The WASM module must be built from the whisper-cpp-capacitor reference:

```bash
# Install Emscripten if you haven't
# https://emscripten.org/docs/getting_started/downloads.html

cd ref-code/whisper-cpp-capacitor
git submodule update --init
./build-native-web.sh

# Copy the built WASM to this project
cp -r dist/wasm ../../libs/wasm
```

This produces `libs/wasm/whisper.js` (single-file with embedded WASM binary).

## Available Models

Downloaded on demand via the overlay UI from Hugging Face:

| Model | Size | Notes |
|-------|------|-------|
| tiny / tiny.en | 75 MB | Fastest, lower accuracy |
| base / base.en | 142 MB | Good balance for English |
| small / small.en | 466 MB | Better accuracy |
| medium / medium.en | 1.5 GB | High accuracy |
| large-v3-turbo | 1.6 GB | Best multilingual accuracy |

`.en` models are English-only and faster. Multilingual models support 30+ languages.

## Supported Languages

Tamil, Telugu, Hindi, Kannada, Odia, Bengali, Malayalam, Punjabi, Gujarati, Marathi, Assamese, Nepali, Sanskrit, Sinhala, Sindhi, Urdu, English, Spanish, French, German, Portuguese, Russian, Japanese, Korean, Chinese, Turkish, Ukrainian, Thai, Greek, Polish, Hebrew.

## Setup

```bash
git clone <repo-url>
cd annadata-vad-dt
npm install
```

## Usage

```bash
npm start
```

The app runs in the system tray. On first launch, download a model from the overlay UI, then use the hotkey to record.

## Project Structure

```
src/
  main.js          Electron main — window, tray, hotkey, IPC, ghost typing
  stt-engine.js    STT engine bridge (receives results from renderer)
  ghost-typer.js   Keystroke injection (AppleScript / nut-js)
  model-manager.js Model download/storage/lifecycle (Hugging Face GGML)
  lang-options.js  Language options for whisper.cpp
  overlay.html     Renderer — mic capture, whisper.wasm transcription, UI
  preload.js       Context bridge for renderer ↔ main IPC
dist/
  wasm/whisper.js  Built whisper.wasm module (you build this)
```

## License

ISC
