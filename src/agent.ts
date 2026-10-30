// Humatron agent: Nebius (Nemotron) client, local memory search, and the tool-calling chat loop.
import type Database from 'better-sqlite3';

// Humatron runs only on NVIDIA Nemotron. Two OpenAI-compatible hosts serve it: Nebius Token Factory (the hackathon
// requirement; old AI Studio host kept as fallback) and NVIDIA build (free nvapi- keys, handy for development).
const BAD_MODEL = /reward|embed|rerank|safety|guard|vision|vl\b|parse|audio|tts|image|lite|preview|thinking|guard|whisper|retriever/i;
// Rank Nemotron ids: Nemotron 3 Ultra first (the hackathon model), then 3.x Super/Lightning, then older generations.
const rankNemotron = (ids: string[]) => {
  const n = ids.filter(i => /nemotron/i.test(i) && !BAD_MODEL.test(i));
  const score = (i: string) => (/nemotron-3[.-]/i.test(i) ? 0 : 10) + (/ultra/i.test(i) ? 0 : /super/i.test(i) ? 1 : /lightning|nano/i.test(i) ? 2 : 3);
  return n.sort((a, b) => score(a) - score(b));
};
export const PROVIDERS: Record<string, { label: string, hosts: string[], keyField: string, pick: (ids: string[]) => string[] }> = {
  nebius: { label: 'Nebius (Nemotron)', hosts: ['https://api.tokenfactory.nebius.com/v1', 'https://api.studio.nebius.com/v1'], keyField: 'nebiusApiKey',
    pick: rankNemotron },
  nvidia: { label: 'NVIDIA build (Nemotron)', hosts: ['https://integrate.api.nvidia.com/v1'], keyField: 'nvidiaApiKey',
    pick: rankNemotron },
};

// NVIDIA keys start with "nvapi-"; anything else is treated as a Nebius Token Factory key.
export const providerForKey = (key: string) => /^nvapi-/i.test(key.trim()) ? 'nvidia' : 'nebius';

type Store = { get: (k: string) => any; set: (k: string, v: any) => void };

// Free tiers (NVIDIA build RPM limits) answer 429 with "try again in 7.5s": wait it out (up to 45 s, twice) instead of failing.
export async function fetchRetry429(url: string, init: RequestInit, tries = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    if (res.status !== 429 || i >= tries) return res;
    const body = await res.clone().text();
    const m = body.match(/try again in\s*(?:(\d+)m)?\s*([\d.]+)\s*(ms|s|seconds?)/i);
    const header = Number(res.headers.get('retry-after'));
    // No hint (NVIDIA just says 429): back off 5 s, 15 s, 30 s.
    const wait = m ? (Number(m[1] || 0) * 60 + Number(m[2]) / (m[3] === 'ms' ? 1000 : 1)) : header || [5, 15, 30][i] || 30;
    if (wait > 45) return res;
    await new Promise(r => setTimeout(r, (wait + 0.5) * 1000));
  }
}
type Embedder = (text: string) => Promise<Float32Array | null>;
type ToolLog = { run: (name: string, args: unknown, result: unknown, ok: boolean) => unknown };
// Extra tool packs (files, images) from skills.ts; run() returns undefined for names it doesn't own.
type Skills = { tools: () => any[], run: (name: string, args: any) => Promise<any>, places: Record<string, string> };
export type ChatOptions = { spokenLanguage?: string, voice?: boolean, romanOnly?: boolean };
export type MissionEvent = { id: number, type: 'start' | 'plan' | 'step' | 'tool' | 'wait' | 'report' | 'done' | 'error', [k: string]: any };

export function createAgent(store: Store, db: Database.Database, embed: Embedder, toolLog: ToolLog, skills?: Skills) {
  // Stored provider if it is a Nemotron host; otherwise (old Groq/Gemini setting) whichever Nemotron key exists, Nebius first.
  const provider = () => {
    const p = String(store.get('provider') || '');
    if (PROVIDERS[p]) return p;
    return String(store.get('nebiusApiKey') || '').trim() || !String(store.get('nvidiaApiKey') || '').trim() ? 'nebius' : 'nvidia';
  };
  db.exec(`CREATE TABLE IF NOT EXISTS missions (id INTEGER PRIMARY KEY AUTOINCREMENT, goal TEXT NOT NULL, title TEXT, plan TEXT, steps TEXT,
    report TEXT, status TEXT, model TEXT, provider TEXT, ms INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

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
        res = await fetchRetry429(host + path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } });
      } catch (e: any) { lastErr = new Error(`Can't reach ${host}: ${e.message}`); continue; }   // DNS/network: try next host
      if (res.status === 404 && path === '/models') { lastErr = new Error(`404 at ${host}`); continue; }
      if (res.status === 429) throw new Error(`${prov.label} is rate-limiting the free tier - wait a minute and try again. (${(await res.text()).slice(0, 160)})`);
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

  // Tools Nemotron may call. No shell; file deletes go to the Recycle Bin (see skills.ts).
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
  // Skill tools can change at runtime (web search appears when a Tavily key is saved), so build the list per request.
  const tools = () => [...TOOLS, ...(skills?.tools() || [])];

  // Tavily is for operations, and credits are limited (free plan: 1,000/month): each request gets a small web budget.
  const WEB_TOOLS = new Set(['web_search', 'read_webpage']);
  async function runTool(name: string, args: any, budget?: { web: number }) {
    if (WEB_TOOLS.has(name) && budget) {
      if (budget.web <= 0) throw new Error('Web search limit for this request reached - continue with the information you already have.');
      budget.web--;
    }
    switch (name) {
      case 'remember': return { saved: true, id: await saveMemory(String(args.content || ''), { source: 'agent' }) };
      case 'recall': return { results: (await searchMemory(String(args.query || ''))).map(r => ({ content: r.content, when: r.created_at })) };
      case 'add_event': {
        const r = db.prepare('INSERT INTO calendar_events (title, start_time, end_time, description) VALUES (?, ?, ?, ?)')
          .run(String(args.title), String(args.start).replace('T', ' '), args.end ? String(args.end).replace('T', ' ') : null, String(args.description || ''));
        return { created: true, id: Number(r.lastInsertRowid) };
      }
      case 'list_events': return { events: db.prepare('SELECT title, start_time, end_time, description FROM calendar_events WHERE date(start_time) = ? ORDER BY start_time').all(String(args.date)) };
      default: {
        const r = skills ? await skills.run(name, args) : undefined;
        if (r === undefined) throw new Error(`unknown tool ${name}`);
        return r;
      }
    }
  }

  // One chat turn: memory-aware prompt -> Nemotron -> tool calls (max 6 rounds) -> answer. Both sides are persisted.
  async function chat(text: string, opts: ChatOptions = {}) {
    const model = await resolveModel();
    const now = new Date();
    const recalled = await searchMemory(text, 4);
    const history = (db.prepare('SELECT role, content FROM conversations ORDER BY id DESC LIMIT 12').all() as any[]).reverse();
    db.prepare('INSERT INTO conversations (role, content, metadata) VALUES (?, ?, ?)').run('user', text, '{}');
    const pad = (n: number) => String(n).padStart(2, '0');
    const system = `You are Humatron, a local-first desktop assistant. Now: ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} (${now.toDateString()}).
Use tools: call "remember" whenever the user shares a lasting fact or preference; "recall" before answering questions about the user;
"add_event" / "list_events" for scheduling; the file tools to list, find, read, create, move, copy, open or delete files;
"generate_image" when asked to draw, create or generate a picture. After using tools, answer briefly and confirm what you did.
Web search ("web_search" / "read_webpage", when available) is ONLY for performing an operation the user asked for - scheduling, planning,
booking, preparing or creating something - when that operation needs real-world facts you don't have (an event's date/time/venue, opening
hours, prices, current news for a task). NEVER search for chit-chat, greetings, opinions or general knowledge you already know.
At most 2 searches per message; cite the source links you used.
Files: the user's folders are ${Object.entries(skills?.places || {}).map(([k, v]) => `${k}=${v}`).join(', ')}. Look before acting
(list or search first when a name is vague). Deleting moves to the Recycle Bin; only delete, move or overwrite what the user clearly asked for.
Languages: the user may write or speak in any language - English, Hindi, Kannada, Tamil, Telugu, Hinglish or mixed. Understand it and
ALWAYS reply in the same language and style they used (mixed Hinglish -> reply in Hinglish).` +
      (opts.spokenLanguage ? `
This message was spoken aloud (speech recognition detected: ${opts.spokenLanguage}); it may contain small transcription errors.` : '') +
      (opts.voice ? `
Your reply will be read aloud: keep it short and conversational (1-3 sentences), no markdown, lists or code.` : '') +
      (opts.romanOnly ? `
Write your reply in Latin letters only (e.g. Hinglish "Haan, ho gaya!" instead of Devanagari), because the voice can only read Latin script.` : '') +
      (recalled.length ? `\nRelevant memories:\n${recalled.map(r => '- ' + r.content).join('\n')}` : '');
    const messages: any[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: text }];
    const used: Array<{ name: string, args: any, result: any, ok: boolean }> = [];
    const webBudget = { web: 2 };
    let reply = '', useTools = true;
    for (let round = 0; round < 6; round++) {
      let r: any;
      try {
        r = await nebiusFetch('/chat/completions', { method: 'POST', body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048,
          ...(useTools ? { tools: tools(), tool_choice: 'auto' } : {}) }) });
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
        try { args = JSON.parse(c.function.arguments || '{}'); result = await runTool(c.function.name, args, webBudget); }
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

  // ---- Missions: Nemotron plans a multi-step goal, executes each step with the tools, then writes a report. ----
  const cancelled = new Set<number>();
  const nowLine = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} (${d.toDateString()})`; };
  const folders = () => Object.entries(skills?.places || {}).map(([k, v]) => `${k}=${v}`).join(', ');

  async function complete(model: string, messages: any[], withTools: boolean, maxTokens = 2048) {
    const r = await nebiusFetch('/chat/completions', { method: 'POST', body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: maxTokens,
      ...(withTools ? { tools: tools(), tool_choice: 'auto' } : {}) }) });
    return r.choices?.[0]?.message || {};
  }

  function parsePlan(text: string) {
    const raw = stripThinking(text).replace(/```(?:json)?/g, '');
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Nemotron did not return a plan.');
    const j = JSON.parse(m[0]);
    const steps = (Array.isArray(j.steps) ? j.steps : []).slice(0, 7)
      .map((x: any) => ({ title: String(x.title || x.step || x).slice(0, 120), detail: String(x.detail || x.description || '').slice(0, 400) }))
      .filter((x: any) => x.title);
    if (!steps.length) throw new Error('The plan had no steps.');
    return { title: String(j.title || '').slice(0, 100), steps };
  }

  async function mission(goal: string, emit: (e: MissionEvent) => void) {
    const t0 = Date.now();
    const model = await resolveModel();
    const prov = PROVIDERS[provider()].label;
    const id = Number(db.prepare('INSERT INTO missions (goal, status, model, provider) VALUES (?, ?, ?, ?)').run(goal, 'running', model, prov).lastInsertRowid);
    const save = (f: Record<string, any>) => db.prepare(`UPDATE missions SET ${Object.keys(f).map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...Object.values(f).map(v => typeof v === 'object' ? JSON.stringify(v) : v), id);
    emit({ id, type: 'start', goal, model, provider: prov });
    const webBudget = { web: 8 };   // whole mission: research steps get room, but a runaway loop can't burn the Tavily plan
    // Missions make many calls in a row; on a rate limit, pause (shown in the UI) and resume instead of failing.
    const ask = async (messages: any[], withTools: boolean, maxTokens = 2048) => {
      for (let attempt = 0; ; attempt++) {
        try { return await complete(model, messages, withTools, maxTokens); }
        catch (e: any) {
          if (!/rate-limit|429/i.test(e.message) || attempt >= 3 || cancelled.has(id)) throw e;
          emit({ id, type: 'wait', seconds: 60, reason: `${prov} is busy (rate limit) - resuming in 60 s` });
          for (let t = 0; t < 60 && !cancelled.has(id); t++) await new Promise(r => setTimeout(r, 1000));
          emit({ id, type: 'wait', seconds: 0 });
        }
      }
    };
    const steps: Array<{ title: string, detail: string, status: string, summary?: string, tools: any[] }> = [];
    try {
      const memories = await searchMemory(goal, 5);
      const toolList = tools().map((t: any) => `- ${t.function.name}: ${t.function.description}`).join('\n');
      const context = `Now: ${nowLine()}. User's folders: ${folders()}.` +
        (memories.length ? `\nWhat you know about the user:\n${memories.map(m => '- ' + m.content).join('\n')}` : '');

      // 1. Plan
      const planMsg = await ask([
        { role: 'system', content: `You are the planning brain of Humatron, a local-first desktop assistant. ${context}
Break the user's goal into 3-6 concrete, ordered steps that Humatron can actually do with these tools:
${toolList}
Steps may also be pure thinking (analyse, compare, write a plan). Prefer saving useful outputs (notes, plans) as files in Documents/Humatron Missions.
If web_search is available, add a research step whenever the goal depends on real-world facts (event dates and times, venues, prices,
opening hours, news, specs) - so anything scheduled or planned uses verified facts, with source links.
Reply with ONLY JSON: {"title": "<short mission name>", "steps": [{"title": "<imperative, <= 8 words>", "detail": "<what exactly to do>"}]}.
Write titles in the same language as the goal.` },
        { role: 'user', content: goal },
      ], false, 3000);
      const plan = parsePlan(planMsg.content || '');
      plan.steps.forEach((x: any) => steps.push({ ...x, status: 'pending', tools: [] }));
      save({ title: plan.title, plan });
      emit({ id, type: 'plan', title: plan.title, steps: plan.steps });

      // 2. Execute step by step; each step sees the goal, the plan and what earlier steps produced.
      for (let i = 0; i < steps.length; i++) {
        if (cancelled.has(id)) throw new Error('Mission stopped.');
        const st = steps[i];
        st.status = 'running';
        emit({ id, type: 'step', index: i, status: 'running' });
        const done = steps.slice(0, i).map((x, k) => `Step ${k + 1} (${x.title}): ${x.summary || x.status}` +
          (x.tools.length ? `\n   tools already run: ${x.tools.map(t => `${t.name}${t.ok ? '' : ' (failed)'} ${JSON.stringify(t.args).slice(0, 140)}`).join('; ')}` : '')).join('\n') || 'none yet';
        const messages: any[] = [
          { role: 'system', content: `You are Humatron executing one step of a mission. ${context}
Mission goal: ${goal}
Plan: ${steps.map((x, k) => `${k + 1}. ${x.title}`).join(' | ')}
Results so far:
${done}
Rules: do ONLY the current step, using tools when they help. Use web_search / read_webpage only when this step needs real-world facts;
put the facts and source links you found in your summary so later steps (scheduling, files) can use them. If an earlier step already did this step's work (see tools already run), do NOT repeat it - just confirm it is done. Look before acting on files. Deletes go to the Recycle Bin and only when the goal asks.
When finished, reply with a short summary (max 90 words) of what you did and the key facts or file paths produced. Same language as the goal.` },
          { role: 'user', content: `Current step ${i + 1}/${steps.length}: ${st.title}. ${st.detail}` },
        ];
        let summary = '';
        for (let round = 0; round < 6 && !summary; round++) {
          if (cancelled.has(id)) throw new Error('Mission stopped.');
          const msg = await ask(messages, true);
          const calls = msg.tool_calls || [];
          if (!calls.length) { summary = stripThinking(msg.content || '') || 'Done.'; break; }
          messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
          for (const c of calls) {
            let args: any = {}, result: any, ok = true;
            try { args = JSON.parse(c.function.arguments || '{}'); result = await runTool(c.function.name, args, webBudget); }
            catch (e: any) { ok = false; result = { error: e.message }; }
            toolLog.run(c.function.name, args, result, ok);
            const brief = { name: c.function.name, args, result: JSON.stringify(result).length > 4000 ? { note: 'large result', image: result?.image } : result, ok };
            st.tools.push(brief);
            emit({ id, type: 'tool', index: i, tool: brief });
            messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result).slice(0, 12000) });
          }
        }
        st.summary = summary || 'Step finished (no summary).';
        st.status = 'done';
        save({ steps });
        emit({ id, type: 'step', index: i, status: 'done', summary: st.summary });
      }

      // 3. Report
      if (cancelled.has(id)) throw new Error('Mission stopped.');
      const reportMsg = await ask([
        { role: 'system', content: `You are Humatron. Write the final mission report in Markdown, in the same language as the goal.
Sections: a one-line outcome, "What I did" (bullets per step), "Results" (key facts, file paths, events created), "Next steps" (2-4 bullets). Be specific, no filler.` },
        { role: 'user', content: `Goal: ${goal}\n\n${steps.map((x, k) => `Step ${k + 1} - ${x.title}: ${x.summary}\nTools: ${x.tools.map(t => `${t.name}${t.ok ? '' : ' (failed)'} ${JSON.stringify(t.args).slice(0, 200)}`).join('; ') || 'none'}`).join('\n\n')}` },
      ], false, 3000);
      const report = stripThinking(reportMsg.content || '') || steps.map(x => `- ${x.title}: ${x.summary}`).join('\n');
      const ms = Date.now() - t0;
      save({ report, status: 'done', steps, ms });
      emit({ id, type: 'report', report });
      emit({ id, type: 'done', ms });
      return { id, report, steps, ms, model };
    } catch (e: any) {
      const msg = String(e.message || e);
      steps.forEach(x => { if (x.status === 'running') x.status = 'failed'; });
      save({ status: cancelled.has(id) ? 'stopped' : 'failed', steps, report: msg, ms: Date.now() - t0 });
      emit({ id, type: 'error', error: msg, stopped: cancelled.has(id) });
      return { id, error: msg };
    } finally {
      cancelled.delete(id);
    }
  }

  const cancelMission = (id: number) => { cancelled.add(id); };
  const listMissions = (limit = 30) => db.prepare('SELECT id, goal, title, status, model, provider, ms, created_at FROM missions ORDER BY id DESC LIMIT ?').all(limit);
  const getMission = (id: number) => {
    const m: any = db.prepare('SELECT * FROM missions WHERE id = ?').get(id);
    if (!m) return null;
    for (const k of ['plan', 'steps']) { try { m[k] = JSON.parse(m[k] || 'null'); } catch { m[k] = null; } }
    return m;
  };

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
    return rankNemotron(ids);
  }

  return { provider, chat, test, models, saveMemory, searchMemory, resolveModel, nebiusFetch, stripThinking, mission, cancelMission, listMissions, getMission };
}
