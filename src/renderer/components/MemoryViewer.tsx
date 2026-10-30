import React, { useState, useEffect } from 'react';

export interface Memory {
  id: number;
  content: string;
  metadata: string;
  created_at: string;
}

export function MemoryViewer() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredMemories, setFilteredMemories] = useState<Memory[]>([]);

  useEffect(() => {
    loadMemories();
  }, []);

  useEffect(() => {
    if (searchQuery.trim()) {
      const filtered = memories.filter(m => 
        m.content.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredMemories(filtered);
    } else {
      setFilteredMemories(memories);
    }
  }, [searchQuery, memories]);

  const loadMemories = async () => {
    try {
      // @ts-ignore
      const data = await window.api.memory.getRecent(100);
      setMemories(data);
      setFilteredMemories(data);
    } catch (e) {
      console.error('Failed to load memories:', e);
    }
  };

  const handleAddMemory = async () => {
    const content = prompt('Enter memory content:');
    if (!content?.trim()) return;
    
    try {
      // @ts-ignore
      await window.api.memory.add(content.trim());
      loadMemories();
    } catch (e) {
      console.error('Failed to add memory:', e);
      alert('Failed to add memory');
    }
  };

  const formatDate = (dateStr: string) => {
    // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
    const date = new Date(/Z|[+-]\d\d:?\d\d$/.test(dateStr) ? dateStr : dateStr.replace(' ', 'T') + 'Z');
    return date.toLocaleString();
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
          <div>
            <h1 className="panel-title">Memory</h1>
            <p className="panel-subtitle">Everything Humatron has learned about you — stored on this PC, searched by meaning</p>
          </div>
          <button className="btn btn-primary" onClick={handleAddMemory} style={{padding: '8px 16px'}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: '6px', verticalAlign: 'middle'}}>
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Memory
          </button>
        </div>
      </div>

      <div style={{marginBottom: '16px'}}>
        <input
          type="text"
          className="settings-input"
          placeholder="Search memories..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{maxWidth: '400px'}}
        />
      </div>

      <div className="memory-list">
        {filteredMemories.length === 0 && (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="15" y1="2" x2="15" y2="15"/>
            </svg>
            <h3>{searchQuery ? 'No matches found' : 'No memories yet'}</h3>
            <p>{searchQuery ? 'Try a different search term.' : 'Memories are saved automatically from conversations. You can also add them manually.'}</p>
          </div>
        )}
        {filteredMemories.map(memory => {
          let meta: any = {};
          try { meta = JSON.parse(memory.metadata); } catch {}
          
          return (
            <div key={memory.id} className="memory-item">
              <div className="memory-content">{memory.content}</div>
              <div className="memory-meta">
                <span>{formatDate(memory.created_at)}</span>
                {meta.source && <span>Source: {meta.source}</span>}
                {meta.tags && <span>Tags: {meta.tags.join(', ')}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}