import { GlobalKeyboardListener } from 'node-global-key-listener';

const keyboard = new GlobalKeyboardListener();

let isRecording = false;

keyboard.addListener((e, down) => {
  // Ctrl + Shift + Space
  if (
    e.name === 'SPACE' &&
    e.state === 'DOWN' &&
    down['LEFT CTRL'] &&
    down['LEFT SHIFT']
  ) {
    isRecording = !isRecording;
    console.log(isRecording ? '🎙️ Recording started' : '⏹️ Recording stopped');
  }
});

console.log('Listening for Ctrl+Shift+Space...');