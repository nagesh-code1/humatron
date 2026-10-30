import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { MissionsPanel } from './components/MissionsPanel';
import { SkillBuilder } from './components/SkillBuilder';
import { MemoryViewer } from './components/MemoryViewer';
import { SettingsPanel } from './components/SettingsPanel';
import { CalendarPanel } from './components/CalendarPanel';
import { SystemTray } from './components/SystemTray';
import { Logo } from './components/Logo';

export type Tab = 'chat' | 'missions' | 'skills' | 'memory' | 'calendar' | 'settings';

// Must match PROVIDERS in SettingsPanel / src/agent.ts.
const PROVIDER_NAME: Record<string, string> = { nvidia: 'Nemotron · NVIDIA', nebius: 'Nemotron · Nebius' };
const KEY_FIELD: Record<string, string> = { nvidia: 'nvidiaApiKey', nebius: 'nebiusApiKey' };

export interface Brain { provider: string; name: string; model: string; hasKey: boolean; loaded: boolean }

const I = (d: React.ReactNode) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;

const NAV: Array<{ id: Tab, label: string, hint: string, icon: React.ReactNode }> = [
  { id: 'chat', label: 'Chat', hint: 'Talk to Humatron', icon: I(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>) },
  { id: 'missions', label: 'Missions', hint: 'Nemotron plans and does multi-step goals', icon: I(<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></>) },
  { id: 'memory', label: 'Memory', hint: 'What it knows about you', icon: I(<><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/></>) },
  { id: 'calendar', label: 'Calendar', hint: 'Your schedule', icon: I(<><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></>) },
  { id: 'skills', label: 'Skills', hint: 'Reusable workflows', icon: I(<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>) },
  { id: 'settings', label: 'Settings', hint: 'Brain, keys, hotkey', icon: I(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>) },
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [isMaximized, setIsMaximized] = useState(false);
  const [chatThinking, setChatThinking] = useState(false);
  const [missionThinking, setMissionThinking] = useState(false);
  const thinking = chatThinking || missionThinking;
  const [brain, setBrain] = useState<Brain>({ provider: 'nvidia', name: PROVIDER_NAME.nvidia, model: '', hasKey: false, loaded: false });
  const [notifications, setNotifications] = useState<Array<{id: number, title: string, body: string, time: number}>>([]);
  const notificationId = useRef(0);

  const loadBrain = useCallback(async () => {
    try {
      const get = (k: string) => window.api.store.get(k);
      // Same rule as agent.ts: a non-Nemotron provider left over from old settings falls back to a saved Nemotron key, Nebius first.
      const [stored, nebiusKey, nvidiaKey] = await Promise.all([get('provider'), get('nebiusApiKey'), get('nvidiaApiKey')]);
      const provider = KEY_FIELD[stored] ? String(stored) : (nebiusKey || !nvidiaKey ? 'nebius' : 'nvidia');
      const [key, chosen, resolved] = await Promise.all([get(KEY_FIELD[provider] || 'nvidiaApiKey'), get('model_' + provider), get('resolvedModel_' + provider)]);
      const model = chosen && chosen !== 'auto' ? chosen : resolved || 'auto';
      setBrain({ provider, name: PROVIDER_NAME[provider] || provider, model: String(model), hasKey: !!String(key || '').trim(), loaded: true });
    } catch {
      setBrain(b => ({ ...b, loaded: true }));
    }
  }, []);

  // Settings may have changed the provider/key, so re-read whenever the page changes.
  useEffect(() => { loadBrain(); }, [activeTab, loadBrain]);

  useEffect(() => {
    window.api.window.isMaximized().then(setIsMaximized);

    // @ts-ignore
    window.api.onNotification((notification: {title: string, body: string}) => {
      const id = ++notificationId.current;
      setNotifications(prev => [...prev, { id, title: notification.title, body: notification.body, time: Date.now() }]);
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, 5000);
    });

    // Ctrl+1..5 jumps between pages.
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= String(NAV.length)) {
        e.preventDefault();
        setActiveTab(NAV[Number(e.key) - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleWindowControl = async (action: 'minimize' | 'maximize' | 'close') => {
    await window.api.window[action]();
    if (action === 'maximize') {
      const maximized = await window.api.window.isMaximized();
      setIsMaximized(maximized);
    }
  };

  const current = NAV.find(n => n.id === activeTab)!;

  return (
    <div className="app">
      <div className="aurora" aria-hidden="true"><span /><span /><span /></div>

      <div className="titlebar" onDoubleClick={() => handleWindowControl('maximize')}>
        <div className="titlebar-crumb">
          <span className="crumb-app">Humatron</span>
          <span className="crumb-sep">/</span>
          <span className="crumb-page">{current.label}</span>
        </div>
        <div className="titlebar-right">
          <button className="window-btn" onClick={() => handleWindowControl('minimize')} title="Minimize">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button className="window-btn" onClick={() => handleWindowControl('maximize')} title={isMaximized ? 'Restore' : 'Maximize'}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {isMaximized ? (
                <><rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/></>
              ) : (
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              )}
            </svg>
          </button>
          <button className="window-btn close" onClick={() => handleWindowControl('close')} title="Hide to tray">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <Logo size={38} active={thinking} />
            <div className="brand-text">
              <span className="brand-name">Humatron</span>
              <span className="brand-tag">your local-first AI</span>
            </div>
          </div>

          <nav className="nav">
            {NAV.map((n, i) => (
              <button key={n.id} className={`nav-item ${activeTab === n.id ? 'active' : ''}`} onClick={() => setActiveTab(n.id)} title={`${n.hint}  (Ctrl+${i + 1})`}>
                <span className="nav-icon">{n.icon}</span>
                <span className="nav-label">{n.label}</span>
                <kbd className="nav-kbd">^{i + 1}</kbd>
              </button>
            ))}
          </nav>

          <div className="sidebar-foot">
            <button className={`brain-card ${brain.hasKey ? 'ok' : 'warn'}`} onClick={() => setActiveTab('settings')} title="Change AI brain">
              <span className={`status-dot ${thinking ? 'busy' : brain.hasKey ? 'ok' : 'warn'}`} />
              <span className="brain-text">
                <span className="brain-name">{brain.name}</span>
                <span className="brain-model">{!brain.loaded ? '…' : brain.hasKey ? (thinking ? 'thinking…' : shortModel(brain.model)) : 'Add your Nemotron key →'}</span>
              </span>
            </button>
            <div className="privacy-pill">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
              Memory stays on this PC
            </div>
          </div>
        </aside>

        <main className="main-content">
          {/* Chat stays mounted so a reply that is still coming in survives switching pages. */}
          <div className={`page ${activeTab === 'chat' ? 'page-enter' : 'page-hidden'}`}>
            <ChatPanel brain={brain} visible={activeTab === 'chat'} onThinking={setChatThinking} onModel={loadBrain} goTo={setActiveTab} />
          </div>
          <div className={`page ${activeTab === 'missions' ? 'page-enter' : 'page-hidden'}`}>
            <MissionsPanel brain={brain} visible={activeTab === 'missions'} onThinking={setMissionThinking} goTo={setActiveTab} />
          </div>
          {activeTab !== 'chat' && activeTab !== 'missions' && (
            <div className="page page-enter" key={activeTab}>
              {activeTab === 'skills' && <SkillBuilder />}
              {activeTab === 'memory' && <MemoryViewer />}
              {activeTab === 'calendar' && <CalendarPanel />}
              {activeTab === 'settings' && <SettingsPanel />}
            </div>
          )}
        </main>
      </div>

      <div className="toast-stack">
        {notifications.map(n => (
          <div key={n.id} className="notification-toast">
            <div className="notification-title">{n.title}</div>
            <div className="notification-body">{n.body}</div>
          </div>
        ))}
      </div>

      <SystemTray />
    </div>
  );
}

export function shortModel(m: string) {
  if (!m || m === 'auto') return 'auto-pick best model';
  return m.replace(/^.*\//, '');
}
