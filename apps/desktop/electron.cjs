require('./server/logger.cjs').installConsoleLogging();
const { app, BrowserWindow, shell, ipcMain, dialog, screen, globalShortcut } = require('electron');

// Packaged builds have hit a FATAL "GPU process isn't usable. Goodbye." crash
// on startup (repeated GPU process exits with STATUS_BREAKPOINT then a hard
// abort) that never showed up in dev mode. disableHardwareAcceleration() alone
// did NOT fix it — the GPU process still gets spawned for SwiftShader software
// rendering and still failed, so the failure is upstream of hw-accel, in
// process/sandbox creation itself (only the *signed, installed* exe hits this;
// dev mode's unsigned raw electron.exe from node_modules does not). Disabling
// the sandbox for the GPU process is the standard workaround for this crash
// shape. Both switches must be set before app.whenReady()/ready.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

// Safety net so one unexpected async error (e.g. an MCP child process's stdio
// pipe erroring after it's already exited) can't hard-crash the whole app the
// way an uncaught 'error' event normally kills a Node process. Log and keep
// running rather than losing the whole session over an isolated failure.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
const path = require('path');
const os = require('os');
const fs = require('fs');
const Module = require('module');

// Ensure server dependencies (express, ssh2, MCP SDK, etc.) resolve in packaged mode
const extraNodeModules = [
  path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules'),
  path.join(process.resourcesPath || '', 'node_modules'),
  path.join(__dirname, 'node_modules'),
  path.join(__dirname, '..', '..', 'node_modules')
];
const validPaths = extraNodeModules.filter(p => fs.existsSync(p));
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + validPaths.join(path.delimiter);
Module._initPaths();
for (const p of validPaths) {
  if (!Module.globalPaths.includes(p)) {
    Module.globalPaths.push(p);
  }
}

const net = require('net');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const { startAloyServer } = require('./server/aloyServer.cjs');
const { initMcpClients, getMcpToolDefinitions, callMcpTool, closeMcpClients } = require('./server/mcpClient.cjs');
const store = require('./server/store.cjs');
const lock = require('./server/lock.cjs');
const { getConfidenceLabel, getCachedOrEscalate, getEscalationStats } = require('./server/confidenceEscalation.cjs');
const { researchTopic } = require('./server/research.cjs');
const { getSkillsDashboard, runNightlyAutoTeaching } = require('./server/skillsDashboard.cjs');
const { getAutoRipStatusText } = require('./server/autoripStatus.cjs');
const { searchKnowledgeGraph } = require('./server/graphRAG.cjs');
const { runNewsScrape, isNewsScrapeInProgress } = require('./server/newsScraper.cjs');
const { proofreadDocumentRewrite } = require('./server/documentProofread.cjs');
const anydoc = require('@firecrawl/anydoc');
const { logToolCallSequence, getRelevantSkills } = require('./server/skillSynthesis.cjs');
const { getOrCreateToken } = require('./server/auth.cjs');
const { getConnectedClients } = require('./server/clientTracker.cjs');

// Domains shared between the desktop app and the mobile/API server, backed
// by the SAME store.json (server/store.cjs) via IPC below — the single
// source of truth fix for the chat-threads data-loss bug root-caused
// 2026-07-31. Desktop-only settings (Gaming Mode, personas, lock history,
// backup config) are NOT in this list and stay in the renderer's own
// localStorage, since the mobile/API server has no use for them.
const ALLOWED_STORE_KEYS = [
  'chats', 'transactions', 'budgets', 'reminders', 'memories',
  'trackedProjects', 'vaultDir', 'userProfile', 'claudeEscalations', 'workouts'
  // learnedKnowledge deliberately excluded — see the comment above its
  // renderer-state removal in App.jsx (2026-08-04): the automated nightly
  // teaching pass writes to it directly in this process; a renderer-synced
  // copy risked clobbering fresh entries with a stale local array.
];

// Loads VITE_HA_TOKEN (and anything else in .env) into process.env for the
// server's dynamically-imported service modules — Vite loads this itself
// for the renderer, but the main process needs it explicitly. Prefers the
// external ~/.aloy-server/.env (same directory as store.json/lock.json) so a
// packaged build's credentials live outside the asar and survive rebuilds;
// falls back to the project-root .env for dev-mode convenience.
const EXTERNAL_ENV_PATH = path.join(os.homedir(), '.aloy-server', '.env');
try {
  process.loadEnvFile(EXTERNAL_ENV_PATH);
} catch (externalErr) {
  try {
    process.loadEnvFile(path.join(__dirname, '.env'));
  } catch (err) {
    console.warn('No .env file found for the main process (HA token will be unavailable to the Aloy server):', err.message);
  }
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Aloy',
    show: true,
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // webSecurity was disabled to let the renderer reach Home Assistant
      // directly. It no longer needs to: HA now goes through /api/ha-proxy on
      // this app's own server. Turning same-origin policy back on matters here
      // because this renderer displays model output, news summaries and scraped
      // web content.
      webSecurity: true,
    },
  });

  mainWindow.show();
  mainWindow.focus();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    try {
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setAlwaysOnTop(false);
    } catch {}
  });

  // Handle permission requests (e.g., webcam/camera and microphone access)
  const allowedPermissions = ['media', 'camera', 'microphone', 'notifications', 'audioCapture', 'videoCapture', 'speaker-selection', 'display-capture'];
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => true);
  mainWindow.webContents.session.setDevicePermissionHandler(() => true);

  // Open target URL or dist HTML
  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL) && !app.isPackaged && !__dirname.includes('resources');

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  // Open external links in user's default web browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

let hudWindow = null;

function createHudWindow(initiallyExpanded = false) {
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.show();
    hudWindow.focus();
    return hudWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const hudWidth = initiallyExpanded ? 430 : 28;
  const hudHeight = screenHeight;
  const hudX = Math.round(primaryDisplay.bounds.x + screenWidth - hudWidth);
  const hudY = Math.round(primaryDisplay.bounds.y);

  hudWindow = new BrowserWindow({
    width: hudWidth,
    height: hudHeight,
    x: hudX,
    y: hudY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // webSecurity was disabled to let the renderer reach Home Assistant
      // directly. It no longer needs to: HA now goes through /api/ha-proxy on
      // this app's own server. Turning same-origin policy back on matters here
      // because this renderer displays model output, news summaries and scraped
      // web content.
      webSecurity: true,
    },
  });

  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  if (hudWindow.setVisibleOnAllWorkspaces) {
    hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  const isDev = Boolean(process.env.VITE_DEV_SERVER_URL) && !app.isPackaged && !__dirname.includes('resources');

  hudWindow.webContents.session.clearCache().catch(() => {});

  if (isDev) {
    const devUrl = (process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173') + '?view=hud';
    hudWindow.loadURL(devUrl).catch(() => {
      hudWindow.loadFile(path.join(__dirname, 'dist', 'index.html'), { query: { view: 'hud' } });
    });
  } else {
    hudWindow.loadFile(path.join(__dirname, 'dist', 'index.html'), { query: { view: 'hud' } });
  }

  hudWindow.on('closed', () => {
    hudWindow = null;
  });

  return hudWindow;
}

// IPC Handlers for Local File & Folder Access
ipcMain.handle('app:getBuildInfo', () => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'server', 'buildInfo.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    // Generated at build time by scripts/genBuildInfo.cjs — absent in a
    // checkout that hasn't run a build/dev script yet.
    return { version: app.getVersion(), gitSha: 'unknown', gitBranch: 'unknown', dirty: false, builtAt: null };
  }
});

ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('fs:scanFolder', async (event, folderPath) => {
  try {
    const files = [];
    const readDirRecursive = (dir, depth = 0) => {
      if (depth > 4) return; // limit depth to prevent hanging on huge system dirs
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        if (entry.isDirectory()) {
          readDirRecursive(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const stats = fs.statSync(fullPath);
          files.push({
            name: entry.name,
            path: fullPath,
            ext,
            size: stats.size
          });
        }
      }
    };
    readDirRecursive(folderPath);
    return { success: true, files };
  } catch (err) {
    return { success: false, error: err.message, files: [] };
  }
});

ipcMain.handle('fs:readFile', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > 10 * 1024 * 1024) { // limit 10MB per file for text indexing
      return { success: false, error: 'File size exceeds 10MB limit' };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Aloy self-modification (Tier 2: model proposes, human confirms via the
// existing chat tool-call confirmation card, nothing auto-builds/installs —
// see src/services/tools.js's read_own_ui_source/propose_ui_change).
// Deliberately its own narrow channel, NOT the general-purpose fs:readFile
// above — that one takes an arbitrary absolute path (fine for a user-driven
// file picker) but would be too broad for a model-initiated call. Scoped
// strictly to this project's src/, and only wired up in dev: __dirname
// resolves to the real project folder when running `electron .`/`npm run
// dev`, but points inside the read-only packaged asar in a built app, where
// "self-modification" has no sensible target anyway.
const UI_SRC_ROOT = path.join(__dirname, 'src');
const UI_PENDING_DIR = path.join(__dirname, '.pending-ui-changes');

function resolveUiSourcePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('A file path is required.');
  }
  const resolved = path.resolve(UI_SRC_ROOT, relativePath);
  if (resolved !== UI_SRC_ROOT && !resolved.startsWith(UI_SRC_ROOT + path.sep)) {
    throw new Error('That path is outside src/ — refused.');
  }
  return resolved;
}

ipcMain.handle('ui-source:available', () => !app.isPackaged);

ipcMain.handle('ui-source:read', (event, relativePath) => {
  if (app.isPackaged) return { success: false, error: 'Self-modification is only available when running the dev build (npm run dev).' };
  try {
    const full = resolveUiSourcePath(relativePath);
    const content = fs.readFileSync(full, 'utf-8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Local models were observed emitting a LITERAL two-character
// "\n" text sequence inside multi-line old_string/new_string tool-call
// arguments instead of a real newline byte — every multi-line proposal
// failed "not found" until this normalization was added, confirmed live:
// 4 straight attempts to edit the New Chat button all failed pre-fix, all
// for this exact reason (checked via each attempt's actual arguments).
function normalizeLiteralEscapes(s) {
  return s.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

function countOccurrences(haystack, needle) {
  return needle ? haystack.split(needle).length - 1 : 0;
}

// Targeted find/replace, not full-file rewrite — asking a local model to
// reproduce an entire file verbatim except one change is a known failure
// mode (truncation, silent corruption) for models this size. old_string
// must match exactly once, mirroring how Claude Code's own Edit tool works,
// so an ambiguous or stale proposal fails loudly instead of guessing.
ipcMain.handle('ui-source:propose', (event, { relativePath, oldString, newString, reason }) => {
  if (app.isPackaged) return { success: false, error: 'Self-modification is only available when running the dev build (npm run dev).' };
  try {
    const full = resolveUiSourcePath(relativePath);
    const current = fs.readFileSync(full, 'utf-8');

    let searchStr = oldString;
    let replaceStr = newString;
    let occurrences = countOccurrences(current, searchStr);
    if (occurrences !== 1) {
      // Fallback: the model's own literal "\n"/"\t" text, not real
      // whitespace — retry with those normalized before giving up.
      const normalizedOld = normalizeLiteralEscapes(oldString);
      if (normalizedOld !== oldString && countOccurrences(current, normalizedOld) === 1) {
        searchStr = normalizedOld;
        replaceStr = normalizeLiteralEscapes(newString);
        occurrences = 1;
      }
    }

    if (occurrences === 0) {
      return { success: false, error: 'old_string was not found in the file — re-read it with read_own_ui_source and match the exact current text (including real line breaks, not literal \\n).' };
    }
    if (occurrences > 1) {
      return { success: false, error: `old_string appears ${occurrences} times — include more surrounding context so it matches exactly one location.` };
    }

    if (!fs.existsSync(UI_PENDING_DIR)) fs.mkdirSync(UI_PENDING_DIR);
    const stamp = Date.now();
    const safeName = relativePath.replace(/[\\/]/g, '_');
    const backupPath = path.join(UI_PENDING_DIR, `${stamp}__${safeName}.bak`);
    fs.writeFileSync(backupPath, current, 'utf-8');
    fs.writeFileSync(path.join(UI_PENDING_DIR, `${stamp}__${safeName}.reason.txt`), reason || '(no reason given)', 'utf-8');
    // split/join, not .replace(str, str) — String.replace interprets $-patterns
    // (e.g. $&, $1) in the REPLACEMENT string even for a plain-string search,
    // and this codebase's JSX is full of template literals containing ${...}.
    const updated = current.split(searchStr).join(replaceStr);
    fs.writeFileSync(full, updated, 'utf-8');
    return {
      success: true,
      message: `Applied to src/${relativePath} (reason: ${reason || 'none given'}). This is NOT live yet — it needs a rebuild (npm run electron:build) and reinstall. Previous content backed up to ${path.basename(backupPath)}; run "git diff" to review exactly what changed before rebuilding.`
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Dev Workspace backlog — a place to capture UI-change ideas (from the user
// typing directly into the panel, from Aloy via the suggest_ui_change tool,
// or Aloy suggesting one unprompted mid-conversation) WITHOUT touching any
// source file. Turning an idea into a real edit still goes through the full
// read_own_ui_source -> propose_ui_change -> chat confirmation flow above —
// this is purely a planning list. Same file-based storage approach as the
// propose/backup mechanism, same dev-only gate (no sensible target in a
// packaged build), single JSON array file, no need for the shared
// multi-domain store.cjs since this is desktop-dev-only, not mobile-synced.
const DEV_IDEAS_PATH = path.join(UI_PENDING_DIR, 'ideas.json');

function readDevIdeas() {
  if (!fs.existsSync(DEV_IDEAS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(DEV_IDEAS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function writeDevIdeas(ideas) {
  if (!fs.existsSync(UI_PENDING_DIR)) fs.mkdirSync(UI_PENDING_DIR);
  fs.writeFileSync(DEV_IDEAS_PATH, JSON.stringify(ideas, null, 2), 'utf-8');
}

ipcMain.handle('dev-ideas:list', () => {
  if (app.isPackaged) return [];
  return readDevIdeas();
});

ipcMain.handle('dev-ideas:add', (event, { title, description, targetFile, source }) => {
  if (app.isPackaged) return { success: false, error: 'Only available when running the dev build.' };
  if (!title || !title.trim()) return { success: false, error: 'A title is required.' };
  const ideas = readDevIdeas();
  const idea = {
    id: `idea-${Date.now()}`,
    title: title.trim(),
    description: (description || '').trim(),
    targetFile: targetFile || null,
    source: source === 'aloy' ? 'aloy' : 'user',
    status: 'idea',
    createdAt: new Date().toISOString()
  };
  ideas.unshift(idea);
  writeDevIdeas(ideas);
  return { success: true, idea };
});

ipcMain.handle('dev-ideas:updateStatus', (event, { id, status }) => {
  if (app.isPackaged) return { success: false, error: 'Only available when running the dev build.' };
  if (!['idea', 'applied', 'dismissed'].includes(status)) return { success: false, error: 'Invalid status.' };
  const ideas = readDevIdeas();
  const idea = ideas.find((i) => i.id === id);
  if (!idea) return { success: false, error: 'Idea not found.' };
  idea.status = status;
  writeDevIdeas(ideas);
  return { success: true };
});

ipcMain.handle('dev-ideas:delete', (event, id) => {
  if (app.isPackaged) return { success: false, error: 'Only available when running the dev build.' };
  writeDevIdeas(readDevIdeas().filter((i) => i.id !== id));
  return { success: true };
});

// IPC Handlers for the Projects & Builds monitoring panel. These act only on
// project folders and commands the user explicitly configured in the UI —
// never on LLM-suggested content — so no extra confirmation gate is needed
// here (unlike the chat's exec_command path, which handles untrusted output).
ipcMain.handle('git:status', async (event, folderPath) => {
  return new Promise((resolve) => {
    exec('git status --porcelain --branch', { cwd: folderPath, timeout: 10000 }, (err, stdout) => {
      if (err) {
        resolve({ isGitRepo: false });
        return;
      }
      const lines = stdout.split('\n').filter(Boolean);
      const branchLine = lines.find(l => l.startsWith('##')) || '';
      const branchMatch = branchLine.match(/^## ([^.[]+)/);
      const aheadMatch = branchLine.match(/ahead (\d+)/);
      const behindMatch = branchLine.match(/behind (\d+)/);
      resolve({
        isGitRepo: true,
        branch: branchMatch ? branchMatch[1].trim() : 'unknown',
        ahead: aheadMatch ? parseInt(aheadMatch[1], 10) : 0,
        behind: behindMatch ? parseInt(behindMatch[1], 10) : 0,
        uncommittedCount: lines.filter(l => !l.startsWith('##')).length
      });
    });
  });
});

ipcMain.handle('net:checkPort', async (event, port) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (isOpen) => {
      socket.destroy();
      resolve(isOpen);
    };
    socket.setTimeout(800);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(Number(port), '127.0.0.1');
  });
});

ipcMain.handle('ports:list', async () => {
  const { listListeningPorts } = require('./server/portManager.cjs');
  return listListeningPorts();
});

ipcMain.handle('ports:kill', async (event, port) => {
  const { killProcessOnPort } = require('./server/portManager.cjs');
  return await killProcessOnPort(Number(port));
});

ipcMain.handle('build:run', async (event, { folderPath, command }) => {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    exec(command, { cwd: folderPath, timeout: 10 * 60 * 1000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        success: !err,
        durationMs: Date.now() - startedAt,
        output: (stdout || '').slice(-4000),
        error: err ? (stderr || err.message || '').slice(-2000) : ''
      });
    });
  });
});

// Fetches a project's status URL (e.g. a local Flask/Node dev server's JSON
// status endpoint) from the main process rather than the renderer, so it
// isn't subject to the target server's CORS headers (most small local
// scripts don't set any).
ipcMain.handle('net:fetchStatusUrl', async (event, url) => {
  return new Promise((resolve) => {
    let client;
    try {
      client = url.startsWith('https:') ? https : http;
    } catch {
      resolve({ success: false, error: 'Invalid URL' });
      return;
    }
    const req = client.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ success: true, data: JSON.parse(body) });
        } catch {
          resolve({ success: true, data: body });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Request timed out' });
    });
    req.on('error', (err) => resolve({ success: false, error: err.message }));
  });
});

// IPC Handlers for local/NAS backup & restore. Writes go only to a directory
// the user configured in the UI (default their mapped NAS drive) — never to
// LLM-suggested paths — so this doesn't need the confirmation gate that the
// chat's tool-call paths require.
//
// Server-only store.cjs domains — deliberately never mirrored into the
// desktop renderer's localStorage (see store.cjs's own comments on
// claudeEscalations/learnedKnowledge for why: avoiding the exact stale-
// renderer-copy-overwrites-fresh-data bug class the 2026-07-31 chat-loss
// incident was), which means src/services/backup.js's localStorage-based
// collectBackupData() structurally can't see them. Added 2026-08-04 after
// confirming these were NOT covered by the NAS backup at all — merged in
// here (main process, has direct store.cjs access) under a separate
// `serverStore` key so it's clear in the backup file which half came from
// the renderer vs. the server-only store.
const SERVER_ONLY_BACKUP_DOMAINS = ['claudeEscalations', 'learnedKnowledge', 'lessons', 'skills', 'toolCallLog', 'documentProofreadHistory'];
ipcMain.handle('backup:write', async (event, { dir, data }) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const storeData = store.load();
    const serverStore = {};
    for (const key of SERVER_ONLY_BACKUP_DOMAINS) serverStore[key] = storeData[key] || [];
    const fullData = { ...data, serverStore };
    const serialized = JSON.stringify(fullData, null, 2);

    const latestPath = path.join(dir, 'aloy-backup-latest.json');
    fs.writeFileSync(latestPath, serialized, 'utf-8');

    // Keep one dated snapshot per day (not on every write) as a rollback
    // point in case a bad in-app state gets backed up over the good one.
    const dateStr = new Date().toISOString().slice(0, 10);
    const datedPath = path.join(dir, `aloy-backup-${dateStr}.json`);
    if (!fs.existsSync(datedPath)) {
      fs.writeFileSync(datedPath, serialized, 'utf-8');
    }

    return { success: true, path: latestPath, timestamp: new Date().toISOString() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('backup:read', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    // Restore server-only domains (see SERVER_ONLY_BACKUP_DOMAINS above)
    // straight into store.json here, since only the main process can reach
    // it — the renderer's own restoreBackupData() only knows how to write
    // localStorage. Only overwrites fields actually present in the backup,
    // so an older backup taken before this existed can't wipe live data
    // with an implicit empty array. This handler has exactly one caller
    // (restoreFromFile, only reachable via the user explicitly clicking
    // Restore in the UI), so restoring as a side effect of "read" is safe
    // here — it is never used for passive inspection.
    if (data.serverStore) {
      const storeData = store.load();
      for (const key of SERVER_ONLY_BACKUP_DOMAINS) {
        if (data.serverStore[key] !== undefined) storeData[key] = data.serverStore[key];
      }
      store.save(storeData);
    }
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('backup:selectRestoreFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Aloy Backup', extensions: ['json'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Creates a markdown note inside a user-configured Obsidian vault folder.
// The filename is model-influenced (via the create_obsidian_note tool), so
// it's sanitized to a bare name with no path separators and re-verified to
// still resolve inside vaultDir before writing — defense in depth against a
// filename like "../../evil" even though the sanitize step already strips it.
ipcMain.handle('obsidian:createNote', async (event, { vaultDir, filename, content }) => {
  try {
    const safeName = String(filename).replace(/[\\/:*?"<>|]/g, '').trim();
    if (!safeName) return { success: false, error: 'Invalid filename' };
    const finalName = safeName.toLowerCase().endsWith('.md') ? safeName : `${safeName}.md`;
    const fullPath = path.join(vaultDir, finalName);

    const resolvedVault = path.resolve(vaultDir);
    const resolvedPath = path.resolve(fullPath);
    if (!resolvedPath.startsWith(resolvedVault + path.sep)) {
      return { success: false, error: 'Resolved path escaped the vault directory' };
    }

    fs.writeFileSync(fullPath, content, 'utf-8');
    return { success: true, path: fullPath, filename: finalName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Spawning MCP servers (npx/uvx child processes) takes longer than the
// renderer takes to mount and request the tool list — mcp:listTools awaits
// initMcpClients() (memoized in mcpClient.cjs) instead of racing it, so the
// first request always sees the real tool set.
ipcMain.handle('mcp:listTools', async () => {
  await initMcpClients();
  return { success: true, tools: getMcpToolDefinitions() };
});

ipcMain.handle('mcp:callTool', async (event, { name, args }) => {
  try {
    return await callMcpTool(name, args);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Single source of truth for the 8 domains shared with the mobile/API
// server — same store.cjs functions aloyServer.cjs's Express routes use.
// No `await` between load() and save() here: both are synchronous fs
// calls, so this stays atomic relative to any other store.cjs consumer
// (Node's single-threaded event loop can't interleave two synchronous
// blocks) — do not turn this into an async read-then-write across a tick.
ipcMain.handle('store:get', () => {
  return store.load();
});

ipcMain.handle('store:save', (event, { key, value }) => {
  if (!ALLOWED_STORE_KEYS.includes(key)) {
    return { success: false, error: `"${key}" is not a shared store key.` };
  }
  const d = store.load();
  d[key] = value;
  store.save(d);
  return { success: true };
});

// Confidence scoring + Claude escalation (server/confidenceEscalation.cjs),
// split into two IPC calls so the renderer can run getConfidenceLabel in the
// background AFTER the local answer is already showing, and only make the
// (slower) escalate call when that comes back low-confidence — see the
// onComplete background block in App.jsx. Both keep the Anthropic API key
// server-side only; it never reaches the renderer bundle.
ipcMain.handle('confidence:check', async (event, { model, question, answer }) => {
  try {
    return await getConfidenceLabel({ model, question, answer });
  } catch (err) {
    console.warn('[confidence:check] failed, treating as confident:', err.message);
    return { label: 'HIGH', probability: 1, lowConfidence: false, error: err.message };
  }
});

ipcMain.handle('confidence:escalate', async (event, { question, localAnswer }) => {
  try {
    const result = await getCachedOrEscalate({ question, localAnswer });
    return { success: true, ...result };
  } catch (err) {
    console.warn('[confidence:escalate] failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('confidence:stats', () => getEscalationStats());

// Fire-once-per-local-day gate for the desktop path's own buildSystemInstruction
// (App.jsx) — mirrors aloyServer.cjs's identical inline call for the mobile
// path, both against the same shared store.json so only one platform's first
// message of the day actually includes the check-in line, whichever gets
// there first. See store.cjs's maybeConsumeDailyCheckIn for the shared logic.
ipcMain.handle('checkin:shouldInclude', () => store.maybeConsumeDailyCheckIn());

// Desktop app-lock (PIN), added 2026-08-03. Recovery if the PIN is ever
// forgotten: delete lock.cjs's LOCK_PATH file (~/.aloy-server/lock.json) —
// verifyPin() treats "no file" as verified, so deleting it fully resets the
// lock without touching any other data. setup only succeeds when no PIN
// exists yet; changing/clearing an existing one always requires the current
// PIN — none of these accept a plaintext PIN over IPC without a check.
ipcMain.handle('lock:isConfigured', () => lock.isConfigured());
ipcMain.handle('lock:verifyPin', (event, pin) => lock.verifyPin(pin));
ipcMain.handle('lock:setup', (event, newPin) => {
  if (lock.isConfigured()) return { success: false, error: 'A PIN is already set — use change instead.' };
  if (!newPin || String(newPin).length < 4) return { success: false, error: 'PIN must be at least 4 digits.' };
  lock.setPin(newPin);
  return { success: true };
});
ipcMain.handle('lock:changePin', (event, { currentPin, newPin }) => {
  if (!lock.verifyPin(currentPin)) return { success: false, error: 'Incorrect current PIN.' };
  if (!newPin || String(newPin).length < 4) return { success: false, error: 'PIN must be at least 4 digits.' };
  lock.setPin(newPin);
  return { success: true };
});
ipcMain.handle('lock:clearPin', (event, currentPin) => {
  if (!lock.verifyPin(currentPin)) return { success: false, error: 'Incorrect PIN.' };
  lock.clearPin();
  return { success: true };
});

// Research pipeline (desktop path) — the actual Claude+web-search call has
// to happen here (main process), never in the renderer, same reasoning as
// confidence:escalate above (API key stays server-side). Read-only: saving
// the result to learnedKnowledge goes through the existing generic
// store:save channel from the renderer, not through this handler.
ipcMain.handle('research:topic', async (event, topic) => {
  try {
    return { success: true, ...(await researchTopic({ topic })) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('dashboard:skills', async () => await getSkillsDashboard());

// Real structural document conversion (harvested from firecrawl/anydoc,
// 2026-08-12) — replaces the old renderer-side pdfjs-dist/mammoth raw-text
// extraction, which flattened headings/tables/lists into plain text that
// mineruNormalizer.cjs then had to regex-guess back into shape. anydoc is a
// native Rust addon (napi-rs), so it can only run here in the main process
// (the renderer has nodeIntegration:false) — bytes come over IPC from
// fileparser.js and real Markdown goes back. Also the first place this app
// gains real xlsx/pptx/csv/epub/rtf/odt support — the old path silently
// mis-parsed all of those as plain text.
ipcMain.handle('document:parse', async (_event, { bytes, filename }) => {
  try {
    const buffer = Buffer.from(bytes);
    const format = filename ? anydoc.formatFromExtension(filename.split('.').pop().toLowerCase()) : null;
    const markdown = await anydoc.toMarkdownBytes(buffer, format);
    return { success: true, markdown };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('document:proofread', async (event, originalDocument, localResponse) => {
  try {
    const result = await proofreadDocumentRewrite({ originalDocument, localResponse });
    store.logDocumentProofread(result);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Direct store write (not the generic store:get/store:save channel — see
// the ALLOWED_STORE_KEYS comment on why learnedKnowledge is excluded from
// that renderer-synced path) for the save_researched_knowledge tool.
ipcMain.handle('knowledge:save', async (event, entry) => {
  const { embedKnowledgeEntry } = require('./server/knowledgeRetrieval.cjs');
  const embedded = await embedKnowledgeEntry(entry);
  const d = store.load();
  d.learnedKnowledge = [...(d.learnedKnowledge || []), embedded];
  store.save(d);
  return { success: true };
});

// Relevance-scored learnedKnowledge lookup for the current question — see
// server/knowledgeRetrieval.cjs. Desktop's buildSystemInstruction (renderer)
// has no direct store/Ollama access, hence the IPC hop.
ipcMain.handle('knowledge:relevant', async (event, questionText) => {
  const { getRelevantKnowledge } = require('./server/knowledgeRetrieval.cjs');
  const { stripContextBoilerplate } = require('./server/confidenceEscalation.cjs');
  return await getRelevantKnowledge(stripContextBoilerplate(questionText || ''));
});

// Same direct-write pattern as knowledge:save, for the save_lesson tool.
ipcMain.handle('lesson:save', (event, entry) => {
  const d = store.load();
  d.lessons = [...(d.lessons || []), entry];
  store.save(d);
  return { success: true };
});

ipcMain.handle('lesson:list', () => store.load().lessons || []);

// Skill synthesis from repeated tool-call sequences — see
// server/skillSynthesis.cjs. logToolSequence is fire-and-forget from the
// renderer (never awaited on the critical chat path); getRelevantSkills
// feeds buildSystemInstruction the same way lesson/knowledge lookups do.
ipcMain.handle('skills:logToolSequence', async (event, question, toolSequence) => {
  try {
    return await logToolCallSequence({ question, toolSequence });
  } catch (err) {
    console.warn('[skills:logToolSequence] failed:', err.message);
    return null;
  }
});
ipcMain.handle('skills:relevant', async (event, question) => {
  try {
    return await getRelevantSkills(question);
  } catch {
    return [];
  }
});

// Manual "run tonight's batch early" escape hatch — no UI button currently
// calls this (the nightly scheduler in aloyServer.cjs handles it
// automatically), kept wired in case it's ever needed directly.
ipcMain.handle('skills:autoresolve', async () => {
  try {
    const result = await runNightlyAutoTeaching();
    return { success: true, ...result, dashboard: await getSkillsDashboard() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Lets the renderer attach the same Bearer token the main aloyServer uses
// (server/auth.cjs) to its own direct fetch() calls against the local
// sidecar servers (system monitor, whisper, kokoro, face — ports 8888-8891),
// which now require it. getOrCreateToken() just re-reads the same on-disk
// token aloyServer.cjs already created, no separate secret involved.
ipcMain.handle('server:getToken', () => getOrCreateToken());

// "Clients connected" sidebar widget — same in-process data aloyServer.cjs's
// own /api/clients route serves to mobile, read directly here since the
// desktop renderer talks to the main process via IPC rather than its own
// HTTP round trip.
ipcMain.handle('server:getConnectedClients', () => getConnectedClients());

ipcMain.handle('autorip:status', () => getAutoRipStatusText());

// No live haCategories in the main process (that's polled inside
// aloyServer.cjs for the mobile path) — desktop's graph search covers
// memories/learnedKnowledge only, not live HA topology.
ipcMain.handle('knowledge:searchGraph', (event, query) => searchKnowledgeGraph(query, null));

// Tech news — same direct in-process store access as autorip:status above,
// not an HTTP call to aloyServer.cjs's :7890 API (which mobile uses instead,
// since mobile has no other way to reach this process).
ipcMain.handle('news:get', () => (store.load().newsArticles || []).filter((a) => a.relevant));
ipcMain.handle('news:getSources', () => store.load().newsSources || []);
ipcMain.handle('news:setSources', (event, sources) => {
  const { normalizeNewsSources } = require('./server/newsScraper.cjs');
  const d = store.load();
  d.newsSources = normalizeNewsSources(sources);
  store.save(d);
  return d.newsSources;
});
ipcMain.handle('news:getInterests', () => store.load().newsInterests || []);
ipcMain.handle('news:setInterests', (event, interests) => {
  const d = store.load();
  d.newsInterests = interests;
  store.save(d);
  return d.newsInterests;
});
// Fire-and-forget, same reasoning as aloyServer.cjs's /api/news/refresh —
// scoring a real batch of articles through the local model measured over
// 2 minutes live, far too slow to hold an IPC call open for a UI button.
// isNewsScrapeInProgress() is shared state inside newsScraper.cjs itself
// (not a locally-owned flag here) — this same Electron main process also
// runs aloyServer.cjs's scheduled job and its own /api/news/refresh route
// against the same store.json, so the guard has to be centralized to
// actually prevent a desktop+mobile double-trigger race.
ipcMain.handle('news:refresh', () => {
  if (isNewsScrapeInProgress()) return { success: false, error: 'A refresh is already in progress.' };
  runNewsScrape()
    .then((result) => console.log(`News refresh (desktop manual): ${result.rawArticlesFound} found, ${result.newArticlesScored} scored, ${result.relevantCount} relevant.`))
    .catch((err) => console.error('Desktop manual news refresh failed:', err.message));
  return { success: true, started: true };
});
ipcMain.handle('news:refreshStatus', () => ({
  inProgress: isNewsScrapeInProgress(),
  lastScrapeAt: store.load().lastNewsScrapeAt
}));

ipcMain.handle('knowledge:delete', (event, id) => {
  const d = store.load();
  d.learnedKnowledge = (d.learnedKnowledge || []).filter((k) => k.id !== id);
  store.save(d);
  return { success: true, learnedKnowledge: d.learnedKnowledge };
});

ipcMain.handle('escalation:delete', (event, id) => {
  const d = store.load();
  d.claudeEscalations = (d.claudeEscalations || []).filter((e) => e.timestamp !== id && e.id !== id);
  store.save(d);
  return { success: true, claudeEscalations: d.claudeEscalations };
});

ipcMain.handle('system:selfTest', async () => {
  const { runSelfDiagnostics } = require('./server/aloySelfTest.cjs');
  return runSelfDiagnostics();
});

ipcMain.handle('models:route', async (_event, messages) => {
  const { routeModelRequest } = require('./server/modelRouter.cjs');
  return routeModelRequest(messages || []);
});

ipcMain.handle('system:dependencyHealth', async () => {
  const checks = {};

  try {
    const oRes = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    checks.ollama = { status: oRes.ok ? 'online' : 'degraded', code: oRes.status };
  } catch (err) {
    checks.ollama = { status: 'offline', error: err.message };
  }

  try {
    const wRes = await fetch('http://127.0.0.1:8890/health', { signal: AbortSignal.timeout(1500) });
    checks.whisper = { status: wRes.ok ? 'online' : 'degraded', code: wRes.status };
  } catch (err) {
    checks.whisper = { status: 'offline', error: err.message };
  }

  try {
    const kRes = await fetch('http://127.0.0.1:8888/voices', { signal: AbortSignal.timeout(1500) });
    checks.kokoro = { status: kRes.ok ? 'online' : 'degraded', code: kRes.status };
  } catch (err) {
    checks.kokoro = { status: 'offline', error: err.message };
  }

  try {
    const jRes = await fetch('http://127.0.0.1:8096/System/Info/Public', { signal: AbortSignal.timeout(1500) });
    checks.jellyfin = { status: jRes.ok ? 'online' : 'degraded', code: jRes.status };
  } catch (err) {
    checks.jellyfin = { status: 'offline', error: err.message };
  }

  try {
    const mRes = await fetch('http://127.0.0.1:8765', { signal: AbortSignal.timeout(1500) });
    checks.mindwalk = { status: mRes.ok ? 'online' : 'degraded', code: mRes.status };
  } catch (err) {
    checks.mindwalk = { status: 'offline', error: err.message };
  }

  checks.backupDriveZ = { status: fs.existsSync('Z:\\') ? 'mounted' : 'unmounted', path: 'Z:\\' };
  checks.mediaDriveP = { status: fs.existsSync('P:\\') ? 'mounted' : 'unmounted', path: 'P:\\' };

  try {
    const aKey = process.env.ANTHROPIC_API_KEY;
    if (!aKey) {
      checks.anthropicApiKey = { configured: false, status: 'missing' };
    } else {
      const aRes = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': aKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(3000)
      });
      if (aRes.ok) {
        checks.anthropicApiKey = { configured: true, status: 'valid', code: 200 };
      } else if (aRes.status === 401) {
        checks.anthropicApiKey = { configured: true, status: 'invalid_key', error: 'Unauthorized (401)' };
      } else {
        const errData = await aRes.json().catch(() => ({}));
        const msg = errData?.error?.message || `HTTP ${aRes.status}`;
        checks.anthropicApiKey = { configured: true, status: msg.includes('credit') ? 'low_credits' : 'degraded', warning: msg };
      }
    }
  } catch (err) {
    checks.anthropicApiKey = { configured: true, status: 'unreachable', error: err.message };
  }

  try {
    const gKey = process.env.GEMINI_API_KEY;
    if (!gKey) {
      checks.geminiApiKey = { configured: false, status: 'missing' };
    } else {
      const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${gKey}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (gRes.ok) {
        checks.geminiApiKey = { configured: true, status: 'valid', code: 200 };
      } else {
        checks.geminiApiKey = { configured: true, status: 'invalid_key', error: `HTTP ${gRes.status}` };
      }
    }
  } catch (err) {
    checks.geminiApiKey = { configured: true, status: 'unreachable', error: err.message };
  }

  const overallHealthy = Object.values(checks).every(c => c.status !== 'offline' && c.status !== 'invalid_key');
  return { status: overallHealthy ? 'healthy' : 'degraded', timestamp: new Date().toISOString(), dependencies: checks };
});

app.whenReady().then(() => {
  createWindow();
  const storeData = store.load();
  if (storeData.hudAutoLaunch !== false) {
    createHudWindow();
  }
  startAloyServer(7890, {
    openHud: () => {
      if (hudWindow && !hudWindow.isDestroyed()) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        const hudWidth = 430;
        const hudHeight = screenHeight;
        const hudX = Math.round(primaryDisplay.bounds.x + screenWidth - hudWidth);
        const hudY = Math.round(primaryDisplay.bounds.y);
        hudWindow.setBounds({ x: hudX, y: hudY, width: hudWidth, height: hudHeight });
        hudWindow.show();
        hudWindow.webContents.send('hud:focus');
        hudWindow.focus();
      } else {
        createHudWindow();
      }
    }
  }).catch((err) => console.error('Aloy server failed to start:', err));
  initMcpClients().catch((err) => console.error('MCP client init failed:', err));
  try {
    const { ensureMindwalkRunning } = require('./server/mindwalkAdapter.cjs');
    ensureMindwalkRunning().catch((err) => console.warn('Mindwalk auto-start notice:', err.message));
  } catch {}

  // Global hotkey: Ctrl+Shift+Space or Alt+Space summons the Sidebar HUD from any Windows app
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (hudWindow && !hudWindow.isDestroyed()) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        const hudWidth = 430;
        const hudHeight = screenHeight;
        const hudX = Math.round(primaryDisplay.bounds.x + screenWidth - hudWidth);
        const hudY = Math.round(primaryDisplay.bounds.y);
        hudWindow.setBounds({ x: hudX, y: hudY, width: hudWidth, height: hudHeight });
        if (!hudWindow.isVisible()) hudWindow.show();
        hudWindow.webContents.send('hud:focus');
        hudWindow.focus();
      } else {
        createHudWindow(true);
      }
    });
  } catch (err) {
    console.warn('Failed to register global HUD hotkey:', err.message);
  }
});

let lastCpuMeasure = null;
ipcMain.handle('hud:setExpanded', async (_event, expanded) => {
  if (!hudWindow || hudWindow.isDestroyed()) return false;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const hudWidth = expanded ? 430 : 28;
  const hudHeight = screenHeight;
  const hudX = Math.round(primaryDisplay.bounds.x + screenWidth - hudWidth);
  const hudY = Math.round(primaryDisplay.bounds.y);
  hudWindow.setBounds({ x: hudX, y: hudY, width: hudWidth, height: hudHeight });
  return true;
});

ipcMain.handle('hud:resize', async (_event, { expanded } = {}) => {
  if (!hudWindow || hudWindow.isDestroyed()) return false;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const hudWidth = expanded ? 430 : 28;
  const hudHeight = screenHeight;
  const hudX = Math.round(primaryDisplay.bounds.x + screenWidth - hudWidth);
  const hudY = Math.round(primaryDisplay.bounds.y);
  hudWindow.setBounds({ x: hudX, y: hudY, width: hudWidth, height: hudHeight });
  return true;
});

ipcMain.handle('hud:getMetrics', async () => {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });

  let cpuUsage = 18;
  if (lastCpuMeasure) {
    const idleDelta = totalIdle - lastCpuMeasure.idle;
    const totalDelta = totalTick - lastCpuMeasure.total;
    if (totalDelta > 0) {
      cpuUsage = Math.round((1 - (idleDelta / totalDelta)) * 100);
    }
  }
  lastCpuMeasure = { idle: totalIdle, total: totalTick };

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

  return {
    cpu: Math.max(2, Math.min(99, cpuUsage)),
    mem: memUsage,
    latency: 12,
    status: 'STABLE',
    timestamp: new Date().toISOString()
  };
});

ipcMain.handle('hud:toggleMainApp', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.restore?.();
      mainWindow.focus();
    }
  } else {
    createWindow();
  }
  return true;
});

ipcMain.handle('hud:close', async () => {
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.hide();
  }
  return true;
});

ipcMain.handle('aloy:log-observation', async (event, observation) => {
  try {
    const aloyDir = path.join(os.homedir(), '.aloy-server');
    if (!fs.existsSync(aloyDir)) fs.mkdirSync(aloyDir, { recursive: true });
    const logFile = path.join(aloyDir, 'observations.log.jsonl');
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...observation
    }) + '\n';
    fs.appendFileSync(logFile, entry, 'utf-8');
    return { success: true };
  } catch (err) {
    console.error('Failed to log observation:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('aloy:get-observation-logs', async () => {
  try {
    const logFile = path.join(os.homedir(), '.aloy-server', 'observations.log.jsonl');
    if (!fs.existsSync(logFile)) return [];
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean).reverse();
  } catch (err) {
    return [];
  }
});

// ==========================================
// HEPHAESTUS (Heph) Native Desktop IPC
// ==========================================
ipcMain.handle('hephaestus:listTasks', async (_event, filter) => {
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  return globalHephaestus.listTasks(filter || {});
});

ipcMain.handle('hephaestus:getTask', async (_event, taskId) => {
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  return globalHephaestus.getTask(taskId);
});

ipcMain.handle('hephaestus:createTask', async (_event, taskData) => {
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  return globalHephaestus.createTask(taskData);
});

ipcMain.handle('hephaestus:stageChange', async (_event, { taskId, filePath, proposedContent }) => {
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  return globalHephaestus.stageFileModification(taskId, filePath, proposedContent);
});

ipcMain.handle('hephaestus:verify', async (_event, { taskId, testCmd }) => {
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  return await globalHephaestus.runVerification(taskId, testCmd);
});

ipcMain.handle('hephaestus:approve', async (_event, taskId) => {
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  return await globalHephaestus.approveAndDeploy(taskId);
});

ipcMain.handle('hephaestus:reject', async (_event, { taskId, reason }) => {
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  return globalHephaestus.rejectTask(taskId, reason);
});

ipcMain.handle('hephaestus:rollback', async (_event, taskId) => {
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  return await globalHephaestus.rollbackDeployment(taskId);
});

ipcMain.handle('hephaestus:getTrainingStats', async () => {
  const { getTrainingStats } = require('./server/hephReviewer.cjs');
  return getTrainingStats();
});

// ==========================================
// ATHENA Research Scout Native Desktop IPC
// ==========================================
ipcMain.handle('athena:listTasks', async () => {
  const { athenaEngine } = require('./server/athena.cjs');
  return athenaEngine.listTasks();
});

ipcMain.handle('athena:getTask', async (_event, taskId) => {
  const { athenaEngine } = require('./server/athena.cjs');
  return athenaEngine.getTask(taskId);
});

ipcMain.handle('athena:createTask', async (_event, taskData) => {
  const { athenaEngine } = require('./server/athena.cjs');
  return athenaEngine.createTask(taskData);
});

ipcMain.handle('athena:deleteTask', async (_event, taskId) => {
  const { athenaEngine } = require('./server/athena.cjs');
  return athenaEngine.deleteTask(taskId);
});

ipcMain.handle('athena:cancelTask', async (_event, taskId) => {
  const { athenaEngine } = require('./server/athena.cjs');
  return athenaEngine.cancelTask(taskId);
});

ipcMain.handle('athena:resumeTask', async (_event, taskId) => {
  const { athenaEngine } = require('./server/athena.cjs');
  return athenaEngine.resumeTask(taskId);
});

// ==========================================
// APOLLO Document Intelligence Desktop IPC
// ==========================================
ipcMain.handle('apollo:listTasks', async () => {
  const { globalApollo } = require('./server/apollo.cjs');
  return globalApollo.listTasks();
});

ipcMain.handle('apollo:getTask', async (_event, taskId) => {
  const { globalApollo } = require('./server/apollo.cjs');
  return globalApollo.getTask(taskId);
});

ipcMain.handle('apollo:createTask', async (_event, taskData) => {
  const { globalApollo } = require('./server/apollo.cjs');
  return globalApollo.createDocumentTask(taskData);
});

ipcMain.handle('apollo:gardenMemories', async () => {
  const { globalApollo } = require('./server/apollo.cjs');
  return globalApollo.gardenMemories();
});

ipcMain.handle('apollo:syncVault', async () => {
  const { globalApollo } = require('./server/apollo.cjs');
  return globalApollo.triggerVaultSync();
});

// ==========================================
// MINERVA Sentinel & Watchdog Desktop IPC
// ==========================================
ipcMain.handle('minerva:healthScan', async () => {
  const { globalMinerva } = require('./server/minerva.cjs');
  return globalMinerva.runHealthScan();
});

ipcMain.handle('minerva:dispatchAlert', async (_event, alertData) => {
  const { globalMinerva } = require('./server/minerva.cjs');
  return globalMinerva.dispatchAlert(alertData);
});

ipcMain.handle('minerva:securityStats', () => {
  const { globalMinerva } = require('./server/minerva.cjs');
  return globalMinerva.getSecurityStats();
});

ipcMain.handle('inbox:feed', (_event, windowMs) => {
  const { globalMinerva } = require('./server/minerva.cjs');
  const { athenaEngine } = require('./server/athena.cjs');
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  const { getInboxFeed } = require('./server/inboxAggregator.cjs');
  return getInboxFeed({ athenaEngine, globalMinerva, globalHephaestus, windowMs });
});

// REMOVED (2026-08-19, second time): ipcMain.handle('minerva:haCall').
//
// This handed the renderer an unrestricted Home Assistant service caller:
// arbitrary domain + service + payload, with NO securityGuard
// validateSmartHomeAction check, so `lock.unlock` on `lock.front_door` went
// through with no 2FA and none of the SMART_HOME_ALLOWED_SERVICES allowlist.
//
// It was removed once, then restored because the smoke test's api-drift check
// flagged this handler calling a method that no longer existed. That finding
// was correct — the handler was the leftover, not the method. Deleting the
// caller is the fix; re-adding the method re-opened the hole.
//
// Smart-home control from any UI must go through /api/smarthome/execute,
// which enforces the allowlist, the exterior-lock 2FA gate, and audit logging.

// ==========================================
// HERMES Operations & Logistics Desktop IPC
// ==========================================
ipcMain.handle('hermes:dailyBrief', async (_event, params) => {
  const { globalHermes } = require('./server/hermes.cjs');
  return globalHermes.generateDailyBriefing(params);
});

ipcMain.handle('hermes:budgetHealth', async () => {
  const { globalHermes } = require('./server/hermes.cjs');
  return globalHermes.evaluateBudgetHealth();
});

ipcMain.handle('hermes:portfolioSnapshot', async () => {
  const { globalHermes } = require('./server/hermes.cjs');
  return globalHermes.getPortfolioSnapshot();
});

ipcMain.handle('hermes:setPortfolioShares', async (_event, symbol, shares) => {
  const { globalHermes } = require('./server/hermes.cjs');
  return globalHermes.setShares(symbol, shares);
});

// ==========================================
// PANTHEON CONCLAVE Desktop IPC
// ==========================================
ipcMain.handle('conclave:latest', async () => {
  const { ConclaveEngine } = require('./server/conclave.cjs');
  const { globalMinerva } = require('./server/minerva.cjs');
  const { globalApollo } = require('./server/apollo.cjs');
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  const { athenaEngine } = require('./server/athena.cjs');
  const { globalHermes } = require('./server/hermes.cjs');
  const conclave = new ConclaveEngine({
    minervaEngine: globalMinerva,
    apolloEngine: globalApollo,
    hephaestusEngine: globalHephaestus,
    athenaEngine: athenaEngine,
    hermesEngine: globalHermes
  });
  return conclave.getLatest();
});

ipcMain.handle('conclave:history', async () => {
  const { ConclaveEngine } = require('./server/conclave.cjs');
  const { globalMinerva } = require('./server/minerva.cjs');
  const { globalApollo } = require('./server/apollo.cjs');
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  const { athenaEngine } = require('./server/athena.cjs');
  const { globalHermes } = require('./server/hermes.cjs');
  const conclave = new ConclaveEngine({
    minervaEngine: globalMinerva,
    apolloEngine: globalApollo,
    hephaestusEngine: globalHephaestus,
    athenaEngine: athenaEngine,
    hermesEngine: globalHermes
  });
  return conclave.getHistory();
});

ipcMain.handle('conclave:convene', async (_event, params) => {
  const { ConclaveEngine } = require('./server/conclave.cjs');
  const { globalMinerva } = require('./server/minerva.cjs');
  const { globalApollo } = require('./server/apollo.cjs');
  const { globalHephaestus } = require('./server/hephaestus.cjs');
  const { athenaEngine } = require('./server/athena.cjs');
  const { globalHermes } = require('./server/hermes.cjs');
  const conclave = new ConclaveEngine({
    minervaEngine: globalMinerva,
    apolloEngine: globalApollo,
    hephaestusEngine: globalHephaestus,
    athenaEngine: athenaEngine,
    hermesEngine: globalHermes
  });
  return conclave.conveneConclave(params || {});
});

// JOB RADAR Desktop IPC
ipcMain.handle('jobs:getListings', async (_event, filter) => {
  const { globalJobRadar } = require('./server/jobRadar.cjs');
  return globalJobRadar.getListings(filter || {});
});
ipcMain.handle('jobs:scan', async (_event, params) => {
  const { globalJobRadar } = require('./server/jobRadar.cjs');
  return globalJobRadar.runJobScan(params || {});
});
ipcMain.handle('jobs:updateStatus', async (_event, { id, status }) => {
  const { globalJobRadar } = require('./server/jobRadar.cjs');
  return globalJobRadar.updateListingStatus(id, status);
});
ipcMain.handle('jobs:getConfig', async () => {
  const { globalJobRadar } = require('./server/jobRadar.cjs');
  return globalJobRadar.getConfig();
});
ipcMain.handle('jobs:updateConfig', async (_event, config) => {
  const { globalJobRadar } = require('./server/jobRadar.cjs');
  return globalJobRadar.updateConfig(config || {});
});
ipcMain.handle('jobs:getSummary', async () => {
  const { globalJobRadar } = require('./server/jobRadar.cjs');
  return globalJobRadar.getDailySummary();
});

// Hermes Harvested RPC Pipeline, Dialectic Memory, Evolution & Gateway Handlers
ipcMain.handle('hermes:runPipeline', async (_event, { script, context } = {}) => {
  const { globalHermesPipeline } = require('./server/hermes.cjs');
  return globalHermesPipeline.executePipeline(script, context || {});
});
ipcMain.handle('hermes:listSkills', async () => {
  const { globalHermesEvolution } = require('./server/hermes.cjs');
  return globalHermesEvolution.listSkills();
});
ipcMain.handle('hermes:synthesizeSkill', async (_event, skillData) => {
  const { globalHermesEvolution } = require('./server/hermes.cjs');
  return globalHermesEvolution.synthesizeSkill(skillData || {});
});
ipcMain.handle('hermes:evolveSkill', async (_event, { skillName, reason, feedback } = {}) => {
  const { globalHermesEvolution } = require('./server/hermes.cjs');
  return globalHermesEvolution.evolveSkill(skillName, { reason, feedback });
});
ipcMain.handle('hermes:getUserModel', async () => {
  const { globalHermesMemory } = require('./server/hermes.cjs');
  return globalHermesMemory.getUserModel();
});
ipcMain.handle('hermes:updateUserModel', async (_event, updates) => {
  const { globalHermesMemory } = require('./server/hermes.cjs');
  return globalHermesMemory.updateUserModel(updates || {});
});
ipcMain.handle('hermes:searchMemory', async (_event, { query, limit } = {}) => {
  const { globalHermesMemory } = require('./server/hermes.cjs');
  return globalHermesMemory.searchCrossSession(query, { maxResults: limit || 8 });
});
ipcMain.handle('hermes:getGatewayStatus', async () => {
  const { globalHermesGateway } = require('./server/hermes.cjs');
  return globalHermesGateway.getGatewayStatus();
});
ipcMain.handle('hermes:scheduleTask', async (_event, task) => {
  const { globalHermesGateway } = require('./server/hermes.cjs');
  return globalHermesGateway.scheduleTask(task || {});
});

// Remote Machines IPC Handlers (Bazzite, Lenny, etc.)
ipcMain.handle('remote:machinesStatus', async () => {
  const { getAllMachinesStatus } = require('./server/bazziteBridge.cjs');
  return getAllMachinesStatus();
});
ipcMain.handle('remote:machineStatus', async (_event, machineId) => {
  const { getMachineStatus } = require('./server/bazziteBridge.cjs');
  return getMachineStatus(machineId);
});
ipcMain.handle('remote:exec', async (_event, { machineId, command, elevated }) => {
  const { executeRemoteCommand } = require('./server/bazziteBridge.cjs');
  return executeRemoteCommand(machineId, command, 20000, { elevated: !!elevated });
});
ipcMain.handle('remote:launchTerminal', async (_event, machineId) => {
  const { launchRemoteTerminal } = require('./server/bazziteBridge.cjs');
  return launchRemoteTerminal(machineId);
});

// Backward-compatible Bazzite IPC Handlers
ipcMain.handle('bazzite:status', async () => {
  const { getBazziteStatus } = require('./server/bazziteBridge.cjs');
  return getBazziteStatus();
});
ipcMain.handle('bazzite:exec', async (_event, command) => {
  const { executeBazziteCommand } = require('./server/bazziteBridge.cjs');
  return executeBazziteCommand(command);
});
ipcMain.handle('bazzite:launchTerminal', async () => {
  const { launchBazziteTerminal } = require('./server/bazziteBridge.cjs');
  return launchBazziteTerminal();
});

app.on('window-all-closed', () => {
  if (hudWindow && !hudWindow.isDestroyed()) {
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeMcpClients().catch(() => {});
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

