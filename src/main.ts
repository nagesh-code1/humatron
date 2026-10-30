import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, shell, dialog } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, unlinkSync, rmSync } from 'fs';
import Store from 'electron-store';
import Database from 'better-sqlite3';
import AutoLaunch from 'auto-launch';
import { createAgent } from './agent';
import { createSkills, resolveUserPath } from './skills';
import { transcribe } from './voice';

// Same data folder in dev and in the packaged app: %APPDATA%/Humatron (memories, chats, settings stay on this PC)
app.setName('Humatron');
// HUMATRON_DATA_DIR (QA only): run against a separate profile so screenshots/tests never touch the real data.
app.setPath('userData', process.env.HUMATRON_DATA_DIR || join(app.getPath('appData'), 'Humatron'));

// Initialize store
const store = new Store({
  name: 'humatron-config',
  defaults: {
    windowBounds: { width: 1200, height: 800 },
    autoStart: false,
    globalHotkey: 'Alt+Space',
    nebiusApiKey: '',
    provider: 'nvidia',   // free tier, no card; switch to nebius in Settings once credits arrive
  },
});

// Initialize database
const dbPath = join(app.getPath('userData'), 'humatron.db');
const db = new Database(dbPath);

// Run migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    embedding BLOB,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
  
  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    when_to_use TEXT NOT NULL,
    steps TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    args TEXT NOT NULL,
    result TEXT,
    success INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    description TEXT,
    location TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Auto-launch
const autoLaunch = new AutoLaunch({
  name: 'Humatron',
  path: app.getPath('exe'),
  isHidden: true,
});

// Only the installed app may register itself at login (unpackaged it would register the bare electron.exe).
if (app.isPackaged) {
  (store.get('autoStart') ? autoLaunch.enable() : autoLaunch.disable()).catch(() => {});
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let embedder: any = null;

// Initialize embedder lazily
async function getEmbedder() {
  if (!embedder) {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = join(app.getPath('userData'), 'models');   // writable even when the app is packaged (asar is read-only)
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  }
  return embedder;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function createWindow() {
  const bounds = store.get('windowBounds');
  
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    icon: join(app.getAppPath(), 'src/assets/icon.png'),
  });

  // Built renderer by default; set HUMATRON_DEV_URL=http://localhost:5173 to use the Vite dev server instead.
  // (Old code loaded the dev server whenever the app was unpackaged -> blank window when Vite wasn't running.)
  const devUrl = process.env.HUMATRON_DEV_URL;
  const isDev = !!devUrl;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // HUMATRON_SHOTS=<steps.json>: QA screenshot tour. HUMATRON_DEMO=<steps.json>: same steps as a hands-off demo for screen
  // recording (window maximized, stays open). Each step {js?, waitFor?, timeout?, wait?, file?, say?} runs JS in the real UI,
  // optionally waits until `waitFor` is truthy, pauses `wait` ms, and saves a PNG when `file` is set.
  const tour = process.env.HUMATRON_SHOTS || process.env.HUMATRON_DEMO;
  if (tour) {
    const demo = !process.env.HUMATRON_SHOTS;
    if (demo) mainWindow.once('ready-to-show', () => mainWindow?.maximize());
    mainWindow.webContents.once('did-finish-load', async () => {
      const steps = JSON.parse(readFileSync(tour, 'utf8'));
      const js = (code: string) => mainWindow!.webContents.executeJavaScript(code, true);
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      await sleep(demo ? 4000 : 2500);
      for (const s of steps) {
        try {
          if (s.say) console.log(`[demo] ${s.say}`);
          if (s.js) await js(s.js);
          if (s.waitFor) {
            const until = Date.now() + (s.timeout || 60000);
            while (Date.now() < until && !(await js(s.waitFor))) await sleep(1000);
          }
          await sleep(s.wait ?? 1200);
          if (s.file) {
            writeFileSync(s.file, (await mainWindow!.webContents.capturePage()).toPNG());
            console.log('[shots] saved', s.file);
          }
        } catch (e: any) { console.log('[tour] step failed', s.file || s.say || '', e.message); }
      }
      if (demo) console.log('[demo] finished - app stays open');
      else { isQuitting = true; app.quit(); }
    });
  }

  // HUMATRON_SELFTEST=<file.png>: render, screenshot the window to that file, print renderer errors, quit. Used for QA.
  const selftest = process.env.HUMATRON_SELFTEST;
  if (selftest) {
    mainWindow.webContents.on('console-message', (e: any) => {
      const level = e.level ?? '', msg = e.message ?? '';
      if (String(level).match(/error|warn|3|2/)) console.log(`[renderer ${level}] ${msg}`);
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => console.log(`[load failed] ${code} ${desc} ${url}`));
    mainWindow.webContents.once('did-finish-load', () => setTimeout(async () => {
      const img = await mainWindow!.webContents.capturePage();
      writeFileSync(selftest, img.toPNG());
      const root = await mainWindow!.webContents.executeJavaScript("document.getElementById('root')?.innerText.slice(0, 300) || '(empty root)'");
      console.log('[selftest] root text:', JSON.stringify(root));
      console.log('[selftest] api bridge:', await mainWindow!.webContents.executeJavaScript('typeof window.api'));
      if (process.env.HUMATRON_SELFTEST_JS) {
        try { console.log('[selftest] js:', JSON.stringify(await mainWindow!.webContents.executeJavaScript(process.env.HUMATRON_SELFTEST_JS))); }
        catch (e: any) { console.log('[selftest] js error:', e.message); }
      }
      isQuitting = true; app.quit();
    }, Number(process.env.HUMATRON_SELFTEST_WAIT || 3000)));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (isDev) {
      mainWindow?.webContents.openDevTools();
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('resize', () => {
    if (mainWindow) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'src/assets/icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Humatron', click: () => mainWindow?.show() },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  
  tray.setToolTip('Humatron');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

function registerGlobalShortcut() {
  const hotkey = store.get('globalHotkey');
  const ret = globalShortcut.register(hotkey, () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
  
  if (!ret) {
    console.log('Global shortcut registration failed');
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  registerGlobalShortcut();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// IPC Handlers
ipcMain.handle('store:get', (_, key: string) => store.get(key));
ipcMain.handle('store:set', (_, key: string, value: unknown) => store.set(key, value));

// Memory operations
ipcMain.handle('memory:add', async (_, content: string, metadata?: object) => ({ id: await agent.saveMemory(content, metadata || { source: 'manual' }), content }));

ipcMain.handle('memory:search', (_, query: string, limit = 10) => agent.searchMemory(query, limit));

ipcMain.handle('memory:getRecent', async (_, limit = 20) => {
  const stmt = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit);
});

// Skill operations
ipcMain.handle('skill:save', async (_, name: string, when_to_use: string, steps: string) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO skills (name, when_to_use, steps) VALUES (?, ?, ?)');
  stmt.run(name, when_to_use, steps);
  return { success: true };
});

ipcMain.handle('skill:list', async () => {
  const stmt = db.prepare('SELECT * FROM skills ORDER BY created_at DESC');
  return stmt.all();
});

ipcMain.handle('skill:get', async (_, name: string) => {
  const stmt = db.prepare('SELECT * FROM skills WHERE name = ?');
  return stmt.get(name);
});

ipcMain.handle('skill:delete', async (_, name: string) => {
  const stmt = db.prepare('DELETE FROM skills WHERE name = ?');
  stmt.run(name);
  return { success: true };
});

// Skill execution - run steps as commands
ipcMain.handle('skill:execute', async (_, name: string, context?: object) => {
  const stmt = db.prepare('SELECT * FROM skills WHERE name = ?');
  const skill = stmt.get(name);
  if (!skill) throw new Error(`Skill "${name}" not found`);
  
  const steps = skill.steps.split('\n').filter((s: string) => s.trim());
  const results = [];
  
  for (const step of steps) {
    try {
      const result = await executeStep(step.trim(), context);
      results.push({ step, result, success: true });
    } catch (err: any) {
      results.push({ step, error: err.message, success: false });
    }
  }
  
  return { skill: name, results };
});

// SQLite can't bind objects/booleans: store args/result as JSON text and success as 0/1.
const toolLogStmt = db.prepare('INSERT INTO tool_calls (tool_name, args, result, success) VALUES (?, ?, ?, ?)');
const toolLog = {
  run: (name: string, args: unknown, result: unknown, success: boolean) =>
    toolLogStmt.run(name, JSON.stringify(args ?? {}), JSON.stringify(result ?? null).slice(0, 20000), success ? 1 : 0),
};

async function executeStep(step: string, context?: object) {
  const numMatch = step.match(/^\d+\.\s*(.+)$/);
  const action = numMatch ? numMatch[1] : step;
  
  const logStmt = toolLog;
  
  // FS operations
  if (action.startsWith('run:')) {
    const cmd = action.slice(4).trim();
    const { stdout, stderr } = await runCommand(cmd);
    logStmt.run('shell', { command: cmd }, { stdout, stderr }, true);
    return { stdout, stderr };
  }
  
  if (action.startsWith('read:')) {
    const file = action.slice(5).trim();
    const content = readFileSync(file, 'utf-8');
    logStmt.run('fs:read', { file }, { length: content.length }, true);
    return content;
  }
  
  if (action.startsWith('write:')) {
    const [file, ...contentParts] = action.slice(6).split('|');
    const content = contentParts.join('|');
    const dir = join(file.trim(), '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file.trim(), content);
    logStmt.run('fs:write', { file: file.trim() }, { bytes: content.length }, true);
    return `Wrote ${content.length} bytes to ${file.trim()}`;
  }
  
  if (action.startsWith('list:')) {
    const dir = action.slice(5).trim() || '.';
    const files = readdirSync(dir, { withFileTypes: true });
    const result = files.map(f => ({ name: f.name, type: f.isDirectory() ? 'dir' : 'file', size: f.isFile() ? statSync(join(dir, f.name)).size : 0 }));
    logStmt.run('fs:list', { dir }, { count: result.length }, true);
    return result;
  }
  
  if (action.startsWith('mkdir:')) {
    const dir = action.slice(6).trim();
    mkdirSync(dir, { recursive: true });
    logStmt.run('fs:mkdir', { dir }, {}, true);
    return `Created directory ${dir}`;
  }
  
  if (action.startsWith('copy:')) {
    const [src, dest] = action.slice(5).split('>');
    copyFileSync(src.trim(), dest.trim());
    logStmt.run('fs:copy', { src: src.trim(), dest: dest.trim() }, {}, true);
    return `Copied ${src.trim()} to ${dest.trim()}`;
  }
  
  if (action.startsWith('delete:')) {
    const target = action.slice(7).trim();
    const stats = statSync(target);
    if (stats.isDirectory()) {
      rmSync(target, { recursive: true, force: true });
    } else {
      unlinkSync(target);
    }
    logStmt.run('fs:delete', { target }, {}, true);
    return `Deleted ${target}`;
  }
  
  // Browser
  if (action.startsWith('web:')) {
    const url = action.slice(4).trim();
    logStmt.run('browser:open', { url }, {}, true);
    shell.openExternal(url);
    return `Opened ${url}`;
  }
  
  // Calendar
  if (action.startsWith('cal:add:')) {
    const [title, start, end, desc] = action.slice(8).split('|');
    const stmt = db.prepare('INSERT INTO calendar_events (title, start_time, end_time, description) VALUES (?, ?, ?, ?)');
    const result = stmt.run(title.trim(), start.trim(), end?.trim() || null, desc?.trim() || '');
    logStmt.run('calendar:add', { title: title.trim(), start: start.trim() }, { id: result.lastInsertRowid }, true);
    return `Created event: ${title.trim()}`;
  }
  
  if (action.startsWith('cal:list:')) {
    const date = action.slice(9).trim();
    const stmt = db.prepare('SELECT * FROM calendar_events WHERE date(start_time) = ? ORDER BY start_time');
    const events = stmt.all(date);
    logStmt.run('calendar:list', { date }, { count: events.length }, true);
    return events;
  }
  
  if (action.startsWith('cal:today')) {
    const today = new Date().toISOString().split('T')[0];
    const stmt = db.prepare('SELECT * FROM calendar_events WHERE date(start_time) = ? ORDER BY start_time');
    const events = stmt.all(today);
    logStmt.run('calendar:today', {}, { count: events.length }, true);
    return events;
  }
  
  // Code execution
  if (action.startsWith('code:')) {
    const langMatch = action.match(/^code:(\w+):([\s\S]+)$/);
    if (langMatch) {
      const lang = langMatch[1];
      const code = langMatch[2];
      const result = await runCode(lang, code);
      logStmt.run('code:exec', { lang, code: code.substring(0, 100) }, result, result.success);
      return result;
    }
  }
  
  // Notifications
  if (action.startsWith('notify:')) {
    const [title, body] = action.slice(7).split('|');
    if (mainWindow) {
      mainWindow.webContents.send('notification', { title: title.trim(), body: body?.trim() || '' });
    }
    logStmt.run('notify', { title: title.trim() }, {}, true);
    return `Notification sent: ${title.trim()}`;
  }
  
  // Sleep/wait
  if (action.startsWith('wait:')) {
    const ms = parseInt(action.slice(5).trim(), 10);
    await new Promise(r => setTimeout(r, ms));
    logStmt.run('wait', { ms }, {}, true);
    return `Waited ${ms}ms`;
  }
  
  logStmt.run('unknown', { step }, { message: 'Step logged but not executed' }, false);
  return { message: `Logged: ${action}` };
}

async function runCode(lang: string, code: string): Promise<{success: boolean, stdout?: string, stderr?: string}> {
  const { spawn } = require('child_process');
  const tmpDir = app.getPath('temp');
  const fileName = `humatron_${Date.now()}`;
  
  const langConfig: Record<string, {ext: string, cmd: string, args: string[]}> = {
    js: { ext: '.js', cmd: 'node', args: [] },
    ts: { ext: '.ts', cmd: 'npx', args: ['ts-node', '--transpile-only'] },
    py: { ext: '.py', cmd: 'python', args: [] },
    sh: { ext: '.sh', cmd: 'bash', args: [] },
    ps1: { ext: '.ps1', cmd: 'powershell', args: ['-File'] },
  };
  
  const config = langConfig[lang] || langConfig.js;
  const filePath = join(tmpDir, `${fileName}${config.ext}`);
  
  return new Promise((resolve) => {
    writeFileSync(filePath, code);
    const child = spawn(config.cmd, [...config.args, filePath], { 
      cwd: tmpDir,
      shell: true,
      timeout: 30000 
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', (code) => {
      try { unlinkSync(filePath); } catch {}
      resolve({ success: code === 0, stdout, stderr });
    });
    child.on('error', (err) => {
      try { unlinkSync(filePath); } catch {}
      resolve({ success: false, stdout, stderr: err.message });
    });
  });
}

function runCommand(cmd: string): Promise<{stdout: string, stderr: string}> {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? 'cmd.exe' : 'sh', isWin ? ['/c', cmd] : ['-c', cmd], { 
      cwd: app.getPath('userData'),
      shell: true 
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', () => resolve({ stdout, stderr }));
  });
}

// Conversation history
ipcMain.handle('conversation:add', async (_, role: string, content: string, metadata?: object) => {
  const stmt = db.prepare('INSERT INTO conversations (role, content, metadata) VALUES (?, ?, ?)');
  const result = stmt.run(role, content, JSON.stringify(metadata || {}));
  return { id: result.lastInsertRowid };
});

ipcMain.handle('conversation:getRecent', async (_, limit = 50) => {
  const stmt = db.prepare('SELECT * FROM conversations ORDER BY id DESC LIMIT ?');
  return stmt.all(limit);
});

// Tool call logging
ipcMain.handle('tool:log', async (_, tool_name: string, args: object, result?: object, success = true) => {
  const stmt = db.prepare('INSERT INTO tool_calls (tool_name, args, result, success) VALUES (?, ?, ?, ?)');
  stmt.run(tool_name, JSON.stringify(args), JSON.stringify(result || {}), success ? 1 : 0);
});

// Files, images and web search tools (src/skills.ts), shared by chat and missions.
const skills = createSkills({
  trash: p => shell.trashItem(p),
  openPath: p => shell.openPath(p),
  imagesDir: join(app.getPath('pictures'), 'Humatron'),
  store: store as any,
});
ipcMain.handle('web:test', () => skills.webTest());

// Nebius / Nemotron + tool-calling agent (src/agent.ts)
const agent = createAgent(store as any, db, async (text: string) => {
  try { const pipe = await getEmbedder(); return (await pipe(text, { pooling: 'mean', normalize: true })).data as Float32Array; }
  catch (e: any) { console.log('[embed] unavailable, using keyword search:', String(e?.stack || e?.message || e).slice(0, 600)); return null; }
}, toolLog, skills);
ipcMain.handle('nebius:chat', async (_, messages: Array<{role: string, content: string}>) =>
  agent.nebiusFetch('/chat/completions', { method: 'POST', body: JSON.stringify({ model: await agent.resolveModel(), messages, max_tokens: 2048 }) }));
ipcMain.handle('nebius:test', () => agent.test());
ipcMain.handle('nebius:models', () => agent.models());
ipcMain.handle('agent:chat', (_, text: string, opts?: object) => agent.chat(text, opts || {}));

// Missions: Nemotron plans + executes multi-step goals; progress streams to the window as 'mission:event'.
ipcMain.handle('mission:start', (_, goal: string) => agent.mission(goal, ev => mainWindow?.webContents.send('mission:event', ev)));
ipcMain.handle('mission:cancel', (_, id: number) => agent.cancelMission(id));
ipcMain.handle('mission:list', () => agent.listMissions());
ipcMain.handle('mission:get', (_, id: number) => agent.getMission(id));

// Voice: renderer records + resamples to 16 kHz mono PCM, main transcribes with Whisper on this PC.
ipcMain.handle('voice:transcribe', (_, pcm: Float32Array) => transcribe(pcm, store as any, app.getPath('userData')));

// Files the assistant produced (images) - open, or show in Explorer.
ipcMain.handle('files:open', async (_, p: string) => shell.openPath(resolveUserPath(p)));
ipcMain.handle('files:reveal', (_, p: string) => shell.showItemInFolder(resolveUserPath(p)));

// Settings > Data & Privacy. Everything Humatron knows lives in these tables; settings/API keys live in the store.
const DATA_TABLES = ['memories', 'conversations', 'calendar_events', 'skills', 'missions', 'tool_calls'];
const tableExists = (t: string) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
const counts = () => Object.fromEntries(DATA_TABLES.filter(tableExists).map(t => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n]));

// Export: a readable JSON file of all local data. API keys are never written out (memory vectors are dropped too).
ipcMain.handle('data:export', async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(mainWindow!, {
    title: 'Export Humatron data',
    defaultPath: join(app.getPath('documents'), `Humatron-export-${stamp}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  const data: Record<string, any> = {};
  for (const t of DATA_TABLES.filter(tableExists)) {
    data[t] = (db.prepare(`SELECT * FROM ${t} ORDER BY id`).all() as any[]).map(row => {
      const { embedding, ...rest } = row;
      for (const k of ['metadata', 'args', 'result', 'plan', 'steps']) {
        if (typeof rest[k] === 'string') { try { rest[k] = JSON.parse(rest[k]); } catch {} }
      }
      return rest;
    });
  }
  const settings = Object.fromEntries(Object.entries(store.store as Record<string, any>).filter(([k]) => !/apikey|key$/i.test(k)));
  writeFileSync(r.filePath, JSON.stringify({ app: 'Humatron', exportedAt: new Date().toISOString(), counts: counts(), settings, data }, null, 2), 'utf8');
  shell.showItemInFolder(r.filePath);
  return { path: r.filePath, counts: counts() };
});

// Clear: wipes memories, chats, calendar, skills, missions and the tool log after a native confirmation.
// API keys and settings stay, so Humatron keeps working; generated images in Pictures\Humatron are left alone.
ipcMain.handle('data:clear', async () => {
  const c = counts();
  const r = await dialog.showMessageBox(mainWindow!, {
    type: 'warning', title: 'Clear all data', buttons: ['Cancel', 'Delete everything'], defaultId: 0, cancelId: 0, noLink: true,
    message: 'Delete everything Humatron has stored on this PC?',
    detail: `${c.memories ?? 0} memories, ${c.conversations ?? 0} chat messages, ${c.calendar_events ?? 0} calendar events, ` +
      `${c.skills ?? 0} skills, ${c.missions ?? 0} missions and the tool log will be permanently deleted.\n\n` +
      'Your API keys and settings are kept. Tip: use Export Data first if you want a backup.',
  });
  if (r.response !== 1) return { canceled: true };
  db.transaction(() => { for (const t of DATA_TABLES.filter(tableExists)) db.prepare(`DELETE FROM ${t}`).run(); })();
  db.exec('VACUUM');
  setTimeout(() => mainWindow?.webContents.reload(), 300);   // every page re-reads its (now empty) data
  return { cleared: c };
});

// Calendar API
ipcMain.handle('calendar:add', async (_, title: string, start: string, end?: string, description?: string) => {
  const stmt = db.prepare('INSERT INTO calendar_events (title, start_time, end_time, description) VALUES (?, ?, ?, ?)');
  const result = stmt.run(title, start, end || null, description || '');
  return { id: result.lastInsertRowid };
});

ipcMain.handle('calendar:list', async (_, date: string) => {
  // 'YYYY-MM' (calendar grid) lists the whole month, 'YYYY-MM-DD' a single day.
  const where = String(date).length === 7 ? "strftime('%Y-%m', start_time) = ?" : 'date(start_time) = ?';
  const stmt = db.prepare(`SELECT * FROM calendar_events WHERE ${where} ORDER BY start_time`);
  return stmt.all(date);
});

ipcMain.handle('calendar:today', async () => {
  const today = new Date().toISOString().split('T')[0];
  const stmt = db.prepare('SELECT * FROM calendar_events WHERE date(start_time) = ? ORDER BY start_time');
  return stmt.all(today);
});

// Window controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window:close', () => mainWindow?.hide());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});