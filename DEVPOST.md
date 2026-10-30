# Devpost Submission — Humatron

## Title
**Humatron — Local-First AI Assistant with Nemotron Reasoning & On-Device Memory**

## Tagline
Summon Nemotron with Alt+Space. It remembers everything locally. Your data never leaves your machine.

## Inspiration
We wanted an AI assistant that actually *stays* on your computer — no cloud sync, no subscription, no data harvesting. The NVIDIA × Nebius hackathon was the perfect excuse to build it: Nemotron models are incredible at reasoning, and Nebius Token Factory makes them accessible. But every "AI assistant" we tried either lived in a browser tab or phoned home. So we built Humatron: a native desktop app where the model is remote (Nebius), but the *mind* — memory, calendar, tools, preferences — is 100% local.

## What It Does

Humatron is a frameless Electron app that lives in your system tray. Press **Alt+Space** and it appears instantly.

**Core capabilities:**
- **Chat with Nemotron** — Nebius Token Factory / AI Studio, auto-detects Nemotron Ultra/Super from your account's model list
- **Local memory with semantic search** — SQLite + MiniLM-L6-v2 embeddings (via `@xenova/transformers`, ONNX, quantized). Tell it "I prefer dark roast coffee" → it remembers. Restart the app, ask "what coffee do I like?" → it recalls via cosine similarity.
- **Tool-calling agent loop** (`src/agent.ts`) — the model decides when to call `remember`, `recall`, `add_event`, `list_events`. Max 6 rounds per turn. Both user messages and tool results persist in SQLite.
- **Calendar + desktop notifications** — add events via chat ("remind me tomorrow at 10am"), they appear in the Calendar tab and as native toasts.
- **Privacy first** — DB at `%APPDATA%\Humatron\humatron.db`, API key encrypted via Windows DPAPI (electron-store). Only `/models` and `/chat/completions` calls leave your machine.

## How We Built It

| Layer | Tech |
|-------|------|
| **UI** | React 19 + TypeScript, Vite, custom CSS variables (sea-blue theme) |
| **Shell** | Electron 45, frameless window, custom titlebar, system tray, global shortcut |
| **Storage** | better-sqlite3 (conversations, memories, calendar, tool logs), electron-store (encrypted settings) |
| **Embeddings** | @xenova/transformers — MiniLM-L6-v2, runs locally, no GPU needed |
| **Model** | Nebius OpenAI-compatible API — Nemotron 3 Ultra / Super, auto-resolved from `/models` |
| **Agent** | `src/agent.ts` — system prompt + history + memory search → tool calls → answer |
| **Build** | esbuild (main/preload) + Vite (renderer), Electron Forge (Squirrel installer) |

**Key implementation details:**
- `createAgent(store, db, embed, toolLog)` factory — pure functions, testable, no global state
- `resolveModel()` hits `/models`, picks Nemotron Ultra > Super > first Nemotron, caches result
- `chat()` injects relevant memories (top-4 cosine similarity) + last 12 conversation turns into system prompt
- Tool schema: `remember(content)`, `recall(query)`, `add_event(title, start, end?, description?)`, `list_events(date)`
- Preload exposes only typed IPC: `chat`, `memory.search`, `calendar.*`, `window.*` — no `nodeIntegration`

## Challenges We Ran Into

1. **Unsigned Windows installer blocked by Smart App Control** — Electron Forge Squirrel output isn't code-signed. Workaround: run from source (`npm start`) for demo. Documented in README.
2. **Nebius host migration** — AI Studio → Token Factory. Agent tries both hosts, caches the working one.
3. **MiniLM in Electron renderer vs main** — Embeddings run in main process (Node) via `@xenova/transformers`; renderer only sends text via IPC. Avoided WebAssembly issues in sandboxed renderer.
4. **Tool-calling model compatibility** — Not all Nemotron variants support `tools` parameter. Agent detects failure, falls back to plain chat automatically.
5. **Context isolation + contextBridge typing** — Added `src/renderer/global.d.ts` for `window.api` autocomplete.

## Accomplishments We're Proud Of

- **Zero-cloud memory** — semantic recall works after full app restart, no vector DB server needed
- **Sub-200MB installer** — Electron + Node + deps, single `.exe` via Squirrel
- **Alt+Space muscle memory** — global hotkey + frameless window feels native, not "web app in a box"
- **Agent loop in ~150 lines** — `src/agent.ts` is readable, no framework bloat
- **Cross-host Nebius support** — gracefully handles Token Factory / AI Studio migration

## What We Learned

- Local embeddings (MiniLM) are fast enough for ~10k memories on CPU — no need for pgvector/Chroma/Weaviate on desktop
- Electron Forge + Vite plugin + esbuild = clean separation: renderer builds to `dist/renderer`, main/preload to `dist/main` & `dist/preload`
- `electron-store` uses OS credential store (DPAPI on Windows) — API keys actually encrypted at rest
- Tool-calling models need tight system prompts: "call remember whenever user shares a lasting fact" works better than "you can use tools"

## What's Next

- **Streaming responses** — Nebius supports SSE; render tokens as they arrive
- **More tools** — file read/write, shell, web search, code execution (sandboxed)
- **Plugin system** — community skills as JSON, hot-loadable
- **macOS / Linux builds** — Forge makers configured, needs CI
- **Code signing** — GitHub Actions + Windows cert for Smart App Control
- **Model quantization options** — let users pick Nemotron 3 Ultra 4-bit for lower latency

## Built With

- **NVIDIA Nemotron** (via Nebius Token Factory / AI Studio)
- **Nebius** — serverless inference, OpenAI-compatible API
- **Electron** — native desktop shell
- **React 19** — UI
- **TypeScript** — type safety across main/preload/renderer
- **Vite** — fast renderer builds
- **esbuild** — instant main/preload bundles
- **better-sqlite3** — fast local SQL
- **@xenova/transformers** — MiniLM-L6-v2 embeddings (ONNX, quantized)
- **electron-store** — encrypted settings (DPAPI / Keychain / libsecret)
- **auto-launch** — start on login
- **Electron Forge** — packaging (Squirrel, DMG, DEB, RPM)

---

**Repository:** (private until Devpost submission approved)  
**Demo:** Run `npm start` — press Alt+Space, add Nebius key in Settings, try "Remember I like dark roast coffee", restart, ask "What coffee do I like?"