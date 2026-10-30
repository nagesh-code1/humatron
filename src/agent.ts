// Humatron agent: Nebius (Nemotron) client, local memory search, and the tool-calling chat loop.
import type Database from 'better-sqlite3';

// Nebius renamed AI Studio -> Token Factory; try the current host first, keep the old one as a fallback.
const NEBIUS_HOSTS = ['https://api.tokenfactory.nebius.com/v1', 'https://api.studio.nebius.com/v1'];

type Store = { get: (k: string) => any; set: (k: string, v: any) => void };
type Embedder = (text: string) => Promise<Float32Array | null>;
type ToolLog = { run: (name: string, args: unknown, result: unknown, ok: boolean) => unknown };

export function createAgent(store: Store, db: Database.Database, embed: Embedder, toolLog: ToolLog) {
  async function nebiusFetch(path: string, init: { method?: string, body?: string } = {}) {
    const apiKey = String(store.get('nebiusApiKey') || '').trim();
    if (!apiKey) throw new Error('Add your Nebius API key in Settings first.');
    const saved = store.get('nebiusBaseUrl') as string | undefined;
    const hosts = saved ? [saved, ...NEBIUS_HOSTS.filter(h => h !== saved)] : NEBIUS_HOSTS;
    let lastErr: any;
    for (const host of hosts) {
      let res: Response;
      try {
        res = await fetch(host + path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } });
      } catch (e: any) { lastErr = new Error(`Can't reach ${host}: ${e.message}`); continue; }   // DNS/network: try next host
      if (res.status === 404 && path === '/models') { lastErr = new Error(`404 at ${host}`); continue; }
      if (!res.ok) throw new Error(`Nebius ${res.status}: ${(await res.text()).slice(0, 300)}`);
      if (host !== saved) store.set('nebiusBaseUrl', host);
      return res.json();
    }
    throw lastErr;
  }

  // Pick a real Nemotron model id from the account's model list (prefer Ultra > Super > any Nemotron).
  async function resolveModel(force = false): Promise<string> {
    const chosen = String(store.get('model') || '');
    if (chosen.includes('/') && !force) return chosen;          // a real "org/name" id picked in Settings
    const cached = store.get('resolvedModel') as string | undefined;
    if (cached && !force) return cached;
    const list = await nebiusFetch('/models');
    const ids: string[] = (list.data || []).map((m: any) => m.id);
    const nemo = ids.filter(id => /nemotron/i.test(id));
    const pick = nemo.find(id => /ultra/i.test(id)) || nemo.find(id => /super/i.test(id)) || nemo[0];
    if (!pick) throw new Error(`No Nemotron model on this Nebius account (${ids.length} models listed).`);
    store.set('resolvedModel', pick);
    return pick;
  }

  const stripThinking = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  async function saveMemory(content: string, metadata: object = {}) {
    const v = await embed(content);
    const r = db.prepare('INSERT INTO memories (content, embedding, metadata) VALUES (?, ?, ?)')
      .run(content, v ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : null, JSON.stringify(metadata));
    return Number(r.lastInsertRowid);
  }

  async function searchMemory(query: string, limit = 5) {
    const rows: any[] = db.prepare('SELECT id, content, embedding, created_at FROM memories ORDER BY id DESC LIMIT 2000').all();
    const q = await embed(query);
    if (q) {
      const hits = rows.filter(r => r.embedding).map(r => {
        const e = new Float32Array(new Uint8Array(r.embedding).buffer);
        let dot = 0; for (let i = 0; i < Math.min(e.length, q.length); i++) dot += e[i] * q[i];   // both normalized
        return { id: r.id, content: r.content, created_at: r.created_at, score: dot };
      }).sort((a, b) => b.score - a.score).filter(h => h.score > 0.25).slice(0, limit);
      if (hits.length) return hits;
    }
    const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);   // keyword fallback (embedder offline)
    return rows.map(r => ({ id: r.id, content: r.content, created_at: r.created_at,
      score: words.filter(w => r.content.toLowerCase().includes(w)).length / Math.max(1, words.length) }))
      .filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Tools Nemotron may call. Deliberately safe for a demo: no shell, no file delete.
  const TOOLS = [
    { type: 'function', function: { name: 'remember', description: 'Save a lasting fact, preference or note about the user to long-term memory (survives restarts).',
      parameters: { type: 'object', properties: { content: { type: 'string', description: 'The fact, as a full sentence.' } }, required: ['content'] } } },
    { type: 'function', function: { name: 'recall', description: 'Search long-term memory for facts relevant to a query.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'add_event', description: 'Add an event to the local calendar.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string', description: 'Local datetime YYYY-MM-DDTHH:MM' },
        end: { type: 'string' }, description: { type: 'string' } }, required: ['title', 'start'] } } },
    { type: 'function', function: { name: 'list_events', description: 'List calendar events on a date.',
      parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] } } },
  ];

  async function runTool(name: string, args: any) {
    switch (name) {
      case 'remember': return { saved: true, id: await saveMemory(String(args.content || ''), { source: 'agent' }) };
      case 'recall': return { results: (await searchMemory(String(args.query || ''))).map(r => ({ content: r.content, when: r.created_at })) };
      case 'add_event': {
        const r = db.prepare('INSERT INTO calendar_events (title, start_time, end_time, description) VALUES (?, ?, ?, ?)')
          .run(String(args.title), String(args.start).replace('T', ' '), args.end ? String(args.end).replace('T', ' ') : null, String(args.description || ''));
        return { created: true, id: Number(r.lastInsertRowid) };
      }
      case 'list_events': return { events: db.prepare('SELECT title, start_time, end_time, description FROM calendar_events WHERE date(start_time) = ? ORDER BY start_time').all(String(args.date)) };
      default: throw new Error(`unknown tool ${name}`);
    }
  }

  // One chat turn: memory-aware prompt -> Nemotron -> tool calls (max 6 rounds) -> answer. Both sides are persisted.
  async function chat(text: string) {
    const model = await resolveModel();
    const now = new Date();
    const recalled = await searchMemory(text, 4);
    const history = (db.prepare('SELECT role, content FROM conversations ORDER BY id DESC LIMIT 12').all() as any[]).reverse();
    db.prepare('INSERT INTO conversations (role, content, metadata) VALUES (?, ?, ?)').run('user', text, '{}');
    const pad = (n: number) => String(n).padStart(2, '0');
    const system = `You are Humatron, a local-first desktop assistant. Now: ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} (${now.toDateString()}).
Use tools: call "remember" whenever the user shares a lasting fact or preference; "recall" before answering questions about the user;
"add_event" / "list_events" for scheduling. After using tools, answer briefly and confirm what you did.` +
      (recalled.length ? `\nRelevant memories:\n${recalled.map(r => '- ' + r.content).join('\n')}` : '');
    const messages: any[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: text }];
    const used: Array<{ name: string, args: any, result: any, ok: boolean }> = [];
    let reply = '', useTools = true;
    for (let round = 0; round < 6; round++) {
      let r: any;
      try {
        r = await nebiusFetch('/chat/completions', { method: 'POST', body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048,
          ...(useTools ? { tools: TOOLS, tool_choice: 'auto' } : {}) }) });
      } catch (e: any) {
        if (useTools && /tool|function/i.test(e.message)) { useTools = false; continue; }   // model without tool support: plain chat
        throw e;
      }
      const msg = r.choices?.[0]?.message || {};
      const calls = msg.tool_calls || [];
      if (!calls.length) { reply = stripThinking(msg.content || ''); break; }
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
      for (const c of calls) {
        let args: any = {}, result: any, ok = true;
        try { args = JSON.parse(c.function.arguments || '{}'); result = await runTool(c.function.name, args); }
        catch (e: any) { ok = false; result = { error: e.message }; }
        toolLog.run(c.function.name, args, result, ok);
        used.push({ name: c.function.name, args, result, ok });
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
      }
    }
    if (!reply) reply = used.length ? 'Done.' : '(no answer)';
    db.prepare('INSERT INTO conversations (role, content, metadata) VALUES (?, ?, ?)').run('assistant', reply, JSON.stringify({ tools: used, model }));
    return { reply, tools: used, model };
  }

  // Settings "Test connection": a real inference round-trip with model + latency.
  async function test() {
    const model = await resolveModel(true);
    const t0 = Date.now();
    const r = await nebiusFetch('/chat/completions', { method: 'POST', body: JSON.stringify({
      model, messages: [{ role: 'user', content: 'Reply with exactly: HUMATRON ONLINE' }], max_tokens: 600, temperature: 0 }) });
    return { model, host: store.get('nebiusBaseUrl'), ms: Date.now() - t0, reply: stripThinking(r.choices?.[0]?.message?.content || '') };
  }

  async function models() {
    const list = await nebiusFetch('/models');
    return (list.data || []).map((m: any) => m.id).filter((id: string) => /nemotron/i.test(id));
  }

  return { chat, test, models, saveMemory, searchMemory, resolveModel, nebiusFetch, stripThinking };
}
