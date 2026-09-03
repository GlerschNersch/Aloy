import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import AmbientCapsule from './components/AmbientCapsule';
import ContextCanvas from './components/ContextCanvas';
import PersonaModal, { PRESET_PERSONAS } from './components/PersonaModal';
import LockScreen from './components/LockScreen';
import HudOverlay from './components/HudOverlay';
import { fetchModels, checkOllamaHealth, streamChat, unloadModel } from './services/ollama';

import {
  fetchHomeAssistantStates,
  fetchGoogleCalendarEvents,
  executeHAService,
  groupEntitiesByCategory,
  calculateSmartHomeStats,
  formatSmartHomeContext,
  fetchLLMVisionTimeline,
  summarizeLLMVisionActivity,
  // Used by the wearable-health context injection below. Both are exported by
  // homeassistant.js and imported correctly by tools.js, but were never added
  // here — so every health-keyword prompt threw ReferenceError inside a
  // try/catch and silently injected no telemetry at all.
  fetchHealthData,
  formatHealthContext
} from './services/homeassistant';
import { searchWeb } from './services/websearch';
import { DocumentKnowledgeBase } from './services/rag';
import { fetchPCTelemetry, fetchDesktopScreenshot } from './services/systemmonitor';
import { fetchProjectStatus, formatProjectStatusContext, parseProjectStatusSummary } from './services/projectMonitor';
import { calculateBudgetStatus, formatFinanceContext } from './services/financeTracker';
import { trimWhitespace, allocateContextBudget, capLinesToBudget, INJECTED_SECTION_WEIGHTS } from './services/contextCompression';

const CONTEXT_SECTION_BUDGETS = allocateContextBudget(INJECTED_SECTION_WEIGHTS);
import { getToolDefinitions, getTool, parseToolArguments, ensureMcpToolsLoaded, getMcpStatus, toolRequiresConfirmation, isWriteTool } from './services/tools';
import { DEFAULT_BACKUP_DIR, writeBackupSnapshot, restoreFromFile } from './services/backup';
import { detectSpendingAnomaly, recordUnlockEvent, detectUnusualUnlock } from './services/anomalyDetection';
import { createReminder, getPendingReminders, getNewlyDueReminders, formatRemindersContext } from './services/reminders';
import { createWorkoutEntry, calculateWorkoutStreak, formatWorkoutHistoryContext } from './services/workouts';
import { getHomeCoordinates, fetchWeather, formatWeatherContext } from './services/weather';
import { sendDesktopNotification } from './services/notifications';
import { selectVaultFolder, scanVaultNotes, readNoteContent, createNote } from './services/obsidian';
import { apiFetch } from './services/aloyApi.js';

// Code splitting: the heavy view components below are each gated behind an
// `activeView === '...'` check, so none of them are needed to paint the first
// screen — yet all of them were bundled into the single 2.7 MB chunk Vite kept
// warning about, and Electron parsed the whole thing before first paint.
//
// lazyView() wraps React.lazy in its own Suspense boundary at the DEFINITION
// site, so every existing `<DashboardView ... />` in the JSX below is unchanged.
// That keeps this a mechanical import-level change rather than a refactor of
// the render tree.
//
// Deliberately NOT lazy: Sidebar, ChatArea and LockScreen (visible immediately
// — lazying them would just add a flash), HudOverlay (returned before the main
// tree), and PersonaModal (it also exports PRESET_PERSONAS, which is read
// synchronously in a useState initializer; React.lazy only handles default
// exports).
function lazyView(loader) {
  const Inner = lazy(loader);
  return function LazyView(props) {
    return (
      <Suspense fallback={<div style={{ padding: '2rem', opacity: 0.5 }}>Loading…</div>}>
        <Inner {...props} />
      </Suspense>
    );
  };
}

const DashboardView = lazyView(() => import('./components/DashboardView'));
const DevWorkspace = lazyView(() => import('./components/DevWorkspace'));
const AthenaWorkspace = lazyView(() => import('./components/AthenaWorkspace'));
const SubAgentsHub = lazyView(() => import('./components/SubAgentsHub'));
const MemoryModal = lazyView(() => import('./components/MemoryModal'));
const SmartHomeDrawer = lazyView(() => import('./components/SmartHomeDrawer'));
const FinancesPanel = lazyView(() => import('./components/FinancesPanel'));
const ProjectsPanel = lazyView(() => import('./components/ProjectsPanel'));
const SkillsDashboard = lazyView(() => import('./components/SkillsDashboard'));
const InboxView = lazyView(() => import('./components/InboxView'));
const MediaDispatcherPanel = lazyView(() => import('./components/MediaDispatcherPanel'));
const RouteIntelligenceDashboard = lazyView(() => import('./components/RouteIntelligenceDashboard'));
const MediaStackHub = lazyView(() => import('./components/MediaStackHub'));
import CommandPalette from './components/CommandPalette';


const stripImage = (dataUrl) => {
  if (!dataUrl) return null;
  const parts = dataUrl.split(',');
  return parts.length > 1 ? parts[1] : dataUrl;
};

// Plain text.slice(0, 30) made most chat history entries look identical —
// Users routinely open chats with "Good morning! Please ...", so the list
// was mostly duplicate "Good morning! Please..." rows. Stripping the
// greeting first surfaces the part of the message that's actually distinct.
const CHAT_TITLE_MAX_LENGTH = 40;

function deriveChatTitle(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return 'New Conversation';

  const withoutGreeting = trimmed
    .replace(/^(good\s+(morning|afternoon|evening|night)|hey|hi|hello)[,!.\s]+(aloy[,!.\s]+)?/i, '')
    .trim();
  const source = withoutGreeting || trimmed;

  if (source.length <= CHAT_TITLE_MAX_LENGTH) return source;

  const truncated = source.slice(0, CHAT_TITLE_MAX_LENGTH).replace(/\s+\S*$/, '');
  return `${truncated || source.slice(0, CHAT_TITLE_MAX_LENGTH)}…`;
}

// Local (not UTC) date components — toISOString() would shift the date
// across midnight-UTC boundaries (any time after ~5-8pm Pacific is already
// "tomorrow" in UTC), silently corrupting "today".
function localISODate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Computed here (reliable JS date math) rather than left for the model to
// infer from a large multi-day event dump — a quantized local model with
// reasoning disabled (think: false) was observed picking the wrong day
// (e.g. answering "tomorrow" with the day after) when asked to filter a
// 70+ event, 7-day list itself instead of being handed the exact date.
function formatDateAnchor() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekday = (date) => date.toLocaleDateString('en-US', { weekday: 'long' });
  return `[DATE ANCHOR — use these exact values, do not compute "today"/"tomorrow" yourself]: Today is ${localISODate(now)} (${weekday(now)}). Tomorrow is ${localISODate(tomorrow)} (${weekday(tomorrow)}).`;
}

// Flattens stored chat messages into the Ollama API message list. A message
// carrying resolved tool calls expands into the assistant's tool_calls
// message followed by one `role: 'tool'` result message per call — Ollama's
// expected shape, but not how we store it (each call's result lives nested
// on the call itself, one message = one visual "turn").
const buildApiMessages = (messages) => messages.flatMap((m) => {
  if (m.role === 'assistant' && m.toolCalls) {
    const assistantMsg = {
      role: 'assistant',
      content: m.content || '',
      tool_calls: m.toolCalls.map((tc) => ({ function: { name: tc.name, arguments: tc.arguments } }))
    };
    const resultMsgs = m.toolCalls
      .filter((tc) => tc.status !== 'pending')
      .map((tc) => {
        let content = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
        const isError = tc.status === 'error' || (typeof content === 'string' && /\b(error|failed|exception)\b/i.test(content) && !content.includes('[SYSTEM HINT]') && !content.includes('declined'));
        if (isError) {
          content += `\n\n[SYSTEM HINT]: Tool '${tc.name}' encountered an issue. Review the output above and attempt a self-correction with adjusted parameters or an alternative tool if applicable.`;
        }
        return { role: 'tool', content };
      });
    return [assistantMsg, ...resultMsgs];
  }
  return [{
    role: m.role,
    content: m.content,
    ...(m.image ? { images: [stripImage(m.image)] } : {})
  }];
});

const MAX_TOOL_LOOP_DEPTH = 6;

// Domains shared with the mobile/API server (server/store.cjs) — in
// Electron, these are backed by store.json via IPC (single source of truth,
// see electron.cjs's ALLOWED_STORE_KEYS) instead of localStorage, and are
// hydrated once via window.electronAPI.storeGet() rather than read
// synchronously at init. Plain `vite dev` (no Electron) keeps the old
// localStorage-only behavior below so UI-only iteration still works without
// the full Electron+server stack running.
const IS_ELECTRON = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

function initSharedDomain(localStorageKey, defaultValue) {
  if (IS_ELECTRON) return defaultValue; // real value arrives via storeGet() hydration
  const saved = localStorage.getItem(localStorageKey);
  return saved ? JSON.parse(saved) : defaultValue;
}

const DEFAULT_USER_PROFILE = {
  name: 'User',
  style: 'Concise, direct, highly technical, clean code, dark UI aesthetics.',
  instructions: 'Always address requests directly with production-ready code and optimal architecture.',
  checkInsEnabled: true
};

const DEFAULT_MEMORIES = [
  'Runs local Home Assistant for smart home automation.',
  'Connected calendar to Home Assistant.',
  'Uses VS Code, Python, Node.js, and Docker.'
];

const DEFAULT_VAULT_DIR = '';

export default function App() {
  const isHudView = typeof window !== 'undefined' && (
    window.location.search.includes('view=hud') || window.location.hash === '#hud'
  );

  useEffect(() => {
    if (isHudView) {
      document.documentElement.classList.add('hud-mode');
      document.body.classList.add('hud-mode');
      const rootEl = document.getElementById('root');
      if (rootEl) rootEl.classList.add('hud-mode');
    }
  }, [isHudView]);

  if (isHudView) {
    return <HudOverlay />;
  }

  return <MainApp />;
}

// Everything below used to live directly in App(), underneath that early
// return — which put ~86 hooks after a conditional exit and broke the Rules of
// Hooks (86 lint errors, all of them this one cause).
//
// It happened to work because isHudView is derived from window.location, which
// never changes for the lifetime of a window: the HUD window always returns
// early, the main window never does, so hook order stayed consistent WITHIN
// each window. But it is one line away from a hard crash — the check includes
// `window.location.hash === '#hud'`, and a hash can change at runtime without a
// reload. Anything that set location.hash to '#hud' would re-render App with
// isHudView suddenly true, take the early return, and destroy 86 live hooks:
// React throws "Rendered fewer hooks than expected" and the window dies.
//
// Splitting the branch across a component boundary makes that structurally
// impossible. App now has exactly one hook before its conditional return, so
// its hook order is unconditional, and MainApp's hooks only ever run when
// MainApp is actually mounted. No hook moved, none were reordered, and nothing
// below this line changed.
function MainApp() {
  const [isOllamaConnected, setIsOllamaConnected] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('aloy-assistant');

  // Gaming Mode — stops background Ollama/Home Assistant polling and the
  // walk-up webcam, and immediately frees the loaded model's VRAM, so a
  // concurrently running game gets the GPU/CPU headroom back. Chat still
  // works if you deliberately send a message; it just isn't kept "warm."
  const [isPaused, setIsPaused] = useState(() => localStorage.getItem('ollama_pro_paused') === 'true');
  useEffect(() => {
    localStorage.setItem('ollama_pro_paused', String(isPaused));
  }, [isPaused]);
  const handleTogglePause = () => {
    setIsPaused(prev => {
      const next = !prev;
      if (next) unloadModel(selectedModel);
      return next;
    });
  };

  // Personas
  const [currentPersona, setCurrentPersona] = useState(PRESET_PERSONAS[0]);
  const [isPersonaModalOpen, setIsPersonaModalOpen] = useState(false);
  // Custom personas the user built via "Save & Activate Assistant". Icon
  // components can't survive JSON persistence, so only serializable fields
  // are stored — PersonaModal falls back to a default icon on reload.
  const [customPersonas, setCustomPersonas] = useState(() => {
    const saved = localStorage.getItem('ollama_pro_custom_personas');
    return saved ? JSON.parse(saved) : [];
  });

  // User Profile & Long-Term Memory
  const [isMemoryModalOpen, setIsMemoryModalOpen] = useState(false);
  const [isSkillsDashboardOpen, setIsSkillsDashboardOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Dev Workspace (Desktop dev-mode only — see propose_ui_change/tools.js).
  // chatPrefillText is a one-shot handoff: set by "Ask Aloy" on an idea,
  // consumed by ChatArea's own input state, then cleared (see its useEffect).
  const [isDevWorkspaceOpen, setIsDevWorkspaceOpen] = useState(false);
  const [chatPrefillText, setChatPrefillText] = useState('');

  const [isProjectsPanelOpen, setIsProjectsPanelOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [trackedProjects, setTrackedProjects] = useState(() => initSharedDomain('ollama_pro_tracked_projects', []));
  const [isContextCanvasOpen, setIsContextCanvasOpen] = useState(false);
  const [contextCanvasTab, setContextCanvasTab] = useState('health');

  // Global Ctrl+K / Cmd+K Command Palette shortcut listener
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);
  // Background live status for tracked projects with a statusUrl (e.g.
  // AutoRipManager) — polled independently of chat so the Sidebar widget
  // stays current without the user having to ask. Keyed by project name.
  const [projectLiveStatus, setProjectLiveStatus] = useState({});
  const prevProjectStatusRef = useRef({});

  // Finances — 100% local transaction/budget tracking, no bank connections.
  const [isFinancesPanelOpen, setIsFinancesPanelOpen] = useState(false);
  const [transactions, setTransactions] = useState(() => initSharedDomain('ollama_pro_transactions', []));
  const [budgets, setBudgets] = useState(() => initSharedDomain('ollama_pro_budgets', []));
  const [budgetAlert, setBudgetAlert] = useState(null);
  const [anomalyAlert, setAnomalyAlert] = useState(null);
  const raiseAnomalyAlert = (message) => {
    setAnomalyAlert(message);
    sendDesktopNotification('Aloy — Anomaly Detected', message.replace(/^\p{Emoji}\s*/u, ''));
    setTimeout(() => setAnomalyAlert(null), 8000);
  };

  // Workout log
  const [workouts, setWorkouts] = useState(() => initSharedDomain('ollama_pro_workouts', []));
  const handleAddWorkout = (exercises, notes) => setWorkouts(prev => [...prev, createWorkoutEntry(exercises, notes)]);
  const handleDeleteWorkout = (id) => setWorkouts(prev => prev.filter(w => w.id !== id));

  // Reminders/Tasks
  const [reminders, setReminders] = useState(() => initSharedDomain('ollama_pro_reminders', []));
  const handleAddReminder = (text, dueAt) => setReminders(prev => [...prev, createReminder(text, dueAt)]);
  const handleCompleteReminder = (textMatch) => {
    const lower = textMatch.toLowerCase();
    const match = reminders.find(r => !r.completed && r.text.toLowerCase().includes(lower));
    if (!match) return false;
    setReminders(prev => prev.map(r => (r.id === match.id ? { ...r, completed: true } : r)));
    return true;
  };

  // Weather — location auto-detected from Home Assistant's zone.home entity
  const [homeCoordinates, setHomeCoordinates] = useState(null);

  // Lock unlock-event history (entity + hour-of-day), used to learn each
  // lock's normal unlock pattern over time and flag unlocks outside it.
  const [lockHistory, setLockHistory] = useState(() => {
    const saved = localStorage.getItem('ollama_pro_lock_history');
    return saved ? JSON.parse(saved) : [];
  });
  // refreshHomeAssistant is captured once by a mount-only setInterval (see
  // below), so reading `lockHistory` state directly inside it would always
  // see its value from that first render. A ref sidesteps that staleness.
  const lockHistoryRef = useRef(lockHistory);
  const prevLockStatesRef = useRef({});

  // Backup & Restore (Desktop App only — writes JSON snapshots to a
  // user-configured local directory).
  const [backupDir, setBackupDir] = useState(() => {
    const stored = localStorage.getItem('ollama_pro_backup_dir');
    // One-time migration: the old default pointed at a mapped NAS drive
    // (Z:\Aloy Backups) that's no longer functional as of 2026-08-15 — move
    // anyone still on that stale value to the new local default rather than
    // leaving them permanently backing up to a dead path. A deliberately
    // chosen custom directory that isn't the old dead path is left alone.
    if (!stored || /^z:/i.test(stored)) return DEFAULT_BACKUP_DIR;
    return stored;
  });
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(() => localStorage.getItem('ollama_pro_auto_backup_enabled') !== 'false');
  const [lastBackupStatus, setLastBackupStatus] = useState(null);
  const [isBackingUp, setIsBackingUp] = useState(false);

  const [userProfile, setUserProfile] = useState(() => initSharedDomain('ollama_pro_user_profile', DEFAULT_USER_PROFILE));

  // App lock (PIN), added 2026-08-03 — 'checking' avoids a flash of real
  // content before we know whether a PIN is even configured. Desktop-only
  // (isElectron false means this never leaves 'unlocked'), separate from
  // every other shared domain — see server/lock.cjs for why.
  const [lockState, setLockState] = useState('checking');
  const [isLockConfigured, setIsLockConfigured] = useState(false);
  const IDLE_LOCK_MS = 15 * 60 * 1000;

  const [memories, setMemories] = useState(() => initSharedDomain('ollama_pro_user_memories', DEFAULT_MEMORIES));

  // learnedKnowledge is deliberately NOT mirrored into renderer state (unlike
  // the other shared domains above) — the automated nightly teaching pass
  // (server/skillsDashboard.cjs) writes to it directly in the main process,
  // same as claudeEscalations. A renderer-side copy + persist-effect would
  // risk overwriting fresh auto-generated entries with a stale local array
  // whenever anything else touched React state. SkillsDashboard.jsx reads it
  // fresh via getSkillsDashboard() each time it opens; writes go through the
  // knowledge:save IPC handler directly (see buildToolContext below).

  // One-shot hydration of the 8 shared domains from store.json (single
  // source of truth with the mobile/API server — see electron.cjs's
  // ALLOWED_STORE_KEYS). Each domain's own persist-effect below checks this
  // ref before calling storeSave(), so the initial empty/default state from
  // the useState calls above can never race ahead and get saved back over
  // real data before this hydration fetch resolves.
  const hasHydratedSharedStoreRef = useRef(false);
  useEffect(() => {
    if (!IS_ELECTRON) {
      hasHydratedSharedStoreRef.current = true; // localStorage already seeded state synchronously
      return;
    }
    window.electronAPI.storeGet().then((d) => {
      if (!d) return;
      setChats(d.chats || []);
      setTransactions(d.transactions || []);
      setBudgets(d.budgets || []);
      setReminders(d.reminders || []);
      setWorkouts(d.workouts || []);
      setMemories(d.memories && d.memories.length > 0 ? d.memories : DEFAULT_MEMORIES);
      setTrackedProjects(d.trackedProjects || []);
      setVaultDir(d.vaultDir || DEFAULT_VAULT_DIR);
      setUserProfile(d.userProfile || DEFAULT_USER_PROFILE);
      hasHydratedSharedStoreRef.current = true;
    });
  }, []);

  // App lock — check once on launch whether a PIN is configured at all; if
  // not, there's nothing to lock (stays 'unlocked' forever until one is set
  // up in the Personal Profile modal). If one IS configured, start locked —
  // this covers the "just launched" case for free, on top of the idle timer
  // below covering "already open, stepped away".
  useEffect(() => {
    if (!IS_ELECTRON) {
      setLockState('unlocked');
      return;
    }
    window.electronAPI.isLockConfigured().then((configured) => {
      setIsLockConfigured(configured);
      setLockState(configured ? 'locked' : 'unlocked');
    });
  }, []);

  // Idle-timeout auto-lock — only armed once actually unlocked AND a PIN
  // exists (never arms with no PIN configured, which would lock the app
  // with no way back in). Any real activity resets the timer; this
  // deliberately does NOT try to be clever about "reading vs. away" — a
  // flat inactivity window is what was asked for.
  useEffect(() => {
    if (lockState !== 'unlocked' || !isLockConfigured) return;
    let timer = null;
    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setLockState('locked'), IDLE_LOCK_MS);
    };
    const events = ['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timer) clearTimeout(timer);
    };
  }, [lockState, isLockConfigured]);

  // Home Assistant Live Stats & Data
  const [haCategories, setHaCategories] = useState({});
  const [smartHomeStats, setSmartHomeStats] = useState(null);
  const [isHARefreshing, setIsHARefreshing] = useState(false);

  // Local RAG & Web Search
  const ragEngineRef = useRef(new DocumentKnowledgeBase());
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);

  // Obsidian Vault — read side auto-indexes every note into the RAG engine
  // above; write side lets the model create new notes via a confirmed tool.
  const DEFAULT_VAULT_DIR = '';
  const [vaultDir, setVaultDir] = useState(() => (IS_ELECTRON ? DEFAULT_VAULT_DIR : localStorage.getItem('ollama_pro_vault_dir') || DEFAULT_VAULT_DIR));
  const [isSyncingVault, setIsSyncingVault] = useState(false);
  const [vaultSyncStatus, setVaultSyncStatus] = useState(null);

  useEffect(() => {
    if (IS_ELECTRON) {
      if (hasHydratedSharedStoreRef.current) window.electronAPI.storeSave('vaultDir', vaultDir || DEFAULT_VAULT_DIR);
      return;
    }
    if (vaultDir) localStorage.setItem('ollama_pro_vault_dir', vaultDir);
    else localStorage.removeItem('ollama_pro_vault_dir');
  }, [vaultDir]);

  const handleSyncVault = async (dirOverride) => {
    const dir = dirOverride || vaultDir;
    if (!dir) return;
    setIsSyncingVault(true);
    try {
      // Drop previously-synced vault notes before re-adding fresh copies, so
      // edited/deleted notes don't leave stale entries behind.
      ragEngineRef.current.documents
        .filter(d => d.source === 'obsidian')
        .forEach(d => ragEngineRef.current.removeDocument(d.id));

      const notes = await scanVaultNotes(dir);
      for (const note of notes) {
        const content = await readNoteContent(note.path);
        if (content) await ragEngineRef.current.addDocument(note.name, content, 'obsidian');
      }
      setUploadedDocuments([...ragEngineRef.current.documents]);
      setVaultSyncStatus({ count: notes.length, timestamp: new Date().toISOString() });
    } finally {
      setIsSyncingVault(false);
    }
  };

  const handleConnectVault = async () => {
    const dir = await selectVaultFolder();
    if (!dir) return;
    setVaultDir(dir);
    await handleSyncVault(dir);
  };

  const handleDisconnectVault = () => {
    ragEngineRef.current.documents
      .filter(d => d.source === 'obsidian')
      .forEach(d => ragEngineRef.current.removeDocument(d.id));
    setUploadedDocuments([...ragEngineRef.current.documents]);
    setVaultDir(null);
    setVaultSyncStatus(null);
  };

  // The RAG index itself only lives in memory (ragEngineRef), unlike vaultDir
  // which persists to localStorage — so a previously-connected vault shows as
  // "connected" on every fresh launch but isn't actually searchable until a
  // resync happens. Do that resync automatically once at startup instead of
  // requiring a manual click every session. Guarded with a ref (not just the
  // empty dep array) because StrictMode double-invokes mount effects in dev —
  // without the guard, handleSyncVault's own "remove previous obsidian docs,
  // then add fresh ones" logic races against itself and double-adds everything.
  const hasAutoSyncedVaultRef = useRef(false);
  useEffect(() => {
    if (vaultDir && !hasAutoSyncedVaultRef.current) {
      hasAutoSyncedVaultRef.current = true;
      handleSyncVault(vaultDir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateNote = async (title, content) => {
    const result = await createNote(vaultDir, title, content);
    if (result.success) {
      // Keep RAG current immediately rather than waiting for a manual resync.
      await ragEngineRef.current.addDocument(result.filename, content, 'obsidian');
      setUploadedDocuments([...ragEngineRef.current.documents]);
    }
    return result;
  };

  // Chats & View Navigation
  const [chats, setChats] = useState(() => initSharedDomain('ollama_pro_chats', []));
  const [activeChatId, setActiveChatId] = useState(null);
  const [activeView, setActiveView] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlView = params.get('view');
      if (urlView) return urlView;
      if (window.location.hash && window.location.hash !== '#hud') return window.location.hash.replace('#', '');
    }
    return 'dashboard';
  });

  const handleSelectDashboard = () => setActiveView('dashboard');
  const handleSelectChatView = () => setActiveView('chat');
  const handleQuickPromptFromDashboard = (promptText) => {
    setActiveView('chat');
    handleSendMessage({ text: promptText });
  };

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStreamContent, setCurrentStreamContent] = useState('');
  const abortControllerRef = useRef(null);

  // Stop an in-progress generation. streamChat treats the abort as a clean
  // completion, so any partial text is preserved as the assistant message.
  const handleStopStreaming = () => {
    abortControllerRef.current?.abort();
  };

  // Fetch Home Assistant data
  const refreshHomeAssistant = async () => {
    setIsHARefreshing(true);
    const states = await fetchHomeAssistantStates();
    if (states) {
      const cats = groupEntitiesByCategory(states);
      setHaCategories(cats);
      const stats = calculateSmartHomeStats(cats);
      setSmartHomeStats(stats);
      setHomeCoordinates(getHomeCoordinates(states));

      // Detect lock -> unlock transitions since the last poll, log them, and
      // flag any unlock happening at an hour this entity has no established
      // pattern of unlocking at.
      const prevStates = prevLockStatesRef.current;
      const nextStates = {};
      let nextHistory = lockHistoryRef.current;
      let historyChanged = false;
      (cats.locks || []).forEach((lock) => {
        nextStates[lock.entity_id] = lock.state;
        if (lock.state === 'unlocked' && prevStates[lock.entity_id] === 'locked') {
          const anomaly = detectUnusualUnlock(lock.entity_id, nextHistory);
          if (anomaly) raiseAnomalyAlert(anomaly.message);
          nextHistory = recordUnlockEvent(lock.entity_id, nextHistory);
          historyChanged = true;
        }
      });
      prevLockStatesRef.current = nextStates;
      if (historyChanged) {
        lockHistoryRef.current = nextHistory;
        setLockHistory(nextHistory);
      }
    }
    setIsHARefreshing(false);
  };

  // Auto detect Ollama, Models & Home Assistant
  useEffect(() => {
    if (isPaused) return;
    const checkOllama = async () => {
      const isOnline = await checkOllamaHealth();
      setIsOllamaConnected(isOnline);

      if (isOnline) {
        const fetched = await fetchModels();
        setModels(fetched);
        // Preserve the user's current selection if it's still available;
        // only auto-pick when the selection is missing (don't override every poll).
        // Ollama's /api/tags returns full tags ("aloy-assistant:latest"), not bare
        // names — matching against the bare 'aloy-assistant' string here silently
        // never matched anything, so this always fell through to
        // fetched[0] (whatever Ollama lists first, i.e. most recently
        // created) instead of actually preferring aloy-assistant.
        //
        // That fetched[0] fallback was a real, previously-invisible bug (found
        // 2026-09-02): with aloy-assistant not installed, this silently routed
        // every local chat turn to whatever model Ollama happened to list
        // first — once a `guoxuter/ov_intent_analysis_sft` fine-tune, never
        // intended for open-ended conversation, with no error and no visible
        // indication anything was wrong. Wrong-model-silently is worse than
        // no-model-visibly: if neither the persisted selection nor
        // aloy-assistant is installed, leave the selection as-is (stays
        // 'aloy-assistant' by default) rather than guessing — Ollama will
        // then return a clear, visible error on send instead of a
        // plausible-looking answer from an unrelated model.
        setSelectedModel(prev => {
          if (fetched.find(m => m.name === prev)) return prev;
          const aloyModel = fetched.find(m => m.name === 'aloy-assistant' || m.name === 'aloy-assistant:latest' || m.name.startsWith('aloy-assistant:'));
          if (aloyModel) return aloyModel.name;
          return prev;
        });
      }
    };

    checkOllama();
    refreshHomeAssistant();

    // Light health/model check often; refresh the (large) HA entity set less often.
    const ollamaInterval = setInterval(checkOllama, 15000);
    const haInterval = setInterval(refreshHomeAssistant, 60000);
    return () => {
      clearInterval(ollamaInterval);
      clearInterval(haInterval);
    };
  }, [isPaused]);

  // Fetch MCP-server tools (see server/mcpClient.cjs) once at startup and
  // register them into the tool-calling registry alongside the app's own
  // hand-written tools. (server/aloyServer.cjs — the mobile/API path — does
  // the equivalent registration itself, independently, at server startup.)
  const [mcpStatus, setMcpStatus] = useState(null);
  useEffect(() => {
    ensureMcpToolsLoaded().then(() => setMcpStatus(getMcpStatus()));
  }, []);

  // Claude-escalation stats for the sidebar footer widget (nested next to
  // the MCP status line, per the established live-status pattern rather
  // than a new panel) — read-only, since only the main process
  // (confidenceEscalation.cjs) ever writes claudeEscalations. Refetched
  // after each completed turn via the effect below keyed on message count.
  const [escalationStats, setEscalationStats] = useState(null);
  const refreshEscalationStats = () => {
    if (IS_ELECTRON) window.electronAPI.getEscalationStats().then(setEscalationStats);
  };
  useEffect(() => { refreshEscalationStats(); }, []);

  // "How many clients are connected" sidebar widget — polled rather than
  // fetched once, since "connected" is defined by recency (last 5 min, see
  // clientTracker.cjs) and needs to reflect a mobile device going idle/
  // active without the user having to do anything to refresh it.
  const [connectedClients, setConnectedClients] = useState(null);
  useEffect(() => {
    if (!IS_ELECTRON) return;
    const refresh = () => window.electronAPI.getConnectedClients().then(setConnectedClients);
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, []);

  // Glanceable skills-dashboard summary for the sidebar's System row — the
  // underlying data only changes once a day (the nightly auto-teaching
  // pass), so a 10-min poll is plenty to catch it during a long-running
  // session without being wasteful.
  const [skillsStats, setSkillsStats] = useState(null);
  const refreshSkillsStats = () => {
    if (IS_ELECTRON) window.electronAPI.getSkillsDashboard().then(setSkillsStats);
  };
  useEffect(() => {
    refreshSkillsStats();
    const interval = setInterval(refreshSkillsStats, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Glanceable "has Hephaestus's reviewer or securityGuard actually flagged
  // anything" summary for the sidebar's System row — same slow-changing,
  // 10-min-poll shape as skillsStats above. See MinervaEngine.getSecurityStats.
  const [securityStats, setSecurityStats] = useState(null);
  const refreshSecurityStats = () => {
    if (IS_ELECTRON) window.electronAPI.getSecurityStats().then(setSecurityStats);
  };
  useEffect(() => {
    refreshSecurityStats();
    const interval = setInterval(refreshSecurityStats, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Background poller for tracked-project live status (Projects & Builds
  // sidebar widget + desktop notifications on notable changes). Runs
  // independently of chat so status is visible without asking every time.
  useEffect(() => {
    if (isPaused) return;

    const refreshProjectStatuses = async () => {
      const projectsWithStatus = trackedProjects.filter(p => p.statusUrl);
      if (projectsWithStatus.length === 0) {
        setProjectLiveStatus({});
        return;
      }

      const nextStatus = {};
      for (const proj of projectsWithStatus) {
        const statusData = await fetchProjectStatus(proj.statusUrl);
        if (!statusData) continue;
        const summary = parseProjectStatusSummary(statusData);
        if (!summary) continue;
        nextStatus[proj.name] = summary;

        const prev = prevProjectStatusRef.current[proj.name];
        const stepChanged = prev?.step?.label !== summary.step?.label && summary.step?.label;
        const newlyCompleted = summary.lastCompleted?.timestamp
          && summary.lastCompleted.timestamp !== prev?.lastCompleted?.timestamp;

        if (prev && newlyCompleted) {
          sendDesktopNotification(
            `Aloy — ${proj.name} Completed`,
            `${summary.lastCompleted.disc_label || 'Item'} finished (${summary.lastCompleted.episodes_saved || 0} episodes saved).`
          );
        } else if (prev && stepChanged) {
          sendDesktopNotification(`Aloy — ${proj.name} Update`, summary.statusMessage || summary.step.label);
        }
      }

      prevProjectStatusRef.current = nextStatus;
      setProjectLiveStatus(nextStatus);
    };

    refreshProjectStatuses();
    const projectInterval = setInterval(refreshProjectStatuses, 45000);
    return () => clearInterval(projectInterval);
  }, [isPaused, trackedProjects]);

  // "Last vision event" sidebar widget for the 5 local-Ollama camera
  // automations (front door doorbell, driveway Amazon-driver detection,
  // game room gaming detection, backyard/behind-garage person descriptions)
  // — all log to one shared HA calendar entity, fetched directly here since
  // the renderer already has the HA token (same as the existing smart-home
  // fetch), no IPC needed. Polled on the same cadence as project status.
  const [llmVisionStats, setLlmVisionStats] = useState(null);
  useEffect(() => {
    if (isPaused) return;
    const refreshLlmVisionStats = async () => {
      const events = await fetchLLMVisionTimeline(24);
      setLlmVisionStats(summarizeLLMVisionActivity(events));
    };
    refreshLlmVisionStats();
    const visionInterval = setInterval(refreshLlmVisionStats, 45000);
    return () => clearInterval(visionInterval);
  }, [isPaused]);

  // Save profile & memories — store.json (IPC) in Electron, localStorage otherwise.
  useEffect(() => {
    if (IS_ELECTRON) {
      if (hasHydratedSharedStoreRef.current) window.electronAPI.storeSave('userProfile', userProfile);
      return;
    }
    localStorage.setItem('ollama_pro_user_profile', JSON.stringify(userProfile));
  }, [userProfile]);

  useEffect(() => {
    if (IS_ELECTRON) {
      if (hasHydratedSharedStoreRef.current) window.electronAPI.storeSave('memories', memories);
      return;
    }
    localStorage.setItem('ollama_pro_user_memories', JSON.stringify(memories));
  }, [memories]);

  useEffect(() => {
    localStorage.setItem('ollama_pro_custom_personas', JSON.stringify(customPersonas));
  }, [customPersonas]);

  useEffect(() => {
    if (IS_ELECTRON) {
      if (hasHydratedSharedStoreRef.current) window.electronAPI.storeSave('trackedProjects', trackedProjects);
      return;
    }
    localStorage.setItem('ollama_pro_tracked_projects', JSON.stringify(trackedProjects));
  }, [trackedProjects]);

  const handleAddProject = (project) => setTrackedProjects(prev => [...prev, project]);
  const handleRemoveProject = (id) => setTrackedProjects(prev => prev.filter(p => p.id !== id));
  const handleUpdateProject = (id, patch) =>
    setTrackedProjects(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));

  useEffect(() => {
    if (IS_ELECTRON) {
      if (hasHydratedSharedStoreRef.current) window.electronAPI.storeSave('transactions', transactions);
      return;
    }
    localStorage.setItem('ollama_pro_transactions', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    if (IS_ELECTRON) {
      if (hasHydratedSharedStoreRef.current) window.electronAPI.storeSave('budgets', budgets);
      return;
    }
    localStorage.setItem('ollama_pro_budgets', JSON.stringify(budgets));
  }, [budgets]);

  useEffect(() => {
    localStorage.setItem('ollama_pro_lock_history', JSON.stringify(lockHistory));
  }, [lockHistory]);

  useEffect(() => {
    if (IS_ELECTRON) {
      if (hasHydratedSharedStoreRef.current) window.electronAPI.storeSave('reminders', reminders);
      return;
    }
    localStorage.setItem('ollama_pro_reminders', JSON.stringify(reminders));
  }, [reminders]);

  useEffect(() => {
    if (IS_ELECTRON) {
      if (hasHydratedSharedStoreRef.current) window.electronAPI.storeSave('workouts', workouts);
      return;
    }
    localStorage.setItem('ollama_pro_workouts', JSON.stringify(workouts));
  }, [workouts]);

  // Desktop-notify + mark any reminder whose due time has just passed.
  useEffect(() => {
    const dueCheckInterval = setInterval(() => {
      setReminders(prev => {
        const due = getNewlyDueReminders(prev);
        if (due.length === 0) return prev;
        due.forEach(r => sendDesktopNotification('Aloy — Reminder', r.text));
        const dueIds = new Set(due.map(r => r.id));
        return prev.map(r => (dueIds.has(r.id) ? { ...r, notified: true } : r));
      });
    }, 30000);
    return () => clearInterval(dueCheckInterval);
  }, []);

  const handleAddTransaction = (transaction) => {
    const nextTransactions = [...transactions, transaction];
    setTransactions(nextTransactions);

    // Budget alert: only meaningful for expenses against a category with a
    // budget set — check whether this transaction just crossed 80%/100%.
    if (transaction.type === 'expense') {
      const status = calculateBudgetStatus(budgets, nextTransactions)
        .find(b => b.category === transaction.category);
      if (status && (status.status === 'warning' || status.status === 'over')) {
        const icon = status.status === 'over' ? '🚨' : '⚠️';
        setBudgetAlert(
          `${icon} ${status.category} is now ${status.pct.toFixed(0)}% of its $${status.limit.toFixed(0)} monthly budget ($${status.spent.toFixed(2)} spent).`
        );
        setTimeout(() => setBudgetAlert(null), 6000);
      }

      const spendingAnomaly = detectSpendingAnomaly(transaction, nextTransactions);
      if (spendingAnomaly) raiseAnomalyAlert(spendingAnomaly.message);
    }
  };
  const handleDeleteTransaction = (id) => setTransactions(prev => prev.filter(t => t.id !== id));
  const handleSetBudget = ({ category, limit }) =>
    setBudgets(prev => [...prev.filter(b => b.category !== category), { category, limit }]);
  const handleDeleteBudget = (category) => setBudgets(prev => prev.filter(b => b.category !== category));

  useEffect(() => {
    localStorage.setItem('ollama_pro_backup_dir', backupDir);
  }, [backupDir]);

  useEffect(() => {
    localStorage.setItem('ollama_pro_auto_backup_enabled', String(autoBackupEnabled));
  }, [autoBackupEnabled]);

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    const result = await writeBackupSnapshot(backupDir);
    setLastBackupStatus(result);
    setIsBackingUp(false);
  };

  const handleRestoreBackup = async () => {
    const result = await restoreFromFile();
    if (result.cancelled) return result;
    if (result.success) {
      // Every piece of app state was initialized from localStorage once on
      // mount, so a full reload is the simplest way to apply a restore
      // consistently across all of it rather than re-seeding each piece by hand.
      window.location.reload();
    }
    return result;
  };

  // Auto-backup: run shortly after launch, then on a steady interval, so a
  // fresh local copy exists without the user having to remember to click anything.
  useEffect(() => {
    if (!autoBackupEnabled || !window.electronAPI?.backupWrite) return;
    const initialTimer = setTimeout(handleBackupNow, 15000);
    const interval = setInterval(handleBackupNow, 10 * 60 * 1000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBackupEnabled, backupDir]);

  // Save chats — store.json (IPC) in Electron, a plain file with no
  // meaningful size quota, so the localStorage-quota fallback below only
  // applies to the non-Electron (plain `vite dev`) path.
  useEffect(() => {
    if (IS_ELECTRON) {
      if (hasHydratedSharedStoreRef.current) window.electronAPI.storeSave('chats', chats);
      return;
    }
    try {
      localStorage.setItem('ollama_pro_chats', JSON.stringify(chats));
    } catch (err) {
      console.warn('Chat persistence failed (storage quota?). Retrying without images.', err);
      try {
        const slimChats = chats.slice(0, 25).map(c => ({
          ...c,
          messages: c.messages.map(m => (m.image ? { ...m, image: null } : m))
        }));
        localStorage.setItem('ollama_pro_chats', JSON.stringify(slimChats));
      } catch (err2) {
        console.error('Chat persistence still failing after trimming images.', err2);
      }
    }
  }, [chats]);

  const activeChat = chats.find(c => c.id === activeChatId) || null;
  const activeMessages = activeChat ? activeChat.messages : [];

  const handleNewChat = () => {
    const newChat = {
      id: `chat-${Date.now()}`,
      title: 'New Conversation',
      messages: [],
      createdAt: new Date().toISOString()
    };
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
  };

  const handleDeleteChat = (id) => {
    setChats(prev => prev.filter(c => c.id !== id));
    if (activeChatId === id) {
      setActiveChatId(null);
    }
  };

  const handleUploadDocument = async (filename, content) => {
    await ragEngineRef.current.addDocument(filename, content);
    setUploadedDocuments([...ragEngineRef.current.documents]);
  };

  const handleRemoveDocument = (id) => {
    ragEngineRef.current.removeDocument(id);
    setUploadedDocuments([...ragEngineRef.current.documents]);
  };

  const handleExecuteHAService = async (domain, service, entityId) => {
    const success = await executeHAService(domain, service, entityId);
    if (success) {
      setTimeout(refreshHomeAssistant, 1000);
    }
    return success;
  };

  const buildSystemInstruction = async (checkInAllowedByFaceId = true, lastUserMessageText = '') => {
    const memoriesList = memories.map(m => `- ${typeof m === 'string' ? m : (m.fact || m.content || m.text || JSON.stringify(m))}`).join('\n');
    // Fire-once-per-local-day gate shared with the mobile path (aloyServer.cjs's
    // identical inline call) via the same store.json — see electron.cjs's
    // checkin:shouldInclude handler / store.cjs's maybeConsumeDailyCheckIn.
    // Falls back to false in the plain-vite-dev (non-Electron) path.
    // checkInAllowedByFaceId short-circuits BEFORE the IPC call (which
    // consumes today's one-time flag as a side effect) when local face ID
    // actively recognized someone other than the enrolled owner — so a
    // kid using the PC first doesn't burn the owner's check-in for the day.
    const checkIn = checkInAllowedByFaceId && ((await window.electronAPI?.checkInShouldInclude?.()) || false);
    // Lessons (explicit user corrections, save_lesson tool) always win over
    // anything auto-researched — small expected volume, so every lesson is
    // injected unconditionally rather than relevance-filtered like
    // learnedKnowledge. See store.cjs's `lessons` domain comment.
    const lessons = (await window.electronAPI?.getLessons?.()) || [];
    const lessonsList = lessons.map(l => `- ${l.topic}: ${l.correction}`).join('\n');
    // Relevance-scored learnedKnowledge lookup (server/knowledgeRetrieval.cjs,
    // via IPC since the renderer has no direct store/Ollama access) — closes
    // the loop so the nightly teaching pipeline's output actually reaches
    // live answers, not just the dashboard.
    const relevantKnowledge = lastUserMessageText
      ? ((await window.electronAPI?.getRelevantKnowledge?.(lastUserMessageText)) || [])
      : [];
    const knowledgeList = relevantKnowledge.map(k => `- ${k.topic}: ${k.summary}`).join('\n');
    // Synthesized tool-call skills (server/skillSynthesis.cjs) — auto-learned
    // from repeated real usage, read-only sequences only. See save_lesson's
    // comment above for why write sequences are never mined into these.
    const relevantSkills = lastUserMessageText
      ? ((await window.electronAPI?.getRelevantSkills?.(lastUserMessageText)) || [])
      : [];
    const skillsList = relevantSkills.map(s => `- For questions like "${s.exampleQuestion}": call ${s.toolSequence.join(' → ')}`).join('\n');
    return `You are ${userProfile.name}'s personalized 100% local AI assistant.

IF THE USER ASKS ABOUT YOU (what you are, your specs/capabilities, how many parameters you have, how to explain you to someone else): answer directly and confidently using this description — this is a fact about your own setup, not a knowledge gap, so do NOT hedge or express uncertainty. You are Aloy, ${userProfile.name}'s personal AI assistant, running 100% locally via Ollama on his own hardware (no cloud dependency for normal chat). You have tools for his calendar, smart home, finances, reminders, project tracking, document analysis, and web research, plus a background system that can escalate low-confidence answers to Claude or verify researched facts with Gemini. You do not know your exact parameter count or quantization beyond what's in your Ollama model name — if asked for that specific number, say so plainly rather than guessing, but everything else above you should state as fact.

USER PROFILE & PERSONAL INSTRUCTIONS:
- User Name: ${userProfile.name}
- Communication Style: ${userProfile.style}
- Personal Guidelines: ${userProfile.instructions}

USER-CORRECTED FACTS (highest priority — these override your own training knowledge, any previously researched information, and anything else in this prompt if they conflict):
${lessonsList || 'None yet.'}

RELEVANT PREVIOUSLY RESEARCHED KNOWLEDGE (auto-researched and Gemini-verified, only shown when likely relevant to the current question):
${knowledgeList || 'Nothing specifically relevant found.'}

KNOWN EFFICIENT TOOL-CALL PATTERNS (learned from repeated real usage — when a new question closely matches one of these, prefer this exact sequence over guessing):
${skillsList || 'None learned yet.'}

PERSISTENT MEMORY BANK:
${memoriesList || 'None saved yet.'}

You HAVE real-time access to ${userProfile.name}'s PC Desktop Screen, System Telemetry, Google Calendar, Home Assistant server, tracked local Projects, and Finances — but ONLY when the relevant data was actually injected above as a labeled block (e.g. [REAL-TIME ...], [LIVE ...], [SMART HOME ...], [LIVE PROJECT STATUS: ...]), OR when you use one of your tools to look it up.
If you don't have injected data or a tool result for what the user is asking about, say so honestly — do NOT invent status reports, numbers, entity counts, or actions. Guessing plausible-sounding details you were not actually given is a serious failure.
This also applies to labels and categories, not just facts: when data is unfamiliar (e.g. a chore or calendar entry you don't recognize), report it using the source's own naming (the calendar/entity name it came from) — do NOT invent a thematic category or label for it that isn't actually stated in the data. Group and summarize; never re-interpret.
When analyzing or rewriting an attached document (resume, letter, report, etc.): NEVER introduce a new number, percentage, date, or quantified claim that isn't already present in the source text — this includes satisfying your own feedback (e.g. "add quantification") by inventing a plausible-sounding figure. If a bullet or claim needs a number the source doesn't provide, leave a clear placeholder (e.g. "[X%]") and tell the user to fill in the real value themselves — do not guess one. Before presenting any rewritten document with dates (employment history, timelines, etc.), verify every date range makes chronological sense — each end date must be after its start date, and ranges should not overlap or reverse against neighboring entries — and flag anything that looks wrong in the source rather than silently carrying an error into your rewrite.
You have tools to look up live finances, smart home status, project status, existing Home Assistant automations/scripts, dashboard/Lovelace card configuration, and entities in a specific domain (e.g. sensors, media players) beyond the always-visible lights/locks/climate summary — and to log transactions, set budgets, control smart home devices, add/complete reminders, or create a note in the user's Obsidian vault. Use them whenever the request calls for it, instead of guessing.
When the user asks for automation recommendations: ALWAYS call get_smart_home_automations first to see what already exists (never suggest a duplicate), and use list_home_assistant_entities to check what sensors/devices are actually available before proposing anything that depends on them.
When the user asks about a dashboard, card, or Lovelace YAML: ALWAYS call get_dashboard_config first — these are custom-built and specific to this setup, not standard/default cards, and guessing at them is a serious failure.
When the user asks about disc ripping, AutoRip, or recent disc encodes: ALWAYS call get_autorip_status first — do not guess what the ripping pipeline processed.
When the user asks about tech news, a specific headline, or a video from the Tech News feed: ALWAYS call get_tech_news first — do not guess at feed contents.
When the user asks you to look at something in front of them right now — what they're holding, what's on their desk, how they look, whether they're wearing something — ALWAYS call look_at_webcam with their actual question rather than answering from the separate real-time presence line already in this prompt (that line only confirms someone is there, it says nothing about what they're doing or holding).
When the user asks about files, directories, movies, TV shows, media, or contents on drive P: (such as P:\Movies, P:\TV Shows, P:\Games, P:\Music, P:\Photos, P:\Other) or in Documents: ALWAYS call your MCP filesystem tools (mcp__filesystem__list_directory, mcp__filesystem__search_files, or mcp__filesystem__directory_tree) with the target path (e.g. "P:\\Movies") to check the real filesystem directly. You HAVE full read and write permissions to drive P:\ and Documents — do NOT claim filesystem access is restricted or rely solely on AutoRip records when asked about files on P:\.
When the user asks to play, watch, put on, or cast a movie, TV show, or Simpsons episode to any device or all devices (such as "Play Drunken Master on Bazzite", "Play The Simpsons on TV", "Cast to Lenny", "Play everywhere", "Broadcast on all devices", "Party mode"): ALWAYS immediately call play_media with the media_title and target (e.g. target="all", target="bazzite", target="lenny", target="local", target="jellyfin"). To check what movies or episodes are available, call search_media_library. To check available destinations, call list_playback_targets.
When the user asks to download, find, acquire, grab, or add a movie or TV show/series (such as "Download Dune 2", "Get Severance season 2", "Add Oppenheimer in 4K", "Check download queue"): ALWAYS call arr_search_media to check availability or arr_add_media with the title and type ("movie" or "series") to initiate the automated download search via Radarr/Sonarr and Usenet. To check live downloading progress, speeds, or upcoming air dates, call arr_queue_status. You HAVE full integration and tools to search and queue media downloads through Radarr/Sonarr.
When the user explicitly asks you to research, look into, or learn about something: call research_topic to get a real sourced draft, present it to them, and only call save_researched_knowledge if they confirm they want it kept — never save without an explicit confirmation.
When the user directly corrects something you said, or explicitly tells you to remember/note a fact going forward: call save_lesson with a short topic and the corrected fact — this is different from save_researched_knowledge (that's for things you looked up yourself; this is for things the user told you directly, and it always takes priority).
When the user asks about your own skill gaps, proficiency, what you're weak at, or what needs review: call get_skills_dashboard first — this reflects real logged data, do not guess or estimate a percentage yourself. If any category comes back as a critical/low-proficiency gap, after reporting it offer to research one of its specific open gap questions right now — if the user agrees, call research_topic using that gap's actual question text as the topic (not a paraphrase), present the sourced result, and only call save_researched_knowledge if they then confirm they want it kept, same as any other research.
When ${userProfile.name} shares personal details, habits, preferences, daily routines, pet peeves, workflow choices, tooling/editor preferences, food/drink tastes, or answers questions about himself: ALWAYS immediately call save_user_memory with a clear, concise fact to permanently add it to his PERSISTENT MEMORY BANK so you remember it forever across all future conversations.
When ${userProfile.name} gives instructions on how you should format responses, speak, or behave — or tells you their actual name — call update_user_profile to permanently adapt your personality, communication style, and name to his liking.
In conversation, be attentive and curiously inquiring — when natural and relevant, ask thoughtful follow-up questions to understand his lifestyle, habits, and preferences deeper over time.
If recommending local OS shell commands to execute, format as: [COMMAND: command_string].${checkIn ? `\n\nThis is the first message today — before addressing the request below, naturally weave in a brief, genuine one-line check-in about how ${userProfile.name}'s day is going, in your own words matching the Communication Style above. Keep it short and light; don't force it if the request is clearly urgent or time-sensitive.` : ''}`;
  };

  // Everything a tool's execute() needs — current data plus the handlers
  // that already implement the real side effects (adding a transaction,
  // calling Home Assistant, etc.), so tools.js stays free of App state.
  const buildToolContext = () => ({
    transactions,
    budgets,
    trackedProjects,
    haCategories,
    smartHomeStats,
    onAddTransaction: handleAddTransaction,
    onSetBudget: handleSetBudget,
    onExecuteHAService: handleExecuteHAService,
    onGetPortfolioSnapshot: () => window.electronAPI?.getPortfolioSnapshot?.(),
    onSetPortfolioShares: (symbol, shares) => window.electronAPI?.setPortfolioShares?.(symbol, shares),
    onAddReminder: handleAddReminder,
    onCompleteReminder: handleCompleteReminder,
    onAddWorkout: handleAddWorkout,
    onGetWorkoutHistory: () => workouts,
    onCreateNote: handleCreateNote,
    onResearchTopic: async (topic) => {
      const result = await window.electronAPI?.researchTopic?.(topic);
      if (!result) throw new Error('Research is only available in the desktop app.');
      if (!result.success) throw new Error(result.error || 'Research failed.');
      const { topic: t, summary, sources } = result;
      return { topic: t, summary, sources };
    },
    onSaveLearnedKnowledge: (entry) => window.electronAPI?.saveLearnedKnowledge?.(entry),
    onSaveLesson: (entry) => window.electronAPI?.saveLesson?.(entry),
    onAddMemory: (newFact) => {
      setMemories(prev => {
        if (prev.includes(newFact)) return prev;
        return [...prev, newFact];
      });
    },
    onSaveProfile: (patch) => {
      setUserProfile(prev => ({ ...prev, ...patch }));
    },
    onGetSkillsDashboard: () => window.electronAPI?.getSkillsDashboard?.(),
    onGetAutoRipStatus: async () => {
      const res = await window.electronAPI?.getAutoRipStatus?.();
      return res || 'AutoRip status is unavailable.';
    },
    onGetTechNews: async () => (await window.electronAPI?.getNews?.()) || [],
    onSearchKnowledgeGraph: async (query) => {
      const res = await window.electronAPI?.searchKnowledgeGraph?.(query);
      return res || 'Knowledge graph search is only available in the desktop app.';
    },
    onReadOwnUiSource: async (relativePath) => {
      const res = await window.electronAPI?.readOwnUiSource?.(relativePath);
      if (!res) throw new Error('Reading own UI source is only available in the desktop dev app.');
      if (!res.success) throw new Error(res.error || 'Read failed.');
      return res.content;
    },
    onProposeUiChange: async ({ filePath, oldString, newString, reason }) => {
      const res = await window.electronAPI?.proposeUiChange?.({ relativePath: filePath, oldString, newString, reason });
      if (!res) throw new Error('Proposing UI changes is only available in the desktop dev app.');
      return res;
    },
    onSuggestUiChange: async ({ title, description, targetFile, source }) => {
      const res = await window.electronAPI?.addDevIdea?.({ title, description, targetFile, source });
      if (!res) throw new Error('The Dev Workspace backlog is only available in the desktop dev app.');
      return res;
    },
    onDispatchAthenaResearch: async (taskData) => {
      const res = await apiFetch(`/api/athena/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData)
      });
      if (!res.ok) throw new Error('Failed to dispatch Athena research task');
      return await res.json();
    },
    onGetAthenaTask: async (taskId) => {
      const url = taskId ? `/api/athena/tasks/${taskId}` : '/api/athena/tasks';
      // apiFetch, not fetch: every /api route requires a bearer token, and a
      // relative URL from the renderer never reaches :7890 anyway. This sat
      // between two correct apiFetch calls and silently returned null forever.
      const res = await apiFetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) ? data[0] : data;
    },
    onDelegateApollo: async (taskData) => {
      if (window.electronAPI?.apolloCreateTask) return await window.electronAPI.apolloCreateTask(taskData);
      const res = await apiFetch(`/api/apollo/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData)
      });
      return await res.json();
    },
    onGardenMemories: async () => {
      if (window.electronAPI?.apolloGardenMemories) return await window.electronAPI.apolloGardenMemories();
      const res = await apiFetch(`/api/apollo/garden-memories`, { method: 'POST' });
      return await res.json();
    },
    onSyncVault: async () => {
      if (window.electronAPI?.apolloSyncVault) return await window.electronAPI.apolloSyncVault();
      const res = await apiFetch(`/api/apollo/sync-vault`, { method: 'POST' });
      return await res.json();
    },
    onMinervaHealthScan: async () => {
      if (window.electronAPI?.minervaHealthScan) return await window.electronAPI.minervaHealthScan();
      const res = await apiFetch(`/api/minerva/health`);
      return await res.json();
    },
    onHermesDailyBrief: async (params) => {
      if (window.electronAPI?.hermesDailyBrief) return await window.electronAPI.hermesDailyBrief(params);
      const res = await apiFetch(`/api/hermes/daily-brief`);
      return await res.json();
    },
    onHermesBudgetHealth: async () => {
      if (window.electronAPI?.hermesBudgetHealth) return await window.electronAPI.hermesBudgetHealth();
      const res = await apiFetch(`/api/hermes/budget-health`);
      return await res.json();
    }
  });

  // Runs one model turn. Read-only tool calls are executed immediately and
  // the conversation continues automatically (recursing, capped at
  // MAX_TOOL_LOOP_DEPTH); write tool calls are surfaced as a pending
  // confirmation on the message and the turn stops until the user resolves
  // them via handleToolCallResponse.
  const runModelTurn = async ({ chatId, apiMessages, modelToUse, extraFields = {}, depth = 0, followedToolCall = false, checkInAllowedByFaceId = true, toolNamesUsed = [], hadWriteTool = false }) => {
    setIsStreaming(true);
    setCurrentStreamContent('');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    await ensureMcpToolsLoaded();
    const lastUserMessageText = [...apiMessages].reverse().find((m) => m.role === 'user')?.content || '';
    const isVisionTurn = modelToUse === 'minicpm-v' || modelToUse.includes('vision') || modelToUse.includes('llava');
    const systemPrompt = isVisionTurn
      ? `You are Aloy, ${userProfile.name}'s multimodal AI assistant. Carefully inspect the user's attached image or screenshot in detail, transcribe and read all relevant text/UI components, and answer their request thoroughly.`
      : await buildSystemInstruction(checkInAllowedByFaceId, lastUserMessageText);

    await streamChat({
      model: modelToUse,
      messages: apiMessages,
      systemPrompt,
      temperature: currentPersona?.temperature || 0.7,
      tools: isVisionTurn ? [] : getToolDefinitions(lastUserMessageText),
      signal: abortController.signal,
      onChunk: (chunk, fullText) => {
        setCurrentStreamContent(fullText);
      },
      onError: (errorMsg) => {
        setIsStreaming(false);
        setCurrentStreamContent('');
        const errorMessage = {
          role: 'assistant',
          content: `⚠️ **Error communicating with Ollama**: ${errorMsg}`,
          timestamp: new Date().toISOString()
        };
        setChats(prev => prev.map(c =>
          c.id === chatId ? { ...c, messages: [...c.messages, errorMessage] } : c
        ));
      },
      onToolCalls: async (rawToolCalls) => {
        setCurrentStreamContent('');

        if (depth >= MAX_TOOL_LOOP_DEPTH) {
          setIsStreaming(false);
          const stopMessage = {
            role: 'assistant',
            content: `⚠️ Stopped after too many tool calls in a row — let me know if you'd like to try again.`,
            timestamp: new Date().toISOString()
          };
          setChats(prev => prev.map(c =>
            c.id === chatId ? { ...c, messages: [...c.messages, stopMessage] } : c
          ));
          return;
        }

        const ctx = buildToolContext();
        const normalizedCalls = await Promise.all(rawToolCalls.map(async (tc, i) => {
          const name = tc.function?.name;
          const args = parseToolArguments(tc.function?.arguments);
          const call = { id: tc.id || `call-${Date.now()}-${i}`, name, arguments: args, status: 'pending', result: null };
          const tool = getTool(name);
          if (!tool) {
            call.status = 'error';
            call.result = JSON.stringify({ error: `Unknown tool: ${name}` });
          } else if (!toolRequiresConfirmation(tool, args)) {
            try {
              call.result = await tool.execute(args, ctx);
              call.status = 'done';
              // Auto-executed but still a write (risk-tiered confirmation —
              // e.g. a light toggle). Flagged so skill synthesis skips this
              // chain; see the hadWriteTool note below.
              if (isWriteTool(tool)) call.wasWrite = true;
            } catch (err) {
              call.status = 'error';
              call.result = JSON.stringify({ error: err.message || 'Tool execution failed' });
            }
          }
          return call;
        }));

        const toolCallMessage = {
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
          model: modelToUse,
          toolCalls: normalizedCalls
        };

        setChats(prev => prev.map(c =>
          c.id === chatId ? { ...c, messages: [...c.messages, toolCallMessage] } : c
        ));

        const allResolved = normalizedCalls.every(c => c.status !== 'pending');
        if (allResolved) {
          const continuedMessages = [
            ...apiMessages,
            {
              role: 'assistant',
              content: '',
              tool_calls: normalizedCalls.map(c => ({ function: { name: c.name, arguments: c.arguments } }))
            },
            ...normalizedCalls.map(c => ({ role: 'tool', content: typeof c.result === 'string' ? c.result : JSON.stringify(c.result) }))
          ];
          // Accumulated across the whole recursive chain for a single user
          // turn — feeds skill synthesis (server/skillSynthesis.cjs) once
          // the chain reaches a final text answer with no further tool
          // calls (see onComplete below).
          //
          // This used to assume everything reaching allResolved was
          // read-only (writes stayed 'pending'). Risk-tiered confirmation
          // broke that: a low-risk smart-home action auto-executes and
          // resolves immediately. Such calls set `wasWrite` above, OR'd in
          // here so write sequences still never get mined into skills.
          const executedNames = normalizedCalls.filter(c => c.status === 'done').map(c => c.name);
          const chainHadWrite = hadWriteTool || normalizedCalls.some(c => c.wasWrite);
          await runModelTurn({ chatId, apiMessages: continuedMessages, modelToUse, depth: depth + 1, followedToolCall: true, toolNamesUsed: [...toolNamesUsed, ...executedNames], hadWriteTool: chainHadWrite });
        } else {
          setIsStreaming(false);
        }
      },
      onComplete: (fullResponseText) => {
        setIsStreaming(false);
        setCurrentStreamContent('');
        abortControllerRef.current = null;
        // Don't persist an empty bubble if the user stopped before any output.
        if (!fullResponseText || !fullResponseText.trim()) return;
        const assistantMessage = {
          role: 'assistant',
          content: fullResponseText,
          timestamp: new Date().toISOString(),
          ...extraFields
        };
        setChats(prev => prev.map(c =>
          c.id === chatId ? { ...c, messages: [...c.messages, assistantMessage] } : c
        ));

        // Skill synthesis (server/skillSynthesis.cjs) — logs the read-only
        // tool-call sequence that led to this final answer, if any. Never
        // fires for write-tool turns (hadWriteTool) — see the comments at
        // each recursion call site above for why. Fire-and-forget, same
        // "never let a background quality feature surface as a chat error"
        // reasoning as the confidence-escalation block below.
        if (toolNamesUsed.length > 0 && !hadWriteTool) {
          const originalQuestion = [...apiMessages].reverse().find(m => m.role === 'user')?.content || '';
          window.electronAPI?.logToolCallSequence?.(originalQuestion, toolNamesUsed)?.catch?.(() => {});
        }

        // Confidence check + Claude escalation run AFTER the local answer is
        // already showing, not before it — the check itself can take
        // several seconds (it forces the model to justify a YES/NO on its
        // own answer, which sometimes runs long chains of hidden reasoning
        // first), and blocking the visible reply on that turned every single
        // turn into a multi-second stall. Instead: show the local answer
        // instantly, check in the background, and if it comes back
        // low-confidence, append a follow-up correction message a few
        // seconds later. Fails silently on any error — a scoring/escalation
        // bug must never surface as a chat error, since this is a quality
        // improvement layered on top of a chat that already completed.
        //
        // Skipped entirely when this text followed a tool call (e.g. "I've
        // turned on the kitchen light") — confirmed live 2026-08-03 that
        // Claude has no way to verify a real-world action actually happened,
        // so escalating produces a generically unhelpful "I can't control
        // your lights" answer that just confuses the user about what Aloy
        // can actually do. Whether a tool call succeeded is already known
        // from its own result, not from re-litigating the summary text.
        if (followedToolCall) return;
        (async () => {
          try {
            const userQuestion = [...apiMessages].reverse().find(m => m.role === 'user')?.content || '';

            // Document analysis/rewrite turns get a Claude proofread pass in the background
            const docMatch = /\[Attached Document:.*?\]\nContent:\n([\s\S]*)\n\nUser Request:/.exec(userQuestion);
            if (docMatch) {
              await window.electronAPI?.proofreadDocument(docMatch[1], fullResponseText);
              return;
            }

            const confidence = await window.electronAPI?.checkAnswerConfidence(modelToUse, userQuestion, fullResponseText);
            if (!confidence?.lowConfidence) return;

            // Silent Background Review:
            // Evaluate and archive low-confidence turns into background training/learning logs
            // without interrupting or injecting secondary revised messages into the user conversation.
            await window.electronAPI?.escalateToClaude(userQuestion);
            refreshEscalationStats();
          } catch (err) {
            console.warn('Silent confidence review completed with note:', err?.message);
          }
        })();
      }
    });
  };

  // Resolves a pending tool call from the user clicking Confirm/Deny in the
  // chat. Once every call on that message is resolved, rebuilds the full API
  // message list (including the tool results) and resumes the conversation.
  const handleToolCallResponse = async (messageTimestamp, toolCallId, approved) => {
    const chatId = activeChatId;
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    const msgIndex = chat.messages.findIndex(m => m.timestamp === messageTimestamp);
    if (msgIndex === -1) return;
    const msg = chat.messages[msgIndex];
    const callIndex = msg.toolCalls?.findIndex(tc => tc.id === toolCallId) ?? -1;
    if (callIndex === -1) return;
    const call = msg.toolCalls[callIndex];
    if (call.status !== 'pending') return;

    let updatedCall;
    if (approved) {
      const tool = getTool(call.name);
      const ctx = buildToolContext();
      try {
        const result = await tool.execute(call.arguments, ctx);
        updatedCall = { ...call, status: 'done', result };
      } catch (err) {
        updatedCall = { ...call, status: 'error', result: JSON.stringify({ error: err.message || 'Tool execution failed' }) };
      }
    } else {
      updatedCall = {
        ...call,
        status: 'denied',
        result: JSON.stringify({
          declined: true,
          reason: 'The user reviewed this exact action and chose not to proceed — this was a deliberate decision, not a technical failure. Acknowledge it and do not retry or suggest adjustments unless the user asks again.'
        })
      };
    }

    const updatedToolCalls = msg.toolCalls.map((tc, i) => (i === callIndex ? updatedCall : tc));
    const updatedMsg = { ...msg, toolCalls: updatedToolCalls };
    const updatedMessages = chat.messages.map((m, i) => (i === msgIndex ? updatedMsg : m));

    setChats(prev => prev.map(c => (c.id === chatId ? { ...c, messages: updatedMessages } : c)));

    const allResolved = updatedToolCalls.every(tc => tc.status !== 'pending');
    if (allResolved) {
      // hadWriteTool: true — this path only runs after a requiresConfirmation
      // (write) tool was resolved, so the whole chain from here on is
      // excluded from skill synthesis (see runModelTurn's onComplete) even
      // if further read-only tool calls follow.
      await runModelTurn({
        chatId,
        apiMessages: buildApiMessages(updatedMessages),
        modelToUse: updatedMsg.model || selectedModel,
        followedToolCall: true,
        hadWriteTool: true
      });
    }
  };

  const handleSendMessage = async (payload) => {
    const { text, image = null, fileName = null, fileContent = null, facePresenceContext = null, faceIdSignal = null } =
      typeof payload === 'string' ? { text: payload } : (payload || {});

    if (!text || typeof text !== 'string' || text.trim().length === 0) return;

    let chatId = activeChatId;

    // Only suppress owner-only behavior (the daily check-in) when face ML is
    // actively running AND says someone other than the enrolled owner is
    // present — if it's off, or hasn't recognized a specific mismatch, fail
    // open rather than silently disabling the feature. See buildSystemInstruction.
    const checkInAllowedByFaceId = !faceIdSignal || (faceIdSignal.isUserPresent && faceIdSignal.recognizedLabel === userProfile.name);

    if (!chatId) {
      const newChat = {
        id: `chat-${Date.now()}`,
        title: deriveChatTitle(text),
        messages: [],
        createdAt: new Date().toISOString()
      };
      setChats(prev => [newChat, ...prev]);
      chatId = newChat.id;
      setActiveChatId(chatId);
    }

    let extraContext = '';
    let finalImage = image;

    // Always-on current date/time — without this the model has no way to
    // know what "today"/"tomorrow" actually is (previously caused it to
    // spiral trying to guess which calendar entry was "today").
    extraContext += `[CURRENT DATE/TIME]: ${new Date().toString()}\n\n`;

    // 0. Attached document content & webcam presence — model-only context.
    // Kept out of the displayed chat bubble (which shows only `text`/fileName).
    if (fileContent) {
      extraContext += `[Attached Document: ${fileName}]\nContent:\n${fileContent}\n\n`;
    }
    if (facePresenceContext) {
      extraContext += `${facePresenceContext}\n\n`;
    }

    // 1. Desktop Telemetry & Desktop Screen Vision Check
    const sysKeywords = ["computer", "pc", "screen", "desktop", "process", "cpu", "ram", "memory", "running", "vram", "looking at", "active window", "inspect my screen"];
    if (sysKeywords.some(k => text.toLowerCase().includes(k))) {
      const telemetry = await fetchPCTelemetry();
      if (telemetry) {
        extraContext += `[REAL-TIME PC SYSTEM TELEMETRY]:
- Active Focused Window: ${telemetry.active_window}
- CPU Usage: ${telemetry.cpu_percent}%
- RAM Usage: ${telemetry.ram_percent}% (${telemetry.ram_used_gb} GB / ${telemetry.ram_total_gb} GB)
- Top Memory Processes: ${telemetry.top_processes.map(p => `${p.name} (${p.mem_percent}%)`).join(', ')}\n\n`;
      }

      if (!finalImage && text.toLowerCase().includes("screen")) {
        const screenShotUrl = await fetchDesktopScreenshot();
        if (screenShotUrl) {
          finalImage = screenShotUrl;
          extraContext += `[REAL-TIME DESKTOP SCREENSHOT CAPTURED]: Analyzing high-res screen vision snapshot.\n\n`;
        }
      }
    }

    // 1.5. Weather Context Check
    const weatherKeywords = ["weather", "temperature outside", "rain", "snow", "forecast", "cold out", "hot out", "sunny", "wind"];
    if (weatherKeywords.some(k => text.toLowerCase().includes(k)) && homeCoordinates) {
      const weather = await fetchWeather(homeCoordinates);
      const weatherCtx = formatWeatherContext(weather);
      if (weatherCtx) extraContext += `${weatherCtx}\n`;
    }

    // 1.6. Reminders/Tasks Context Check
    const reminderKeywords = ["remind", "reminder", "task", "todo", "to-do", "to do list"];
    if (reminderKeywords.some(k => text.toLowerCase().includes(k))) {
      const remindersCtx = formatRemindersContext(reminders);
      if (remindersCtx) extraContext += `${remindersCtx}\n`;
    }

    // 2. Google Calendar Context Check
    const calKeywords = ["calendar", "schedule", "event", "meeting", "appointment", "agenda", "tomorrow", "chores"];
    const isCalendarQuery = calKeywords.some(k => text.toLowerCase().includes(k));

    if (isCalendarQuery) {
      const calendarEvents = await fetchGoogleCalendarEvents(7);
      let eventLines = '';
      if (calendarEvents.length > 0) {
        calendarEvents.forEach(ev => {
          const summary = ev.summary || 'Event';
          const st = ev.start || '';
          const cal = ev.calendar ? `[${ev.calendar}] ` : '';
          eventLines += `- ${cal}${summary} (Date/Time: ${st})\n`;
        });
        // Observed live at 74 uncapped lines for a single 7-day window —
        // capped by a context-window-proportional budget (contextCompression.js)
        // rather than a flat line count, so it rescales if num_ctx changes.
        eventLines = capLinesToBudget(eventLines.trim(), CONTEXT_SECTION_BUDGETS.calendarEvents, 'events') + '\n';
      } else {
        eventLines = `No upcoming events found on ${userProfile?.name || 'User'}'s calendar for the next 7 days.\n`;
      }
      const calStr = `[LIVE GOOGLE CALENDAR DATA RETRIEVED FROM HOME ASSISTANT (${calendarEvents.length} Events)]:\n${eventLines}`;
      extraContext += `${formatDateAnchor()}\n${calStr}\nIMPORTANT DIRECTIVE: The user is asking about their Google Calendar. Report the events listed above directly to ${userProfile.name}. Use the DATE ANCHOR above for what "today"/"tomorrow" mean — do not compute those dates yourself. Do NOT output generic action placeholders.\n\n`;
    }

    // 3. Home Assistant General States Context Check
    // NOTE: keep these specific. Short/common tokens like "ha", "what", "are",
    // "check" matched as substrings and injected the full ~1,600-entity summary
    // into almost every prompt.
    const haKeywords = ["home assistant", "light", "switch", "sensor", "device", "door", "lock", "thermostat", "temperature", "entity", "dashboard", "smart home", "turn on", "turn off", "climate", "garage", "motion", "occupancy", "briefing", "morning"];
    if (haKeywords.some(k => text.toLowerCase().includes(k)) && haCategories.lights) {
      extraContext += formatSmartHomeContext(haCategories, smartHomeStats) + '\n\n';
    }

    // 3.2. Wearable Health & Sleep Telemetry Check (Amazfit T-Rex 3 / Zepp)
    const healthRegex = /\b(sle+p|sle+pt|bed|rest|nap|wake|woke|health|fit|step|heart|pulse|bpm|hr|watch|amazfit|zepp|t-?rex|vital|readiness|stress|recovery|briefing|morning|workout)\w*/i;
    if (healthRegex.test(text)) {
      try {
        const healthData = await fetchHealthData();
        if (healthData) {
          extraContext += formatHealthContext(healthData) + '\n\n';
        }
      } catch (err) {
        console.warn('Could not inject live health data:', err?.message);
      }
    }

    // 3.5. Tracked Project Live Status Check (Projects & Builds panel).
    // Keep this keyword list specific for the same reason as the HA one
    // above — broad tokens caused false-positive context injection there.
    // Snapshots are captured (not just folded into the prompt) so the
    // ProjectStatusCard widget can render them from real fetched data
    // rather than depending on the model to restate numbers accurately.
    const projectsWithStatus = trackedProjects.filter(p => p.statusUrl);
    const projectStatusSnapshots = [];
    if (projectsWithStatus.length > 0) {
      const lowerText = text.toLowerCase();
      const projectKeywords = ["rip", "ripping", "disc", "encode", "encoding", "finished", "how's it going", "how is it going"];
      const matchedProjects = projectsWithStatus.filter(p =>
        lowerText.includes(p.name.toLowerCase()) || projectKeywords.some(k => lowerText.includes(k))
      );
      for (const proj of matchedProjects) {
        const statusData = await fetchProjectStatus(proj.statusUrl);
        if (statusData) {
          extraContext += formatProjectStatusContext(proj.name, statusData) + '\n\n';
          const summary = parseProjectStatusSummary(statusData);
          if (summary) projectStatusSnapshots.push({ name: proj.name, summary });
        }
      }
    }

    // 3.6. Finance Question Check. Same false-positive lesson as HA/Projects
    // above — keep keywords specific to actual finance questions.
    if (transactions.length > 0 || budgets.length > 0) {
      const lowerText = text.toLowerCase();
      const financeKeywords = ["spend", "spent", "budget", "expense", "income", "afford", "finances", "financial", "transaction", "how much did i"];
      const knownCategories = new Set([...transactions.map(t => t.category), ...budgets.map(b => b.category)]);
      const mentionsCategory = Array.from(knownCategories).some(c => lowerText.includes(c.toLowerCase()));
      if (financeKeywords.some(k => lowerText.includes(k)) || mentionsCategory) {
        extraContext += formatFinanceContext(transactions, budgets) + '\n\n';
      }
    }

    // 4. RAG Knowledge Base Search Context
    const ragContext = await ragEngineRef.current.search(text);
    if (ragContext) {
      extraContext += ragContext + '\n\n';
    }

    // 5. Web Search Context (if enabled)
    if (isWebSearchEnabled) {
      const searchResults = await searchWeb(text);
      if (searchResults) {
        extraContext += searchResults + '\n\n';
      }
    }

    // trimWhitespace only strips formatting noise (trailing spaces, runs of
    // blank lines) — safe against stripContextBoilerplate's regexes, which
    // only require the boundary blocks to end in >=2 newlines, still true
    // after collapsing 3+ down to 2.
    const fullPromptWithContext = extraContext
      ? `${trimWhitespace(extraContext)}\n\nUser Request: ${text}`
      : text;

    const userMessage = {
      role: 'user',
      content: text,
      image: finalImage,
      fileName,
      timestamp: new Date().toISOString()
    };

    const apiMessagesPayload = [
      ...buildApiMessages(activeMessages),
      {
        role: 'user',
        content: fullPromptWithContext,
        ...(finalImage ? { images: [stripImage(finalImage)] } : {})
      }
    ];

    setChats(prev => prev.map(c =>
      c.id === chatId
        ? {
            ...c,
            title: c.messages.length === 0 ? deriveChatTitle(text) : c.title,
            messages: [...c.messages, userMessage]
          }
        : c
    ));

    const modelToUse = finalImage ? 'minicpm-v' : selectedModel;

    await runModelTurn({
      chatId,
      apiMessages: apiMessagesPayload,
      modelToUse,
      extraFields: projectStatusSnapshots.length > 0 ? { projectStatuses: projectStatusSnapshots } : {},
      checkInAllowedByFaceId
    });
  };

  // Regenerate: drop the assistant message at `index` (and anything after
  // it — a later edit/regenerate should never leave orphaned tool-call
  // scaffolding behind it) and replay the same prior turn through
  // runModelTurn directly. No new user text exists here, so this
  // deliberately bypasses handleSendMessage's context-injection pipeline
  // (calendar/weather/HA/etc.) rather than re-deriving it — that pipeline
  // only makes sense for a freshly typed message.
  const handleRegenerate = async (index) => {
    if (!activeChatId || isStreaming) return;
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat) return;
    const truncated = chat.messages.slice(0, index);
    const lastUserMessage = [...truncated].reverse().find(m => m.role === 'user');
    if (!lastUserMessage) return; // nothing to regenerate from
    setChats(prev => prev.map(c => (c.id === activeChatId ? { ...c, messages: truncated } : c)));
    await runModelTurn({
      chatId: activeChatId,
      apiMessages: buildApiMessages(truncated),
      modelToUse: lastUserMessage.image ? 'minicpm-v' : selectedModel,
      // No fresh faceIdSignal to check against on a replay — fail open, the
      // same default handleSendMessage falls back to when none is passed.
      checkInAllowedByFaceId: true
    });
  };

  // Edit & resend: drop the user message at `index` and everything after
  // it, then hand the edited text to handleSendMessage exactly as if the
  // user had just typed it — that's what re-runs the full context pipeline
  // (calendar/weather/HA/vision/etc.) correctly for the new text rather
  // than duplicating that logic here.
  const handleEditMessage = async (index, newText) => {
    if (!activeChatId || isStreaming || !newText || !newText.trim()) return;
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat) return;
    const truncated = chat.messages.slice(0, index);
    setChats(prev => prev.map(c => (c.id === activeChatId ? { ...c, messages: truncated } : c)));
    await handleSendMessage(newText.trim());
  };

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden', background: '#10141f' }}>
      {(lockState === 'checking' || lockState === 'locked') && (
        <LockScreen
          checking={lockState === 'checking'}
          onUnlock={() => setLockState('unlocked')}
        />
      )}

      <Sidebar
        activeView={activeView}
        onSelectDashboard={handleSelectDashboard}
        onSelectChatView={handleSelectChatView}
        isOllamaConnected={isOllamaConnected}
        isPaused={isPaused}
        onTogglePause={handleTogglePause}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        currentPersona={currentPersona}
        onSelectView={(view) => setActiveView(view)}
        onOpenPersonaModal={() => setIsPersonaModalOpen(true)}
        onOpenMemoryModal={() => setActiveView('memory')}
        onOpenSkillsDashboard={() => setActiveView('skills')}
        onOpenProjectsPanel={() => setActiveView('projects')}
        projectLiveStatus={projectLiveStatus}
        onOpenFinancesPanel={() => setIsFinancesPanelOpen(true)}
        onOpenDevWorkspace={() => setActiveView('cauldron')}
        onOpenAthenaWorkspace={() => setActiveView('athena')}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        smartHomeStats={smartHomeStats}
        onOpenSmartHomeDrawer={() => setActiveView('smarthome')}
        mcpStatus={mcpStatus}
        escalationStats={escalationStats}
        connectedClients={connectedClients}
        skillsStats={skillsStats}
        securityStats={securityStats}
        llmVisionStats={llmVisionStats}
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={(id) => {
          setActiveChatId(id);
          setActiveView('chat');
        }}
        onNewChat={() => {
          handleNewChat();
          setActiveView('chat');
        }}
        onDeleteChat={handleDeleteChat}
      />

      {activeView === 'dashboard' && (
        <DashboardView
          userProfile={userProfile}
          isOllamaConnected={isOllamaConnected}
          isPaused={isPaused}
          onTogglePause={handleTogglePause}
          selectedModel={selectedModel}
          smartHomeStats={smartHomeStats}
          haCategories={haCategories}
          refreshHomeAssistant={refreshHomeAssistant}
          isHARefreshing={isHARefreshing}
          trackedProjects={trackedProjects}
          projectLiveStatus={projectLiveStatus}
          skillsStats={skillsStats}
          llmVisionStats={llmVisionStats}
          reminders={reminders}
          onAddReminder={handleAddReminder}
          onCompleteReminder={handleCompleteReminder}
          homeCoordinates={homeCoordinates}
          connectedClients={connectedClients}
          mcpStatus={mcpStatus}
          memories={memories}
          lastBackupStatus={lastBackupStatus}
          onBackupNow={handleBackupNow}
          isBackingUp={isBackingUp}
          isLockConfigured={isLockConfigured}
          vaultDir={vaultDir}
          uploadedDocuments={uploadedDocuments}
          isSyncingVault={isSyncingVault}
          onSyncVault={() => handleSyncVault()}
          onAskAloy={handleQuickPromptFromDashboard}
          onOpenSmartHomeDrawer={() => setActiveView('smarthome')}
          onOpenProjectsPanel={() => setActiveView('projects')}
          onOpenSkillsDashboard={() => setActiveView('skills')}
          onOpenFinancesPanel={() => setIsFinancesPanelOpen(true)}
          onOpenMemoryModal={() => setActiveView('memory')}
          onOpenDevWorkspace={() => setActiveView('cauldron')}
        />
      )}

      {activeView === 'inbox' && (
        <InboxView lockHistory={lockHistory} />
      )}

      {activeView === 'chat' && (
        <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', position: 'relative' }}>
          <div style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <ChatArea
              messages={activeMessages}
              isStreaming={isStreaming}
              currentStreamContent={currentStreamContent}
              onSendMessage={handleSendMessage}
              onRegenerate={handleRegenerate}
              onEditMessage={handleEditMessage}
              onStopStreaming={handleStopStreaming}
              isOllamaConnected={isOllamaConnected}
              isPaused={isPaused}
              currentPersona={currentPersona}
              selectedModel={selectedModel}
              onExecuteHAService={handleExecuteHAService}
              isWebSearchEnabled={isWebSearchEnabled}
              onToggleWebSearch={() => setIsWebSearchEnabled(prev => !prev)}
              uploadedDocuments={uploadedDocuments}
              onUploadDocument={handleUploadDocument}
              onRemoveDocument={handleRemoveDocument}
              vaultDir={vaultDir}
              isSyncingVault={isSyncingVault}
              vaultSyncStatus={vaultSyncStatus}
              onConnectVault={handleConnectVault}
              onSyncVault={() => handleSyncVault()}
              onDisconnectVault={handleDisconnectVault}
              budgetAlert={budgetAlert}
              anomalyAlert={anomalyAlert}
              onToolCallResponse={handleToolCallResponse}
              prefillText={chatPrefillText}
              onPrefillConsumed={() => setChatPrefillText('')}
              memories={memories}
              lastBackupStatus={lastBackupStatus}
              isLockConfigured={isLockConfigured}
              skillsStats={skillsStats}
              trackedProjects={trackedProjects}
              smartHomeStats={smartHomeStats}
              onOpenMemoryModal={() => setActiveView('memory')}
              onOpenSkillsDashboard={() => setActiveView('skills')}
              onOpenProjectsPanel={() => setActiveView('projects')}
              onOpenSmartHomeDrawer={() => setActiveView('smarthome')}
              onOpenDevWorkspace={() => setActiveView('cauldron')}
              onOpenDashboard={handleSelectDashboard}
              onOpenPersonaModal={() => setIsPersonaModalOpen(true)}
              onToggleCanvas={() => setIsContextCanvasOpen(prev => !prev)}
              isCanvasOpen={isContextCanvasOpen}
            />
          </div>

          {/* Right Split Context Canvas */}
          <ContextCanvas
            isOpen={isContextCanvasOpen}
            onClose={() => setIsContextCanvasOpen(false)}
            activeTab={contextCanvasTab}
            onSelectTab={setContextCanvasTab}
            haCategories={haCategories}
            onExecuteHAService={handleExecuteHAService}
            trackedProjects={trackedProjects}
            onAskAloy={(promptText) => {
              setChatPrefillText(promptText);
            }}
          />
        </div>
      )}

      {(activeView === 'hephaestus' || activeView === 'cauldron' || activeView === 'projects') && (
        <DevWorkspace
          isFullPage={true}
          initialTab={activeView === 'projects' ? 'projects' : 'cauldron'}
          projects={trackedProjects}
          onClose={() => setActiveView('chat')}
          onAddProject={handleAddProject}
          onRemoveProject={handleRemoveProject}
          onUpdateProject={handleUpdateProject}
          onAskAloy={(promptText) => {
            setActiveView('chat');
            setChatPrefillText(promptText);
          }}
        />
      )}

      {activeView === 'athena' && (
        <AthenaWorkspace
          isFullPage={true}
          onClose={() => setActiveView('chat')}
        />
      )}

      {activeView === 'media' && (
        <MediaDispatcherPanel
          isFullPage={true}
          onClose={() => setActiveView('chat')}
          onAskAloy={(promptText) => {
            setActiveView('chat');
            setChatPrefillText(promptText);
          }}
        />
      )}

      {activeView === 'mediastack' && (
        <MediaStackHub
          onClose={() => setActiveView('chat')}
        />
      )}

      {activeView === 'network' && (
        <RouteIntelligenceDashboard
          isFullPage={true}
          onClose={() => setActiveView('chat')}
          onAskAloy={(promptText) => {
            setActiveView('chat');
            setChatPrefillText(promptText);
          }}
        />
      )}

      {['subagents', 'apollo', 'minerva', 'hermes', 'skills', 'memory', 'profile', 'conclave', 'council'].includes(activeView) && (
        <SubAgentsHub
          key={activeView}
          initialAgent={activeView === 'skills' || activeView === 'memory' || activeView === 'profile' || activeView === 'subagents' ? 'apollo' : activeView}
          initialSubTab={activeView === 'skills' ? 'skills' : (activeView === 'memory' || activeView === 'profile' ? 'profile' : null)}
          haCategories={haCategories}
          onExecuteHAService={handleExecuteHAService}
          profileProps={{
            userProfile,
            onSaveProfile: setUserProfile,
            backupDir,
            onSetBackupDir: setBackupDir,
            autoBackupEnabled,
            onSetAutoBackupEnabled: setAutoBackupEnabled,
            isBackingUp,
            lastBackupStatus,
            onBackupNow: handleBackupNow,
            onRestoreBackup: handleRestoreBackup,
            isLockConfigured,
            onLockConfiguredChange: setIsLockConfigured
          }}
          onClose={() => setActiveView('chat')}
        />
      )}

      {activeView === 'smarthome' && (
        <SmartHomeDrawer
          isFullPage={true}
          categories={haCategories}
          onExecuteService={handleExecuteHAService}
          onRefresh={refreshHomeAssistant}
          isRefreshing={isHARefreshing}
        />
      )}

      {activeView === 'memory' && (
        <MemoryModal
          isFullPage={true}
          userProfile={userProfile}
          onSaveProfile={setUserProfile}
          memories={memories}
          onAddMemory={(newFact) => setMemories(prev => [...prev, newFact])}
          onDeleteMemory={(index) => setMemories(prev => prev.filter((_, i) => i !== index))}
          isElectron={!!window.electronAPI?.isElectron}
          backupDir={backupDir}
          onSetBackupDir={setBackupDir}
          autoBackupEnabled={autoBackupEnabled}
          onSetAutoBackupEnabled={setAutoBackupEnabled}
          isBackingUp={isBackingUp}
          lastBackupStatus={lastBackupStatus}
          onBackupNow={handleBackupNow}
          onRestoreBackup={handleRestoreBackup}
          isLockConfigured={isLockConfigured}
          onLockConfiguredChange={setIsLockConfigured}
        />
      )}

      {/* Floating Modals */}
      <FinancesPanel
        isOpen={isFinancesPanelOpen}
        onClose={() => setIsFinancesPanelOpen(false)}
        transactions={transactions}
        budgets={budgets}
        onAddTransaction={handleAddTransaction}
        onDeleteTransaction={handleDeleteTransaction}
        onSetBudget={handleSetBudget}
        onDeleteBudget={handleDeleteBudget}
      />

      <PersonaModal
        isOpen={isPersonaModalOpen}
        onClose={() => setIsPersonaModalOpen(false)}
        currentPersona={currentPersona}
        onSelectPersona={setCurrentPersona}
        customPersonas={customPersonas}
        onSaveCustomPersona={(persona) => setCustomPersonas(prev => [...prev, persona])}
        onDeleteCustomPersona={(id) => {
          setCustomPersonas(prev => prev.filter(p => p.id !== id));
          if (currentPersona?.id === id) setCurrentPersona(PRESET_PERSONAS[0]);
        }}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectView={(view) => {
          if (view === 'dashboard') handleSelectDashboard();
          else setActiveView(view);
        }}
        onAskAloy={(promptText) => {
          setActiveView('chat');
          setChatPrefillText(promptText);
        }}
        haCategories={haCategories}
        onExecuteHAService={handleExecuteHAService}
        trackedProjects={trackedProjects}
      />
    </div>
  );
}
