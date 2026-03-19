# annadata-vad-dt — Voice-to-Text with Ghost Typing

An Electron app that captures your microphone via a global hotkey and types transcribed text directly into whatever app has focus. Powered by Deepgram's real-time speech-to-text API.

## How It Works

1. Press `Ctrl+Shift+Space` (or `Cmd+Shift+Space` on macOS) to start recording.
2. A small floating overlay appears showing the transcription status.
3. Audio is streamed to Deepgram's Nova-2 model for real-time transcription.
4. Interim and final results are "ghost typed" into the currently focused application — keystrokes are injected as if you were typing.
5. Press the hotkey again to stop.

## Ghost Typing

The app diffs interim transcription results against what's already been typed, sending backspaces and new characters as needed. This gives a natural, real-time typing feel.

- macOS: uses AppleScript (`System Events` keystroke/key code)
- Windows: uses [nut-js](https://github.com/nut-tree/nut.js) for synthetic keystrokes

## Prerequisites

- Node.js 18+
- A [Deepgram](https://deepgram.com/) API key
- macOS: Accessibility and Microphone permissions must be granted to Electron
- Windows: nut-js handles input injection natively

## Setup

```bash
git clone <repo-url>
cd annadata-vad-dt
npm install
```

Copy the example env file and add your Deepgram key:

```bash
cp .env.example .env
```

Edit `.env`:

```
DEEPGRAM_API_KEY=your_key_here
```

## Usage

```bash
npm start
```

The app runs in the system tray. Use the global hotkey or the tray menu to toggle recording.

## Project Structure

```
src/
  main.js          Electron main process — window, tray, hotkey, IPC
  stt-engine.js    Deepgram WebSocket client (Nova-2, streaming PCM)
  ghost-typer.js   Keystroke injection (AppleScript on macOS, nut-js on Windows)
  overlay.html     Floating pill overlay — mic capture + transcript display
  preload.js       Context bridge for renderer ↔ main IPC
scripts/
  gen-icons.js     Generates placeholder tray icons (16x16 PNGs)
assets/
  mic-on.png       Tray icon (recording)
  mic-off.png      Tray icon (idle)
```

## Dev Mode

```bash
npm run dev
```

## License

ISC
