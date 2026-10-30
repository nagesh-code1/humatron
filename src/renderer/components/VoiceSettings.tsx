import React, { useEffect, useState } from 'react';
import { voices, speak, stopSpeaking } from '../voice';

const LANGS: Array<[string, string]> = [
  ['auto', 'Auto-detect (any language)'], ['hinglish', 'Hinglish (Hindi + English mix, Roman letters)'], ['en', 'English'], ['hi', 'Hindi'],
  ['kn', 'Kannada'], ['ta', 'Tamil'], ['te', 'Telugu'], ['ml', 'Malayalam'], ['mr', 'Marathi'], ['bn', 'Bengali'], ['gu', 'Gujarati'],
  ['pa', 'Punjabi'], ['ur', 'Urdu'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ar', 'Arabic'], ['ja', 'Japanese'], ['zh', 'Chinese'],
];

// Voice + image options. Each change is saved immediately (no Save button needed).
export function VoiceSettings() {
  const [s, setS] = useState<Record<string, any>>({ sttModel: 'base', speechLanguage: 'auto', ttsVoice: '', ttsRate: 1, autoSpeak: false });
  const [list, setList] = useState<SpeechSynthesisVoice[]>([]);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      const keys = Object.keys(s);
      const vals = await Promise.all(keys.map(k => window.api.store.get(k)));
      setS(prev => Object.fromEntries(keys.map((k, i) => [k, vals[i] ?? prev[k]])));
      setList(await voices());
    })();
    return () => stopSpeaking();
  }, []);

  const set = (k: string, v: any) => { setS(prev => ({ ...prev, [k]: v })); window.api.store.set(k, typeof v === 'string' ? v.trim() : v); };
  const nonLatin = list.some(v => !/^en/i.test(v.lang));

  const test = () => {
    if (testing) { stopSpeaking(); setTesting(false); return; }
    setTesting(true);
    speak("Hi! I'm Humatron. Aap kaise ho? I can talk in your language.", { voiceName: s.ttsVoice, rate: s.ttsRate, onEnd: () => setTesting(false) });
  };

  return (
    <div className="settings-section">
      <h3 style={{fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--fg)'}}>Voice & images</h3>

      <div className="form-group">
        <label className="form-label">Speech recognition (speech → text) · runs on this PC</label>
        <select className="settings-input" value={s.sttModel} onChange={e => set('sttModel', e.target.value)} style={{maxWidth: '420px', cursor: 'pointer'}}>
          <option value="base">Whisper base — fast (~80 MB, downloaded once)</option>
          <option value="small">Whisper small — more accurate for Indian languages (~250 MB, slower)</option>
        </select>
        <p style={{fontSize: '12px', color: 'var(--fg-muted)', marginTop: '6px'}}>
          No key needed and your voice never leaves this PC. The first time you speak, the model downloads (one time).
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">Language you speak</label>
        <select className="settings-input" value={s.speechLanguage} onChange={e => set('speechLanguage', e.target.value)} style={{maxWidth: '420px', cursor: 'pointer'}}>
          {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <p style={{fontSize: '12px', color: 'var(--fg-muted)', marginTop: '6px'}}>
          Auto works for most languages. If you mix Hindi and English, pick Hinglish for cleaner text. Humatron always replies in the language you use.
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">Reply voice (text → speech)</label>
        <div style={{display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap'}}>
          <select className="settings-input" value={s.ttsVoice} onChange={e => set('ttsVoice', e.target.value)} style={{maxWidth: '320px', cursor: 'pointer'}}>
            <option value="">Auto (Indian English if installed)</option>
            {list.map(v => <option key={v.name} value={v.name}>{v.name.replace(/^Microsoft /, '')} · {v.lang}</option>)}
          </select>
          <button className="btn btn-secondary" onClick={test}>{testing ? 'Stop' : '▶ Test voice'}</button>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px', maxWidth: '420px'}}>
          <span style={{fontSize: '12.5px', color: 'var(--fg-muted)', width: '80px'}}>Speed {Number(s.ttsRate).toFixed(1)}×</span>
          <input type="range" min="0.6" max="1.6" step="0.1" value={s.ttsRate} onChange={e => set('ttsRate', Number(e.target.value))} style={{flex: 1, accentColor: 'var(--accent)'}} />
        </div>
        {!nonLatin && list.length > 0 && (
          <p style={{fontSize: '12px', color: 'var(--fg-muted)', marginTop: '8px', lineHeight: 1.5}}>
            Only English voices are installed, so spoken replies use Roman letters (e.g. Hinglish). For Hindi, Tamil or Telugu script voices,
            add them in Windows Settings › Time & language › Speech › Add voices.
          </p>
        )}
      </div>

      <div className="settings-row">
        <div style={{flex: 1}}>
          <label className="form-label" style={{marginBottom: 2}}>Read every reply aloud</label>
          <span style={{fontSize: '12px', color: 'var(--fg-muted)'}}>Voice conversation mode always speaks; this also speaks typed chats.</span>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={!!s.autoSpeak} onChange={e => set('autoSpeak', e.target.checked)} />
          <span className="toggle-slider" />
        </label>
      </div>

      <p style={{fontSize: '12.5px', color: 'var(--fg-muted)', lineHeight: 1.6, marginTop: '4px'}}>
        <b style={{color: 'var(--fg-soft)'}}>Images</b> are made with the free Pollinations service (no key) and saved to Pictures\Humatron.
        Only the image description is sent — never your memories or files.
      </p>
    </div>
  );
}
