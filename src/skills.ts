// Humatron skills beyond memory/calendar: file management, image generation and web search (Tavily), exposed as agent tools.
import { homedir } from 'os';
import { join, resolve, dirname, basename, extname, isAbsolute, sep } from 'path';
import { promises as fs, existsSync } from 'fs';

type Deps = {
  trash: (p: string) => Promise<void>;        // shell.trashItem: deletes go to the Recycle Bin, never permanent
  openPath: (p: string) => Promise<string>;   // shell.openPath
  imagesDir: string;
  store: { get: (k: string) => any };
};

const HOME = homedir();
// Friendly names the model (and the user) can use instead of full paths.
const PLACES: Record<string, string> = {
  home: HOME, desktop: join(HOME, 'Desktop'), documents: join(HOME, 'Documents'), downloads: join(HOME, 'Downloads'),
  pictures: join(HOME, 'Pictures'), music: join(HOME, 'Music'), videos: join(HOME, 'Videos'),
};
// OneDrive often owns Desktop/Documents on Windows; prefer those when they exist.
for (const k of ['desktop', 'documents', 'pictures']) {
  const od = join(HOME, 'OneDrive', k[0].toUpperCase() + k.slice(1));
  if (!existsSync(PLACES[k]) && existsSync(od)) PLACES[k] = od;
}

// System locations the assistant must never touch.
const BLOCKED = [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files',
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', process.env.ProgramData || 'C:\\ProgramData']
  .map(p => resolve(p).toLowerCase());

export function resolveUserPath(p: string): string {
  let raw = String(p || '').trim().replace(/^["']|["']$/g, '');
  if (!raw) throw new Error('No path given.');
  raw = raw.replace(/^~(?=$|[\\/])/, HOME);
  const first = raw.split(/[\\/]/)[0].toLowerCase();
  if (!isAbsolute(raw) && PLACES[first]) raw = join(PLACES[first], raw.slice(first.length));
  const full = resolve(isAbsolute(raw) ? raw : join(HOME, raw));
  const low = full.toLowerCase();
  if (BLOCKED.some(b => low === b || low.startsWith(b + sep))) throw new Error(`Refusing to touch system folder: ${full}`);
  return full;
}

const TEXT_EXT = /\.(txt|md|csv|json|js|ts|tsx|jsx|py|html|css|xml|yml|yaml|ini|log|bat|ps1|sh|java|c|cpp|h|go|rs|sql|env|toml)$/i;
const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

// Tavily: web search built for AI agents. Separate key ('tavilyApiKey'); the tools only appear once it is set.
async function tavily(key: string, path: '/search' | '/extract', body: object) {
  const res = await fetch('https://api.tavily.com' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 200);
    throw new Error(res.status === 401 || res.status === 403 ? 'Tavily rejected the key - check it in Settings > Web search.'
      : res.status === 429 || res.status === 432 ? `Tavily limit reached (${res.status}): ${t}` : `Tavily ${res.status}: ${t}`);
  }
  return res.json();
}

const WEB_TOOLS = [
  { type: 'function', function: { name: 'web_search', description: 'Search the live web for current information (news, prices, docs, people, events). Returns a short answer plus sources with URLs - cite them.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, news: { type: 'boolean', description: 'true for recent news' },
      max_results: { type: 'number', description: '1-8, default 5' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'read_webpage', description: 'Read the main text of a web page (e.g. a source from web_search) to get details.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
];

export function createSkills(deps: Deps) {
  const tavilyKey = () => String(deps.store.get('tavilyApiKey') || '').trim();
  // Same search/page within 10 minutes (e.g. a mission step repeating a lookup) reuses the result instead of spending a credit.
  const webCache = new Map<string, { at: number, value: any }>();
  const cached = async (key: string, get: () => Promise<any>) => {
    const hit = webCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60000) return { ...hit.value, cached: true };
    const value = await get();
    webCache.set(key, { at: Date.now(), value });
    return value;
  };
  const TOOLS = [
    { type: 'function', function: { name: 'list_files', description: 'List files and folders in a folder. Accepts full paths or shortcuts like "Desktop", "Downloads", "Documents/Projects".',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'search_files', description: 'Find files whose name contains a text (searches sub-folders, up to 4 levels deep).',
      parameters: { type: 'object', properties: { folder: { type: 'string' }, name_contains: { type: 'string' }, extension: { type: 'string', description: 'optional, e.g. pdf' } }, required: ['folder', 'name_contains'] } } },
    { type: 'function', function: { name: 'read_file', description: 'Read a text file (first 20,000 characters).',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_file', description: 'Create a text file (or overwrite only when overwrite=true).',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, overwrite: { type: 'boolean' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'create_folder', description: 'Create a folder (and any missing parent folders).',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'move_file', description: 'Move or rename a file or folder. Will not overwrite an existing target.',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } } },
    { type: 'function', function: { name: 'copy_file', description: 'Copy a file or folder. Will not overwrite an existing target.',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } } },
    { type: 'function', function: { name: 'delete_file', description: 'Move a file or folder to the Recycle Bin (recoverable). Only when the user clearly asked to delete it.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'open_file', description: 'Open a file or folder with its default app (e.g. show a folder in Explorer, open a PDF).',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'generate_image', description: 'Generate an image from a text description and save it to Pictures/Humatron. Write the prompt in English, detailed and visual.',
      parameters: { type: 'object', properties: { prompt: { type: 'string' }, shape: { type: 'string', enum: ['square', 'portrait', 'landscape'] } }, required: ['prompt'] } } },
  ];

  async function search(dir: string, needle: string, ext: string, depth: number, out: string[]) {
    if (depth > 4 || out.length >= 40) return;
    let entries: any[] = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= 40) return;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'AppData') continue;
      const p = join(dir, e.name);
      if (e.name.toLowerCase().includes(needle) && (!ext || e.name.toLowerCase().endsWith('.' + ext))) out.push(p);
      if (e.isDirectory()) await search(p, needle, ext, depth + 1, out);
    }
  }

  async function freeTarget(to: string) {
    if (existsSync(to)) throw new Error(`"${to}" already exists - pick another name or delete it first.`);
    await fs.mkdir(dirname(to), { recursive: true });
  }

  // "Move report.pdf to Documents" -> keep the file name when the target is an existing folder.
  async function targetFor(from: string, to: string) {
    try { if ((await fs.stat(to)).isDirectory()) return join(to, basename(from)); } catch {}
    return to;
  }

  async function generateImage(prompt: string, shape = 'square') {
    const [w, h] = shape === 'portrait' ? [768, 1152] : shape === 'landscape' ? [1152, 768] : [1024, 1024];
    const seed = Math.floor(Math.random() * 1e9);
    // Pollinations: free, no key. The prompt (not your files or memory) is sent to image.pollinations.ai.
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
    let res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if ([402, 429, 503].includes(res.status)) {   // free tier: 1 image per 45 s per IP, or busy ("Retry after 19s") - wait once
      const body = await res.text(), m = body.match(/retry after\s*(\d+(?:\.\d+)?)\s*s/i) || body.match(/(\d+(?:\.\d+)?)\s*s(?:ec|\b)/);
      const wait = Math.min(45, Number(res.headers.get('retry-after')) || (m ? Number(m[1]) : 30));
      await new Promise(r => setTimeout(r, (wait + 1) * 1000));
      res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    }
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) throw new Error(`Image service error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await fs.mkdir(deps.imagesDir, { recursive: true });
    const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '') || 'image';
    const file = join(deps.imagesDir, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${slug}${type.includes('png') ? '.png' : '.jpg'}`);
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    return { image: file, prompt, size: `${w}x${h}` };
  }

  async function run(name: string, a: any): Promise<any> {
    switch (name) {
      case 'list_files': {
        const dir = resolveUserPath(a.path);
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const items = await Promise.all(entries.filter(e => !e.name.startsWith('.')).slice(0, 200).map(async e => {
          const p = join(dir, e.name);
          try { const s = await fs.stat(p); return { name: e.name, type: e.isDirectory() ? 'folder' : 'file', size: e.isDirectory() ? undefined : fmtSize(s.size), modified: s.mtime.toISOString().slice(0, 16).replace('T', ' ') }; }
          catch { return { name: e.name, type: e.isDirectory() ? 'folder' : 'file' }; }
        }));
        return { folder: dir, count: entries.length, items };
      }
      case 'search_files': {
        const dir = resolveUserPath(a.folder), out: string[] = [];
        await search(dir, String(a.name_contains || '').toLowerCase(), String(a.extension || '').replace(/^\./, '').toLowerCase(), 0, out);
        return { folder: dir, matches: out, truncated: out.length >= 40 };
      }
      case 'read_file': {
        const p = resolveUserPath(a.path), s = await fs.stat(p);
        if (s.isDirectory()) throw new Error('That is a folder - use list_files.');
        if (!TEXT_EXT.test(p) && s.size > 200000) return { path: p, size: fmtSize(s.size), note: `Binary ${extname(p) || 'file'} - can't show its contents as text.` };
        const text = await fs.readFile(p, 'utf8');
        return { path: p, size: fmtSize(s.size), content: text.slice(0, 20000), truncated: text.length > 20000 };
      }
      case 'write_file': {
        const p = resolveUserPath(a.path);
        if (existsSync(p) && !a.overwrite) throw new Error(`"${p}" already exists. Ask the user before overwriting.`);
        await fs.mkdir(dirname(p), { recursive: true });
        await fs.writeFile(p, String(a.content ?? ''), 'utf8');
        return { written: p, size: fmtSize(Buffer.byteLength(String(a.content ?? ''))) };
      }
      case 'create_folder': { const p = resolveUserPath(a.path); await fs.mkdir(p, { recursive: true }); return { created: p }; }
      case 'move_file': {
        const from = resolveUserPath(a.from), to = await targetFor(from, resolveUserPath(a.to));
        await freeTarget(to);
        try { await fs.rename(from, to); }
        catch (e: any) { if (e.code !== 'EXDEV') throw e; await fs.cp(from, to, { recursive: true }); await deps.trash(from); }   // across drives
        return { moved: from, to };
      }
      case 'copy_file': {
        const from = resolveUserPath(a.from), to = await targetFor(from, resolveUserPath(a.to));
        await freeTarget(to);
        await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false });
        return { copied: from, to };
      }
      case 'delete_file': {
        const p = resolveUserPath(a.path);
        if (Object.values(PLACES).some(x => resolve(x).toLowerCase() === p.toLowerCase())) throw new Error('Refusing to delete a main user folder.');
        await fs.stat(p);
        await deps.trash(p);
        return { moved_to_recycle_bin: p };
      }
      case 'open_file': {
        const p = resolveUserPath(a.path);
        const err = await deps.openPath(p);
        if (err) throw new Error(err);
        return { opened: p };
      }
      case 'generate_image': return generateImage(String(a.prompt || ''), a.shape);
      case 'web_search': {
        if (!tavilyKey()) throw new Error('Web search is off - add a Tavily key in Settings > Web search.');
        const q = String(a.query || '').trim().slice(0, 400), max = Math.min(8, Math.max(1, Number(a.max_results) || 5));
        return cached(`s|${q.toLowerCase()}|${!!a.news}|${max}`, async () => {
          const r: any = await tavily(tavilyKey(), '/search', { query: q, include_answer: true, search_depth: 'basic', topic: a.news ? 'news' : 'general', max_results: max });
          return { query: q, answer: r.answer, results: (r.results || []).map((x: any) => ({ title: x.title, url: x.url, snippet: String(x.content || '').slice(0, 500), published: x.published_date })) };
        });
      }
      case 'read_webpage': {
        if (!tavilyKey()) throw new Error('Web reading is off - add a Tavily key in Settings > Web search.');
        return cached(`x|${String(a.url || '').trim()}`, async () => {
          const r: any = await tavily(tavilyKey(), '/extract', { urls: [String(a.url || '')] });
          const page = r.results?.[0];
          if (!page) throw new Error(`Couldn't read ${a.url}${r.failed_results?.[0]?.error ? ': ' + r.failed_results[0].error : ''}`);
          const text = String(page.raw_content || '');
          return { url: page.url, content: text.slice(0, 12000), truncated: text.length > 12000 };
        });
      }
      default: return undefined;
    }
  }

  // Tool list for each request: web tools only when a Tavily key is saved, so Nemotron never calls a dead tool.
  const tools = () => tavilyKey() ? [...TOOLS, ...WEB_TOOLS] : TOOLS;

  async function webTest() {
    const t0 = Date.now();
    const r: any = await tavily(tavilyKey(), '/search', { query: 'NVIDIA Nemotron', max_results: 1 });
    return { ms: Date.now() - t0, title: r.results?.[0]?.title || '(no results)' };
  }

  return { TOOLS, tools, run, places: PLACES, webTest };
}
