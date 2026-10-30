import React, { useState, useEffect, useRef } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  tools?: Array<{ name: string, args: any, result: any, ok: boolean }>;
}

const TOOL_LABEL: Record<string, string> = { remember: '🧠 Saved to memory', recall: '🔎 Searched memory', add_event: '📅 Added event', list_events: '📅 Checked calendar' };

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadHistory = async () => {
    try {
      // @ts-ignore
      const history = await window.api.conversation.getRecent(50);
      const formatted = history.reverse().map((msg: any) => ({
        id: msg.id.toString(),
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        timestamp: new Date(msg.created_at).getTime(),
        tools: (() => { try { return JSON.parse(msg.metadata || '{}').tools; } catch { return undefined; } })(),
      }));
      setMessages(formatted);
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  };

  const saveMessage = async (role: 'user' | 'assistant', content: string) => {
    try {
      // @ts-ignore
      await window.api.conversation.add(role, content);
    } catch (e) {
      console.error('Failed to save message:', e);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // agent:chat persists both sides, injects relevant memories and runs Nemotron's tool calls
      // @ts-ignore
      const response = await window.api.agent.chat(text);
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.reply,
        timestamp: Date.now(),
        tools: response.tools,
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error: any) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${String(error.message || 'Failed to get response').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="panel chat-panel">
      <div className="panel-header">
        <h1 className="panel-title">Chat</h1>
        <p className="panel-subtitle">NVIDIA Nemotron on Nebius · memory + calendar tools · data stays on this PC</p>
      </div>

      <div className="messages" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <h3>Start a conversation</h3>
            <p>Ask me anything - code, research, planning, or just chat.</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="avatar">
              {msg.role === 'user' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <path d="M8 17h8M12 17v4"/>
                </svg>
              )}
            </div>
            <div className="message-content">
              {msg.tools && msg.tools.length > 0 && (
                <div className="tool-chips">
                  {msg.tools.map((t, i) => (
                    <span key={i} className={`tool-chip ${t.ok ? '' : 'failed'}`} title={JSON.stringify(t.args)}>
                      {TOOL_LABEL[t.name] || t.name}{t.name === 'remember' ? `: ${String(t.args?.content || '').slice(0, 60)}` : t.name === 'add_event' ? `: ${t.args?.title} @ ${t.args?.start}` : ''}
                    </span>
                  ))}
                </div>
              )}
              {renderMarkdown(msg.content)}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="message assistant"><div className="avatar">…</div><div className="message-content thinking">Nemotron is thinking…</div></div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="input-area" onSubmit={handleSend}>
        <div className="input-wrapper">
          <textarea
            ref={textareaRef}
            className="input-field"
            placeholder="Message Humatron... (Enter to send, Shift+Enter for new line)"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={1}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 22 2"/>
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

function renderMarkdown(text: string) {
  // Simple markdown rendering for code blocks and inline code
  const parts = text.split(/(`{1,3}[\s\S]*?`{1,3})/);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3).trim();
          const langMatch = code.match(/^(\w+)\n/);
          const language = langMatch ? langMatch[1] : '';
          const codeContent = language ? code.slice(language.length + 1) : code;
          return (
            <pre key={i}><code className={language}>{codeContent}</code></pre>
          );
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}