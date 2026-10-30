// Humatron agent: Nebius (Nemotron) client, local memory search, and the tool-calling chat loop.
import type Database from 'better-sqlite3';

// OpenAI-compatible providers. Nebius = the hackathon target (renamed AI Studio -> Token Factory, both hosts kept);
// NVIDIA / Gemini / Groq have free tiers with no card, so the app works before Nebius credits arrive.
const BAD_MODEL = /reward|embed|rerank|safety|guard|vision|vl|parse|audio|tts|image|lite|preview|thinking|guard|whisper|retriever/i;
// Rank Nemotron ids: Nemotron 3 Ultra first (the hackathon model), then 3.x Super/Lightning, then older generations.
const rankNemotron = (ids: string[]) => {
  const n = ids.filter(i => /nemotron/i.test(i) && !BAD_MODEL.test(i));
  const score = (i: string) => (/nemotron-3[.-]/i.test(i) ? 0 : 10) + (/ultra/i.test(i) ? 0 : /super/i.test(i) ? 1 : /lightning|nano/i.test(i) ? 2 : 3);
  return n.sort((a, b) => score(a) - score(b));
};
export const PROVIDERS: Record<string, { label: string, hosts: string[], keyField: string, pick: (ids: string[]) => string[] }> = {
  nebius: { label: 'Nebius (Nemotron)', hosts: ['https://api.tokenfactory.nebius.com/v1', 'https://api.studio.nebius.com/v1'], keyField: 'nebiusApiKey',
    pick: rankNemotron },
  nvidia: { label: 'NVIDIA build (Nemotron, free)', hosts: ['https://integrate.api.nvidia.com/v1'], keyField: 'nvidiaApiKey',
    pick: rankNemotron },
  gemini: { label: 'Google Gemini (free)', hosts: ['https://generativelanguage.googleapis.com/v1beta/openai'], keyField: 'geminiApiKey',
    pick: ids => { const n = ids.filter(i => /^gemini-/.test(i) && !BAD_MODEL.test(i)); return [...n.filter(i => /flash$/.test(i)).sort().reverse(), ...n]; } },
  groq: { label: 'Groq (free, fast)', hosts: ['https://api.groq.com/openai/v1'], keyField: 'groqApiKey',
    pick: ids => [...ids.filter(i => /llama-3\.3-70b-versatile/.test(i)), ...ids.filter(i => /70b/.test(i) && !BAD_MODEL.test(i)), ...ids.filter(i => !BAD_MODEL.test(i))] },
};

type Store = { get: (k: string) => any; set: (k: string, v: any) => void };
type Embedder = (text: string) => Promise<Float32Array | null>;
type ToolLog = { run: (name: string, args: unknown, result: unknown, ok: boolean) => unknown };

export function createAgent(store: Store, db: Database.Database, embed: Embedder, toolLog: ToolLog) {
  const provider = () => { const p = String(store.get('provider') || 'nvidia'); return PROVIDERS[p] ? p : 'nvidia'; };

  async function nebiusFetch(path: string, init: { method?: string, body?: string } = {}) {
    const prov = PROVIDERS[provider()];
    const apiKey = String(store.get(prov.keyField) || '').trim();
    if (!apiKey) throw new Error(`Add your ${prov.label} API key in Settings first.`);
    const saved = store.get('baseUrl_' + provider()) as string | undefined;
    const hosts = saved && prov.hosts.includes(saved) ? [saved, ...prov.hosts.filter(h => h !== saved)] : prov.hosts;
    let lastErr: any;
    for (const host of hosts) {
      let res: Response;
      try {
        res = await fetch(host + path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } });
      } catch (e: any) { lastErr = new Error(`Can't reach ${host}: ${e.message}`); continue; }   // DNS/network: try next host
      if (res.status === 404 && path === '/models') { lastErr = new Error(`404 at ${host}`); continue; }
      if (!res.ok) throw new Error(`${prov.label} ${res.status}: ${(await res.text()).slice(0, 300)}`);
      if (host !== saved) store.set('baseUrl_' + provider(), host);
      return res.json();
    }
    throw lastErr;
  }

  // Pick a real model id from the provider's model list (Nemotron on Nebius/NVIDIA), unless one was chosen in Settings.
  async function resolveModel(force = false): Promise<string> {
    const p = provider();
    const chosen = String(store.get('model_' + p) || '');
    if (chosen && chosen !== 'auto' && !force) return chosen;
    const cached = store.get('resolvedModel_' + p) as string | undefined;
    if (cached && !force) return cached;
    // A listed model isn't always deployed for this account (NVIDIA returns 404), so probe candidates until one answers.
    const candidates = [...new Set(PROVIDERS[p].pick(await listModels()))].slice(0, 6);
    let lastErr = '';
    for (const model of candidates) {
      try {
        await nebiusFetch('/chat/completions', { method: 'POST', body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 }) });
        store.set('resolvedModel_' + p, model);
        return model;
      } catch (e: any) {
        lastErr = e.message;
        if (/ 40[13]:/.test(lastErr)) throw e;               // bad key: no point trying other models
      }
    }
    throw new Error(`No working model on ${PROVIDERS[p].label} (tried ${candidates.join(', ') || 'none'}). Last error: ${lastErr.slice(0, 200)}`);
  }

  async function listModels(): Promise<string[]> {
    const list = await nebiusFetch('/models');
    return (list.data || []).map((m: any) => String(m.id).replace(/^models\//, ''));
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
    return { reply, tools: used, model, provider: PROVIDERS[provider()].label };
  }

  // Settings "Test connection": a real inference round-trip with model + latency.
  async function test() {
    const model = await resolveModel(true);
    const t0 = Date.now();
    const r = await nebiusFetch('/chat/completions', { method: 'POST', body: JSON.stringify({
      model, messages: [{ role: 'user', content: 'Reply with exactly: HUMATRON ONLINE' }], max_tokens: 600, temperature: 0 }) });
    return { provider: PROVIDERS[provider()].label, model, ms: Date.now() - t0, reply: stripThinking(r.choices?.[0]?.message?.content || '') };
  }

  async function models() {
    const p = provider(), ids = await listModels();
    return p === 'nebius' || p === 'nvidia' ? ids.filter(i => /nemotron/i.test(i) && !BAD_MODEL.test(i)) : ids.filter(i => !BAD_MODEL.test(i));
  }

  return { chat, test, models, saveMemory, searchMemory, resolveModel, nebiusFetch, stripThinking };
}
