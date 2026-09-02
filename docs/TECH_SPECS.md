# Aloy — Technical Specifications & Architecture Reference

**Version:** 2.0.0  
**Status:** Active Production  
**Last Updated:** August 2026  
**Maintainer:** Aloy Open Source Team  

---

## 1. System Overview

Aloy is a 100% locally hosted, multi-agent AI assistant, personal dashboard, and home orchestration platform. It operates with zero mandatory cloud dependencies for standard conversations, home automation, media control, financial management, and system telemetry.

```
                               ┌─────────────────────────────────────────────────────────┐
                               │                    ALOY MONOREPO                        │
                               └────────────────────────────┬────────────────────────────┘
                                                            │
                 ┌──────────────────────────────────────────┴──────────────────────────────────────────┐
                 ▼                                                                                     ▼
  ┌─────────────────────────────────────────┐                                           ┌─────────────────────────────────────────┐
  │         apps/desktop (Electron)         │                                           │           apps/mobile (React Native)    │
  ├─────────────────────────────────────────┤                                           ├─────────────────────────────────────────┤
  │ • React 19 + Vite 8 + Framer Motion     │                                           │ • React Native 0.86                     │
  │ • Express Backend Server (:7890)        │                                           │ • Direct Tailscale LAN API Bridge       │
  │ • MCP Bridge, SSH Engine, SQLite/Store  │                                           │ • Native Gesture Drawers & Haptics      │
  │ • Multi-Agent Council & Media Cast Hub  │                                           │ • Standalone Offline Assets Bundle      │
  └─────────────────────────────────────────┘                                           └─────────────────────────────────────────┘
```

---

## 2. Network Topology & Port Registry

### 2.1 Host Infrastructure

| Port | Protocol | Service | Description | Module |
| :--- | :---: | :--- | :--- | :--- |
| **7890** | HTTP / WS | **Aloy Core Server** | Central REST API, SSE streaming, Auth & WebSockets | `apps/desktop/server/aloyServer.cjs` |
| **11434**| HTTP | **Ollama LLM Engine** | Local inference (`aloy-assistant`, `qwen2.5-coder`, `llama3.2`) | External process / GPU |
| **8096** | HTTP / WS | **Jellyfin Media Server** | Media catalog, transcoding, remote session control | `jellyfinService.cjs` client |
| **8123** | HTTP / WS | **Home Assistant** | Smart home device states, automations, entities | `homeassistant.js` client |
| **8890** | HTTP | **Faster-Whisper STT** | Local GPU speech-to-text transcription sidecar | `whisper_server.py` (Waitress) |
| **8891** | HTTP | **Kokoro-82M TTS** | High-fidelity neural voice synthesis sidecar | `kokoro_server.py` |
| **8892** | HTTP | **Scrapling News Scraper** | Stealth headless tech news extraction sidecar | `news_scraper_server.py` |
| **8765** | HTTP / WS | **Mindwalk Visualizer** | 3D Session, knowledge, and codebase graph visualizer | `mindwalkAdapter.cjs` |
| **5173** | HTTP | **Vite Dev Server** | Standalone desktop renderer hot-reload server | `vite.config.js` |

### 2.2 Remote Target Nodes

| Host IP | Machine Name | OS / Platform | Access Protocol | Capabilities |
| :--- | :--- | :--- | :---: | :--- |
| `192.168.1.100` | **Host PC** | Windows 11 Pro | Local IPC / Port 7890 | Master Aloy Server, GPU Inference, Media Server |
| `192.168.1.111` | **Bazzite Station** | Fedora / Bazzite 44 | SSH (Port 22) / MPV | Gaming PC, Wayland Display, Jellyfin Flatpak, MPV |
| `192.168.1.106` | **Linux Media Node**| Ubuntu LTS | SSH (Port 22) / MPV | Headless Server, Storage Node, Stream Player |
| `192.168.1.x`   | **Smart TV** | Android TV / Cast | Cast / Jellyfin API | 4K HDR Display, Jellyfin TV Client |
| Tailnet / LAN   | **Mobile Client** | Android / iOS | Tailscale / HTTP 7890 | Aloy Mobile Client, Companion App Notifications |

---

## 3. Core Architecture & Subsystems

### 3.1 Data Store & Single Source of Truth (`store.cjs`)
* **Physical Store:** `%USERPROFILE%\.aloy-server\store.json`
* **Desktop Path:** Read/written through Electron IPC channels (`store:get`, `store:save`) mapped to `store.cjs`.
* **Mobile/API Path:** Read/written through authenticated Express endpoints (`GET /api/store/:key`, `POST /api/store/:key`).
* **Managed Domains:**
  ```typescript
  interface AloyStore {
    chats: ChatThread[];
    transactions: TransactionEntry[];
    budgets: BudgetEntry[];
    reminders: ReminderItem[];
    memories: UserMemory[];
    trackedProjects: TrackedProject[];
    vaultDir: string;
    userProfile: UserProfile;
    claudeEscalations: EscalationRecord[];
    workouts: WorkoutEntry[];
    newsArticles: NewsArticle[];
    jobListings: JobListing[];
    installedSkills: SkillPackage[];
  }
  ```

### 3.2 Authentication & Security Guard (`auth.cjs` & `securityGuard.cjs`)
* **Bearer Token Security:** Every `/api/*` endpoint is protected by `requireAuth` checking `Authorization: Bearer <token>` or query token parameters.
* **Token Storage:** `%USERPROFILE%\.aloy-server\auth-token.txt` (auto-generated 256-bit cryptographically secure token).
* **Least-Privilege Path Enforcement:**
  - **Read Roots:** `%USERPROFILE%\Documents`, `%USERPROFILE%\.aloy-server`.
  - **Write Roots:** `%USERPROFILE%\Documents\Vault Notes`, `%USERPROFILE%\.aloy-server`.
* **2FA Smart Home Gates:** High-risk actions (unlocking exterior deadbolts, disabling security systems) require PIN verification.

---

## 4. Universal Media Dispatcher Specification

### 4.1 Dispatch Routing Matrix

```
                                  ┌─────────────────────────────┐
                                  │      dispatchMedia()        │
                                  └──────────────┬──────────────┘
                                                 │
            ┌──────────────────┬─────────────────┼─────────────────┬──────────────────┐
            ▼                  ▼                 ▼                 ▼                  ▼
     ┌──────────────┐   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   ┌──────────────┐
     │ target: local│   │ machine:bazz │  │ machine:lenny│  │jellyfin:<id> │   │ target: all  │
     ├──────────────┤   ├──────────────┤  ├──────────────┤  ├──────────────┤   ├──────────────┤
     │ Windows      │   │ SSH → Wayland│  │ SSH → X11/MPV│  │ WS PlayMedia │   │ Promise.all  │
     │ Native Exec  │   │ mpv / Flatpak│  │ Stream URL   │  │ to Client    │   │ Parallel Cast│
     └──────────────┘   └──────────────┘  └──────────────┘  └──────────────┘   └──────────────┘
```

### 4.2 HTTP Range Streaming (`GET /api/media/stream`)
* **Endpoint:** `http://<server-ip>:7890/api/media/stream?file=<encoded_path>`
* **Status Code:** `206 Partial Content` (Supports `bytes=start-end` HTTP Range headers).
* **MIME Support:** `.mp4` (`video/mp4`), `.mkv` (`video/x-matroska`), `.avi` (`video/x-msvideo`), `.m4v`.
* **Network Exemption:** Exempt from Bearer token validation to allow hardware video players, MPV, VLC, and Smart TVs on the LAN to stream without custom header injection.

### 4.3 Multi-Room Simultaneous Broadcast (`targetId: 'all'`)
* Aggregates all online destinations dynamically (`listPlaybackTargets()`).
* Executes parallel asynchronous dispatches with `Promise.allSettled`.
* Collects individual success/failure receipts and reports unified status metrics back to caller.

---

## 5. ADK Multi-Agent Council & Orchestration

The Pantheon Multi-Agent Council divides operational responsibilities among specialized persona engines:

```
                               ┌─────────────────────────────────────────────────────────┐
                               │                    ALOY (PRIME AGENT)                   │
                               │  Executive Assistant, User Router & Conversational Hub  │
                               └────────────────────────────┬────────────────────────────┘
                                                            │
                 ┌──────────────────┬───────────────────────┼───────────────────────┬──────────────────┐
                 ▼                  ▼                       ▼                       ▼                  ▼
  ┌─────────────────────────┐┌─────────────────────────┐┌─────────────────────────┐┌─────────────────────────┐┌─────────────────────────┐
  │  ATHENA (RESEARCH)      ││  HEPHAESTUS (FORGE)     ││  HERMES (FINANCES)      ││  APOLLO (MEMORY/LOGS)   ││  MINERVA (HEALTH/SEC)   │
  ├─────────────────────────┤├─────────────────────────┤├─────────────────────────┤├─────────────────────────┤├─────────────────────────┤
  │ Autonomous deep-dive    ││ Code generation, git    ││ Stock portfolio, budget ││ GraphRAG memory bank,   ││ Watchdog health scans,   │
  │ web research, dossiers  ││ workflows, AST diffs,   ││ tracking, expense log,  ││ Obsidian vault sync,    ││ 2FA lock verification,  │
  │ and synthesis reports.  ││ local build monitors.   ││ and market analytics.   ││ escalation logging.     ││ vision anomaly alerts.  │
  └─────────────────────────┘└─────────────────────────┘└─────────────────────────┘└─────────────────────────┘└─────────────────────────┘
```

### 5.1 Orchestration Protocols (`adkOrchestrator.cjs`)
1. **Sequential Pipeline (`SequentialPipeline`):** Step-by-step linear execution where the output of Agent $N$ becomes context for Agent $N+1$.
2. **Parallel Dispatch (`ParallelDispatch`):** Concurrent task execution across multiple agents with consolidated response aggregation.
3. **Agent Handoff Manager (`AgentHandoffManager`):** Dynamic conversation transfer when specialized domain intervention is required.

---

## 6. REST API Endpoint Reference

| Route | Method | Auth | Description |
| :--- | :---: | :---: | :--- |
| `/api/health` | `GET` | Bearer | Basic server health check |
| `/api/media/targets` | `GET` | Bearer | Discover all online PCs, TVs, and Jellyfin sessions |
| `/api/media/library` | `GET` | Bearer | Search movies (`P:\Movies`) and TV shows (`P:\TV Shows`) |
| `/api/media/dispatch` | `POST` | Bearer | Launch media on single target or broadcast to all |
| `/api/media/stream` | `GET` | Public | HTTP Range 206 chunked video streaming |
| `/api/jellyfin/status` | `GET` | Bearer | Live status of Jellyfin media server |
| `/api/jellyfin/sessions` | `GET` | Bearer | Active Jellyfin client sessions & playback state |
| `/api/jellyfin/events` | `GET` | Bearer (Query) | Server-Sent Events (SSE) stream for instant playback updates |
| `/api/bazzite/exec` | `POST` | Bearer | Execute command on Bazzite Gaming Station via SSH |
| `/api/voice/tts` | `POST` | Bearer | Synthesize audio buffer via Kokoro-82M TTS |
| `/api/voice/transcribe` | `POST` | Bearer | Transcribe audio stream via Faster-Whisper GPU |
| `/api/news/articles` | `GET` | Bearer | Fetch categorized tech news scraped by Scrapling |
| `/api/jobs/listings` | `GET` | Bearer | Scraped LinkedIn / tech job radar listings |
