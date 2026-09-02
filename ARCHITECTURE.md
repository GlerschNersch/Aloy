# Aloy — architecture reference

Present-tense reference: what Aloy is today.
- For complete low-level REST APIs, protocols, and multi-agent contracts, see [docs/TECH_SPECS.md](./docs/TECH_SPECS.md).
- For design tokens, visual hierarchy, Framer Motion springs, and mobile interaction guidelines, see [docs/UX_SPECS.md](./docs/UX_SPECS.md).
- For terminology, see [CONTEXT.md](./CONTEXT.md). For why it got this way and what's designed-but-unbuilt, see [DECISIONS.md](./DECISIONS.md).

## Shape of the monorepo

```
aloy/
├── apps/
│   ├── desktop/   # Electron + React 19 + Vite 8 + framer-motion
│   │   ├── src/               # renderer (Sidebar, ChatArea, DashboardView, modals)
│   │   └── server/            # Express backend, runs inside Electron's main process AND standalone for mobile/API
│   └── mobile/    # React Native 0.86, thin client — no on-device model
├── docs/          # operational notes, research dossiers
└── (root package.json orchestrates both apps' dev/build/test scripts)
```

## Ports

| Port | Service | Module |
| :--- | :--- | :--- |
| 7890 | Aloy Core Server (REST + WebSocket) | `apps/desktop/server/aloyServer.cjs` |
| 8081 | Metro bundler (mobile JS) | react-native tooling |
| 8092 → 8890 | Whisper STT (local GPU faster-whisper) | `whisper_server.py`, served via `waitress` |
| 8892 | News-scraper Python sidecar (Scrapling-based) | `news_scraper_server.py`, orchestrated by `newsScraper.cjs` |
| 8096 | Jellyfin media server | `jellyfinService.cjs` talks to it, doesn't host it |
| 8765 | Mindwalk 3D codebase/session visualizer | `mindwalkAdapter.cjs` |
| 11434 | Ollama (local LLM inference: `aloy-assistant`, `qwen2.5-coder:7b`, etc. — see `server/models.cjs`, the single source of truth for every model ID) | external |

## Data flow: one store, two frontends

`aloyServer.cjs` is the single source of truth. It runs two ways: embedded in Electron's main process (desktop) and standalone (serving mobile + any other API client over Tailscale). Both paths read/write the exact same `store.cjs` functions against `~/.aloy-server/store.json` — desktop's renderer never touches the file directly, it goes through IPC (`store:get`/`store:save` channels in `electron.cjs`) to the same `load()`/`save()` the Express routes use. This means a chat started on the phone is immediately visible on desktop and vice versa. Shared domains as of 2026-08-23: `chats`, `transactions`, `budgets`, `reminders`, `memories`, `trackedProjects`, `vaultDir`, `userProfile`, `claudeEscalations`, `workouts` (`electron.cjs`'s `ALLOWED_STORE_KEYS`).

Initial hydration on desktop is one async IPC round trip, gated by a `hasHydratedSharedStoreRef` so an empty initial React state can't race ahead and overwrite real data before the real store loads. A bare `vite dev` (no Electron) falls back to a localStorage-only path via an `IS_ELECTRON` check — useful for pure-UI verification without needing the Electron shell, and how UI changes in this session were checked without disturbing a live server.

**Gotcha, found 2026-08-23**: the real IPC method is `window.electronAPI.storeSave(key, value)` — `storeSet` does not exist. `SubAgentsHub.jsx` had `window.electronAPI?.storeSet(...)` in five places, which the optional-chaining guard silently no-op'd on every call while local React state and a success toast both still fired, making broken persistence look like it worked. Fixed, but worth grep'ing for `storeSet` before assuming any *other* new persistence code copied from that file is correct.

## MCP tool integration

`mcpClient.cjs` spawns stdio MCP servers listed in `mcp-servers.json` (gitignored; `mcp-servers.example.json` tracked). Both desktop and the mobile/API server register the same tool defs into their own separate `tools.js` module instance — desktop's renderer calls through an IPC bridge, the server calls `callMcpTool` directly (same process, no IPC). Configured servers: `filesystem` (scoped to user documents directory), `fetch` (`uvx mcp-server-fetch`, pinned below `mcp 2.0.0` — the unpinned dependency resolves to a breaking release otherwise), `git` (`uvx mcp-server-git`, same pin, no fixed repo — takes `repo_path` per call). **Every MCP tool call requires user confirmation, no exceptions** — this is a hard rule, not a default.

## Security enforcement path

`securityGuard.cjs` is the single enforcement point: least-privilege path allowlists (separate read/write root lists — write access is much narrower, e.g. Hephaestus's own code-staging paths, the Vault, and `~/.aloy-server` itself), 2FA on exterior locks/cameras, and prompt-injection sanitization on untrusted web text. Every module that touches the filesystem, smart-home devices, or untrusted web content is expected to route through it rather than reimplement checks — Minerva's own file header calls this out explicitly for smart-home execution. `auditLogger.cjs` is the shared ledger both securityGuard and Minerva write to.

## Inbox — cross-agent findings feed

`apps/desktop/server/inboxAggregator.cjs` (`getInboxFeed`) merges Apollo (confidence-escalation entries), Athena (completed research tasks), Minerva (`securityGuard`/`auditLogger` blocked-access and injection events), and Hephaestus (Pantheon Council-dispatched work orders still sitting `queued`, shown unconditionally rather than window-gated) into one time-windowed (default 24h), recency-sorted list. Exposed as both `GET /api/inbox/feed` and the Electron IPC channel `inbox:feed` (`window.electronAPI.getInboxFeed`), so it works identically whether the renderer takes the IPC path (real app) or a direct HTTP fetch (bare `vite` dev mode) — see `InboxView.jsx`'s IPC-first, HTTP-fallback pattern, matching `AthenaWorkspace.jsx`. Vision-timeline notable events and lock-unlock history are merged in client-side in `InboxView.jsx` rather than server-side, since both are already fetched/tracked there — desktop-only for now; see DECISIONS.md for why mobile parity is a deliberate follow-up, not an oversight.

## Animation conventions (both platforms)

**Desktop** (framer-motion): every real floating modal/drawer uses `AnimatePresence` wrapping `{isOpen && (<motion.div ...>)}`, with `transition={{ type: 'spring', damping: 25, stiffness: 220 or 300 }}`. The dark backdrop behind a modal is a plain (non-animated) element — it's a hard on/off gated by the same conditional, not itself fading; only the panel content springs.

**Mobile** (React Native `Animated`, no third-party animation library): the one custom-animated surface is the Threads drawer, driven by `Animated.spring` with explicit `restSpeedThreshold`/`restDisplacementThreshold` (loosened from RN's very tight `0.001` defaults — see [DECISIONS.md](./DECISIONS.md) for why this matters). Every other overlay uses React Native's built-in `<Modal animationType="slide"|"fade">`, which needs no such handling since the native `visible` prop drives it directly.

**Common pitfall in both**: if a component's dark/dismissed state is gated by an early return *before* the code that plays the exit animation (React early-`return null`, or a spring's `.onRest` callback with too-tight thresholds), the visible content can finish looking done well before the state that actually removes it flips — read as "stuck" or "instant" depending on direction. Both platforms have hit a version of this bug; see DECISIONS.md.

## Dev workflow

### Desktop
- From the monorepo root: `npm run dev` (server + Vite), `npm run electron:dev`, `npm test`.
- From `apps/desktop` directly: `npx vite --port 5173 --strictPort` runs the renderer alone against whatever's already on 7890 — the fast path for pure UI verification.
- **Packaged Desktop App Updates**: The user's live daily desktop app runs from `%LOCALAPPDATA%\Programs\Aloy\resources\app.asar`. Whenever modifying renderer (`src/`) or server (`server/`) files for the live desktop app, **always run `npm run pack:asar`** (runs `vite build && node scripts/packApp.cjs` to compile `dist/` and hot-deploy `app.asar`). Press `Ctrl+R` in the desktop window or restart the app to load the new bundle.

### Mobile
- The RN CLI's `run-android` does not work directly in this environment (spawn can't resolve `gradlew.bat`/`adb`).
- **Standalone Android JS Bundling Requirement**: The physical OnePlus 15 runs standalone builds with no Metro hot-reload. Gradle packages whatever pre-compiled bundle is in `android/app/src/main/assets/index.android.bundle`. **Whenever editing React Native code (`App.tsx` or `src/`), ALWAYS re-bundle before installing:**
  1. `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output android/app/src/main/assets/index.android.bundle --assets-dest android/app/src/main/res`
  2. `cd android && .\gradlew.bat installDebug` (or `app:installRelease`)
  3. Relaunch via `adb shell am force-stop com.aloymobile && adb shell am start -n com.aloymobile/.MainActivity`
  4. Always verify with an actual screenshot (`adb shell screencap -p /sdcard/screen.png`), never assume from a successful build alone.
- **Widget Bootloader Rule**: Any new widget or poller in `apps/mobile/App.tsx` MUST be called in the initial `AsyncStorage` startup `useEffect` with `(url, token)` overrides (e.g. `refreshJellyfin(url, token)`). Otherwise, the widget initializes with empty default state and fails to display on initial boot.
