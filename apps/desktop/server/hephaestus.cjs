// HEPHAESTUS (Heph) — Dedicated AI Coding & Architecture Agent Engine.
// Operates in isolated staging/sandboxes to safely develop, test, and package
// code modifications for Aloy without risking runtime crashes or prompt pollution.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { logAuditEvent } = require('./auditLogger.cjs');
const { RollbackManager } = require('./rollbackManager.cjs');
const { reviewCodeChangeWithAI, getTrainingStats, scanForDangerousExecution } = require('./hephReviewer.cjs');
const { validatePathAccess } = require('./securityGuard.cjs');
const { generateRepoMap } = require('./repoMap.cjs');

const rollbackManager = new RollbackManager();
const STORAGE_DIR = path.join(os.homedir(), '.aloy-server');
const TASKS_FILE = path.join(STORAGE_DIR, 'hephaestus-tasks.json');

const TASK_STATUS = {
  QUEUED: 'queued',
  ANALYZING: 'analyzing',
  STAGING: 'staging',
  TESTING: 'testing',
  STAGED_FOR_REVIEW: 'staged_for_review',
  APPROVED: 'approved',
  DEPLOYED: 'deployed',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  FAILED: 'failed',
  ROLLED_BACK: 'rolled_back',
  AUTO_ROLLED_BACK: 'auto_rolled_back'
};

function ensureStorage() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
  if (!fs.existsSync(TASKS_FILE)) {
    fs.writeFileSync(TASKS_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

/**
 * Generates a unified diff between two text contents.
 */
function generateUnifiedDiff(filePath, original, proposed) {
  const origLines = (original || '').split('\n');
  const propLines = (proposed || '').split('\n');

  let additions = 0;
  let deletions = 0;
  const diffLines = [];

  diffLines.push(`--- a/${filePath}`);
  diffLines.push(`+++ b/${filePath}`);

  // Simple line-by-line diff generator for visualization
  const maxLen = Math.max(origLines.length, propLines.length);
  let i = 0, j = 0;

  while (i < origLines.length || j < propLines.length) {
    if (i < origLines.length && j < propLines.length && origLines[i] === propLines[j]) {
      diffLines.push(` ${origLines[i]}`);
      i++;
      j++;
    } else if (i < origLines.length && (j >= propLines.length || !propLines.includes(origLines[i]))) {
      diffLines.push(`-${origLines[i]}`);
      deletions++;
      i++;
    } else if (j < propLines.length) {
      diffLines.push(`+${propLines[j]}`);
      additions++;
      j++;
    }
  }

  return {
    patch: diffLines.join('\n'),
    additions,
    deletions
  };
}

// A work order created this long ago that never reached staging is abandoned —
// nothing ever picked it up. Almost always a Conclave directive dispatched for
// a condition nobody acted on.
const STALE_QUEUED_MS = 24 * 60 * 60 * 1000;

// runVerification runs in-process: a server restart mid-run, or a hung call
// inside it (the AI review network call, principally — the smoke/test-cmd
// execSync calls already carry their own execSync timeouts), leaves a task
// stuck in TESTING forever with nothing to notice. 20 minutes is comfortably
// above every individual bounded step inside runVerification (60s review-call
// timeout, 60s smoke gate, 45s test cmd, plus retry overhead), so a genuine
// in-progress run is never mistaken for stuck.
const STALE_TESTING_MS = 20 * 60 * 1000;

// After this long, a finished task keeps its patch (the useful record of what
// changed) but drops the full before/after file bodies.
const CONTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Absolute cap on retained tasks, newest first.
const MAX_TASKS_RETAINED = 200;

// Size budget for the ledger. Age-based retention alone is not enough: 22
// tasks reached 3.6 MB in three days because a single App.tsx-sized change
// stores ~400 KB (original + proposed + patch), and getTask/listTasks re-read
// the entire file. When the ledger exceeds this, file bodies are stripped from
// finished tasks oldest-first until it fits — regardless of age.
const MAX_LEDGER_BYTES = 1 * 1024 * 1024;

class HephaestusEngine {
  constructor(storageFile = TASKS_FILE) {
    this.storageFile = storageFile;
    this.tasks = new Map();
    this.loadPersistedTasks();
    this.recoverStaleTasks();
    this.pruneTaskHistory();
  }

  /**
   * Closes out work orders that were created and then never acted on.
   *
   * Hephaestus does not author code — a task sits in `queued` until something
   * stages changes into it. Conclave dispatches directives automatically, so
   * anything it raises that nobody picks up accumulates forever and inflates
   * the "active work orders" number Conclave then reports back to itself.
   * Observed live: 3 tasks stuck in queued, 2 of them duplicates.
   */
  recoverStaleTasks() {
    const OPEN_UNSTARTED = new Set([TASK_STATUS.QUEUED, TASK_STATUS.ANALYZING]);
    const now = Date.now();
    let expired = 0;
    for (const task of this.tasks.values()) {
      if (!OPEN_UNSTARTED.has(task.status)) continue;
      if ((task.stagedChanges || []).length > 0) continue; // real work in progress
      if (now - new Date(task.createdAt || 0).getTime() < STALE_QUEUED_MS) continue;
      task.status = TASK_STATUS.EXPIRED;
      task.updatedAt = new Date().toISOString();
      task.logs = task.logs || [];
      task.logs.push({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: `Auto-closed: work order expired after sitting unstarted past the ${Math.round(STALE_QUEUED_MS / 3600000)}-hour staleness window.`
      });
      expired++;
    }
    // A task stuck in TESTING is a different failure mode from one that
    // never started: real work WAS in progress, so it's marked FAILED (not
    // REJECTED/EXPIRED) — the same outcome a genuine review failure would produce,
    // just triggered by a hang instead of a bad diff. autoDeploy can't fire
    // on a FAILED task, matching the fail-closed contract runVerification
    // itself uses for review errors.
    let recovered = 0;
    for (const task of this.tasks.values()) {
      if (task.status !== TASK_STATUS.TESTING) continue;
      if (now - new Date(task.updatedAt || task.createdAt || 0).getTime() < STALE_TESTING_MS) continue;
      task.status = TASK_STATUS.FAILED;
      task.updatedAt = new Date().toISOString();
      task.logs = task.logs || [];
      task.logs.push({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `Recovered: task was orphaned in TESTING (server restart or a hung verification call) past the ${Math.round(STALE_TESTING_MS / 60000)}-minute staleness window, and has been marked failed.`
      });
      recovered++;
    }

    if (expired > 0 || recovered > 0) {
      this.persistTasks();
      if (expired > 0) console.warn(`[HEPHAESTUS] Auto-closed ${expired} expired work order(s).`);
      if (recovered > 0) console.warn(`[HEPHAESTUS] Recovered ${recovered} orphaned in-flight verification task(s).`);
      logAuditEvent({
        action: 'hephaestus_stale_tasks_closed',
        source: 'hephaestus',
        details: { expired, recovered }
      });
    }
  }

  /**
   * Bounds the on-disk ledger.
   *
   * Every staged change stores originalContent AND proposedContent AND the
   * patch. For a file the size of App.tsx that is ~400KB per task, and the
   * whole file is re-read by getTask/listTasks. Measured at 3.6MB for 22
   * tasks, 96% of it file bodies. Finished tasks keep the patch — which is
   * what anyone actually reads — and drop the bodies. Rollback is unaffected:
   * it restores from rollbackManager's snapshots, not from these fields.
   */
  pruneTaskHistory() {
    const FINISHED = new Set([
      TASK_STATUS.DEPLOYED,
      TASK_STATUS.REJECTED,
      TASK_STATUS.EXPIRED,
      TASK_STATUS.ROLLED_BACK,
      TASK_STATUS.AUTO_ROLLED_BACK,
      TASK_STATUS.FAILED
    ]);
    const now = Date.now();
    const EXPIRED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14-day retention for expired/failed tasks
    let prunedOldTasks = 0;

    // 1. Purge expired/failed tasks older than 14 days to prevent ghost accumulation
    for (const [id, task] of Array.from(this.tasks.entries())) {
      if (task.status === TASK_STATUS.EXPIRED || task.status === TASK_STATUS.FAILED) {
        const closedAt = new Date(task.updatedAt || task.createdAt || 0).getTime();
        if (now - closedAt > EXPIRED_RETENTION_MS) {
          this.tasks.delete(id);
          prunedOldTasks++;
        }
      }
    }
    if (prunedOldTasks > 0) {
      this.persistTasks();
      console.log(`[HEPHAESTUS] Pruned ${prunedOldTasks} ancient expired/failed task(s) older than 14 days.`);
    }

    let strippedTasks = 0;
    let bytesFreed = 0;

    for (const task of this.tasks.values()) {
      if (!FINISHED.has(task.status)) continue;
      const finishedAt = new Date(task.deployedAt || task.updatedAt || task.createdAt || 0).getTime();
      if (now - finishedAt < CONTENT_RETENTION_MS) continue;
      let touched = false;
      for (const change of task.stagedChanges || []) {
        for (const field of ['originalContent', 'proposedContent']) {
          if (typeof change[field] === 'string' && change[field].length > 0) {
            bytesFreed += change[field].length;
            change[field] = '';
            touched = true;
          }
        }
        if (touched) change.contentPruned = true;
      }
      if (touched) strippedTasks++;
    }

    // Size pressure: if the ledger is still over budget, keep stripping
    // finished tasks oldest-first until it fits. Age-based retention alone
    // leaves a recently-created but enormous ledger untouched.
    const ledgerBytes = () => {
      try { return Buffer.byteLength(JSON.stringify(Array.from(this.tasks.values()))); } catch { return 0; }
    };
    if (ledgerBytes() > MAX_LEDGER_BYTES) {
      const finishedOldestFirst = Array.from(this.tasks.values())
        .filter(t => FINISHED.has(t.status))
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      for (const task of finishedOldestFirst) {
        if (ledgerBytes() <= MAX_LEDGER_BYTES) break;
        let touched = false;
        for (const change of task.stagedChanges || []) {
          for (const field of ['originalContent', 'proposedContent']) {
            if (typeof change[field] === 'string' && change[field].length > 0) {
              bytesFreed += change[field].length;
              change[field] = '';
              touched = true;
            }
          }
          if (touched) change.contentPruned = true;
        }
        if (touched) strippedTasks++;
      }
    }

    // Last resort: patches for a full-file rewrite of something App.tsx-sized
    // are themselves hundreds of KB, so stripping bodies alone can't get under
    // budget. Truncate oversized patches on finished tasks, keeping the head
    // (where the meaningful diff usually is) plus an explicit marker. Only
    // reached when the two passes above were not enough.
    const MAX_PATCH_CHARS = 20000;
    if (ledgerBytes() > MAX_LEDGER_BYTES) {
      const finishedOldestFirst = Array.from(this.tasks.values())
        .filter(t => FINISHED.has(t.status))
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      for (const task of finishedOldestFirst) {
        if (ledgerBytes() <= MAX_LEDGER_BYTES) break;
        for (const change of task.stagedChanges || []) {
          if (typeof change.patch === 'string' && change.patch.length > MAX_PATCH_CHARS) {
            bytesFreed += change.patch.length - MAX_PATCH_CHARS;
            change.patch = change.patch.slice(0, MAX_PATCH_CHARS) +
              `\n\n[... patch truncated by ledger pruning — ${change.additions || 0} additions, ${change.deletions || 0} deletions total ...]`;
            change.patchTruncated = true;
          }
        }
      }
    }

    // Hard cap, newest first.
    let dropped = 0;
    if (this.tasks.size > MAX_TASKS_RETAINED) {
      const ordered = Array.from(this.tasks.values())
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      for (const t of ordered.slice(MAX_TASKS_RETAINED)) {
        this.tasks.delete(t.id);
        dropped++;
      }
    }

    if (strippedTasks > 0 || dropped > 0) {
      this.persistTasks();
      console.log(`[HEPHAESTUS] Pruned ledger: stripped file bodies from ${strippedTasks} task(s) (~${Math.round(bytesFreed / 1024)} KB), dropped ${dropped} old task(s).`);
    }
  }

  loadPersistedTasks() {
    try {
      if (!fs.existsSync(this.storageFile)) {
        const dir = path.dirname(this.storageFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.storageFile, JSON.stringify([], null, 2), 'utf8');
      }
      const raw = fs.readFileSync(this.storageFile, 'utf8');
      const list = JSON.parse(raw);
      this.tasks.clear();
      for (const t of list) {
        this.tasks.set(t.id, t);
      }
    } catch (err) {
      console.warn('[HEPHAESTUS] Failed to load persisted tasks:', err.message);
    }
  }

  persistTasks() {
    try {
      const dir = path.dirname(this.storageFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const list = Array.from(this.tasks.values());
      fs.writeFileSync(this.storageFile, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      console.warn('[HEPHAESTUS] Failed to persist tasks:', err.message);
    }
  }

  deleteTask(taskId) {
    const deleted = this.tasks.delete(taskId);
    if (deleted) this.persistTasks();
    return deleted;
  }

  pruneExpiredTasks() {
    let count = 0;
    for (const [id, t] of this.tasks.entries()) {
      if (t.status === TASK_STATUS.EXPIRED) {
        this.tasks.delete(id);
        count++;
      }
    }
    if (count > 0) this.persistTasks();
    return count;
  }

  clearAllTasks() {
    this.tasks.clear();
    this.persistTasks();
  }

  /**
   * Creates a new engineering work order for HEPHAESTUS.
   */
  createTask({
    title,
    description,
    category = 'feature',
    targetFiles = [],
    requirements = [],
    requestedBy = 'user',
    autoDeploy = false
  }) {
    const id = `heph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const task = {
      id,
      title: title || 'Untitled Engineering Task',
      description: description || '',
      category,
      status: TASK_STATUS.QUEUED,
      requestedBy,
      branch: `heph/${id}`,
      targetFiles: Array.isArray(targetFiles) ? targetFiles : [targetFiles],
      requirements: Array.isArray(requirements) ? requirements : [requirements],
      autoDeploy: Boolean(autoDeploy),
      stagedChanges: [], // Array of { filePath, originalContent, proposedContent, patch, additions, deletions }
      testResults: {
        syntaxValid: null,
        testsRun: 0,
        testsPassed: 0,
        output: '',
        passed: null
      },
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `Task initialized in Cauldron by ${requestedBy}. Branch: heph/${id}`
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deployedAt: null,
      rollbackSnapshotId: null
    };

    this.tasks.set(id, task);
    this.persistTasks();

    logAuditEvent({
      action: 'hephaestus_task_created',
      source: 'hephaestus',
      details: { taskId: id, title: task.title, category: task.category, requestedBy }
    });

    return task;
  }

  getTask(id) {
    if (!this.tasks.has(id)) {
      this.loadPersistedTasks();
    }
    return this.tasks.get(id) || null;
  }

  listTasks(filter = {}) {
    this.loadPersistedTasks();
    let list = Array.from(this.tasks.values());
    if (filter.status) {
      list = list.filter(t => t.status === filter.status);
    }
    if (filter.category) {
      list = list.filter(t => t.category === filter.category);
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  addLog(taskId, message, level = 'info') {
    const task = this.getTask(taskId);
    if (!task) return;
    task.logs.push({
      timestamp: new Date().toISOString(),
      level,
      message
    });
    task.updatedAt = new Date().toISOString();
    this.persistTasks();
  }

  /**
   * Stages a proposed file modification in sandbox without modifying target directly.
   */
  stageFileModification(taskId, filePath, proposedContent) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const resolvedPath = path.resolve(filePath);

    // Least-privilege gate: Hephaestus (and, on a NEEDS_REVISION verdict,
    // the AI reviewer's own suggested filePath — see runVerification) can
    // otherwise write to any path the process can reach. Without this check
    // a manipulated review verdict has an unfenced arbitrary-file-write
    // primitive, not just a code-quality opinion.
    const access = validatePathAccess(resolvedPath, true);
    if (!access.allowed) {
      this.addLog(taskId, `Staging BLOCKED for ${path.basename(resolvedPath)}: ${access.reason}`, 'error');
      throw new Error(`Refusing to stage outside allowed write roots: ${access.reason}`);
    }

    let originalContent = '';

    if (fs.existsSync(resolvedPath)) {
      originalContent = fs.readFileSync(resolvedPath, 'utf8');
    }

    const { patch, additions, deletions } = generateUnifiedDiff(filePath, originalContent, proposedContent);

    // Update existing staged change or append new
    const existingIdx = task.stagedChanges.findIndex(sc => path.resolve(sc.filePath) === resolvedPath);
    const changeRecord = {
      filePath: resolvedPath,
      relativePath: path.relative(process.cwd(), resolvedPath),
      originalContent,
      proposedContent,
      patch,
      additions,
      deletions,
      stagedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      task.stagedChanges[existingIdx] = changeRecord;
    } else {
      task.stagedChanges.push(changeRecord);
    }

    task.status = TASK_STATUS.STAGING;
    this.addLog(taskId, `Staged modification for ${path.basename(resolvedPath)} (+${additions}/-${deletions} lines)`);
    this.persistTasks();

    return changeRecord;
  }

  /**
   * Runs syntax check and unit test verification on staged changes.
   */
  async runVerification(taskId, customTestCmd = null) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.status = TASK_STATUS.TESTING;
    this.addLog(taskId, 'Starting pre-flight verification & sandbox testing...');

    let syntaxValid = true;
    let syntaxOutput = '';

    // 1. Syntax check for JS/CJS/JSON staged files
    for (const change of task.stagedChanges) {
      const ext = path.extname(change.filePath).toLowerCase();
      if (['.js', '.cjs', '.mjs'].includes(ext)) {
        try {
          // Write to a temporary isolated file to test syntax
          const tempFile = path.join(os.tmpdir(), `heph_syntax_${Date.now()}_${path.basename(change.filePath)}`);
          fs.writeFileSync(tempFile, change.proposedContent, 'utf8');
          execSync(`node --check "${tempFile}"`, { stdio: 'pipe' });
          fs.unlinkSync(tempFile);
          this.addLog(taskId, `Syntax check passed for ${path.basename(change.filePath)}`);
        } catch (err) {
          syntaxValid = false;
          syntaxOutput += `Syntax error in ${path.basename(change.filePath)}: ${err.message}\n`;
          this.addLog(taskId, `Syntax check FAILED for ${path.basename(change.filePath)}: ${err.message}`, 'error');
        }
      } else if (ext === '.json') {
        try {
          JSON.parse(change.proposedContent);
          this.addLog(taskId, `JSON syntax valid for ${path.basename(change.filePath)}`);
        } catch (err) {
          syntaxValid = false;
          syntaxOutput += `Invalid JSON in ${path.basename(change.filePath)}: ${err.message}\n`;
          this.addLog(taskId, `JSON syntax error in ${path.basename(change.filePath)}`, 'error');
        }
      }
    }

    // 2. Run unit test suite gate (auto-executes vitest if JS/CJS files are modified in production/live)
    let testPassed = syntaxValid;
    let testOutput = syntaxOutput;

    const isInsideVitest = !!process.env.VITEST;
    const modifiesDesktopFiles = task.stagedChanges.some((c) => {
      const p = (c.filePath || '').replace(/\\/g, '/');
      return !p.includes('apps/mobile') && !p.includes('AloyMobile') && /\.(js|cjs|jsx|ts|tsx)$/i.test(p);
    });
    // customTestCmd arrives from the POST /api/hephaestus/tasks/:id/verify body
    // and used to be handed straight to execSync — an arbitrary shell command,
    // token-auth only. There is exactly one test command this project runs, so
    // the caller can now only choose WHETHER to run it, not what to run.
    if (customTestCmd && customTestCmd !== 'npm test') {
      this.addLog(taskId, `Refused custom test command (only "npm test" is permitted): ${String(customTestCmd).slice(0, 80)}`);
    }
    const testCmd = (!isInsideVitest && syntaxValid && modifiesDesktopFiles) ? 'npm test' : null;

    if (syntaxValid && testCmd) {
      try {
        this.addLog(taskId, `Executing test suite: ${testCmd}`);
        const out = execSync(testCmd, {
          cwd: path.resolve(__dirname, '..'),
          encoding: 'utf8',
          timeout: 45000,
          stdio: 'pipe'
        });
        testOutput += `\nTest suite output:\n${out}`;
        this.addLog(taskId, 'Unit test verification passed successfully.');
      } catch (err) {
        testPassed = false;
        testOutput += `\nTest suite failure:\n${err.stdout || ''}\n${err.stderr || ''}\n${err.message}`;
        this.addLog(taskId, `Test suite failed: ${err.message}`, 'error');
      }
    }

    // 2b. Assembly smoke gate (scripts/smoke.cjs).
    //
    // Unit tests mock their dependencies, so they pass happily while the
    // WIRING between modules is broken. Concrete proof: this engine deployed
    // sidecarWatchdog.cjs on 2026-08-18 with syntax, tests, AI review and the
    // canary all green — and the file has never executed once, because nothing
    // imports it. Every gate was passing on code that does nothing.
    //
    // The smoke test checks the things unit tests structurally cannot: that
    // every module loads, that no module is orphaned, that cross-module calls
    // resolve to methods that actually exist, that Node builtins are required
    // before use, and that no network call is unbounded.
    if (testPassed && !isInsideVitest && modifiesDesktopFiles) {
      try {
        this.addLog(taskId, 'Running assembly smoke gate (npm run smoke)...');
        const smokeOut = execSync('npm run smoke --silent', {
          cwd: path.resolve(__dirname, '..'),
          encoding: 'utf8',
          timeout: 60000,
          stdio: 'pipe'
        });
        testOutput += `\nSmoke gate output:\n${smokeOut}`;
        this.addLog(taskId, 'Assembly smoke gate passed.');
      } catch (err) {
        testPassed = false;
        const detail = `${err.stdout || ''}\n${err.stderr || ''}`.trim();
        testOutput += `\nSmoke gate failure:\n${detail}\n${err.message}`;
        // Surface the individual failures as log lines so the reason is visible
        // in the task view rather than buried in a blob of test output.
        for (const line of detail.split('\n').filter(l => l.trim().startsWith('x '))) {
          this.addLog(taskId, `[SMOKE] ${line.trim().slice(2)}`, 'error');
        }
        this.addLog(taskId, 'Assembly smoke gate FAILED — halting before deploy.', 'error');
      }
    }

    task.testResults = {
      syntaxValid,
      passed: testPassed,
      output: testOutput.trim(),
      verifiedAt: new Date().toISOString()
    };

    // 3. AI Code Review Gate (Claude 3.7 / Gemini Teacher Judge)
    if (testPassed && task.stagedChanges.length > 0) {
      try {
        this.addLog(taskId, 'Submitting diff to AI Code Reviewer (Claude/Gemini) for architectural critique...');
        const aiReview = await reviewCodeChangeWithAI(task, task.stagedChanges);

        // Defense in depth: don't rely solely on the reviewer's own
        // `verdict` field surviving a prompt-injection attempt cleanly —
        // if it separately flagged that the reviewed content tried to
        // direct its behavior, force REJECTED regardless of what verdict
        // it otherwise settled on.
        if (aiReview.injectionAttemptDetected) {
          aiReview.verdict = 'REJECTED';
          aiReview.securityIssues = Array.isArray(aiReview.securityIssues) ? aiReview.securityIssues : [];
          aiReview.securityIssues.unshift('Reviewer flagged a likely prompt-injection attempt inside the reviewed diff/task metadata — forced REJECTED regardless of stated verdict.');
        }

        // Same defense-in-depth, for dangerous execution patterns: don't
        // rely on Claude/Gemini having noticed and self-reported eval()/
        // exec()/spawn()/new Function()/recursive rm in its own verdict —
        // scan the actual staged code independently and force REJECTED
        // regardless of what score or verdict the reviewer settled on. A
        // 2026-08-16 adversarial test proved a reviewer can score this kind
        // of change NEEDS_REVISION (still deployable) rather than REJECTED.
        const dangerousExecutionFindings = scanForDangerousExecution(task.stagedChanges);
        if (dangerousExecutionFindings.length > 0) {
          aiReview.verdict = 'REJECTED';
          aiReview.securityIssues = Array.isArray(aiReview.securityIssues) ? aiReview.securityIssues : [];
          for (const finding of dangerousExecutionFindings) {
            aiReview.securityIssues.unshift(`${finding} — forced REJECTED regardless of stated verdict.`);
          }
        }
        task.aiReview = aiReview;

        const providerTag = aiReview.provider.toUpperCase();
        this.addLog(taskId, `[${providerTag} REVIEW] Verdict: ${aiReview.verdict} (Score: ${aiReview.score}/100) — ${aiReview.summary}`);

        if (aiReview.securityIssues && aiReview.securityIssues.length > 0) {
          for (const sec of aiReview.securityIssues) {
            this.addLog(taskId, `[SECURITY FLAG] ${sec}`, 'warn');
          }
        }

        if (aiReview.verdict === 'APPROVED') {
          task.status = TASK_STATUS.STAGED_FOR_REVIEW;
          this.addLog(taskId, 'AI Review passed. Training flywheel recorded verified positive sample.');
        } else if (aiReview.verdict === 'NEEDS_REVISION') {
          if (aiReview.improvedCode && Array.isArray(aiReview.improvedCode)) {
            for (const imp of aiReview.improvedCode) {
              if (imp.filePath && imp.content) {
                this.stageFileModification(taskId, imp.filePath, imp.content);
              }
            }
            this.addLog(taskId, 'Applied AI-suggested code corrections. Training pair saved to QLoRA buffer.');
          }
          task.status = TASK_STATUS.STAGED_FOR_REVIEW;
        } else {
          task.status = TASK_STATUS.FAILED;
          this.addLog(taskId, `AI Review REJECTED code: ${aiReview.critique}`, 'error');
          testPassed = false;
        }
      } catch (err) {
        // Fail CLOSED, not open: this used to log a warning and still mark
        // the task STAGED_FOR_REVIEW (i.e. treat an unreviewed diff as
        // reviewed), which meant a broken/rate-limited review call — or a
        // review verdict whose suggested improvedCode path got rejected by
        // validatePathAccess in stageFileModification — could still reach
        // deploy under autoDeploy. An exception here means the diff was
        // NOT verified; halt rather than proceed as if it had been.
        task.status = TASK_STATUS.FAILED;
        testPassed = false;
        this.addLog(taskId, `AI Review failed: ${err.message}. Halting — diff was not verified.`, 'error');
      }
    } else if (testPassed) {
      task.status = TASK_STATUS.STAGED_FOR_REVIEW;
      this.addLog(taskId, 'Diff package is verified and ready for review.');
    } else {
      task.status = TASK_STATUS.FAILED;
      this.addLog(taskId, 'Verification failed. Halting deployment to protect Aloy runtime.', 'error');
    }

    if (testPassed && task.autoDeploy) {
      this.addLog(taskId, 'Auto-deploy enabled: proceeding to apply changes...');
      return this.approveAndDeploy(taskId);
    }

    this.persistTasks();
    return task;
  }

  /**
   * Deploys staged changes to production files with automated post-deployment canary testing and circuit breaker.
   */
  async approveAndDeploy(taskId, options = { runPostDeployVerification: true, customTestCmd: null }) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (task.stagedChanges.length === 0) {
      throw new Error(`Task ${taskId} has no staged changes to deploy`);
    }

    // Gate deployment on having actually passed runVerification. Without
    // this, approveAndDeploy — reachable directly via POST
    // /api/hephaestus/tasks/:id/approve, not only through the auto-deploy
    // path inside runVerification — would deploy a task in ANY status,
    // including one that was never verified at all (queued/staging/testing)
    // or one whose AI review was REJECTED (which sets FAILED, not
    // STAGED_FOR_REVIEW). That would bypass syntax/unit-test/smoke checks
    // and the dual-provider AI review gate entirely, not just weaken them.
    if (task.status !== TASK_STATUS.STAGED_FOR_REVIEW) {
      throw new Error(`Task ${taskId} is not ready to deploy (status: ${task.status}). It must pass runVerification first and reach status "${TASK_STATUS.STAGED_FOR_REVIEW}".`);
    }

    this.addLog(taskId, 'Deploying staged changes to production codebase...');

    const rollbackSnapshots = [];
    let rbId = null;

    try {
      for (const change of task.stagedChanges) {
        const dest = change.filePath;

        // Snapshot original if it exists
        if (fs.existsSync(dest)) {
          const snapshotPath = rollbackManager.captureFileSnapshot(dest);
          if (snapshotPath) {
            rollbackSnapshots.push({ originalPath: dest, snapshotPath });
          }
        }

        // Ensure parent directory exists
        const dir = path.dirname(dest);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Write approved content
        fs.writeFileSync(dest, change.proposedContent, 'utf8');
        this.addLog(taskId, `Applied changes to ${path.basename(dest)}`);
      }

      // Register rollback record
      rbId = rollbackManager.pushAction({
        type: 'file_edit',
        description: `HEPHAESTUS Deployment: ${task.title} (${task.id})`,
        undoContext: {
          taskId: task.id,
          snapshots: rollbackSnapshots
        },
        undoHandler: async (ctx) => {
          for (const s of ctx.snapshots || []) {
            if (fs.existsSync(s.snapshotPath)) {
              fs.copyFileSync(s.snapshotPath, s.originalPath);
            }
          }
        }
      });

      // ----------------------------------------------------
      // AUTOMATED POST-DEPLOYMENT CANARY VERIFICATION
      // ----------------------------------------------------
      if (options?.runPostDeployVerification !== false) {
        this.addLog(taskId, 'Executing post-deployment canary verification & health checks...');
        let canaryFailed = false;
        let canaryError = '';

        // A. Verify syntax of written files on disk
        for (const change of task.stagedChanges) {
          const ext = path.extname(change.filePath).toLowerCase();
          if (['.js', '.cjs', '.mjs'].includes(ext) && fs.existsSync(change.filePath)) {
            try {
              execSync(`node --check "${change.filePath}"`, { stdio: 'pipe' });
            } catch (err) {
              canaryFailed = true;
              canaryError = `Post-deployment syntax validation failed on ${path.basename(change.filePath)}: ${err.message}`;
              break;
            }
          }
        }

        // B. Optional custom test command
        if (!canaryFailed && options?.customTestCmd) {
          try {
            execSync(options.customTestCmd, { stdio: 'pipe', timeout: 20000 });
          } catch (err) {
            canaryFailed = true;
            canaryError = `Post-deploy test command failed: ${err.message}`;
          }
        }

        // Circuit Breaker: Auto-rollback on canary failure
        if (canaryFailed) {
          this.addLog(taskId, `🚨 POST-DEPLOY CANARY FAILED: ${canaryError}. Triggering instant auto-rollback!`, 'error');
          await rollbackManager.rollback(rbId);
          task.status = TASK_STATUS.AUTO_ROLLED_BACK || 'auto_rolled_back';
          task.updatedAt = new Date().toISOString();
          task.postDeployVerification = {
            passed: false,
            error: canaryError,
            autoRolledBack: true,
            checkedAt: new Date().toISOString()
          };
          this.persistTasks();
          return {
            success: false,
            autoRolledBack: true,
            error: canaryError,
            task
          };
        }
      }

      task.status = TASK_STATUS.DEPLOYED;
      task.deployedAt = new Date().toISOString();
      task.rollbackSnapshotId = rbId;
      task.updatedAt = new Date().toISOString();
      task.postDeployVerification = {
        passed: true,
        autoRolledBack: false,
        checkedAt: new Date().toISOString()
      };

      this.addLog(taskId, `Deployment verified with post-deploy canary pass. Rollback snapshot: ${rbId}`);

      logAuditEvent({
        action: 'hephaestus_deployment_applied',
        source: 'hephaestus',
        details: { taskId: task.id, title: task.title, filesModified: task.stagedChanges.map(c => c.filePath) }
      });

      this.persistTasks();
      return { success: true, task, rollbackSnapshotId: rbId };
    } catch (err) {
      task.status = TASK_STATUS.FAILED;
      this.addLog(taskId, `Deployment failed during write: ${err.message}`, 'error');
      this.persistTasks();
      throw err;
    }
  }

  /**
   * Rejects and discards staged changes safely.
   */
  rejectTask(taskId, reason = 'Rejected by operator') {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.status = TASK_STATUS.REJECTED;
    task.updatedAt = new Date().toISOString();
    this.addLog(taskId, `Task rejected: ${reason}`, 'warn');

    logAuditEvent({
      action: 'hephaestus_task_rejected',
      source: 'hephaestus',
      details: { taskId: task.id, reason }
    });

    this.persistTasks();
    return task;
  }

  /**
   * Rolls back a previously deployed task.
   */
  async rollbackDeployment(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== TASK_STATUS.DEPLOYED) {
      throw new Error(`Task ${taskId} is not deployed (current status: ${task.status})`);
    }

    this.addLog(taskId, 'Triggering emergency rollback to pre-deployment state...');

    const res = await rollbackManager.rollback(task.rollbackSnapshotId);
    if (res.success) {
      task.status = TASK_STATUS.ROLLED_BACK;
      task.updatedAt = new Date().toISOString();
      this.addLog(taskId, `Rollback complete: ${res.message}`);

      logAuditEvent({
        action: 'hephaestus_task_rolled_back',
        source: 'hephaestus',
        details: { taskId: task.id, snapshotId: task.rollbackSnapshotId }
      });

      this.persistTasks();
      return { success: true, task };
    } else {
      task.status = TASK_STATUS.FAILED;
      this.addLog(taskId, `Rollback failed: ${res.error}`, 'error');
      this.persistTasks();
      return { success: false, error: res.error };
    }
  }

  /**
   * Generates a compact Aider-style Repo-Map for a target workspace directory.
   */
  getRepoMap(targetDir = path.resolve(__dirname, '..', '..')) {
    try {
      return generateRepoMap(targetDir, { maxFiles: 50, maxTokens: 1200 });
    } catch (e) {
      return { repoMap: '', fileCount: 0, symbolCount: 0, error: e.message };
    }
  }

  /**
   * Deletes a task permanently from the ledger.
   */
  deleteTask(taskId) {
    const deleted = this.tasks.delete(taskId);
    if (deleted) {
      this.persistTasks();
    }
    return deleted;
  }
}

const globalHephaestus = new HephaestusEngine();

module.exports = {
  HephaestusEngine,
  globalHephaestus,
  TASK_STATUS,
  generateUnifiedDiff
};
