# Humatron

**A private, always-on personal AI for your desktop — powered by NVIDIA Nemotron on Nebius Token Factory.**

Humatron lives in your system tray. It remembers what matters to you, manages your files and calendar, talks in your
language, and carries out multi-step **Missions** — while your memories, chats, files and calendar stay on your PC.

> Built for the **Nebius × NVIDIA Global AI Hackathon 2026** — track: **Personal AI**
> (*"A private, always-on assistant with memory, reusable skills, and user-controlled tools."*)

## What it does

| | |
|---|---|
| 🧠 **Nemotron brain** | Every answer and decision comes from **NVIDIA Nemotron** (Nemotron 3 Ultra first) via **Nebius Token Factory**'s OpenAI-compatible API. An NVIDIA build (`nvapi-`) key also works for development. |
| 🎯 **Missions** | Give a goal ("prepare me for Monday's exam"). Nemotron **plans** 3–6 steps, **executes** each one with real tools, and writes a **report** — shown live as a step timeline. |
| 💾 **Local memory** | Facts you share are saved in SQLite with on-device MiniLM embeddings and recalled by meaning in later chats — across restarts. |
| 📂 **File management** | List, search, read, create, move, copy, open files and folders. Deletes go to the **Recycle Bin** only; system folders are blocked. |
| 📅 **Calendar** | Add and check events in plain language; month view in the app. |
| 🌐 **Web research (Tavily)** | Optional. Used **only to perform operations** — research steps in Missions, or when a request (e.g. scheduling an event) needs real-world facts. Capped per request and cached. |
| 🎙️ **Voice** | Dictate, or talk hands-free in voice mode. Speech recognition runs **on your PC** (Whisper via transformers.js); replies are spoken with Windows voices. |
| 🌍 **Any language** | Write or speak English, Hindi, Kannada, Tamil, Telugu, Hinglish… Humatron replies in the same language. |
| 🎨 **Images** | "Make an image of…" → generated and saved to `Pictures\Humatron`. |
| 🔒 **Your data** | Export everything to JSON or clear it from Settings. No telemetry, no cloud sync. |

## How Nemotron is used

Nemotron is not a chat add-on here — it is the agent's reasoning core:

1. **Chat agent** (`src/agent.ts → chat`): relevant local memories + recent history go into the system prompt; Nemotron
   decides which tools to call (up to 6 rounds), then answers in the user's language.
2. **Missions** (`src/agent.ts → mission`): Nemotron returns a JSON plan, then runs each step with tool calls, seeing what
   earlier steps produced (and which tools already ran, so it doesn't repeat work), and finally writes a Markdown report.
   Progress streams to the UI over IPC. Rate limits pause and resume the mission instead of failing it.
3. **Model selection**: Humatron lists the account's models, ranks Nemotron (3 Ultra → Super → Nano) and probes until
   one answers; the choice is cached.

## Architecture

```
React renderer (Chat · Missions · Memory · Calendar · Skills · Settings)
        │  contextBridge IPC (typed, no nodeIntegration, sandboxed)
Electron main ── better-sqlite3 (%APPDATA%\Humatron\humatron.db)
        │        electron-store (settings + API keys, local JSON)
        ├── src/agent.ts   Nemotron client (Nebius Token Factory / NVIDIA build), chat loop, Missions engine
        ├── src/skills.ts  file tools, image tool, Tavily web_search / read_webpage
        └── src/voice.ts   local Whisper speech-to-text (transformers.js, ONNX)
```

## Setup

**Prerequisites:** Windows 10/11, Node.js 22+, a **Nebius Token Factory** API key (or an NVIDIA build `nvapi-` key).
Optional: a **Tavily** key for web research.

```bash
git clone https://github.com/nagesh-code1/humatron.git
cd humatron
npm install
npm start            # builds (node build.mjs) and launches Electron
```

Then in the app:

1. **Settings → AI Brain → Nemotron API key**: paste your Nebius Token Factory key (the badge shows
   *"Nebius Token Factory ✓ hackathon-ready"*), leave the model on **Auto**, click **Save & test connection**.
2. *(Optional)* **Settings → Web search · Tavily**: paste a `tvly-` key and click **Test**.
3. Try **Chat** ("Remember that I'm vegetarian") or a **Mission** from the examples.

First use of voice downloads the Whisper base model (~100 MB) into `%APPDATA%\Humatron\models`; memory embeddings
(MiniLM, ~25 MB) download on first chat. After that both run offline.

**Packaging:** `npm run package` → `out/Humatron-win32-x64/`. The unsigned `.exe` may be blocked by Windows Smart App
Control; running from source avoids that.

## Privacy

- Memories, chats, calendar, skills and missions: `%APPDATA%\Humatron\humatron.db` on your PC.
- API keys: stored only in `%APPDATA%\Humatron\humatron-config.json` (local, plain JSON — never committed, never exported).
- What leaves your PC: requests to Nemotron (Nebius / NVIDIA), Tavily searches when web research is enabled, and
  image descriptions sent to the image service. Voice is transcribed locally.
- No shell tool; file deletes go to the Recycle Bin; `C:\Windows`, `Program Files`, `ProgramData` are refused.

## Testing done

- Live on **NVIDIA Nemotron 3 Ultra** (`nvidia/nemotron-3-ultra-550b-a55b`): chat with tools; a Mission planned an exam
  schedule, saved a study-plan file and created two calendar events.
- File tools: 12 automated checks (create/read/move/copy/search/recycle, overwrite refusal, blocked system paths).
- Local Whisper: English sentence transcribed exactly in ~3 s after the one-time model download.
- Multilingual: Kannada and Hindi prompts answered in the same language.

## License

MIT — see [LICENSE](LICENSE). © 2026 Nagesh.
