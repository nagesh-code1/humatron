import React, { useState, useEffect } from 'react';
import { VoiceSettings } from './VoiceSettings';
import { WebSearchSettings } from './WebSearchSettings';

// Humatron runs only on NVIDIA Nemotron. One key field; the key's format tells us which host serves it (see agent.ts providerForKey).
const HOSTS: Record<string, { label: string, keyField: string }> = {
  nebius: { label: 'Nebius Token Factory', keyField: 'nebiusApiKey' },
  nvidia: { label: 'NVIDIA build', keyField: 'nvidiaApiKey' },
};
const hostForKey = (key: string) => /^nvapi-/i.test(key.trim()) ? 'nvidia' : 'nebius';
const cleanErr = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function SettingsPanel() {
  const [settings, setSettings] = useState<Record<string, any>>({
    provider: 'nebius', key: '', model: 'auto',
    autoStart: false,
    globalHotkey: 'Alt+Space',
  });
  const [otherKey, setOtherKey] = useState('');   // the other host's saved key, if any (offered as a one-click switch)
  const [saved, setSaved] = useState(false);
  const [dataMsg, setDataMsg] = useState<{ ok?: boolean, text: string } | null>(null);

  const exportData = async () => {
    setDataMsg(null);
    try {
      const r = await window.api.data.export();
      if (r.canceled) return;
      const n = Object.values(r.counts || {}).reduce((a, b) => a + b, 0);
      setDataMsg({ ok: true, text: `✅ Exported ${n} items to ${r.path}` });
    } catch (e) { setDataMsg({ ok: false, text: '❌ Export failed: ' + cleanErr(e) }); }
  };

  const clearData = async () => {
    setDataMsg(null);
    try {
      const r = await window.api.data.clear();
      if (!r.canceled) setDataMsg({ ok: true, text: '✅ All data cleared — reloading…' });
    } catch (e) { setDataMsg({ ok: false, text: '❌ Clear failed: ' + cleanErr(e) }); }
  };
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<{ busy?: boolean, ok?: boolean, text?: string }>({});
  const host = HOSTS[settings.provider] || HOSTS.nebius;
  const other = settings.provider === 'nebius' ? 'nvidia' : 'nebius';

  const runTest = async () => {
    await handleSave();
    setTest({ busy: true, text: `Calling Nemotron on ${host.label}…` });
    try {
      const r = await window.api.nebius.test();
      setTest({ ok: true, text: `✅ ${r.model} answered in ${(r.ms / 1000).toFixed(1)}s: "${r.reply.slice(0, 80)}"` });
      setModels(await window.api.nebius.models());
    } catch (e: any) {
      setTest({ ok: false, text: '❌ ' + cleanErr(e) });
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const get = (k: string) => window.api.store.get(k);
      const [stored, nebiusKey, nvidiaKey, autoStart, hotkey] = await Promise.all([
        get('provider'), get('nebiusApiKey'), get('nvidiaApiKey'), get('autoStart'), get('globalHotkey'),
      ]);
      // Old Groq/Gemini setups fall back to whichever Nemotron key exists, Nebius first.
      const provider = HOSTS[stored] ? stored : (nebiusKey || !nvidiaKey ? 'nebius' : 'nvidia');
      const keys: Record<string, string> = { nebius: nebiusKey || '', nvidia: nvidiaKey || '' };
      setOtherKey(keys[provider === 'nebius' ? 'nvidia' : 'nebius']);
      setSettings({
        provider, key: keys[provider], model: (await get('model_' + provider)) || 'auto',
        autoStart: autoStart ?? false,
        globalHotkey: hotkey || 'Alt+Space',
      });
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  };

  const handleSave = async () => {
    try {
      const set = (k: string, v: any) => window.api.store.set(k, v);
      const provider = settings.key.trim() ? hostForKey(settings.key) : settings.provider;
      await Promise.all([
        set('provider', provider),
        set(HOSTS[provider].keyField, settings.key.trim()),
        set('model_' + provider, settings.model),
        set('autoStart', settings.autoStart),
        set('globalHotkey', settings.globalHotkey),
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

  // Typing/pasting a key re-detects the host; switching host loads that host's model choice.
  const changeKey = async (key: string) => {
    const provider = key.trim() ? hostForKey(key) : settings.provider;
    const model = provider !== settings.provider ? (await window.api.store.get('model_' + provider)) || 'auto' : settings.model;
    if (provider !== settings.provider) { setModels([]); setTest({}); setOtherKey(String((await window.api.store.get(HOSTS[settings.provider].keyField)) || '')); }
    setSettings(prev => ({ ...prev, key, provider, model }));
    setSaved(false);
  };

  const switchHost = async () => {
    const prevKey = settings.key;
    await window.api.store.set('provider', other);
    setSettings(prev => ({ ...prev, provider: other, key: otherKey }));
    setOtherKey(prevKey);
    setModels([]); setTest({});
    setSettings(prev => ({ ...prev, model: 'auto' }));
    const m = await window.api.store.get('model_' + other);
    if (m) setSettings(prev => ({ ...prev, model: m }));
  };

  return (
    <div className="panel" style={{maxWidth: '700px'}}>
      <div className="panel-header">
        <h1 className="panel-title">Settings</h1>
        <p className="panel-subtitle">Configure Humatron to match your workflow</p>
      </div>

      <div className="settings-section">
        <h3 style={{fontSize: '15px', fontWeight: '600', marginBottom: '6px', color: 'var(--fg)'}}>AI Brain · NVIDIA Nemotron</h3>
        <p style={{fontSize: '12.5px', color: 'var(--fg-muted)', marginBottom: '16px', lineHeight: 1.55}}>
          Humatron thinks with NVIDIA Nemotron only. Paste one Nemotron API key — from Nebius Token Factory (recommended) or NVIDIA build.
        </p>

        <div className="form-group">
          <label className="form-label">Nemotron API key</label>
          <input
            type="password"
            className="settings-input"
            value={settings.key}
            onChange={e => changeKey(e.target.value)}
            placeholder="Paste your Nebius Token Factory key (or an NVIDIA nvapi- key)"
            style={{maxWidth: '500px'}}
          />
          <div style={{display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '8px'}}>
            {settings.key.trim() && (
              <span className={`host-badge ${settings.provider}`}>
                <span className="nv-dot" />Detected: {host.label}{settings.provider === 'nebius' ? ' ✓ hackathon-ready' : ' · use a Nebius key for the hackathon'}
              </span>
            )}
            {otherKey && <button className="ghost-btn" onClick={switchHost}>Use saved {HOSTS[other].label} key instead</button>}
          </div>
          <p style={{fontSize: '12px', color: 'var(--fg-muted)', marginTop: '8px'}}>
            Get one at <a href="https://tokenfactory.nebius.com" target="_blank" rel="noopener noreferrer" style={{color: 'var(--accent)'}}>tokenfactory.nebius.com</a> (API keys)
            {' '}or <a href="https://build.nvidia.com" target="_blank" rel="noopener noreferrer" style={{color: 'var(--accent)'}}>build.nvidia.com</a> (starts with nvapi-). Stored only on this PC.
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">Nemotron model</label>
          <select
            className="settings-input"
            value={settings.model}
            onChange={e => handleChange('model', e.target.value)}
            style={{maxWidth: '420px', cursor: 'pointer'}}
          >
            <option value="auto">Auto: best Nemotron (Nemotron 3 Ultra first)</option>
            {settings.model !== 'auto' && !models.includes(settings.model) && <option value={settings.model}>{settings.model}</option>}
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="form-group">
          <button className="btn btn-primary" onClick={runTest} disabled={test.busy || !settings.key.trim()}>
            {test.busy ? 'Testing…' : 'Save & test connection'}
          </button>
          {test.text && <p style={{fontSize: '13px', marginTop: '8px', color: test.ok ? 'var(--ok)' : test.busy ? 'var(--fg-muted)' : '#fca5a5'}}>{test.text}</p>}
        </div>
      </div>

      <WebSearchSettings />

      <VoiceSettings />

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
          Memories, chats, skills and calendar live in a local database on this PC. The only things that leave your
          device are requests to NVIDIA Nemotron (on Nebius or NVIDIA), web searches (Tavily, if enabled) and image descriptions. Speech is recognised on this PC. Your API key is saved only in Humatron's local settings file.
        </p>
        <div style={{display: 'flex', gap: '12px'}}>
          <button className="btn btn-secondary" onClick={exportData}>
            Export Data
          </button>
          <button className="btn btn-danger" onClick={clearData}>
            Clear All Data
          </button>
        </div>
        {dataMsg && <p style={{fontSize: '13px', marginTop: '10px', color: dataMsg.ok ? 'var(--ok)' : '#fca5a5', wordBreak: 'break-all'}}>{dataMsg.text}</p>}
      </div>

      <div className="settings-section">
        <h3 style={{fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: 'var(--fg)'}}>About</h3>
        <div style={{color: 'var(--fg-muted)', fontSize: '13px', lineHeight: '1.8'}}>
          <p><strong>Humatron</strong> v1.0.0</p>
          <p>Local-first AI assistant with memory, skills, and tool integration.</p>
          <p>Built with Electron, React, TypeScript, and Vite.</p>
          <p style={{marginTop: '12px'}}>Powered by NVIDIA Nemotron on <a href="https://tokenfactory.nebius.com" target="_blank" rel="noopener noreferrer" style={{color: 'var(--accent)'}}>Nebius Token Factory</a>.</p>
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