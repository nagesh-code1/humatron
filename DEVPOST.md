# Devpost submission — Humatron (copy-paste ready)

**Track:** Personal AI

## Project name
Humatron

## Elevator pitch (≤200 chars)
A private, always-on desktop AI powered by NVIDIA Nemotron on Nebius. It remembers you, manages files and calendar, speaks your language, and completes multi-step Missions.

## Inspiration
Most "AI assistants" are a chat box in a browser tab that forgets you the moment you close it. We wanted something closer
to a real personal assistant: it lives on your desktop, remembers what matters to you, can actually *do* things on your
PC — and keeps your life on your machine instead of someone else's cloud. In India, people also switch between
English, Hindi, Kannada and Hinglish in the same sentence, so the assistant had to understand and answer in all of them.

## What it does
Humatron is a Windows desktop app (system tray) whose brain is **NVIDIA Nemotron 3 Ultra, served by Nebius Token Factory**.

- **Missions** — give a goal like *"I have my Signals & Systems exam on Monday — make a study plan and book study
  sessions."* Nemotron plans 3–6 steps, executes each with real tools, and writes a report. You watch it live: a step
  timeline, tool cards (file written, events added, pages read), a progress bar and the final report.
- **Long-term memory** — facts you share are stored locally with on-device embeddings and recalled by meaning later,
  even after a restart.
- **Hands-on tools** — files (list, search, read, create, move, copy, open; deletes only to the Recycle Bin), calendar,
  image generation, and **Tavily web research used only when performing an operation** (e.g. finding the real date and
  venue of an event before scheduling it).
- **Voice, in your language** — dictate or have a hands-free conversation. Speech is recognised on your PC (Whisper);
  Humatron replies in the language you used — English, Hindi, Kannada, Tamil, Hinglish…
- **You own the data** — export everything to JSON or clear it from Settings. No telemetry.

## How we built it
- **Electron 45 + React 19 + TypeScript**, Vite for the renderer, esbuild for main/preload; typed `contextBridge` IPC,
  sandboxed renderer, no `nodeIntegration`.
- **Nemotron via Nebius Token Factory** (OpenAI-compatible `/v1/chat/completions` with tool calling). Humatron lists the
  account's models, ranks Nemotron (3 Ultra → Super → Nano) and probes until one answers.
- **Agent** (`src/agent.ts`): system prompt + recent history + top memories → Nemotron chooses tools (up to 6 rounds) →
  answer in the user's language.
- **Missions engine**: Nemotron returns a JSON plan → each step runs its own tool loop and sees earlier results (including
  which tools already ran, so it doesn't redo work) → Nemotron writes a Markdown report. Events stream to the UI over IPC;
  missions are stored in SQLite; rate limits pause and resume instead of failing.
- **Local stack**: better-sqlite3 for memories/chats/calendar/missions; `@xenova/transformers` for MiniLM embeddings and
  Whisper speech-to-text, both on-device (ONNX).
- **Tavily** for web research with a per-request budget (2 per chat message, 8 per mission) and a 10-minute cache.

## Challenges we ran into
- **Free-tier rate limits during long missions** — a mission makes many Nemotron calls in a row. We added backoff
  retries and a visible "pause and resume" so a mission survives a 429 instead of dying halfway.
- **Agents repeating work** — Nemotron sometimes finished step 3's job during step 2. Feeding each step the list of tools
  already run fixed duplicate calendar events.
- **Hinglish speech** — Whisper's auto-detect turns mixed Hindi-English into Devanagari; a "Hinglish" mode keeps it in
  readable Roman letters.
- **Safety on a real file system** — every path is resolved and checked; system folders are refused, overwrites need
  explicit permission and deletes go to the Recycle Bin.

## Accomplishments that we're proud of
- Missions that genuinely *do* things: in testing, Nemotron 3 Ultra planned an exam schedule, saved a study-plan file and
  created two calendar events by itself.
- Voice recognition that works without sending audio anywhere.
- Answers in the user's own language — Kannada in, Kannada out.

## What we learned
- Nemotron 3 Ultra is strong at planning and tool use when each step gets a tight, specific prompt.
- Long-running agents need visible progress and graceful recovery more than they need speed.
- Local-first and cloud-model can coexist: keep the *memory* on the device, send only what the model needs.

## What's next
- Streaming responses and faster Nemotron variants for quick chats (Ultra for Missions).
- Scheduled / recurring Missions (e.g. a daily morning brief).
- NVIDIA speech models for voice, and macOS/Linux builds.

## Built with
nvidia-nemotron, nebius-token-factory, electron, react, typescript, vite, esbuild, sqlite, better-sqlite3,
transformers.js, whisper, tavily, node.js

## Try it out
- GitHub: https://github.com/nagesh-code1/humatron
- Run: `npm install && npm start`, then paste a Nebius Token Factory key in Settings.

## Video
YouTube link (unlisted is fine), under 3 minutes — see `DEMO_SCRIPT.md`.
