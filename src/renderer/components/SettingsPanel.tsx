import React, { useState, useEffect } from 'react';

export function SettingsPanel() {
  const [settings, setSettings] = useState({
    nebiusApiKey: '',
    model: 'auto',
    autoStart: false,
    globalHotkey: 'Alt+Space',
  });
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<{ busy?: boolean, ok?: boolean, text?: string }>({});

  const runTest = async () => {
    await handleSave();
    setTest({ busy: true, text: 'Calling Nemotron on Nebius…' });
    try {
      // @ts-ignore
      const r = await window.api.nebius.test();
      setTest({ ok: true, text: `✅ ${r.model} answered in ${(r.ms / 1000).toFixed(1)}s: "${r.reply.slice(0, 80)}"` });
      // @ts-ignore
      setModels(await window.api.nebius.models());
    } catch (e: any) {
      setTest({ ok: false, text: '❌ ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      // @ts-ignore
      const [apiKey, model, autoStart, hotkey] = await Promise.all([
        window.api.store.get('nebiusApiKey'),
        window.api.store.get('model'),
        window.api.store.get('autoStart'),
        window.api.store.get('globalHotkey'),
      ]);
      setSettings({
        nebiusApiKey: apiKey || '',
        model: model && String(model).includes('/') ? model : 'auto',
        autoStart: autoStart ?? false,
        globalHotkey: hotkey || 'Alt+Space',
      });
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };

  const handleSave = async () => {
    try {
      // @ts-ignore
      await Promise.all([
        window.api.store.set('nebiusApiKey', settings.nebiusApiKey),
        window.api.store.set('model', settings.model),
        window.api.store.set('autoStart', settings.autoStart),
        window.api.store.set('globalHotkey', settings.globalHotkey),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  };

  const handleChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };


  return (
    <div className="panel" style={{maxWidth: '700px'}}>
      <div className="panel-header">
        <h1 className="panel-title">Settings</h1>
        <p className="panel-subtitle">Configure Humatron to match your workflow</p>
      </div>

      <div className="settings-section">
        <h3 style={{fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--fg)'}}>Nebius AI</h3>
        
        <div className="form-group">
          <label className="form-label">API Key</label>
          <input
            type="password"
            className="settings-input"
            value={settings.nebiusApiKey}
            onChange={e => handleChange('nebiusApiKey', e.target.value)}
            placeholder="Paste your Nebius API key (stored only on this PC)"
            style={{maxWidth: '500px'}}
          />
          <p style={{fontSize: '12px', color: 'var(--fg-muted)', marginTop: '6px'}}>
            Get your key at <a href="https://studio.nebius.com" target="_blank" rel="noopener noreferrer" style={{color: 'var(--accent)'}}>studio.nebius.com</a>
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">Model</label>
          <select
            className="settings-input"
            value={settings.model}
            onChange={e => handleChange('model', e.target.value)}
            style={{maxWidth: '300px', cursor: 'pointer'}}
          >
            <option value="auto">Auto: best Nemotron on my account</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="form-group">
          <button className="btn btn-primary" onClick={runTest} disabled={test.busy || !settings.nebiusApiKey}>
            {test.busy ? 'Testing…' : 'Save & test connection'}
          </button>
          {test.text && <p style={{fontSize: '13px', marginTop: '8px', color: test.ok ? '#5eead4' : test.busy ? 'var(--fg-muted)' : '#fca5a5'}}>{test.text}</p>}
        </div>
      </div>

      <div className="settings-section">
        <h3 style={{fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--fg)'}}>General</h3>
        
        <div className="settings-row">
          <div style={{flex: 1}}>
            <label className="form-label">Auto-start on login</label>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.autoStart}
              onChange={e => handleChange('autoStart', e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        <div className="form-group">
          <label className="form-label">Global Hotkey (show/hide window)</label>
          <input
            type="text"
            className="settings-input"
            value={settings.globalHotkey}
            onChange={e => handleChange('globalHotkey', e.target.value)}
            placeholder="e.g., Alt+Space, Ctrl+Shift+H"
            style={{maxWidth: '250px', fontFamily: 'JetBrains Mono, monospace'}}
          />
          <p style={{fontSize: '12px', color: 'var(--fg-muted)', marginTop: '6px'}}>
            Requires app restart to take effect.
          </p>
        </div>
      </div>

      <div className="settings-section">
        <h3 style={{fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--fg)'}}>Data & Privacy</h3>
        <p style={{fontSize: '13px', color: 'var(--fg-muted)', lineHeight: '1.6', marginBottom: '16px'}}>
          All data is stored locally on your machine. Nothing leaves your device except API calls to Nebius.
          Your API key is stored encrypted in the OS credential store.
        </p>
        <div style={{display: 'flex', gap: '12px'}}>
          <button className="btn btn-secondary" onClick={() => { /* export data */ }}>
            Export Data
          </button>
          <button className="btn btn-danger" onClick={() => { /* clear data */ }}>
            Clear All Data
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h3 style={{fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--fg)'}}>About</h3>
        <div style={{color: 'var(--fg-muted)', fontSize: '13px', lineHeight: '1.8'}}>
          <p><strong>Humatron</strong> v1.0.0</p>
          <p>Local-first AI assistant with memory, skills, and tool integration.</p>
          <p>Built with Electron, React, TypeScript, and Vite.</p>
          <p style={{marginTop: '12px'}}>Powered by <a href="https://nebius.com" target="_blank" rel="noopener noreferrer" style={{color: 'var(--accent)'}}>Nebius</a> serverless inference.</p>
        </div>
      </div>

      <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '16px', borderTop: '1px solid var(--border)'}}>
        <button className="btn btn-primary" onClick={handleSave} style={{minWidth: '120px'}}>
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}