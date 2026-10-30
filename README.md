# Humatron

**Local-first AI desktop assistant** powered by NVIDIA Nemotron (via Nebius or NVIDIA build). Memory, chats and calendar stay on your machine — only model API calls leave your device.

## What It Does

Humatron is a local-first AI assistant that lives in your system tray (Alt+Space to summon). It combines:

- **Nemotron reasoning** via Nebius Token Factory or NVIDIA build (auto-detects a working Nemotron model, Nemotron 3 Ultra first). Google Gemini and Groq are available as free fallbacks.
- **Persistent local memory** — SQLite + on-device MiniLM embeddings (via `@xenova/transformers`) for semantic recall across restarts
- **Tool-calling agent loop** (`src/agent.ts`) — remembers facts, recalls them, adds/lists calendar events, all without leaving your machine
- **Calendar** — events stored locally, created and queried by the agent in plain language

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Main (dist/main/main.cjs)                         │
│  - BrowserWindow, tray, global hotkey, IPC                 │
│  - better-sqlite3 DB at %APPDATA%\Humatron\humatron.db     │
│  - electron-store JSON for provider, API keys, settings    │
└──────────────────────────┬──────────────────────────────────┘
                           │ contextBridge (preload)
┌──────────────────────────▼──────────────────────────────────┐
│  React Renderer (dist/renderer)                             │
│  - Chat, Memory, Calendar, Settings tabs                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC: chat, memory, calendar
┌──────────────────────────▼──────────────────────────────────┐
│  Agent Loop (src/agent.ts)                                  │
│  - resolveModel() → ranks /models, probes until one answers │
│  - chat() → system prompt + recent history + memory search  │
│  - tool calls: remember, recall, add_event, list_events    │
│  - max 6 tool rounds per turn                               │
└──────────────────────────┬──────────────────────────────────┘
                           │ local embeddings
┌──────────────────────────▼──────────────────────────────────┐
│  @xenova/transformers (MiniLM-L6-v2, ONNX, quantized)       │
│  - cosine similarity search in SQLite                       │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### Prerequisites
- Node.js 22+
- An API key from **one** provider:

| Provider | Model | Cost | Get a key |
|---|---|---|---|
| NVIDIA build *(default)* | Nemotron 3 Ultra / 3.5 Lightning | Free tier, no card | [build.nvidia.com](https://build.nvidia.com) → open a Nemotron model → Get API Key |
| Nebius Token Factory | Nemotron | Credits (hackathon promo or card) | [tokenfactory.nebius.com](https://tokenfactory.nebius.com) |
| Google Gemini | Gemini Flash | Free tier, no card | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Groq | Llama 3.3 70B | Free tier, no card | [console.groq.com/keys](https://console.groq.com/keys) |

### Development (run from source — avoids Windows Smart App Control)
```bash
git clone <repo-url> humatron
cd humatron
npm install
npm run build          # or: node build.mjs
npm start              # node build.mjs && electron .
```

### Connect a Model
1. Open Humatron (Alt+Space)
2. Go to **Settings** → **AI Brain** → pick a **Provider**
3. Paste your API key → **Save & test connection**
4. Leave Model on **Auto**: Humatron lists the provider's models, ranks them (Nemotron 3 Ultra first) and uses the first one that actually answers. Pick `nemotron-3.5-lightning` for faster replies.

The first chat also downloads the small local embedding model (MiniLM, ~25 MB) into `%APPDATA%\Humatron\models`; after that, memory search works offline.

### Verified
Tested 2026-10-30 on Windows 11 with `nvidia/nemotron-3-ultra-550b-a55b`: the agent called `remember` + `add_event`, then answered a follow-up with `recall` + `list_events`; memories survived a full app restart.

### Packaging (Windows installer)
```bash
npm run package
# Output: out/Humatron-win32-x64/
# Note: unsigned .exe may be blocked by Windows Smart App Control.
# Prefer running from source for the hackathon demo.
```

## Privacy

- **All data stays in `%APPDATA%\Humatron`** (e.g., `C:\Users\<you>\AppData\Roaming\Humatron\humatron.db`)
- API keys are stored only on this PC in `%APPDATA%\Humatron\humatron-config.json` (plain JSON, never in the repo)
- Only model API calls (`/models`, `/chat/completions`) to the provider you picked leave your machine
- The agent's tools are deliberately safe: memory and calendar only (no shell, no file deletion)
- No telemetry, no analytics, no cloud sync

## Known Issue

**Windows Smart App Control / SmartScreen** may block the unsigned packaged `.exe`.
**Workaround:** run from source (`npm start`) for the demo. The installed app works if you allow it in Windows Security.

## License

MIT — see [LICENSE](LICENSE). Author: Nagesh (2026).