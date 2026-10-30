import React, { useState, useEffect } from 'react';

export interface Skill {
  id: number;
  name: string;
  when_to_use: string;
  steps: string;
  created_at: string;
}

export function SkillBuilder() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [formData, setFormData] = useState({ name: '', when_to_use: '', steps: '' });
  const [executing, setExecuting] = useState<string | null>(null);
  const [executionResults, setExecutionResults] = useState<{skill: string, results: any[]} | null>(null);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      // @ts-ignore
      const data = await window.api.skill.list();
      setSkills(data);
    } catch (e) {
      console.error('Failed to load skills:', e);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // @ts-ignore
      await window.api.skill.save(formData.name, formData.when_to_use, formData.steps);
      setShowModal(false);
      setFormData({ name: '', when_to_use: '', steps: '' });
      setEditingSkill(null);
      loadSkills();
    } catch (e) {
      console.error('Failed to save skill:', e);
    }
  };

  const handleEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setFormData({ name: skill.name, when_to_use: skill.when_to_use, steps: skill.steps });
    setShowModal(true);
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete skill "${name}"?`)) return;
    try {
      // @ts-ignore
      await window.api.skill.delete(name);
      loadSkills();
    } catch (e) {
      console.error('Failed to delete skill:', e);
    }
  };

  const handleExecute = async (name: string) => {
    setExecuting(name);
    try {
      // @ts-ignore
      const result = await window.api.skill.execute(name);
      setExecutionResults(result);
      setShowResults(true);
    } catch (e) {
      console.error('Failed to execute skill:', e);
    } finally {
      setExecuting(null);
    }
  };

  const handleNew = () => {
    setEditingSkill(null);
    setFormData({ name: '', when_to_use: '', steps: '' });
    setShowModal(true);
  };

  const handleClose = () => {
    setShowModal(false);
    setEditingSkill(null);
    setFormData({ name: '', when_to_use: '', steps: '' });
  };

  const handleCloseResults = () => {
    setShowResults(false);
    setExecutionResults(null);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h1 className="panel-title">Skill Engine</h1>
        <p className="panel-subtitle">Teach Humatron a workflow once, run it with one click</p>
      </div>

      <div className="skills-list">
        {skills.length === 0 && (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
            <h3>No skills yet</h3>
            <p>Create your first skill to automate repetitive workflows.</p>
          </div>
        )}
        {skills.map(skill => (
          <div key={skill.id} className="skill-card">
            <div className="skill-header">
              <span className="skill-name">{skill.name}</span>
              <div className="skill-actions">
                <button className="icon-btn" onClick={() => handleExecute(skill.name)} title="Execute" disabled={executing === skill.name}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                </button>
                <button className="icon-btn" onClick={() => handleEdit(skill)} title="Edit">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button className="icon-btn" onClick={() => handleDelete(skill.name)} title="Delete">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </div>
            </div>
            <p className="skill-description">{skill.when_to_use}</p>
            <pre className="skill-steps">{skill.steps}</pre>
          </div>
        ))}
        <button className="add-skill-btn" onClick={handleNew}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Skill
        </button>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={handleClose}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">{editingSkill ? 'Edit Skill' : 'New Skill'}</h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="settings-input"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., deploy-frontend"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">When to Use</label>
                <textarea
                  className="form-textarea"
                  value={formData.when_to_use}
                  onChange={e => setFormData(prev => ({ ...prev, when_to_use: e.target.value }))}
                  placeholder="Describe when this skill should be triggered..."
                  rows={3}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Steps (numbered, one per line)</label>
                <textarea
                  className="form-textarea"
                  value={formData.steps}
                  onChange={e => setFormData(prev => ({ ...prev, steps: e.target.value }))}
                  placeholder="1. run: npm run build
2. write: dist/index.html|<html>...
3. web: https://vercel.com"
                  rows={8}
                  required
                />
              </div>
              <p style={{fontSize: '12px', color: 'var(--fg-muted)', marginTop: '8px', marginBottom: '16px'}}>
                Step types: <code>run: {'<command>'}</code>, <code>read: {'<file>'}</code>, <code>write: {'<file>'}|{'<content>'}</code>, <code>web: {'<url>'}</code>
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingSkill ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showResults && executionResults && (
        <div className="modal-overlay" onClick={handleCloseResults}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth: '700px', maxHeight: '80vh'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px'}}>
              <h2 className="modal-title" style={{margin: 0}}>Execution Results: {executionResults.skill}</h2>
              <button className="icon-btn" onClick={handleCloseResults} title="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div style={{maxHeight: '50vh', overflowY: 'auto'}}>
              {executionResults.results.map((r, i) => (
                <div key={i} style={{marginBottom: '12px', padding: '12px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '8px'}}>
                    <span style={{fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: 'var(--fg-muted)'}}>{r.step}</span>
                    <span className={r.success ? 'success' : 'error'} style={{fontSize: '12px', fontWeight: '500', color: r.success ? 'var(--accent)' : 'var(--danger)'}}>
                      {r.success ? '✓ Success' : '✗ Failed'}
                    </span>
                  </div>
                  {r.result && (
                    <pre style={{fontSize: '11px', color: 'var(--fg)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'}}>{JSON.stringify(r.result, null, 2)}</pre>
                  )}
                  {r.error && (
                    <pre style={{fontSize: '11px', color: 'var(--danger)', whiteSpace: 'pre-wrap'}}>{r.error}</pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}