/**
 * Language options for whisper.cpp STT.
 * url: Hugging Face GGML model URL. null = not yet available (shown greyed out).
 */
const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export const langOptions = {
  'en': { name: 'English', whisper: 'en', url: `${HF}/ggml-base.en.bin` },
  'hi': { name: 'हिन्दी', whisper: 'hi', url: `${HF}/ggml-small.bin` },
  'ta': { name: 'தமிழ்', whisper: 'ta', url: `${HF}/ggml-small.bin` },
  'te': { name: 'తెలుగు', whisper: 'te', url: `${HF}/ggml-small.bin` },
  'kn': { name: 'ಕನ್ನಡ', whisper: 'kn', url: `${HF}/ggml-small.bin` },
  'bn': { name: 'বাংলা', whisper: 'bn', url: `${HF}/ggml-small.bin` },
  'ml': { name: 'മലയാളം', whisper: 'ml', url: `${HF}/ggml-small.bin` },
  'mr': { name: 'मराठी', whisper: 'mr', url: `${HF}/ggml-small.bin` },
  'gu': { name: 'ગુજરાતી', whisper: 'gu', url: `${HF}/ggml-small.bin` },
  'pa': { name: 'ਪੰਜਾਬੀ', whisper: 'pa', url: `${HF}/ggml-small.bin` },
  'or': { name: 'ଓଡ଼ିଆ', whisper: 'or', url: null },
  'as': { name: 'অসমীয়া', whisper: 'as', url: null },
  'ne': { name: 'नेपाली', whisper: 'ne', url: `${HF}/ggml-small.bin` },
  'si': { name: 'සිංහල', whisper: 'si', url: `${HF}/ggml-small.bin` },
  'sd': { name: 'سنڌي', whisper: 'sd', url: null },
  'ur': { name: 'اردو', whisper: 'ur', url: null },
  'sa': { name: 'संस्कृतम्', whisper: 'sa', url: null },
  'es': { name: 'Español', whisper: 'es', url: `${HF}/ggml-small.bin` },
  'fr': { name: 'Français', whisper: 'fr', url: `${HF}/ggml-small.bin` },
  'de': { name: 'Deutsch', whisper: 'de', url: `${HF}/ggml-small.bin` },
  'pt': { name: 'Português', whisper: 'pt', url: `${HF}/ggml-small.bin` },
  'ru': { name: 'Русский', whisper: 'ru', url: `${HF}/ggml-small.bin` },
  'ja': { name: '日本語', whisper: 'ja', url: `${HF}/ggml-small.bin` },
  'ko': { name: '한국어', whisper: 'ko', url: `${HF}/ggml-small.bin` },
  'zh': { name: '简体中文', whisper: 'zh', url: `${HF}/ggml-small.bin` },
  'tr': { name: 'Türkçe', whisper: 'tr', url: `${HF}/ggml-small.bin` },
  'uk': { name: 'Українська', whisper: 'uk', url: `${HF}/ggml-small.bin` },
  'th': { name: 'ไทย', whisper: 'th', url: `${HF}/ggml-small.bin` },
  'el': { name: 'Ελληνικά', whisper: 'el', url: `${HF}/ggml-small.bin` },
  'pl': { name: 'Polski', whisper: 'pl', url: `${HF}/ggml-small.bin` },
  'he': { name: 'עברית', whisper: 'he', url: `${HF}/ggml-small.bin` },
};
