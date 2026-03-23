# Requirements Document

## Introduction

Phase 1 of ANNADATA-VAD-DT focuses on transforming the existing Electron desktop app into a high-performance, responsive voice-to-text overlay. The current implementation suffers from unresponsive UI buttons (caused by `-webkit-app-region: drag` conflicts and async race conditions), a monolithic single-IIFE renderer architecture that hinders debugging, use of the deprecated ScriptProcessorNode for audio capture, and a complete absence of error handling across the audio recording, transcription, model loading, and IPC communication pipeline. This phase rewires click handling, modularizes the renderer, replaces deprecated audio APIs, and adds comprehensive error boundaries while maintaining the existing feature set (ghost typing, global hotkey, tray icon, IndexedDB history, multi-language whisper.cpp WASM transcription).

## Glossary

- **Overlay_Window**: The frameless, always-on-top Electron BrowserWindow that serves as the voice-to-text UI, positioned at the top-center of the screen.
- **Renderer_Process**: The Electron renderer process that runs the UI, audio capture, and WASM transcription logic inside the Overlay_Window.
- **Main_Process**: The Electron main process (`electron/main.cjs`) responsible for window management, IPC handling, model file I/O, ghost typing, global hotkey registration, and tray icon.
- **IPC_Bridge**: The preload-based communication layer (`electron/preload.cjs`) that exposes `__electronBridge` to the Renderer_Process via `contextBridge.exposeInMainWorld`.
- **Audio_Recorder**: The module responsible for capturing microphone audio at 16 kHz mono and delivering 1-second PCM Float32 chunks to the transcription pipeline.
- **Whisper_Transcriber**: The module that loads whisper.cpp WASM, manages model contexts, and transcribes PCM audio chunks into text.
- **Transcription_Pipeline**: The end-to-end flow from audio chunk capture through WASM transcription to text display and ghost typing output.
- **Ghost_Typer**: The Main_Process component that simulates keyboard input of transcribed text into the currently focused application (macOS AppleScript, future Windows nut-js).
- **History_Store**: The IndexedDB-backed module that persists completed recording sessions (timestamp, language, audio PCM, transcript text).
- **Language_Selector**: The dropdown UI component that allows the user to choose a transcription language and triggers model download/loading.
- **Model_Manager**: The Main_Process component responsible for downloading, storing, and serving whisper.cpp GGML model files from the shared models directory.
- **AudioWorkletNode**: The modern Web Audio API node that replaces the deprecated ScriptProcessorNode for real-time audio processing on a dedicated audio thread.
- **Drag_Region**: The CSS property `-webkit-app-region: drag` that enables window dragging on frameless Electron windows but intercepts pointer events on child elements.
- **Chunk_Queue**: The in-memory array of PCM audio chunks awaiting transcription by the Whisper_Transcriber.

## Requirements

### Requirement 1: Responsive Button Click Handling

**User Story:** As a user, I want all UI buttons (record, stop, history, language) to respond immediately to clicks, so that I can control the app without frustration.

#### Acceptance Criteria

1. WHEN the user clicks the record button, THE Renderer_Process SHALL initiate recording within 100ms of the click event firing.
2. WHEN the user clicks the stop button while recording is active, THE Renderer_Process SHALL stop recording within 100ms of the click event firing.
3. WHEN the user clicks the history button, THE Renderer_Process SHALL toggle the history panel within 100ms of the click event firing.
4. WHEN the user clicks the language button, THE Renderer_Process SHALL toggle the Language_Selector dropdown within 100ms of the click event firing.
5. THE Overlay_Window SHALL set `-webkit-app-region: no-drag` on all interactive elements and their ancestors up to the `#app` container, so that Drag_Region properties do not intercept pointer events on buttons.
6. THE Overlay_Window SHALL confine `-webkit-app-region: drag` to a dedicated non-interactive drag handle area that does not overlap any button or dropdown.

### Requirement 2: Modular Renderer Architecture

**User Story:** As a developer, I want the renderer code split into focused modules, so that I can debug, test, and maintain each concern independently.

#### Acceptance Criteria

1. THE Renderer_Process SHALL separate audio recording logic into a standalone Audio_Recorder module with a public API of `start(onChunk)`, `stop() → Float32Array`, and `isRecording() → boolean`.
2. THE Renderer_Process SHALL separate transcription logic into a standalone Whisper_Transcriber module with a public API of `loadModel(url)`, `transcribe(pcm, lang) → string`, and `isModelLoaded() → boolean`.
3. THE Renderer_Process SHALL separate history persistence into a standalone History_Store module with a public API of `save(entry)` and `getRecent(limit) → Array`.
4. THE Renderer_Process SHALL separate language selection into a standalone Language_Selector module that manages dropdown state, language picking, and model download triggering.
5. THE Renderer_Process SHALL use ES module imports to compose the modules, replacing the single IIFE pattern.
6. THE Renderer_Process SHALL load via a single entry-point module (`main.js`) that wires together all sub-modules and DOM event listeners.

### Requirement 3: Modern Audio Capture with AudioWorkletNode

**User Story:** As a developer, I want audio capture to use AudioWorkletNode instead of the deprecated ScriptProcessorNode, so that audio processing runs on a dedicated thread and does not block the UI.

#### Acceptance Criteria

1. THE Audio_Recorder SHALL use an AudioWorkletNode for real-time PCM capture at 16 kHz sample rate, mono channel.
2. THE Audio_Recorder SHALL register an AudioWorklet processor that buffers incoming samples and posts 1-second (16000-sample) Float32Array chunks to the main thread via `MessagePort`.
3. THE Audio_Recorder SHALL accumulate partial buffers across `process()` calls and flush a complete chunk only when 16000 samples have been collected.
4. WHEN the user stops recording, THE Audio_Recorder SHALL flush any remaining partial buffer as a final chunk before disconnecting the audio graph.
5. IF the browser does not support AudioWorkletNode, THEN THE Audio_Recorder SHALL fall back to ScriptProcessorNode and log a warning to the console.

### Requirement 4: Stop Recording Reliability

**User Story:** As a user, I want the stop button to reliably halt recording and finalize transcription, so that I never get stuck in a recording state.

#### Acceptance Criteria

1. WHEN the user clicks stop, THE Renderer_Process SHALL set a `recording` flag to `false` before awaiting any async cleanup operations.
2. WHEN the `recording` flag becomes `false`, THE Transcription_Pipeline SHALL exit the transcribe loop within one iteration cycle (at most 200ms polling interval plus one transcription duration).
3. WHEN the user clicks stop, THE Audio_Recorder SHALL disconnect the AudioWorkletNode, close the AudioContext, and stop all MediaStream tracks within 500ms.
4. WHEN the user clicks stop while a transcription is in progress, THE Renderer_Process SHALL wait for the current transcription call to complete before finalizing the session transcript.
5. THE Renderer_Process SHALL use an AbortController or equivalent cancellation signal to coordinate stop requests across the Audio_Recorder and Transcription_Pipeline.

### Requirement 5: Error Handling for Audio Recording

**User Story:** As a user, I want clear feedback when audio recording fails, so that I know what went wrong and can take corrective action.

#### Acceptance Criteria

1. IF `getUserMedia` rejects with a `NotAllowedError`, THEN THE Renderer_Process SHALL display "Microphone access denied" in the text overlay and reset the record button to idle state.
2. IF `getUserMedia` rejects with a `NotFoundError`, THEN THE Renderer_Process SHALL display "No microphone found" in the text overlay and reset the record button to idle state.
3. IF the AudioContext fails to initialize, THEN THE Renderer_Process SHALL display "Audio system error" in the text overlay, log the error details to the console, and reset the record button to idle state.
4. IF the AudioWorkletNode disconnects unexpectedly during recording, THEN THE Audio_Recorder SHALL emit an error event and THE Renderer_Process SHALL stop recording gracefully and display "Recording interrupted" in the text overlay.

### Requirement 6: Error Handling for Whisper WASM Transcription

**User Story:** As a user, I want the app to recover gracefully from transcription errors, so that a single failure does not break the entire session.

#### Acceptance Criteria

1. IF `WhisperModule` initialization fails, THEN THE Whisper_Transcriber SHALL throw a descriptive error and THE Renderer_Process SHALL display "Transcription engine failed to load" in the text overlay.
2. IF `whisper.init()` returns an empty or invalid context, THEN THE Whisper_Transcriber SHALL throw an error with the model file path and THE Renderer_Process SHALL display "Model initialization failed" in the text overlay.
3. IF `whisper.transcribe()` throws an exception for a single chunk, THEN THE Transcription_Pipeline SHALL log the error, skip the failed chunk, and continue processing the next chunk in the Chunk_Queue.
4. IF `wasm_malloc` returns a null pointer, THEN THE Whisper_Transcriber SHALL skip the chunk, log "WASM memory allocation failed" to the console, and return an empty string.
5. THE Whisper_Transcriber SHALL always call `wasm_free` on allocated pointers in a `finally` block, regardless of whether transcription succeeded or failed.

### Requirement 7: Error Handling for Model Download and Loading

**User Story:** As a user, I want clear progress and error feedback during model downloads, so that I understand what the app is doing and can retry if something fails.

#### Acceptance Criteria

1. WHEN a model download is in progress, THE Renderer_Process SHALL display the download percentage in the text overlay, updated at least every 5 percentage points.
2. IF a model download fails due to a network error, THEN THE Main_Process SHALL return `{ success: false, error: <message> }` and THE Renderer_Process SHALL display "Download failed: <message>" in the text overlay.
3. IF a model download is interrupted (partial `.tmp` file exists), THEN THE Model_Manager SHALL delete the partial file before retrying the download.
4. IF the model file on disk is corrupted (whisper.init fails after loading), THEN THE Renderer_Process SHALL display "Model corrupted, re-downloading..." and THE Model_Manager SHALL delete the file and re-download.
5. WHEN a model is being loaded into WASM memory, THE Renderer_Process SHALL display "Loading model..." in the text overlay.

### Requirement 8: Error Handling for IPC Communication

**User Story:** As a developer, I want IPC calls between renderer and main process to handle failures gracefully, so that a broken IPC channel does not crash the app.

#### Acceptance Criteria

1. THE IPC_Bridge SHALL wrap each `ipcRenderer.invoke` call in a try-catch and return a structured error object `{ success: false, error: <message> }` on failure.
2. IF an IPC handler in the Main_Process throws an unhandled exception, THEN THE Main_Process SHALL catch the exception, log it, and return a structured error response to the Renderer_Process.
3. IF the Renderer_Process calls an IPC method before the Main_Process has registered the handler, THEN THE IPC_Bridge SHALL return a descriptive error rather than hanging indefinitely.
4. THE Main_Process SHALL register an `uncaughtException` handler that logs the error and prevents the process from crashing.
5. THE Main_Process SHALL register an `unhandledRejection` handler that logs the rejected promise reason.

### Requirement 9: Overlay Window Sizing for Dropdowns

**User Story:** As a user, I want the language dropdown and history panel to be fully visible without clipping, so that I can see and select all options.

#### Acceptance Criteria

1. WHEN the Language_Selector dropdown opens, THE Overlay_Window SHALL resize to at least 360px height to accommodate the dropdown content.
2. WHEN the Language_Selector dropdown closes and the history panel is not open, THE Overlay_Window SHALL resize back to 60px height.
3. WHEN the history panel opens, THE Overlay_Window SHALL resize to at least 400px height.
4. WHEN the history panel closes, THE Overlay_Window SHALL resize back to 60px height.
5. THE Language_Selector dropdown SHALL open in a direction (upward or downward) that keeps the dropdown fully within the Overlay_Window bounds.

### Requirement 10: Transcription Latency Target

**User Story:** As a user, I want transcribed text to appear within a reasonable delay after speaking, so that the voice-to-text experience feels responsive.

#### Acceptance Criteria

1. WHEN a 1-second audio chunk completes capture, THE Transcription_Pipeline SHALL deliver the transcribed text to the text overlay within 2 seconds of chunk completion under normal operating conditions.
2. THE Audio_Recorder SHALL deliver each 1-second chunk to the Chunk_Queue within 50ms of the chunk boundary being reached.
3. THE Transcription_Pipeline SHALL process chunks in FIFO order from the Chunk_Queue without reordering.
4. WHILE the Chunk_Queue contains pending chunks, THE Transcription_Pipeline SHALL process the next chunk immediately after the current transcription completes, without additional polling delay.

### Requirement 11: Graceful Degradation for Ghost Typing

**User Story:** As a developer, I want ghost typing to fail silently on unsupported platforms, so that the transcription pipeline works everywhere even if ghost typing is unavailable.

#### Acceptance Criteria

1. WHEN the Ghost_Typer receives a transcript on macOS, THE Ghost_Typer SHALL execute the AppleScript keystroke command to type the text into the focused application.
2. WHEN the Ghost_Typer receives a transcript on a non-macOS platform where ghost typing is not implemented, THE Ghost_Typer SHALL log a debug message and skip the typing action without throwing an error.
3. IF the AppleScript execution fails, THEN THE Ghost_Typer SHALL log the error to the console and continue processing subsequent transcripts.
4. THE Ghost_Typer SHALL not block the Transcription_Pipeline; ghost typing execution SHALL be fire-and-forget relative to the transcription flow.

### Requirement 12: Consolidated Renderer Codebase

**User Story:** As a developer, I want a single canonical renderer codebase, so that there is no confusion about which files are active and changes are made in one place.

#### Acceptance Criteria

1. THE project SHALL maintain a single renderer entry point that the Electron Main_Process loads.
2. THE Renderer_Process source files SHALL reside in one directory (either `src/` or `renderer/`, not both).
3. WHEN the consolidated codebase is loaded by Electron, THE Overlay_Window SHALL render the same 4-column layout: record button, center waveform/text area, history button, and language selector.
4. THE consolidated codebase SHALL use ES module syntax (`import`/`export`) for all internal module dependencies.
