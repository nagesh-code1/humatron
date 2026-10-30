# Humatron

**Local-first AI desktop assistant** powered by NVIDIA Nemotron models via Nebius. Everything runs on your machine — only API calls leave your device.

## What It Does

Humatron is a local-first AI assistant that lives in your system tray (Alt+Space to summon). It combines:

- **Nemotron reasoning** via Nebius Token Factory / AI Studio (auto-detects available Nemotron Ultra/Super models)
- **Persistent local memory** — SQLite + on-device MiniLM embeddings (via `@xenova/transformers`) for semantic recall across restarts
- **Tool-calling agent loop** (`src/agent.ts`) — remembers facts, recalls them, adds/lists calendar events, all without leaving your machine
- **Calendar & notifications** — native desktop notifications, events stored locally

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Main (dist/main/main.cjs)                         │
│  - BrowserWindow, tray, global hotkey, IPC                 │
│  - better-sqlite3 DB at %APPDATA%\Humatron\humatron.db     │
│  - electron-store (encrypted) for API key / settings       │
└──────────────────────────┬──────────────────────────────────┘
                           │ contextBridge (preload)
┌──────────────────────────▼──────────────────────────────────┐
│  React Renderer (dist/renderer)                             │
│  - Chat, Memory, Calendar, Settings tabs                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC: chat, memory, calendar
┌──────────────────────────▼──────────────────────────────────┐
│  Agent Loop (src/agent.ts)                                  │
│  - resolveModel() → picks Nemotron Ultra/Super from /models │
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
- Nebius API key from [tokenfactory.nebius.com](https://tokenfactory.nebius.com) or [studio.nebius.com](https://studio.nebius.com)

### Development (run from source — avoids Windows Smart App Control)
```bash
git clone <repo-url> humatron
cd humatron
npm install
npm run build          # or: node build.mjs
npm start              # node build.mjs && electron .
```

### Add Your Nebius Key
1. Open Humatron (Alt+Space)
2. Go to **Settings** tab
3. Paste your API key → **Save & test connection**
4. Model auto-resolves to a Nemotron model from your account

### Packaging (Windows installer)
```bash
npm run package
# Output: out/Humatron-win32-x64/
# Note: unsigned .exe may be blocked by Windows Smart App Control.
# Prefer running from source for the hackathon demo.
```

## Privacy

- **All data stays in `%APPDATA%\Humatron`** (e.g., `C:\Users\<you>\AppData\Roaming\Humatron\humatron.db`)
- API key stored encrypted via `electron-store` (Windows DPAPI)
- Only Nebius API calls (`/models`, `/chat/completions`) leave your machine
- No telemetry, no analytics, no cloud sync

## Known Issue

**Windows Smart App Control / SmartScreen** may block the unsigned packaged `.exe`.
**Workaround:** run from source (`npm start`) for the demo. The installed app works if you allow it in Windows Security.

## License

MIT — see [LICENSE](LICENSE). Author: Nagesh (2026).