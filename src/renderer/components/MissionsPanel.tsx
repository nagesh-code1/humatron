import React, { useEffect, useRef, useState } from 'react';
import { Logo } from './Logo';
import { TOOL_INFO, fileUrl, renderMarkdown } from './ChatPanel';
import type { Brain, Tab } from '../App';
import { shortModel } from '../App';

type Step = { title: string, detail: string, status: 'pending' | 'running' | 'done' | 'failed', summary?: string, tools: any[] };
type Mission = { id: number, goal: string, title?: string, steps: Step[], report?: string, status: 'planning' | 'running' | 'done' | 'failed' | 'stopped',
  model?: string, provider?: string, startedAt: number, ms?: number, error?: string, waiting?: string };

// Showcase goals: each one makes Nemotron plan, use several real tools and produce something you can open.
const EXAMPLES = [
  { icon: '📚', title: 'Exam prep plan', goal: 'I have my Signals & Systems exam on Monday. Make a day-by-day study plan, save it as a file, and add study sessions to my calendar for the next 3 days.' },
  { icon: '🚀', title: 'Hackathon launch kit', goal: 'Create a launch kit for my hackathon project "Humatron": write a 60-second pitch script file, generate a poster image, and add a reminder to submit on Devpost today at 9:30pm.' },
  { icon: '🧹', title: 'Downloads clean-up report', goal: 'Look through my Downloads folder, find what takes the most space and what looks old or duplicate, and write a clean-up suggestions file. Do not delete or move anything.' },
  { icon: '🌐', title: 'Web research brief', goal: 'Research the latest news about NVIDIA Nemotron models on the web, read the 2 best sources, and write a one-page brief with source links as a file in Documents.' },
];

const toLocal = (s: string) => new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : String(s).replace(' ', 'T') + 'Z');

export function MissionsPanel({ brain, visible, onThinking, goTo }: { brain: Brain, visible: boolean, onThinking: (b: boolean) => void, goTo: (t: Tab) => void }) {
  const [goal, setGoal] = useState('');
  const [m, setM] = useState<Mission | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const live = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const running = !!m && (m.status === 'planning' || m.status === 'running');

  const loadHistory = () => window.api.mission.list().then(setHistory).catch(() => {});
  useEffect(() => { loadHistory(); }, []);
  useEffect(() => { if (visible) loadHistory(); }, [visible]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => { onThinking(running); }, [running]);

  // Live progress from the main process.
  useEffect(() => window.api.mission.onEvent((ev: any) => {
    if (ev.type !== 'start' && ev.id !== live.current) return;
    setM(prev => {
      if (ev.type === 'start') { live.current = ev.id; return { ...(prev as Mission), id: ev.id, model: ev.model, provider: ev.provider }; }
      if (!prev) return prev;
      const steps = prev.steps.map(s => ({ ...s, tools: [...s.tools] }));
      switch (ev.type) {
        case 'plan': return { ...prev, title: ev.title, status: 'running', steps: ev.steps.map((s: any) => ({ ...s, status: 'pending', tools: [] })) };
        case 'step': if (steps[ev.index]) { steps[ev.index].status = ev.status; if (ev.summary) steps[ev.index].summary = ev.summary; } return { ...prev, steps };
        case 'tool': steps[ev.index]?.tools.push(ev.tool); return { ...prev, steps };
        case 'wait': return { ...prev, waiting: ev.seconds ? ev.reason : undefined };
        case 'report': return { ...prev, report: ev.report };
        case 'done': return { ...prev, status: 'done', ms: ev.ms };
        case 'error': return { ...prev, status: ev.stopped ? 'stopped' : 'failed', error: ev.error,
          steps: steps.map(s => s.status === 'running' ? { ...s, status: 'failed' } : s) };
      }
      return prev;
    });
    if (ev.type === 'done' || ev.type === 'error') { loadHistory(); }
  }), []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [m?.steps.map(s => s.status + s.tools.length).join(), m?.report]);

  const launch = async (g: string) => {
    const text = g.trim();
    if (!text || running) return;
    if (brain.loaded && !brain.hasKey) { goTo('settings'); return; }
    live.current = null;
    setM({ id: 0, goal: text, steps: [], status: 'planning', startedAt: Date.now() });
    setNow(Date.now());
    setGoal('');
    await window.api.mission.start(text);   // resolves when finished; progress arrives as events
  };

  const open = async (id: number) => {
    if (running) return;
    const x = await window.api.mission.get(id);
    if (!x) return;
    live.current = null;
    setM({ id: x.id, goal: x.goal, title: x.title, steps: (x.steps || x.plan?.steps || []).map((s: any) => ({ tools: [], status: 'pending', ...s })),
      report: x.status === 'done' ? x.report : undefined, error: x.status !== 'done' ? x.report : undefined,
      status: x.status === 'running' ? 'failed' : x.status, model: x.model, provider: x.provider, startedAt: toLocal(x.created_at).getTime(), ms: x.ms });
  };

  const elapsed = m ? ((m.ms ?? (now - m.startedAt)) / 1000) : 0;
  const doneCount = m?.steps.filter(s => s.status === 'done').length || 0;
  const pct = m?.steps.length ? Math.round((doneCount / m.steps.length) * 100) : 0;

  return (
    <div className="missions">
      <aside className="mission-history">
        <button className="btn btn-primary mission-new" onClick={() => { if (!running) { setM(null); live.current = null; } }} disabled={running}>+ New mission</button>
        <div className="mh-label">Past missions</div>
        {history.length === 0 && <div className="mh-empty">Your missions will show up here.</div>}
        {history.map(h => (
          <button key={h.id} className={`mh-item ${m?.id === h.id ? 'active' : ''}`} onClick={() => open(h.id)} disabled={running}>
            <span className={`mh-dot ${h.status}`} />
            <span className="mh-text">
              <span className="mh-title">{h.title || h.goal}</span>
              <span className="mh-meta">{toLocal(h.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{h.ms ? ` · ${Math.round(h.ms / 1000)}s` : ''}</span>
            </span>
          </button>
        ))}
      </aside>

      <section className="mission-main" ref={scrollRef}>
        {!m ? (
          <div className="mission-hero">
            <div className="hero-logo"><Logo size={64} /></div>
            <h1 className="hero-title" style={{ fontSize: 34 }}>Give Humatron a mission</h1>
            <p className="hero-sub">Describe a goal. <b>NVIDIA Nemotron</b> plans the steps, runs them with your files, calendar, memory and image tools, and hands you a report.</p>
            <div className="mission-input">
              <textarea value={goal} onChange={e => setGoal(e.target.value)} rows={3} placeholder="e.g. Prepare me for Monday's exam: study plan file + calendar sessions…"
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); launch(goal); } }} />
              <div className="mission-input-bar">
                <span className="brain-badge"><span className="nv-dot" />{brain.name} · {shortModel(brain.model)}</span>
                <button className="btn btn-primary" onClick={() => launch(goal)} disabled={!goal.trim()}>Launch mission →</button>
              </div>
            </div>
            <div className="starter-grid">
              {EXAMPLES.map((x, i) => (
                <button key={x.title} className="starter" style={{ animationDelay: `${100 + i * 60}ms` }} onClick={() => launch(x.goal)}>
                  <span className="starter-icon">{x.icon}</span>
                  <span className="starter-title">{x.title}</span>
                  <span className="starter-text">{x.goal}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mission-run">
            <header className="mission-head">
              <div className="mission-head-top">
                <Logo size={44} active={running} />
                <div className="mission-head-text">
                  <h2>{m.title || (m.status === 'planning' ? 'Planning your mission…' : m.goal)}</h2>
                  <p>{m.goal}</p>
                </div>
                {running
                  ? <button className="btn btn-danger btn-sm" onClick={() => m.id && window.api.mission.cancel(m.id)}>Stop</button>
                  : <button className="btn btn-secondary btn-sm" onClick={() => launch(m.goal)}>Run again</button>}
              </div>
              <div className="mission-stats">
                <span className="brain-badge"><span className="nv-dot" />{m.provider || brain.name} · {shortModel(m.model || brain.model)}</span>
                <span className={`mission-status ${m.status}`}>{{ planning: 'Planning', running: 'Running', done: 'Complete', failed: 'Failed', stopped: 'Stopped' }[m.status]}</span>
                <span className="mission-time">{elapsed.toFixed(0)}s</span>
                {m.steps.length > 0 && <span className="mission-count">{doneCount}/{m.steps.length} steps</span>}
              </div>
              {m.steps.length > 0 && <div className="mission-progress"><i style={{ width: `${pct}%` }} /></div>}
              {m.waiting && running && <div className="mission-wait">⏳ {m.waiting}</div>}
            </header>

            {m.status === 'planning' && (
              <div className="thinking-card" style={{ marginTop: 18 }}>
                <span className="dots"><i /><i /><i /></span>
                <span className="thinking-phase">Nemotron is breaking your goal into steps…</span>
              </div>
            )}

            <ol className="timeline">
              {m.steps.map((s, i) => (
                <li key={i} className={`tl-step ${s.status}`}>
                  <span className="tl-node">{s.status === 'done' ? '✓' : s.status === 'failed' ? '!' : i + 1}</span>
                  <div className="tl-body">
                    <div className="tl-title">{s.title}{s.status === 'running' && <span className="tl-live">working…</span>}</div>
                    {s.detail && <div className="tl-detail">{s.detail}</div>}
                    {s.tools.length > 0 && (
                      <div className="tool-cards">
                        {s.tools.map((t, k) => {
                          const info = TOOL_INFO[t.name] || { icon: '⚙️', label: t.name, detail: () => '' };
                          const img = t.ok && t.name === 'generate_image' ? String(t.result?.image || '') : '';
                          return (
                            <React.Fragment key={k}>
                              <div className={`tool-card ${t.ok ? '' : 'failed'}`}>
                                <span className="tool-icon">{info.icon}</span>
                                <span className="tool-label">{t.ok ? info.label : `${info.label} — failed`}</span>
                                <span className="tool-detail">{t.ok ? info.detail(t.args) : String(t.result?.error || '')}</span>
                                <span className="tool-check">{t.ok ? '✓' : '!'}</span>
                              </div>
                              {img && <figure className="gen-image"><img src={fileUrl(img)} alt="" onClick={() => window.api.files.open(img)} /></figure>}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    )}
                    {s.summary && <div className="tl-summary">{s.summary}</div>}
                  </div>
                </li>
              ))}
            </ol>

            {m.report && (
              <div className="mission-report">
                <div className="report-head">
                  <span>📋 Mission report</span>
                  <button className="ghost-btn" onClick={() => navigator.clipboard.writeText(m.report || '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <div className="md">{renderMarkdown(m.report)}</div>
              </div>
            )}
            {(m.status === 'failed' || m.status === 'stopped') && (
              <div className="error-card" style={{ marginTop: 16 }}>
                <b>{m.status === 'stopped' ? 'Mission stopped.' : 'Mission failed.'}</b>
                <span>{m.error}</span>
                <div className="error-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => launch(m.goal)}>Try again</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => goTo('settings')}>Check settings</button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
