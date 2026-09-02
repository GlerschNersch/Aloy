# Aloy — glossary

Vocabulary settled while working on Aloy. Pure vocabulary — no spec, no implementation detail beyond what a term needs to be unambiguous. See [ARCHITECTURE.md](./ARCHITECTURE.md) for how these pieces fit together, and [DECISIONS.md](./DECISIONS.md) for why they exist and what's still unbuilt.

## The Pantheon

Aloy's backend capabilities are organized under five named sub-agents plus a council, each with its own accent color and nav entry in both the desktop sidebar (`apps/desktop/src/components/Sidebar.jsx`) and the mobile Threads drawer (`apps/mobile/App.tsx`). The names are a UI/product framing layer over the underlying server modules in `apps/desktop/server/` — the module filename and the persona name usually match directly.

- **Hephaestus** ("Heph") — the code-forge persona. Covers autonomous coding: AST patching, QLoRA training-pair capture, rollback snapshots. Backed by `hephaestus.cjs` (the agent itself) and `hephReviewer.cjs` (the Claude/Gemini-based reviewer that verifies Hephaestus's own output and captures critique/correction pairs for distillation training). **The Cauldron** is the UI name for Hephaestus's project/task workspace (`activeView === 'cauldron'`).
- **Athena** ("Scout") — deep research and dossier-writing. Backed by `athena.cjs` and `research.cjs` (the actual research pipeline behind the `research_topic`/`save_researched_knowledge` chat tools). Athena's dossiers are the source for a lot of the "harvested from X" modules below.
- **Apollo** ("Vault") — memory, skills, and user-profile gardening. Backed by `apollo.cjs`. The **Vault** itself is the Obsidian-notes export target (`vaultSync.cjs`), distinct from the in-app Memory Modal.
- **Minerva** ("Sentinel") — smart-home control and reliability watchdog. Backed by `minerva.cjs`. Minerva is a *consumer* of `securityGuard.cjs`'s enforcement (see Security layer below), not a competing security system — its own file header says smart-home executions must route through `/api/smarthome/execute` specifically to get securityGuard's validation and 2FA.
- **Hermes** ("Brief") — operations, logistics, and the daily briefing. Backed by `hermes.cjs`: morning briefing synthesis, transaction categorization, budget-threshold monitoring, schedule/task organizing. `jobRadar.cjs` (career/job-posting scanning) and `stockTracker.cjs` (portfolio quotes) both feed into Hermes's briefings rather than standing alone.
- **Pantheon Council** — the weekly strategic conclave. Backed by `conclave.cjs`, which orchestrates all five other sub-agents to jointly evaluate system health, skill gaps, code backlog, and user friction. `activeView === 'conclave'`.

## Security & trust layer

Four distinct modules, easy to conflate:

- **`securityGuard.cjs`** — the actual enforcement mechanism: least-privilege path allowlisting (separate read vs. write root lists), 2FA requirement on exterior locks/cameras, prompt-injection sanitization on untrusted web text, and the interface into audit logging. Other modules (Minerva, Hephaestus's file-write staging) call into this; it doesn't do anything on its own initiative.
- **`auditLogger.cjs`** — the underlying ledger (`~/.aloy-server/audit.log.jsonl`) that securityGuard and Minerva both write security-sensitive events to.
- **`sensitiveContent.cjs`** — unrelated to filesystem/smart-home security. A narrow, dependency-free guard specifically against auto-*learning* (researching + permanently saving into `learnedKnowledge`, which gets injected into every future prompt) content that contains real secrets or PII.
- **`rollbackManager.cjs`** — a reversible-action stack for the Planner/agentic execution path (tracks inverse operations and prior-state snapshots), not a security boundary itself — a safety net for the Planner's own mistakes, not for malicious input.

## Skills — two different systems with the same word

- **Skill synthesis** (`skillSynthesis.cjs`) — mines *repeated tool-call sequences* into new reusable skills (a KiroCrew-inspired pattern, packaged HKUDS/CLI-Anything-style as `SKILL.md` cards). This is about *creating* new capabilities from observed usage.
- **Skills Dashboard** (`skillsDashboard.cjs`, UI: `SkillsDashboard.jsx`) — aggregates `claudeEscalations` (gaps: questions the local model needed Claude's help on) and `learnedKnowledge` (confirmed: topics actively researched and saved) by topic category into a proficiency view. This is about *measuring* existing capability, not creating it.

## Data & storage

- **`~/.aloy-server/`** — canonical data home for the whole ecosystem (both desktop and mobile talk to the same store, since mobile is a thin client). Contains `store.json` (the shared store — see below), `auth-token.txt` (bearer token for API auth), `.env` (external credentials, loaded by several modules independently of the app's own `.env`), `audit.log.jsonl`, and per-module training/cache subdirectories (`training/` for confidenceEscalation/hephReviewer/evalHarness).
- **The shared store** (`store.cjs`) — one JSON file, one set of domains, read/written identically whether the request came from the desktop Electron IPC bridge or the mobile/API Express routes. Domains: `chats`, `transactions`, `budgets`, `reminders`, `memories`, `trackedProjects`, `vaultDir`, `userProfile`, `claudeEscalations`. `seededFromBackup` is a persistent one-time flag (not a data domain) guarding the NAS-backup reseed path — see [[DECISIONS.md]] for the incident that made this necessary.
- **learnedKnowledge** — Athena's confirmed research findings, injected into future prompts as context. Distinct from `memories` (personal facts about the user) and from `claudeEscalations` (gaps, not confirmed knowledge).
- **GraphRAG** (`graphRAG.cjs`) — the unifying world model: connects Obsidian vault notes, Home Assistant topology, calendar events, and the P:\ filesystem media library into one queryable graph. Separate from the Vault (which is an export *target*, not a query engine) and from `knowledgeRetrieval.cjs` (which does hybrid embedding+keyword scoring with age-decay, feeding relevance into `learnedKnowledge` lookups specifically, not the whole graph).

## Model IDs

`server/models.cjs` (`MODELS`) is the single source of truth for every model ID (local Ollama and cloud), each overridable via env var. Any other file hardcoding a model ID string is drift waiting to happen — `modelRouter.cjs` did exactly this until 2026-08-23 (see DECISIONS.md). New code referencing a model should import `MODELS` from `models.cjs`, never write the string directly.

## Workouts

The workout log (`src/services/workouts.js`, `workouts` store domain, surfaced in Hermes's "🏋️ Fitness" tab in `SubAgentsHub.jsx`) — a session log (date, logged exercises with sets/reps/weight, notes), harvested from norrdev/OpenGym's data model but deliberately not their full program-builder/exercise-catalog/muscle-mapping system. Streak = consecutive calendar days with at least one logged workout.

The Fitness tab also shows a separate "Upcoming from your calendar" section — keyword-matched (`isWorkoutEvent`) Google Calendar events, self-fetched the same way `DashboardView.jsx` does. This is *scheduled*, not *logged* — it never feeds the streak. `NON_WORKOUT_KEYWORDS` excludes meal/nutrition-timing reminders that would otherwise false-positive on the substring "workout" (e.g. "Pre-Workout Snack").

## Inbox

The cross-agent findings feed (`InboxView.jsx`, `inboxAggregator.cjs`) — not itself a Pantheon agent, so it's styled with Aloy's own brand cyan rather than an agent color in the nav. Groups items by agent (Apollo/Athena/Minerva) within a rolling 24h window, ambient (no dismiss/resolved state), strict recency ordering. Distinct from the "System" status row (which is health counters, not a findings list) and from any single agent's own detail view.

## "Harvested from X"

A recurring, deliberate pattern in this codebase: several modules are explicitly ported ideas from other open-source projects, named in their own header comments — `mineruNormalizer.cjs` (OpenDataLab/MinerU), `vaultSync.cjs` (memU's 3-layer Markdown memory), `cliHubRunner.cjs` and `toolEnvelope.cjs` (HKUDS/CLI-Anything), `skillSynthesis.cjs` (KiroCrew), `mindwalkAdapter.cjs` (cosmtrek/mindwalk), and `rufloFederation.cjs`, `sparcLifecycle.cjs`, `agentArena.cjs` (ruvnet/ruflo). This is the same workflow as this session's animejs/PostHog/mattpocock-skills exploration — not a one-off.

## Sub-agent naming vs. UI `activeView`

The Pantheon names are product framing; the actual React state driving the desktop UI is `activeView`, with values like `'conclave'`, `'hephaestus'`/`'cauldron'`/`'projects'`, `'athena'`, `'apollo'`/`'memory'`/`'profile'`/`'skills'`, `'minerva'`, `'hermes'`, `'dashboard'`, `'chat'`. Some sub-agents map to more than one `activeView` value because they cover more than one full-page surface (e.g. Apollo covers memory, profile, and skills as separate pages).

## Client/session terms

- **Thin client** — AloyMobile has no on-device model; it's a pure client to the same backend/store as desktop, reached over Tailscale (deliberate architecture choice, not a stopgap).
- **Connected clients** — the desktop sidebar's "System" status row shows a live count from `clientTracker.cjs`, which has no real persistent-connection concept — every request is stateless; "connected" means "made a request within the active window."
- **Gaming Mode** — a desktop-only pause toggle that stops background polling/webcam use and frees loaded-model VRAM for a concurrently running game.
- **Confidence escalation** — the background check that runs after every local-model turn; if judged low-confidence, escalates to `claude-opus-5` for a corrected follow-up message, badged "⚡ Answered via Claude" in the UI. Distinct from Skill synthesis and from the Skills Dashboard, though its output (`claudeEscalations`) feeds the latter.
