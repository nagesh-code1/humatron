// Renderer side of Humatron's voice: microphone capture with end-of-speech detection, and text-to-speech.

export type Recording = { stop: () => void, cancel: () => void, done: Promise<Float32Array | null> };

// Records until the user stops talking (or stop() is called). Resolves 16 kHz mono PCM, or null if nothing was said.
export async function record(opts: { onLevel?: (v: number) => void, autoStop?: boolean, maxMs?: number } = {}): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);

  let heard = false, cancelled = false, lastLoud = performance.now(), noise = 0.01;
  const started = performance.now(), maxMs = opts.maxMs ?? 45000;
  const buf = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0; for (const x of buf) sum += x * x;
    const rms = Math.sqrt(sum / buf.length), now = performance.now();
    if (!heard && now - started < 600) noise = Math.max(noise, rms * 1.6);   // learn the room's noise floor first
    opts.onLevel?.(Math.min(1, rms * 12));
    if (rms > Math.max(0.018, noise)) { lastLoud = now; if (now - started > 250) heard = true; }
    if (opts.autoStop !== false) {
      if (heard && now - lastLoud > 1300) stop();               // finished a sentence
      else if (!heard && now - started > 9000) stop();          // nobody spoke
    }
    if (now - started > maxMs) stop();
  }, 50);

  function stop() { if (rec.state !== 'inactive') rec.stop(); }
  const done = new Promise<Float32Array | null>(resolve => {
    rec.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach(t => t.stop());
      opts.onLevel?.(0);
      try {
        if (cancelled || !heard || !chunks.length) return resolve(null);
        const decoded = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
        const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
        const s = off.createBufferSource(); s.buffer = decoded; s.connect(off.destination); s.start();
        resolve((await off.startRendering()).getChannelData(0));
      } catch (e) { console.error('[voice] decode failed', e); resolve(null); }
      finally { ctx.close(); }
    };
  });
  rec.start(250);
  return { stop, cancel: () => { cancelled = true; stop(); }, done };
}

// ---- Text to speech (Windows voices via speechSynthesis; works offline) ----

const SCRIPTS: Array<[RegExp, string]> = [[/[ऀ-ॿ]/, 'hi'], [/[ಀ-೿]/, 'kn'], [/[஀-௿]/, 'ta'],
  [/[ఀ-౿]/, 'te'], [/[ഀ-ൿ]/, 'ml'], [/[ঀ-৿]/, 'bn'], [/[઀-૿]/, 'gu'], [/[਀-੿]/, 'pa'],
  [/[؀-ۿ]/, 'ar'], [/[぀-ヿ]/, 'ja'], [/[一-鿿]/, 'zh'], [/[가-힯]/, 'ko'], [/[Ѐ-ӿ]/, 'ru']];

export const scriptLang = (text: string) => SCRIPTS.find(([re]) => re.test(text))?.[1] || '';

export function voices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise(res => {
    const v = speechSynthesis.getVoices();
    if (v.length) return res(v);
    speechSynthesis.onvoiceschanged = () => res(speechSynthesis.getVoices());
    setTimeout(() => res(speechSynthesis.getVoices()), 1500);
  });
}

// True when only Latin-script voices are installed, so replies must be romanised to be speakable.
export async function needsRoman() {
  const v = await voices();
  return !v.some(x => !/^en/i.test(x.lang));
}

export function cleanForSpeech(md: string) {
  return md.replace(/```[\s\S]*?```/g, ' (code omitted) ').replace(/`([^`]+)`/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_#>~|]+/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
}

let current: SpeechSynthesisUtterance | null = null;

export async function speak(text: string, opts: { voiceName?: string, rate?: number, onEnd?: () => void } = {}) {
  stopSpeaking();
  const clean = cleanForSpeech(text);
  if (!clean) { opts.onEnd?.(); return; }
  const all = await voices();
  const lang = scriptLang(clean);
  // A native voice for the reply's script wins; otherwise the chosen voice, then an Indian-English one, then any English.
  const voice = (lang && all.find(v => v.lang.toLowerCase().startsWith(lang))) || all.find(v => v.name === opts.voiceName)
    || all.find(v => /en-IN/i.test(v.lang)) || all.find(v => /^en/i.test(v.lang)) || all[0];
  const u = new SpeechSynthesisUtterance(clean);
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  u.rate = opts.rate || 1;
  // Cancelled utterances (stopSpeaking) don't fire onEnd, so a voice loop can't restart after the user stopped it.
  u.onend = u.onerror = () => { if (current !== u) return; current = null; opts.onEnd?.(); };
  current = u;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  current = null;
  speechSynthesis.cancel();
}

export const isSpeaking = () => speechSynthesis.speaking;
