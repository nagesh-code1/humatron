# Demo Video Plan — Humatron (≤ 3 minutes)

**Target length:** 2:45  
**Format:** 1080p screen capture + voiceover  
**Record from source** (`npm start`) to avoid SmartScreen blocks

---

## Shot List

| Time | Scene | Action / Narration |
|------|-------|-------------------|
| **0:00–0:10** | **Cold open** | Black screen → "Humatron" logo fade in. Voice: "Humatron. Local-first AI. Nemotron reasoning. Your data, your machine." |
| **0:10–0:20** | **Launch & Hotkey** | Desktop recording. Press **Alt+Space** → Humatron slides in from tray. Show frameless window, custom titlebar, sea-blue accent. "Alt+Space summons it. Hides to tray on close. Auto-starts on login." |
| **0:20–0:40** | **Settings — Add Nebius Key** | Click **Settings** tab. Paste API key (masked). Click **Save & test connection** → green checkmark. Model badge shows resolved Nemotron model (e.g., `nvidia/nemotron-3-ultra`). "Nebius Token Factory or AI Studio — auto-detects Nemotron Ultra or Super from your account." |
| **0:40–1:10** | **Chat — Tool Use (Remember)** | Switch to **Chat**. Type: `"Remember: I take my coffee black, no sugar."` → Send. Model replies with confirmation. Chip appears: "💾 Remembered". "The agent calls `remember` automatically when you share a lasting fact." |
| **1:10–1:30** | **Chat — Tool Use (Add Event)** | Type: `"Add a calendar event for tomorrow 10am: team standup."` → Send. Model confirms. Toast notification appears. "Tool calls: `add_event` → native desktop notification + Calendar tab." |
| **1:30–1:50** | **Calendar Tab** | Click **Calendar** tab. Show month view with "team standup" on tomorrow's date. Click day → event detail. "All events stored locally in SQLite." |
| **1:50–2:10** | **Restart App (Persistence Proof)** | Close Humatron (tray → Quit). Press **Alt+Space** again → app opens. Go to **Chat**. Type: `"How do I take my coffee?"` → Send. Model: `"You take it black, no sugar."` with 💾 recall chip. "Restarted. Memory persists. Semantic search via local MiniLM embeddings." |
| **2:10–2:30** | **Memory Tab — Vector Search** | Click **Memory** tab. Search box: type `"coffee"` → results show the remembered fact with similarity score. Type `"standup"` → calendar event appears. "Every conversation, every tool result — embedded, indexed, searchable." |
| **2:30–2:45** | **Closing** | Wide shot of all 5 tabs (Chat, Memory, Calendar, Settings, tray). Text overlay: **Humatron • Local-first • Nemotron via Nebius • MIT License**. Voice: "Built for the NVIDIA × Nebius Hackathon. Your AI. Your machine. Your rules." Fade to black. |

---

## Technical Notes for Recording

- **Resolution:** 1920×1080 (app window ~1200×800, centered)
- **Frame rate:** 30 fps
- **Audio:** 44.1 kHz mono, voiceover recorded separately, synced in post
- **Mask API key** in Settings (blur or replace with `sk-****`)
- **No mouse trails** — clean clicks
- **Speed up** any loading spinners in post (cut to result)

---

## Post-Production Checklist

- [ ] Trim to ≤ 3:00
- [ ] Add timestamp labels (optional, lower-third)
- [ ] Background music: low, ambient, sea-blue vibe
- [ ] Export: H.264, 8 Mbps, `.mp4`
- [ ] Thumbnail: Humatron logo + "Alt+Space" text
- [ ] Upload to YouTube (unlisted) + Devpost video field

---

## Backup Plan (If Time Runs Short)

Cut in order:
1. Calendar tab detail (keep toast notification)
2. Model badge close-up
3. Settings tab full walkthrough (keep key entry + test connection)
4. Memory tab search demo (keep restart + recall proof)