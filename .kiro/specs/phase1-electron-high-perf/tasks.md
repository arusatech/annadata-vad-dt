# Implementation Plan: Phase 1 — Electron High-Performance Renderer

## Overview

This plan consolidates the dual renderer codebases into `src/`, replaces deprecated audio APIs with AudioWorkletNode, adds comprehensive error handling across all async boundaries, and fixes UI responsiveness issues caused by drag region conflicts. Tasks are ordered so foundational changes (consolidation, module structure) come before feature work (AudioWorklet, error handling, testing).

## Tasks

- [x] 1. Project setup and codebase consolidation
  - [x] 1.1 Add Vitest and fast-check as devDependencies
    - Run `npm install --save-dev vitest fast-check fake-indexeddb` and add a `"test"` script to `package.json`
    - _Requirements: 2.5 (testing infrastructure)_

  - [x] 1.2 Update `electron/main.cjs` to load `src/index.html`
    - Change `const indexPath = path.join(__dirname, '..', 'renderer', 'index.html')` to `path.join(__dirname, '..', 'src', 'index.html')`
    - _Requirements: 12.1, 12.2_

  - [x] 1.3 Update `src/index.html` whisper.js script path
    - Change the whisper.js `<script>` tag `src` from `./wasm/whisper.js` to `../libs/wasm/whisper.js` so it resolves correctly when loaded from `src/`
    - _Requirements: 12.1, 12.3_

  - [x] 1.4 Remove the `renderer/` directory
    - Delete `renderer/app.js`, `renderer/index.html`, `renderer/styles.css` since all functionality is now in `src/`
    - _Requirements: 12.2_

- [x] 2. Fix UI responsiveness and drag region handling
  - [x] 2.1 Update `src/styles.css` drag region CSS
    - Set `body { -webkit-app-region: drag; }` and `#app { -webkit-app-region: no-drag; }`
    - Ensure all interactive elements (`.icon-btn`, `#langWrap`, `.lang-dropdown`, `.lang-option`, `#centerCol`, `#historyList`, `.history-item`, `.hi-play`) have `-webkit-app-region: no-drag`
    - _Requirements: 1.5, 1.6_

  - [x] 2.2 Verify button click handlers in `src/main.js`
    - Confirm record, stop, history, and language buttons have direct click/pointerdown listeners that respond within 100ms (no blocking async in the event handler path before UI update)
    - Ensure `setRecordingUI()` is called synchronously before any async work in `startRecording()` and `stopRecording()`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Checkpoint — Consolidation complete
  - Ensure the app loads from `src/index.html`, all buttons are clickable, and the `renderer/` directory is removed. Ask the user to verify by running `npm start`.

- [x] 4. Implement AudioWorkletNode audio capture
  - [x] 4.1 Create `src/audio-worklet-processor.js`
    - Implement `ChunkProcessor extends AudioWorkletProcessor` that buffers incoming samples and posts 16000-sample Float32Array chunks via `MessagePort`
    - Handle `{ command: 'flush' }` message to emit partial buffer and stop processing
    - _Requirements: 3.2, 3.3_

  - [x] 4.2 Refactor `src/audio-recorder.js` to use AudioWorkletNode
    - Replace `createScriptProcessor` with `audioContext.audioWorklet.addModule('./audio-worklet-processor.js')` and `AudioWorkletNode`
    - Receive chunks via `workletNode.port.onmessage`
    - On `stop()`: send `{ command: 'flush' }` to worklet, wait for final chunk, disconnect graph
    - Add `isRecording()` method and `onError` callback
    - Add fallback to `ScriptProcessorNode` if `audioContext.audioWorklet` is undefined, with `console.warn`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 2.1_

  - [x] 4.3 Write property test: AudioWorklet chunk boundary invariant
    - **Property 1: AudioWorklet chunk boundary invariant**
    - Test that for any sequence of variably-sized input buffers, the processor emits chunks of exactly 16000 samples (except final flush)
    - **Validates: Requirements 3.2, 3.3**

  - [x] 4.4 Write property test: Audio capture sample conservation
    - **Property 2: Audio capture sample conservation**
    - Test that the sum of all emitted chunk lengths equals the total number of input samples
    - **Validates: Requirements 3.4**

- [x] 5. Implement stop recording reliability and cancellation
  - [x] 5.1 Add AbortController-based cancellation to `src/main.js`
    - Create `AbortController` in `startRecording()`, store as `abortController`
    - In `stopRecording()`: set `recording = false` first, then `abortController.abort()`, then await `recorder.stop()`, then wait for transcription to drain
    - In `transcribeLoop()`: check `abortController.signal.aborted` to exit loop
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 6. Implement error handling for audio recording
  - [x] 6.1 Add error handling in `src/audio-recorder.js` and `src/main.js`
    - In `start()`: catch `getUserMedia` errors — `NotAllowedError` → "Microphone access denied", `NotFoundError` → "No microphone found", other → "Audio system error"
    - Add `onError` callback for unexpected AudioWorklet disconnection during recording
    - In `main.js`: wrap `startRecording()` to catch errors, display message via `setText()`, reset UI to idle
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 7. Implement error handling for Whisper WASM transcription
  - [x] 7.1 Enhance `src/whisper-transcriber.js` error handling
    - `WhisperModule` init failure → throw descriptive error
    - `whisper.init()` invalid context → throw error with model path
    - `transcribe()` exception → log, skip chunk, return empty string
    - `wasm_malloc` null → log "WASM memory allocation failed", return empty string
    - Ensure `wasm_free` is always called in `finally` block
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 7.2 Write property test: Transcription pipeline chunk-error resilience
    - **Property 3: Transcription pipeline chunk-error resilience**
    - Test that for any sequence of chunks where some cause errors, all remaining chunks are still processed
    - **Validates: Requirements 6.3**

  - [x] 7.3 Write property test: WASM memory deallocation invariant
    - **Property 4: WASM memory deallocation invariant**
    - Test that `wasm_free` call count equals `wasm_malloc` call count for all non-null pointers
    - **Validates: Requirements 6.5**

- [x] 8. Implement error handling for model download and IPC
  - [x] 8.1 Enhance `electron/preload.cjs` with `safeInvoke` wrapper
    - Add `safeInvoke(channel, ...args)` that wraps `ipcRenderer.invoke` in try-catch and returns `{ success: false, error: message }` on failure
    - Replace all `ipcRenderer.invoke` calls with `safeInvoke`
    - _Requirements: 8.1, 8.3_

  - [x] 8.2 Enhance `electron/main.cjs` error handling
    - Add `process.on('uncaughtException', ...)` and `process.on('unhandledRejection', ...)` handlers
    - Wrap all IPC handlers in try-catch returning structured error objects
    - In `downloadModel()`: delete `.tmp` files before retry
    - Ghost typer: add platform check, fire-and-forget, log errors silently on non-macOS
    - _Requirements: 8.2, 8.4, 8.5, 7.3, 11.1, 11.2, 11.3, 11.4_

  - [x] 8.3 Add model download/load error handling in `src/main.js`
    - Display download percentage in text overlay during download
    - On download failure: display "Download failed: {message}"
    - On model corruption (init fails after load): display "Model corrupted, re-downloading...", delete file via IPC, re-download
    - Display "Loading model..." during WASM load
    - _Requirements: 7.1, 7.2, 7.4, 7.5_

  - [x] 8.4 Write property test: IPC bridge error wrapping
    - **Property 5: IPC bridge error wrapping**
    - Test that for any IPC invoke call that rejects, `safeInvoke` returns `{ success: false, error: string }` with non-empty error
    - **Validates: Requirements 8.1**

- [x] 9. Checkpoint — Core features and error handling complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement overlay window sizing and transcription pipeline ordering
  - [x] 10.1 Add window resize logic in `src/main.js`
    - Language dropdown open → resize to 360px height; close → resize to 60px (if history not open)
    - History panel open → resize to 400px height; close → resize to 60px
    - Ensure dropdown opens in direction that stays within window bounds
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 10.2 Ensure transcription pipeline FIFO ordering in `src/main.js`
    - Verify `chunkQueue.shift()` processes chunks in order
    - Process next chunk immediately after current transcription completes (no extra polling delay when queue is non-empty)
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 10.3 Write property test: Chunk processing FIFO order
    - **Property 6: Chunk processing FIFO order**
    - Test that for any sequence of labeled chunks, processing order matches enqueue order
    - **Validates: Requirements 10.3**

- [x] 11. Implement ghost typing graceful degradation
  - [x] 11.1 Refactor ghost typing in `electron/main.cjs`
    - Add platform check: only execute AppleScript on macOS
    - On non-macOS: log debug message, skip typing, no error thrown
    - Wrap AppleScript `exec` in try-catch, log errors, continue processing
    - Ensure ghost typing is fire-and-forget (does not block transcription pipeline)
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 11.2 Write property test: Ghost typing never throws
    - **Property 7: Ghost typing never throws**
    - Test that for any transcript string (empty, special chars, unicode), the ghost typing function never throws
    - **Validates: Requirements 11.2, 11.3**

- [x] 12. Add error message constants and final wiring
  - [x] 12.1 Define `ERROR_MESSAGES` constants in `src/main.js`
    - Add all user-facing error message strings as constants per the design document
    - Replace all hardcoded error strings in `main.js` with constant references
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 7.2, 7.4, 7.5_

  - [x] 12.2 Verify consolidated 4-column layout renders correctly
    - Ensure `src/index.html` renders record button, center waveform/text area, history button, and language selector
    - Verify ES module imports work correctly across all `src/` modules
    - _Requirements: 12.3, 12.4, 2.5, 2.6_

- [x] 13. Final checkpoint — All features complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `renderer/` directory is removed in task 1.4 after consolidation to `src/`
- Vitest + fast-check are added as devDependencies in task 1.1
