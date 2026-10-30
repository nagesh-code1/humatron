import React, { useState, useEffect, useRef } from 'react';
import { Logo } from './Logo';
import type { Brain, Tab } from '../App';
import { shortModel } from '../App';
import { record, speak, stopSpeaking, needsRoman, type Recording } from '../voice';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  tools?: Array<{ name: string, args: any, result: any, ok: boolean }>;
  model?: string;
  ms?: number;
  error?: boolean;
}

export const TOOL_INFO: Record<string, { icon: string, label: string, detail: (a: any) => string }> = {
  remember: { icon: '🧠', label: 'Saved to memory', detail: a => String(a?.content || '') },
  recall: { icon: '🔎', label: 'Searched memory', detail: a => a?.query ? `"${a.query}"` : '' },
  add_event: { icon: '📅', label: 'Added to calendar', detail: a => [a?.title, fmtWhen(a?.start)].filter(Boolean).join(' · ') },
  list_events: { icon: '🗓️', label: 'Checked calendar', detail: a => fmtWhen(a?.date) },
  list_files: { icon: '📂', label: 'Looked in folder', detail: a => String(a?.path || '') },
  search_files: { icon: '🔍', label: 'Searched files', detail: a => `"${a?.name_contains || ''}" in ${a?.folder || ''}` },
  read_file: { icon: '📄', label: 'Read file', detail: a => String(a?.path || '') },
  write_file: { icon: '✍️', label: 'Wrote file', detail: a => String(a?.path || '') },
  create_folder: { icon: '📁', label: 'Created folder', detail: a => String(a?.path || '') },
  move_file: { icon: '📦', label: 'Moved', detail: a => `${a?.from || ''} → ${a?.to || ''}` },
  copy_file: { icon: '📑', label: 'Copied', detail: a => `${a?.from || ''} → ${a?.to || ''}` },
  delete_file: { icon: '🗑️', label: 'Moved to Recycle Bin', detail: a => String(a?.path || '') },
  open_file: { icon: '↗️', label: 'Opened', detail: a => String(a?.path || '') },
  generate_image: { icon: '🎨', label: 'Generated image', detail: a => String(a?.prompt || '') },
  web_search: { icon: '🌐', label: 'Searched the web', detail: a => `"${a?.query || ''}"${a?.news ? ' · news' : ''}` },
  read_webpage: { icon: '📰', label: 'Read web page', detail: a => String(a?.url || '').replace(/^https?:\/\//, '') },
};

export const fileUrl = (p: string) => 'file:///' + p.replace(/\\/g, '/').split('/').map((seg, i) => i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)).join('/');
type VoicePhase = 'off' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';

// Demo-friendly starters: each one exercises a real tool so judges see memory + calendar working in one click.
const STARTERS = [
  { icon: '🧠', title: 'Teach it about you', text: "Remember that I'm vegetarian and I love filter coffee." },
  { icon: '🎨', title: 'Create an image', text: 'Generate an image of a cozy study desk at night with a glowing laptop and rain on the window.' },
  { icon: '📂', title: 'Manage your files', text: "What's in my Downloads folder? Show me the biggest files." },
  { icon: '📅', title: 'Plan something', text: 'Add "Hackathon demo" to my calendar tomorrow at 4pm.' },
];

const PHASES: Array<[number, string]> = [[0, 'Looking through your memory'], [3, 'Thinking'], [15, 'Still reasoning — big model, worth the wait'], [40, 'Almost there']];

export function ChatPanel({ brain, visible, onThinking, onModel, goTo }: { brain: Brain, visible: boolean, onThinking: (b: boolean) => void, onModel: () => void, goTo: (t: Tab) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [dictating, setDictating] = useState<Recording | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('off');
  const [voiceHeard, setVoiceHeard] = useState('');
  const [voiceReply, setVoiceReply] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const voiceOn = useRef(false);
  const voiceRec = useRef<Recording | null>(null);
  const skipSpeech = useRef<(() => void) | null>(null);   // releases the voice loop when speech is skipped/stopped
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (atBottom) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (visible) setTimeout(() => textareaRef.current?.focus(), 50);
  }, [visible]);

  // Elapsed-time ticker while waiting, so a 20-30 s Nemotron answer never looks frozen.
  useEffect(() => {
    if (!isLoading) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [isLoading]);

  // "/" focuses the composer from anywhere on the chat page.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'TEXTAREA' && tag !== 'INPUT') { e.preventDefault(); textareaRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  // Auto-grow the composer with its content.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [input]);

  const loadHistory = async () => {
    try {
      // @ts-ignore
      const history = await window.api.conversation.getRecent(50);
      const formatted = history.reverse().map((msg: any) => {
        let meta: any = {};
        try { meta = JSON.parse(msg.metadata || '{}'); } catch {}
        return {
          id: msg.id.toString(),
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: new Date(String(msg.created_at).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(msg.created_at) ? '' : 'Z')).getTime(),
          tools: meta.tools,
          model: meta.model,
        };
      });
      setMessages(formatted);
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  };

  const send = async (raw: string, opts: { spokenLanguage?: string, voice?: boolean } = {}): Promise<string | null> => {
    const text = raw.trim();
    if (!text || isLoading) return null;
    if (!brain.hasKey && brain.loaded) { goTo('settings'); return null; }
    stopSpeaking(); setSpeakingId(null);
    const [autoSpeak, voiceName, rate] = await Promise.all(['autoSpeak', 'ttsVoice', 'ttsRate'].map(k => window.api.store.get(k)));
    const spoken = !!opts.voice || !!autoSpeak;
    const romanOnly = spoken && await needsRoman();

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setAtBottom(true);
    setIsLoading(true);
    onThinking(true);
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(t0);

    try {
      // agent:chat persists both sides, injects relevant memories and runs Nemotron's tool calls
      // @ts-ignore
      const response = await window.api.agent.chat(text, { spokenLanguage: opts.spokenLanguage, voice: !!opts.voice, romanOnly });
      const id = (Date.now() + 1).toString();
      setMessages(prev => [...prev, {
        id, role: 'assistant', content: response.reply, timestamp: Date.now(),
        tools: response.tools, model: response.model, ms: Date.now() - t0,
      }]);
      onModel();
      if (autoSpeak && !opts.voice) { setSpeakingId(id); speak(response.reply, { voiceName, rate, onEnd: () => setSpeakingId(null) }); }
      return response.reply;
    } catch (error: any) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'assistant', timestamp: Date.now(), error: true,
        content: String(error.message || 'Failed to get response').replace(/^Error invoking remote method '[^']+': (Error: )?/, ''),
      }]);
      return null;
    } finally {
      setIsLoading(false);
      onThinking(false);
      textareaRef.current?.focus();
    }
  };

  const retryLast = () => {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser) { setMessages(prev => prev.slice(0, -1)); send(lastUser.content); }
  };

  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(id); setTimeout(() => setCopied(null), 1500); });
  };

  const cleanErr = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const flashError = (msg: string) => { setVoiceError(msg); setTimeout(() => setVoiceError(''), 7000); };

  // Mic button: speak, Humatron writes it into the composer (you can edit before sending).
  const toggleDictation = async () => {
    if (dictating) { dictating.stop(); return; }
    try {
      const rec = await record({ onLevel: setLevel });
      setDictating(rec);
      const pcm = await rec.done;
      setDictating(null);
      if (!pcm) return;
      setTranscribing(true);
      const r = await window.api.voice.transcribe(pcm);
      if (r.text) setInput(prev => (prev ? prev.trimEnd() + ' ' : '') + r.text);
    } catch (e) {
      setDictating(null);
      flashError(cleanErr(e));
    } finally {
      setTranscribing(false);
      textareaRef.current?.focus();
    }
  };

  // Voice mode: hands-free loop - listen, transcribe, answer, speak the answer, listen again.
  const startVoice = () => {
    if (!brain.hasKey && brain.loaded) { goTo('settings'); return; }
    voiceOn.current = true;
    setVoiceHeard(''); setVoiceReply(''); setVoiceError('');
    listenLoop();
  };

  const stopVoice = () => {
    voiceOn.current = false;
    voiceRec.current?.cancel();
    voiceRec.current = null;
    stopSpeaking();
    skipSpeech.current?.();
    setVoicePhase('off');
    setLevel(0);
  };

  const listenLoop = async () => {
    let misses = 0;
    while (voiceOn.current) {
      try {
        setVoicePhase('listening');
        const rec = await record({ onLevel: setLevel });
        voiceRec.current = rec;
        const pcm = await rec.done;
        voiceRec.current = null;
        if (!voiceOn.current) return;
        if (!pcm) { if (++misses >= 2) { stopVoice(); return; } continue; }   // two silent turns: go to sleep
        misses = 0;
        setVoicePhase('transcribing');
        const heard = await window.api.voice.transcribe(pcm);
        if (!voiceOn.current) return;
        if (!heard.text) continue;
        setVoiceHeard(heard.text); setVoiceReply('');
        setVoicePhase('thinking');
        const reply = await send(heard.text, { spokenLanguage: heard.language, voice: true });
        if (!voiceOn.current) return;
        if (!reply) { voiceOn.current = false; setVoicePhase('error'); setVoiceError('The AI brain did not answer - check Settings.'); return; }
        setVoiceReply(reply);
        setVoicePhase('speaking');
        const [voiceName, rate] = await Promise.all([window.api.store.get('ttsVoice'), window.api.store.get('ttsRate')]);
        await new Promise<void>(res => { skipSpeech.current = res; speak(reply, { voiceName, rate, onEnd: res }); });
        skipSpeech.current = null;
      } catch (e) {
        voiceOn.current = false; setVoicePhase('error'); setVoiceError(cleanErr(e)); return;
      }
    }
  };

  useEffect(() => {
    if (voicePhase === 'off') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stopVoice(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voicePhase]);

  const toggleSpeak = async (msg: Message) => {
    if (speakingId === msg.id) { stopSpeaking(); setSpeakingId(null); return; }
    const [voiceName, rate] = await Promise.all([window.api.store.get('ttsVoice'), window.api.store.get('ttsRate')]);
    setSpeakingId(msg.id);
    speak(msg.content, { voiceName, rate, onEnd: () => setSpeakingId(null) });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    } else if (e.key === 'ArrowUp' && !input) {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (lastUser) { e.preventDefault(); setInput(lastUser.content); }
    }
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const phase = [...PHASES].reverse().find(([s]) => elapsed >= s)![1];
  const empty = messages.length === 0;

  return (
    <div className="chat-panel">
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite">
        <div className="chat-column">
          {empty && (
            <div className="hero">
              <div className="hero-logo"><Logo size={84} active={isLoading} /></div>
              <h1 className="hero-title">{greeting()}<span className="hero-wave">👋</span></h1>
              <p className="hero-sub">I'm <b>Humatron</b> — I remember what matters to you, manage your files and calendar, make images, and talk in <b>your</b> language.</p>
              {brain.hasKey && (
                <button className="voice-cta" onClick={startVoice}>
                  <span className="voice-cta-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg></span>
                  Talk to me <span className="voice-cta-sub">any language · hands-free</span>
                </button>
              )}

              {brain.loaded && !brain.hasKey ? (
                <button className="onboard-card" onClick={() => goTo('settings')}>
                  <span className="onboard-step">1</span>
                  <span className="onboard-text">
                    <b>Connect NVIDIA Nemotron — takes 30 seconds</b>
                    <span>Paste your Nebius Token Factory (or NVIDIA) key. It stays on this PC.</span>
                  </span>
                  <span className="onboard-go">Set up →</span>
                </button>
              ) : (
                <div className="starter-grid">
                  {STARTERS.map((s, i) => (
                    <button key={s.title} className="starter" style={{ animationDelay: `${120 + i * 70}ms` }} onClick={() => send(s.text)}>
                      <span className="starter-icon">{s.icon}</span>
                      <span className="starter-title">{s.title}</span>
                      <span className="starter-text">{s.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((msg, idx) => {
            const showDay = idx === 0 || dayKey(messages[idx - 1].timestamp) !== dayKey(msg.timestamp);
            return (
              <React.Fragment key={msg.id}>
                {showDay && <div className="day-divider"><span>{dayLabel(msg.timestamp)}</span></div>}
                {msg.role === 'user' ? (
                  <div className="msg user">
                    <div className="bubble">{msg.content}</div>
                    <div className="msg-meta">{fmtTime(msg.timestamp)}</div>
                  </div>
                ) : (
                  <div className={`msg assistant ${msg.error ? 'error' : ''}`}>
                    <div className="msg-avatar"><Logo size={30} /></div>
                    <div className="msg-body">
                      <div className="msg-head">
                        <span className="msg-name">Humatron</span>
                        <span className="msg-meta">{fmtTime(msg.timestamp)}</span>
                      </div>
                      {msg.tools && msg.tools.length > 0 && (
                        <div className="tool-cards">
                          {msg.tools.map((t, i) => {
                            const info = TOOL_INFO[t.name] || { icon: '⚙️', label: t.name, detail: () => '' };
                            const img = t.ok && t.name === 'generate_image' ? String(t.result?.image || '') : '';
                            return (
                              <React.Fragment key={i}>
                                <div className={`tool-card ${t.ok ? '' : 'failed'}`} title={t.ok ? JSON.stringify(t.args) : String(t.result?.error || '')}>
                                  <span className="tool-icon">{info.icon}</span>
                                  <span className="tool-label">{t.ok ? info.label : `${info.label} — failed`}</span>
                                  <span className="tool-detail">{t.ok ? info.detail(t.args) : String(t.result?.error || info.detail(t.args))}</span>
                                  <span className="tool-check">{t.ok ? '✓' : '!'}</span>
                                </div>
                                {img && (
                                  <figure className="gen-image">
                                    <img src={fileUrl(img)} alt={String(t.args?.prompt || 'generated image')} onClick={() => window.api.files.open(img)} />
                                    <figcaption>
                                      <span>{t.result?.size} · saved to Pictures\Humatron</span>
                                      <span className="gen-actions">
                                        <button type="button" className="ghost-btn" onClick={() => window.api.files.open(img)}>Open</button>
                                        <button type="button" className="ghost-btn" onClick={() => window.api.files.reveal(img)}>Show in folder</button>
                                      </span>
                                    </figcaption>
                                  </figure>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      )}
                      {msg.error ? (
                        <div className="error-card">
                          <b>Couldn't reach the AI brain.</b>
                          <span>{msg.content}</span>
                          <div className="error-actions">
                            <button className="btn btn-primary btn-sm" onClick={retryLast} disabled={isLoading}>Try again</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => goTo('settings')}>Check settings</button>
                          </div>
                        </div>
                      ) : (
                        <div className="md">{renderMarkdown(msg.content)}</div>
                      )}
                      {!msg.error && (
                        <div className="msg-actions">
                          <button className="ghost-btn" onClick={() => copy(msg.id, msg.content)}>
                            {copied === msg.id ? '✓ Copied' : (
                              <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
                            )}
                          </button>
                          <button className={`ghost-btn ${speakingId === msg.id ? 'on' : ''}`} onClick={() => toggleSpeak(msg)}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>{speakingId === msg.id ? 'Stop' : 'Listen'}
                          </button>
                          {(msg.model || msg.ms) && (
                            <span className="msg-stat">{[msg.model && shortModel(msg.model), msg.ms && `${(msg.ms / 1000).toFixed(1)}s`].filter(Boolean).join(' · ')}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {isLoading && (
            <div className="msg assistant thinking-row">
              <div className="msg-avatar"><Logo size={30} active /></div>
              <div className="msg-body">
                <div className="thinking-card">
                  <span className="dots"><i /><i /><i /></span>
                  <span className="thinking-phase">{phase}…</span>
                  <span className="thinking-time">{elapsed.toFixed(0)}s</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {!atBottom && !empty && (
        <button className="jump-btn" onClick={() => { setAtBottom(true); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }}>
          ↓ Latest
        </button>
      )}

      <form className="composer-wrap" onSubmit={e => { e.preventDefault(); send(input); }}>
        <div className={`composer ${isLoading ? 'busy' : ''}`}>
          <textarea
            ref={textareaRef}
            className="composer-input"
            placeholder={brain.loaded && !brain.hasKey ? 'Connect an AI brain in Settings to start chatting…' : 'Ask anything, or tell me something to remember…'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <div className="composer-bar">
            <div className="composer-chips">
              <button type="button" className={`mic-btn ${dictating ? 'rec' : ''}`} onClick={toggleDictation} disabled={transcribing || isLoading}
                title={dictating ? 'Stop - I stop by myself when you pause' : 'Dictate (speak instead of typing)'} style={{ ['--lvl' as any]: dictating ? level : 0 }}>
                {transcribing ? <span className="spinner dark" /> : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg>}
                <span>{dictating ? 'Listening…' : transcribing ? 'Writing… (first time: downloading speech model)' : 'Dictate'}</span>
              </button>
              <span className="chip chip-model" onClick={() => goTo('settings')} title="Change model">⚡ {brain.hasKey ? shortModel(brain.model) : 'no brain yet'}</span>
            </div>
            <div className="composer-right">
              <span className="composer-hint"><kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line</span>
              <button type="button" className="voice-btn" onClick={startVoice} disabled={isLoading} title="Voice conversation (hands-free)"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg></button>
              <button type="submit" className="send-btn" disabled={!input.trim() || isLoading} aria-label="Send message">
                {isLoading ? <span className="spinner" /> : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                )}
              </button>
            </div>
          </div>
        </div>
        {voiceError && voicePhase === 'off' && <div className="voice-toast">🎙️ {voiceError}</div>}
      </form>

      {voicePhase !== 'off' && (
        <div className="voice-overlay" role="dialog" aria-label="Voice conversation">
          <div className={`voice-stage ${voicePhase}`} style={{ ['--lvl' as any]: voicePhase === 'listening' ? level : 0 }}>
            <span className="voice-ring" /><span className="voice-ring r2" />
            <Logo size={104} active={voicePhase === 'thinking' || voicePhase === 'transcribing' || voicePhase === 'speaking'} />
          </div>
          <div className="voice-phase">
            {{ listening: 'Listening… just talk', transcribing: 'Got it, writing that down…', thinking: 'Thinking…', speaking: 'Speaking…', error: 'Voice stopped', off: '' }[voicePhase]}
          </div>
          {voiceHeard && <div className="voice-heard">“{voiceHeard}”</div>}
          {voiceReply && <div className="voice-reply">{voiceReply}</div>}
          {voicePhase === 'error' && <div className="voice-err">{voiceError}</div>}
          <div className="voice-actions">
            {voicePhase === 'speaking' && <button className="btn btn-secondary" onClick={() => { stopSpeaking(); skipSpeech.current?.(); }}>Skip</button>}
            {voicePhase === 'error' && <button className="btn btn-primary" onClick={startVoice}>Try again</button>}
            <button className="btn btn-danger" onClick={stopVoice}>End conversation <kbd>Esc</kbd></button>
          </div>
          <div className="voice-foot">Speak in any language — Humatron answers in the same one. It sleeps after two silent turns.</div>
        </div>
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late? ' : h < 12 ? 'Good morning ' : h < 17 ? 'Good afternoon ' : 'Good evening ';
}

function fmtTime(ts: number) {
  return isNaN(ts) ? '' : new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function dayKey(ts: number) { return new Date(ts).toDateString(); }

function dayLabel(ts: number) {
  if (isNaN(ts)) return 'Earlier';
  const d = new Date(ts), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function fmtWhen(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return /T|\d:\d/.test(s) ? d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// Small, safe markdown: fenced code, headings, lists, quotes, bold/italic, inline code, links. No innerHTML.
export function renderMarkdown(text: string) {
  const out: React.ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(<CodeBlock key={k++} lang={fence[1]} code={code.join('\n')} />);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { out.push(React.createElement(`h${Math.min(h[1].length + 2, 6)}`, { key: k++ }, inline(h[2]))); i++; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      out.push(React.createElement(ordered ? 'ol' : 'ul', { key: k++ }, items.map((it, j) => <li key={j}>{inline(it)}</li>)));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={k++}>{inline(q.join(' '))}</blockquote>);
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push(<hr key={k++} />); i++; continue; }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|[-*•]\s|\d+[.)]\s|>)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={k++}>{para.flatMap((p, j) => j ? [<br key={'b' + j} />, ...inline(p)] : inline(p))}</p>);
  }
  return out;
}

function inline(s: string): React.ReactNode[] {
  const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.filter(Boolean).map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    const link = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

function CodeBlock({ lang, code }: { lang: string, code: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || 'code'}</span>
        <button className="ghost-btn" onClick={() => navigator.clipboard.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
          {done ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}
