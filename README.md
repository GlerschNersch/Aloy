# 🛡️ Aloy Monorepo

> **Aloy**: A 100% local, autonomous personal AI assistant ecosystem designed for desktop, mobile, and ambient computing.

For the full picture beyond this overview: [CONTEXT.md](./CONTEXT.md) (glossary), [ARCHITECTURE.md](./ARCHITECTURE.md) (present-tense reference), [DECISIONS.md](./DECISIONS.md) (why, incidents, roadmap).

---

## 🏛️ Architecture Overview

```text
aloy/
├── apps/
│   ├── desktop/          # Electron + React + Node.js backend (aloyServer.cjs, Athena, Hephaestus)
│   └── mobile/           # React Native (Android/iOS) + Command Center Hub & Bento UI
├── docs/                 # Operational notes, SNES AI training guides, research dossiers
├── package.json          # Monorepo root workspace scripts
└── README.md
```

### Subsystems

1. **🖥️ Desktop App & Core Server (`apps/desktop`)**:
   * **Electron Frontend**: React + Tailwind/Vanilla CSS desktop interface.
   * **Backend API (`apps/desktop/server/aloyServer.cjs`)**: Express server listening on port **`7890`** (reached over Tailscale & USB).
   * **Athena Engine (`athena.cjs`)**: Autonomous deep research scout producing structured markdown dossiers.
   * **Hephaestus Engine (`hephaestus.cjs`)**: Autonomous coding agent with AST patching, QLoRA buffer pairs, and rollback snapshots.
   * **Mindwalk 3D Bridge (`mindwalkAdapter.cjs`)**: 3D codebase visualizer & session replay adapter.

2. **📱 Mobile App (`apps/mobile`)**:
   * **React Native Client**: Thin client talking to `http://<server-ip>:7890` (LAN / Tailscale) or `http://127.0.0.1:7890` (USB).
   * **Command Center Hub**: Live status ticker, 2×2 Home & Security Bento Grid, Upcoming Schedule, and Autonomous Studio Portals.

3. **💾 Canonical State (`~/.aloy-server/`)**:
   * Global state store (`store.json`), auth tokens, Athena dossiers (`athena-tasks.json`), Hephaestus work orders, and rollback snapshots.

---

## 🚀 Quick Start Commands

From the monorepo root:

```bash
# Start backend server + Vite desktop dev
npm run dev

# Start backend server only (port 7890)
npm run dev:server

# Launch desktop app with Electron
npm run electron:dev

# Start React Native Metro bundler for mobile (port 8081)
npm run dev:mobile

# Build and run Android app on connected device
npm run android

# Run all unit tests
npm test
```

---

## 🌐 Port Allocations

| Port | Service | Description |
| :---: | :--- | :--- |
| **7890** | Aloy Core Server | Main REST & WebSocket backend API (`aloyServer.cjs`) |
| **8081** | Metro Bundler | React Native JS bundler for Aloy Mobile |
| **8765** | Mindwalk 3D Visualizer | 3D Codebase Citymap & Agent Session Replay (`mindwalk.exe`) |
| **8890** | Whisper STT Server | Local GPU faster-whisper speech-to-text |
| **11434** | Ollama Engine | Local LLM inference (`aloy-assistant`, `qwen2.5-coder:14b`, `gemma4:12b`) |
