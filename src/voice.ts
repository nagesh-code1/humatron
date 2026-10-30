// Speech-to-text for Humatron, fully on this PC: Whisper via transformers.js (no key, nothing uploaded).
// Input: 16 kHz mono Float32 PCM from the renderer. Settings: 'sttModel' base | small, 'speechLanguage'.
import { join } from 'path';

type Store = { get: (k: string) => any };

// 'speechLanguage' setting -> Whisper language. Hinglish: auto-detect picks Hindi and writes Devanagari, so we force
// English, which keeps mixed Hindi-English speech in readable Roman letters (learned on Ultron's video editor).
const LANG_NAMES: Record<string, string> = { en: 'english', hi: 'hindi', kn: 'kannada', ta: 'tamil', te: 'telugu', ml: 'malayalam',
  mr: 'marathi', bn: 'bengali', gu: 'gujarati', pa: 'punjabi', ur: 'urdu', es: 'spanish', fr: 'french', de: 'german', ar: 'arabic', ja: 'japanese', zh: 'chinese' };

// base: ~80 MB, fast on a laptop CPU. small: ~250 MB, clearly better for Indian languages, ~2-3x slower.
const MODELS: Record<string, string> = { base: 'Xenova/whisper-base', small: 'Xenova/whisper-small' };
const loaded: Record<string, any> = {};

async function pipe(size: string, dataDir: string) {
  if (!loaded[size]) {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = join(dataDir, 'models');   // writable even when packaged; downloaded once, then offline
    loaded[size] = pipeline('automatic-speech-recognition', MODELS[size], { quantized: true });
  }
  return loaded[size];
}

export async function transcribe(pcm: Float32Array, store: Store, dataDir: string) {
  if (!pcm || pcm.length < 1600) return { text: '', language: '', engine: '' };   // < 0.1 s: nothing said
  const size = MODELS[String(store.get('sttModel'))] ? String(store.get('sttModel')) : 'base';
  const lang = String(store.get('speechLanguage') || 'auto');
  let asr: any;
  try { asr = await pipe(size, dataDir); }
  catch (e: any) { delete loaded[size]; throw new Error(`Couldn't load the speech model (first use downloads it - check internet): ${e?.message || e}`); }
  const language = lang === 'hinglish' ? 'english' : LANG_NAMES[lang];
  const out: any = await asr(pcm, { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, ...(language ? { language } : {}) });
  const text = String(out?.text || '').replace(/\[(BLANK_AUDIO|Music|music)\]|\(.*?music.*?\)/gi, '').trim();
  return { text, language: lang === 'auto' ? '' : lang, engine: `Whisper ${size} (on this PC)` };
}

// Warm the model up in the background so the first spoken sentence isn't slowed by the download.
export function preloadVoice(store: Store, dataDir: string) {
  const size = MODELS[String(store.get('sttModel'))] ? String(store.get('sttModel')) : 'base';
  pipe(size, dataDir).catch(e => { delete loaded[size]; console.log('[voice] preload failed:', e?.message || e); });
}
