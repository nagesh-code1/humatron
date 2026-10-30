import React, { useEffect, useState } from 'react';

const cleanErr = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// Separate Tavily key: turns on Humatron's web_search / read_webpage tools (chat + missions). Saved as you type.
export function WebSearchSettings() {
  const [key, setKey] = useState('');
  const [test, setTest] = useState<{ busy?: boolean, ok?: boolean, text?: string }>({});

  useEffect(() => { window.api.store.get('tavilyApiKey').then(k => setKey(k || '')); }, []);

  const change = (v: string) => { setKey(v); setTest({}); window.api.store.set('tavilyApiKey', v.trim()); };

  const runTest = async () => {
    setTest({ busy: true, text: 'Searching the web via Tavily…' });
    try {
      const r = await window.api.web.test();
      setTest({ ok: true, text: `✅ Web search works (${(r.ms / 1000).toFixed(1)}s) — top result: "${r.title.slice(0, 70)}"` });
    } catch (e) { setTest({ ok: false, text: '❌ ' + cleanErr(e) }); }
  };

  return (
    <div className="settings-section">
      <h3 style={{fontSize: '15px', fontWeight: '600', marginBottom: '6px', color: 'var(--fg)'}}>Web search · Tavily</h3>
      <p style={{fontSize: '12.5px', color: 'var(--fg-muted)', marginBottom: '16px', lineHeight: 1.55}}>
        Lets Nemotron search the live web and read pages — for news, prices, facts and research missions. Optional; leave empty to keep Humatron offline-only.
      </p>
      <div className="form-group">
        <label className="form-label">Tavily API key {key.trim() && <span style={{color: 'var(--ok)'}}>· web search on</span>}</label>
        <div style={{display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap'}}>
          <input type="password" className="settings-input" value={key} onChange={e => change(e.target.value)}
            placeholder="tvly-… (free at app.tavily.com)" style={{maxWidth: '360px'}} />
          <button className="btn btn-secondary" onClick={runTest} disabled={!key.trim() || test.busy}>{test.busy ? 'Testing…' : 'Test'}</button>
        </div>
        {test.text && <p style={{fontSize: '13px', marginTop: '8px', color: test.ok ? 'var(--ok)' : test.busy ? 'var(--fg-muted)' : '#fca5a5'}}>{test.text}</p>}
        <p style={{fontSize: '12px', color: 'var(--fg-muted)', marginTop: '8px'}}>
          Get a free key (1,000 searches/month) at <a href="https://app.tavily.com" target="_blank" rel="noopener noreferrer" style={{color: 'var(--accent)'}}>app.tavily.com</a>. Stored only on this PC; only your search queries go to Tavily.
        </p>
      </div>
    </div>
  );
}
