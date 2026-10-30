import React, { useState, useEffect, useRef } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { SkillBuilder } from './components/SkillBuilder';
import { MemoryViewer } from './components/MemoryViewer';
import { SettingsPanel } from './components/SettingsPanel';
import { CalendarPanel } from './components/CalendarPanel';
import { SystemTray } from './components/SystemTray';

type Tab = 'chat' | 'skills' | 'memory' | 'calendar' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [isMaximized, setIsMaximized] = useState(false);
  const [notifications, setNotifications] = useState<Array<{id: number, title: string, body: string, time: number}>>([]);
  const notificationId = useRef(0);

  useEffect(() => {
    // @ts-ignore
    window.api.window.isMaximized().then(setIsMaximized);

    // @ts-ignore
    window.api.onNotification((notification: {title: string, body: string}) => {
      const id = ++notificationId.current;
      setNotifications(prev => [...prev, { id, title: notification.title, body: notification.body, time: Date.now() }]);
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, 5000);
    });

    return () => {
      // @ts-ignore
      window.api.onNotification(() => {});
    };
  }, []);

  const handleWindowControl = async (action: 'minimize' | 'maximize' | 'close') => {
    // @ts-ignore
    await window.api.window[action]();
    if (action === 'maximize') {
      const maximized = await window.api.window.isMaximized();
      setIsMaximized(maximized);
    }
  };

  return (
    <div className="app">
      <div className="titlebar" onDoubleClick={() => handleWindowControl('maximize')}>
        <div className="titlebar-left">
          <div className="app-icon" />
          <span className="app-title">Humatron</span>
        </div>
        <div className="titlebar-center">
          <nav className="tabs">
            <button className={activeTab === 'chat' ? 'active' : ''} onClick={() => setActiveTab('chat')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Chat
            </button>
            <button className={activeTab === 'skills' ? 'active' : ''} onClick={() => setActiveTab('skills')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
              Skills
            </button>
            <button className={activeTab === 'memory' ? 'active' : ''} onClick={() => setActiveTab('memory')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="15" y1="2" x2="15" y2="15"/><line x1="9" y1="9" x2="9" y2="9"/>
              </svg>
              Memory
            </button>
            <button className={activeTab === 'calendar' ? 'active' : ''} onClick={() => setActiveTab('calendar')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Calendar
            </button>
            <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Settings
            </button>
          </nav>
        </div>
        <div className="titlebar-right">
          <button className="window-btn" onClick={() => handleWindowControl('minimize')} title="Minimize">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button className="window-btn" onClick={() => handleWindowControl('maximize')} title={isMaximized ? 'Restore' : 'Maximize'}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {isMaximized ? (
                <>
                  <path d="M4 4h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
                  <path d="M10 4v16"/><path d="M4 10h16"/>
                </>
              ) : (
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              )}
            </svg>
          </button>
          <button className="window-btn close" onClick={() => handleWindowControl('close')} title="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <main className="main-content">
        {activeTab === 'chat' && <ChatPanel />}
        {activeTab === 'skills' && <SkillBuilder />}
        {activeTab === 'memory' && <MemoryViewer />}
        {activeTab === 'calendar' && <CalendarPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
      </main>

      {notifications.map(n => (
        <div key={n.id} className="notification-toast" style={{animation: 'slideIn 300ms ease'}}>
          <div className="notification-title">{n.title}</div>
          <div className="notification-body">{n.body}</div>
        </div>
      ))}

      <SystemTray />
    </div>
  );
}