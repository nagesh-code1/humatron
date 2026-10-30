# Humatron Demo Script

## 30-Second Elevator Pitch
"Humatron is a local-first AI assistant that lives on your machine. It combines Nebius's powerful Nemotron 3 Ultra model with local vector memory, a skill engine for automation, and tool adapters for file system, shell, browser, calendar, and code execution. Everything runs locally - only API calls leave your device."

## 3-Minute Demo Flow

### 1. Launch & Global Hotkey (15s)
- Press **Alt+Space** → Humatron appears instantly from system tray
- Show frameless window, custom titlebar, dark theme
- Mention: auto-starts on login, hides to tray on close

### 2. Chat with Nemotron 3 Ultra (45s)
- Switch to **Chat** tab
- Ask: "Write a Python script that fetches GitHub trending repos and saves to JSON"
- Show streaming response with code block
- Mention: conversation history persists locally in SQLite

### 3. Memory & Vector Search (30s)
- Switch to **Memory** tab
- Show automatically saved conversation memories
- Search: "GitHub trending" → semantic search finds relevant memories
- Add manual memory: "Project idea: AI code reviewer for PRs"
- Search: "code reviewer" → finds it via embeddings

### 4. Skill Engine - Create & Execute (60s)
- Switch to **Skills** tab
- Click **Add Skill** → Name: "deploy-frontend"
- When to use: "Deploy React app to Vercel after build"
- Steps:
```
1. run: npm run build
2. write: dist/vercel.json|{"buildCommand":"npm run build","outputDirectory":"dist"}
3. web: https://vercel.com
4. notify: Deploy Started|Frontend build complete, opening Vercel
5. wait: 3000
5. code:js: console.log('Ready for Vercel deploy!')
```
- Click **Execute** → Show real-time results with success/failure badges
- Show tool call log in database

### 5. Calendar Integration (20s)
- Switch to **Calendar** tab
- Click today → Add event: "Hackathon submission deadline" at 11:59 PM
- Show month view with event
- Mention: skills can add calendar events automatically

### 6. Settings & Configuration (15s)
- Switch to **Settings** tab
- Show Nebius API key field (encrypted storage)
- Model selector: Nemotron 3 Ultra, Hermes 3, Llama 3.1 405B
- Global hotkey customization
- Auto-start toggle

### 7. Architecture Highlights (15s)
- Open DevTools → Console showing IPC calls
- Show `~/.humatron/humatron.db` - all local
- Mention: zero cloud dependencies except Nebius API

## Technical Talking Points

| Feature | Implementation |
|---------|---------------|
| **Vector Memory** | `@xenova/transformers` + all-MiniLM-L6-v2, cosine similarity in SQLite |
| **Skill Engine** | Parsed numbered steps → executed via tool adapters → results logged |
| **Tool Adapters** | FS (read/write/list/mkdir/copy/delete), Shell, Browser, Calendar, Code (JS/TS/Py/Sh/PS1) |
| **Nebius API** | OpenAI-compatible, streaming-ready, secure key storage |
| **UI** | React 19, TypeScript, Vite, custom CSS variables, frameless Electron |
| **Packaging** | Electron Forge + Vite plugin, Squirrel installer for Windows |

## Hackathon Categories
- **Best Local-First AI App** - Everything runs locally
- **Best Developer Tool** - Skill engine automates dev workflows
- **Best Nebius Integration** - Full Nemotron 3 Ultra with model selector
- **Most Innovative UX** - Global hotkey, tray, frameless, notifications

## Judges' Questions Prep

**Q: Why not just use ChatGPT/Claude?**
A: Privacy, offline capability, local memory persistence, custom tool execution, no subscription.

**Q: How does vector search work without a vector DB?**
A: all-MiniLM-L6-v2 runs locally via ONNX in transformers.js, embeddings stored as BLOB in SQLite, cosine similarity computed in-memory. Fast enough for ~10k memories.

**Q: Can skills call external APIs?**
A: Yes - `run: curl ...` or `code:js: fetch(...)` - but we encourage local-first patterns.

**Q: What's the install size?**
A: ~150MB (Electron + Node + dependencies), single executable via Squirrel.

**Q: Does it work on Mac/Linux?**
A: Yes - Electron Forge builds for all platforms, makers configured for DMG, DEB, RPM, ZIP.

## Submission Assets
- [x] GitHub repo with source
- [x] Windows installer (.exe)
- [x] README with architecture diagram
- [x] Demo video (3 min)
- [x] Devpost project page