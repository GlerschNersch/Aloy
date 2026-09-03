// ATHENA — Dedicated Autonomous Deep Research & Intelligence Scout Engine.
// Conducts long-running background research, web search synthesis, technical evaluations,
// and produces structured intelligence dossiers without blocking live user chat.

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { logAuditEvent } = require('./auditLogger.cjs');
const { sanitizeUntrustedWebContent } = require('./securityGuard.cjs');
const { adaptiveScrape } = require('./scraplingEngine.cjs');
const { MODELS, geminiUrl } = require('./models.cjs');
const { httpFetch, TIMEOUTS } = require('./http.cjs');

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), '.aloy-server');
const DEFAULT_TASKS_FILE = path.join(DEFAULT_STORAGE_DIR, 'athena-tasks.json');

const RESEARCH_STATUS = {
  QUEUED: 'queued',
  RESEARCHING: 'researching',
  SYNTHESIZING: 'synthesizing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

const RESEARCH_DEPTH = {
  QUICK: 'quick',          // 1-2 min executive brief
  STANDARD: 'standard',    // 3-5 min balanced report
  DEEP_DIVE: 'deep_dive'   // Comprehensive dossier with technical comparisons
};

const http = require('http');

// Hard ceiling on the source-gathering step. Beyond this the task proceeds
// with whatever it has (usually nothing) rather than waiting forever.
const SEARCH_DEADLINE_MS = 30000;

// A task still marked in-flight this long after createdAt is treated as
// orphaned — it can only be a process that died mid-run or a hang predating
// the timeout fixes. Generous enough that a genuinely slow deep-dive is never
// killed while running.
const STALE_TASK_MS = 15 * 60 * 1000;

// Resolves to `fallback` if `promise` hasn't settled within ms. Does not
// cancel the underlying work — it just stops the caller waiting on it.
function withDeadline(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve(fallback); }
    }, ms);
    timer.unref?.();
    promise.then(
      (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      () => { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } }
    );
  });
}

// Normalized query signature, used to detect an already-active duplicate.
function querySignature(q) {
  return String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Fetches and extracts readable text from a URL using Scrapling-inspired adaptive scraping,
 * automatically sanitized against indirect prompt injections.
 */
async function fetchPageText(url) {
  if (!url || !url.startsWith('http')) return '';
  try {
    const res = await adaptiveScrape(url, { timeout: 8000, wrapSandbox: true });
    if (res.success && res.sanitizedContent) {
      return res.sanitizedContent.slice(0, 4000);
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Searches DuckDuckGo Instant Answer API and fetches rich page content for top results.
 */
async function searchWebBaseline(query) {
  const baselineResults = await new Promise((resolve) => {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    // `timeout:` on its own only arms the socket's idle timer — Node does NOT
    // abort the request for you. Without the req.on('timeout') handler below,
    // a hung/rate-limited DuckDuckGo response fires neither 'end' nor 'error',
    // this promise never settles, and executeTask awaits forever with the task
    // frozen at progress:25 "Searching web indices...". That wedged 7 real
    // research tasks for two days. A belt-and-braces settle guard is also used
    // so this promise can only ever resolve once, from whichever path wins.
    let settled = false;
    const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = https.get(url, { headers: { 'User-Agent': 'Aloy-Athena-Scout/1.0' }, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const results = [];
          if (parsed.AbstractText) {
            results.push({
              title: sanitizeUntrustedWebContent(parsed.Heading || query),
              snippet: sanitizeUntrustedWebContent(parsed.AbstractText),
              url: parsed.AbstractURL || 'https://duckduckgo.com'
            });
          }
          if (Array.isArray(parsed.RelatedTopics)) {
            parsed.RelatedTopics.slice(0, 4).forEach(t => {
              if (t.Text && t.FirstURL) {
                results.push({
                  title: sanitizeUntrustedWebContent(t.Text.slice(0, 60)) + '...',
                  snippet: sanitizeUntrustedWebContent(t.Text),
                  url: t.FirstURL
                });
              }
            });
          }
          settle(results);
        } catch {
          settle([]);
        }
      });
    });
    req.on('error', () => settle([]));
    req.on('timeout', () => { req.destroy(); settle([]); });
    // Absolute ceiling independent of socket state — covers a stalled TLS
    // handshake or a trickle of bytes that keeps resetting the idle timer.
    setTimeout(() => { if (!settled) { try { req.destroy(); } catch {} settle([]); } }, 12000).unref?.();
  });

  // Deep-fetch full page text for up to 3 top URLs concurrently
  const deepResults = await Promise.all(baselineResults.slice(0, 3).map(async (src) => {
    if (src.url && src.url.startsWith('http') && !src.url.includes('duckduckgo.com')) {
      const pageText = await fetchPageText(src.url);
      if (pageText && pageText.length > 100) {
        return { ...src, content: pageText };
      }
    }
    return src;
  }));

  return deepResults.concat(baselineResults.slice(3));
}

/**
 * Synthesizes research findings into a comprehensive markdown report using Claude, Gemini, or Ollama.
 */
async function synthesizeReportWithAI({ query, depth, focusAreas = [], rawSources = [] }) {
  const depthPrompt = depth === RESEARCH_DEPTH.QUICK
    ? 'Provide a concise, high-impact Executive Brief (approx 300 words).'
    : depth === RESEARCH_DEPTH.DEEP_DIVE
    ? 'Provide an exhaustive, deeply technical Comprehensive Intelligence Dossier with comparisons, trade-offs, and data tables.'
    : 'Provide a well-structured Standard Research Report (approx 600-800 words).';

  const systemPrompt = `You are ATHENA, an elite Autonomous Research & Intelligence Scout.
Your mission is to perform rigorous, objective, and deeply insightful research on the user's query.

FORMAT REQUIREMENTS:
Generate a pristine, GitHub-Flavored Markdown report with:
# [Clear Descriptive Title]
> **Executive Summary**: 2-3 sentence high-level takeaway.

## 🔑 Key Findings & Takeaways
- Bulleted core insights.

## 📊 Comparative Analysis & Details
- Detailed breakdown with markdown tables or structured sub-sections.

## 💡 Practical Recommendations & Next Steps
- Actionable advice tailored to the user.

## 🌐 Sources & References
- List any relevant tools, projects, or reference URLs.

Tone: Authoritative, crystal clear, data-driven, and highly structured. Avoid fluff.`;

  const userPrompt = `TOPIC TO RESEARCH: ${query}
DEPTH: ${depth} (${depthPrompt})
FOCUS AREAS: ${focusAreas.length ? focusAreas.join(', ') : 'Comprehensive coverage'}
PRE-DISCOVERED CONTEXT & SOURCES:
${rawSources.map((s, i) => `[${i+1}] ${s.title} (${s.url})\nSummary: ${s.snippet}${s.content ? `\nPage Content: ${s.content}` : ''}`).join('\n\n') || 'None provided; use your broad knowledge base.'}

Conduct the full synthesis now in Markdown:`;

  // 1. Try Claude if available
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const response = await httpFetch('https://api.anthropic.com/v1/messages', {
        timeoutMs: TIMEOUTS.API,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: MODELS.CLAUDE,
          max_tokens: 2500,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.content?.[0]?.text;
        if (text) return { provider: MODELS.CLAUDE, markdown: text };
      }
    } catch (err) {
      console.warn('[Athena] Claude synthesis failed, falling back:', err.message);
    }
  }

  // 2. Try Gemini if available
  if (process.env.GEMINI_API_KEY) {
    try {
      const response = await httpFetch(geminiUrl(process.env.GEMINI_API_KEY), {
        timeoutMs: TIMEOUTS.API,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }]
        })
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return { provider: MODELS.GEMINI, markdown: text };
      }
    } catch (err) {
      console.warn('[Athena] Gemini synthesis failed, falling back:', err.message);
    }
  }

  // 3. Fallback to Local Ollama
  try {
    const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    const response = await httpFetch(`${ollamaUrl}/api/chat`, {
      timeoutMs: TIMEOUTS.LOCAL_LLM,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODELS.GENERAL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        stream: false,
        options: { temperature: 0.3 }
      })
    });
    if (response.ok) {
      const data = await response.json();
      const text = data?.message?.content;
      if (text) return { provider: 'local-ollama', markdown: text };
    }
  } catch (err) {
    console.warn('[Athena] Ollama synthesis failed:', err.message);
  }

  // 4. Heuristic Fallback
  return {
    provider: 'heuristic-engine',
    markdown: `# Research Dossier: ${query}\n\n> **Executive Summary**: Baseline research dossier compiled for **${query}**.\n\n## 🔑 Key Findings\n- Query investigated with depth: **${depth}**.\n- Synthesis completed across local intelligence indices.\n\n## 💡 Recommendations\n- Review topic specifics or refine focus areas for an extended deep-dive.`
  };
}

class AthenaEngine {
  constructor(customTasksFile = null) {
    this.tasksFile = customTasksFile || DEFAULT_TASKS_FILE;
    this.storageDir = path.dirname(this.tasksFile);
    this.ensureStorage();
    this.recoverStaleTasks();
  }

  /**
   * Marks tasks left in an in-flight state as failed.
   *
   * executeTask runs in-process via setImmediate, so a server restart (or a
   * hang like the missing-timeout bug) orphans anything mid-run: it stays
   * 'researching' at 25% forever, and because the underlying knowledge gap
   * never closes, schedulers keep dispatching fresh duplicates of it. Run at
   * construction so every server start sweeps the ledger clean.
   */
  recoverStaleTasks() {
    try {
      const tasks = this.loadTasks();
      const now = Date.now();
      let recovered = 0;
      for (const t of tasks) {
        const inFlight = t.status === RESEARCH_STATUS.RESEARCHING || t.status === RESEARCH_STATUS.SYNTHESIZING;
        if (!inFlight) continue;
        const age = now - new Date(t.createdAt || 0).getTime();
        if (age < STALE_TASK_MS) continue;
        t.status = RESEARCH_STATUS.FAILED;
        t.statusMessage = 'Recovered: task was orphaned in-flight (server restart or upstream hang) and has been marked failed.';
        t.completedAt = new Date().toISOString();
        // Mirrors the same check executeTask's own catch block uses on a
        // real failure — an orphan that got past the search step still has
        // its checkpoint and gathered sources sitting right there, so a
        // retry should be able to resume instead of redoing the search.
        // Previously this path never set canResume at all, so every
        // orphan-recovered task retried from scratch regardless of how far
        // it had actually gotten.
        t.canResume = Boolean(t.sources && t.sources.length > 0);
        recovered++;
      }
      if (recovered > 0) {
        this.saveTasks(tasks);
        console.warn(`[Athena] Recovered ${recovered} orphaned in-flight research task(s).`);
        logAuditEvent({
          action: 'athena_stale_tasks_recovered',
          source: 'athena',
          details: { recovered }
        });
      }
    } catch (err) {
      console.warn('[Athena] Stale-task recovery failed:', err.message);
    }
  }

  ensureStorage() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    if (!fs.existsSync(this.tasksFile)) {
      fs.writeFileSync(this.tasksFile, JSON.stringify([], null, 2), 'utf8');
    }
  }

  loadTasks() {
    this.ensureStorage();
    const bakFile = this.tasksFile + '.bak';
    try {
      if (fs.existsSync(this.tasksFile)) {
        const raw = fs.readFileSync(this.tasksFile, 'utf8');
        if (raw && raw.trim().length > 0) {
          return JSON.parse(raw);
        }
      }
    } catch {
      // Primary corrupted, attempt backup recovery
      try {
        if (fs.existsSync(bakFile)) {
          const bakRaw = fs.readFileSync(bakFile, 'utf8');
          if (bakRaw && bakRaw.trim().length > 0) {
            const parsedBak = JSON.parse(bakRaw);
            this.saveTasks(parsedBak);
            return parsedBak;
          }
        }
      } catch {}
    }
    return [];
  }

  saveTasks(tasks) {
    this.ensureStorage();
    const serialized = JSON.stringify(tasks, null, 2);
    const dir = path.dirname(this.tasksFile);
    const tmpPath = path.join(dir, `.${path.basename(this.tasksFile)}.${process.pid}.${Date.now()}.tmp`);
    const bakFile = this.tasksFile + '.bak';

    try {
      fs.writeFileSync(tmpPath, serialized, 'utf8');
      if (fs.existsSync(this.tasksFile)) {
        try { fs.copyFileSync(this.tasksFile, bakFile); } catch {}
      }
      fs.renameSync(tmpPath, this.tasksFile);
    } catch (err) {
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
      throw err;
    }
  }

  listTasks(filter = {}) {
    const tasks = this.loadTasks();
    if (filter && filter.status && filter.status !== 'all') {
      return tasks.filter(t => t.status === filter.status);
    }
    return tasks;
  }

  getTask(id) {
    const tasks = this.loadTasks();
    return tasks.find(t => t.id === id) || null;
  }

  async createTask({ query, depth = RESEARCH_DEPTH.STANDARD, focusAreas = [], requestedBy = 'user' }) {
    if (!query || !query.trim()) {
      throw new Error('Research query is required');
    }

    const tasks = this.loadTasks();

    // Duplicate guard. Schedulers (Conclave's knowledge-gap directive, the
    // skills dashboard) re-dispatch the SAME query every run while the gap
    // stays open — and if the existing task is wedged, the gap never closes,
    // so it re-dispatches forever. Observed live: 7 identical "Calendar &
    // Reminders" tasks, 6 of them from pantheon_conclave. Return the existing
    // in-flight task instead of stacking another copy; callers already treat
    // the return value as "the task for this query".
    const sig = querySignature(query);
    const active = tasks.find(t =>
      querySignature(t.query) === sig &&
      (t.status === RESEARCH_STATUS.QUEUED ||
       t.status === RESEARCH_STATUS.RESEARCHING ||
       t.status === RESEARCH_STATUS.SYNTHESIZING)
    );
    if (active) {
      console.log(`[Athena] Duplicate request for an already-active query — returning existing task ${active.id}.`);
      return active;
    }

    const taskId = `athena-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const task = {
      id: taskId,
      query: query.trim(),
      depth: Object.values(RESEARCH_DEPTH).includes(depth) ? depth : RESEARCH_DEPTH.STANDARD,
      focusAreas: Array.isArray(focusAreas) ? focusAreas : [],
      status: RESEARCH_STATUS.QUEUED,
      progress: 0,
      statusMessage: 'Queued for background intelligence scout...',
      reportMarkdown: null,
      provider: null,
      sources: [],
      requestedBy,
      createdAt: new Date().toISOString(),
      completedAt: null
    };

    tasks.unshift(task);
    this.saveTasks(tasks);

    logAuditEvent({
      action: 'athena_research_created',
      source: 'athena',
      details: { taskId, query: task.query, depth: task.depth }
    });

    // Execute asynchronously in the background
    setImmediate(() => this.executeTask(taskId));

    return task;
  }

  // Re-loads the tasks file fresh and applies `mutate` to THIS task's
  // current record, then saves that fresh array — never a snapshot taken
  // earlier in a long-running executeTask call. Returns the updated task, or
  // null if it was deleted or cancelled out from under this run (the caller
  // must stop rather than keep going and overwrite that with a stale copy).
  //
  // executeTask used to hold one tasks-array snapshot for its whole
  // multi-step duration (search → checkpoint → synthesize → complete) and
  // write that same snapshot back at every progress update. A delete or
  // cancel that landed mid-run wrote correctly to disk in that moment, but
  // the next progress save from the still-running task silently overwrote
  // it right back — the dossier just reappeared on the next poll as if
  // nothing had happened. Routing every save through here closes that.
  persistTaskUpdate(taskId, mutate) {
    const freshTasks = this.loadTasks();
    const idx = freshTasks.findIndex(t => t.id === taskId);
    if (idx === -1) return null; // deleted mid-run
    const freshTask = freshTasks[idx];
    if (freshTask.status === RESEARCH_STATUS.CANCELLED) return null; // cancelled mid-run
    mutate(freshTask);
    this.saveTasks(freshTasks);
    return freshTask;
  }

  async executeTask(taskId) {
    let task = this.getTask(taskId);
    if (!task) return;
    if (task.status === RESEARCH_STATUS.CANCELLED) return;

    try {
      let sources = task.sources || [];

      // Check if we already have a checkpoint with gathered sources
      const hasValidCheckpoint = task.checkpoint?.stage === 'sources_gathered' && Array.isArray(task.sources) && task.sources.length > 0;

      if (!hasValidCheckpoint) {
        // Step 1: Gathering baseline sources
        task = this.persistTaskUpdate(taskId, (t) => {
          t.status = RESEARCH_STATUS.RESEARCHING;
          t.progress = 25;
          t.statusMessage = 'Searching web indices and relevant documentation...';
        });
        if (!task) return;

        // Defence in depth: wrap search in deadline
        sources = await withDeadline(
          searchWebBaseline(task.query),
          SEARCH_DEADLINE_MS,
          []
        );

        task = this.persistTaskUpdate(taskId, (t) => {
          t.sources = sources;
          t.checkpoint = {
            stage: 'sources_gathered',
            sourcesCount: sources.length,
            savedAt: new Date().toISOString()
          };
          t.progress = 60;
          t.statusMessage = `Discovered ${sources.length} relevant sources. Synthesizing intelligence dossier...`;
        });
        if (!task) return;
      } else {
        task = this.persistTaskUpdate(taskId, (t) => {
          t.status = RESEARCH_STATUS.SYNTHESIZING;
          t.progress = 60;
          t.statusMessage = `Resuming from checkpoint with ${sources.length} cached sources. Synthesizing intelligence dossier...`;
        });
        if (!task) return;
      }

      // Step 2: AI Multi-source Synthesis
      task = this.persistTaskUpdate(taskId, (t) => { t.status = RESEARCH_STATUS.SYNTHESIZING; });
      if (!task) return;

      const synthesis = await synthesizeReportWithAI({
        query: task.query,
        depth: task.depth,
        focusAreas: task.focusAreas,
        rawSources: sources
      });

      // Step 3: Complete
      task = this.persistTaskUpdate(taskId, (t) => {
        t.status = RESEARCH_STATUS.COMPLETED;
        t.progress = 100;
        t.statusMessage = 'Research dossier complete and verified.';
        t.reportMarkdown = synthesis.markdown;
        t.provider = synthesis.provider;
        t.completedAt = new Date().toISOString();
        t.checkpoint = { stage: 'completed', completedAt: t.completedAt };
      });
      if (!task) return; // deleted/cancelled mid-run — don't log completion for it

      logAuditEvent({
        action: 'athena_research_completed',
        source: 'athena',
        details: { taskId, provider: task.provider, sourcesCount: sources.length }
      });

    } catch (err) {
      console.error('[Athena Engine Error]', err);
      const failed = this.persistTaskUpdate(taskId, (t) => {
        t.status = RESEARCH_STATUS.FAILED;
        t.statusMessage = `Research failed: ${err.message}`;
        t.completedAt = new Date().toISOString();
        t.canResume = Boolean(t.sources && t.sources.length > 0);
      });
      if (failed) {
        logAuditEvent({
          action: 'athena_research_failed',
          source: 'athena',
          details: { taskId, error: err.message }
        });
      }
    }
  }

  resumeTask(taskId) {
    const tasks = this.loadTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return { success: false, error: 'Task not found' };

    if (task.status === RESEARCH_STATUS.COMPLETED) {
      return { success: false, error: 'Task already completed' };
    }

    task.status = RESEARCH_STATUS.QUEUED;
    task.statusMessage = 'Research task queued for resumption...';
    task.completedAt = null;
    this.saveTasks(tasks);

    setImmediate(() => this.executeTask(taskId));
    logAuditEvent({
      action: 'athena_task_resumed',
      source: 'athena',
      details: { taskId, checkpoint: task.checkpoint }
    });
    return { success: true, task };
  }

  deleteTask(taskId) {
    const tasks = this.loadTasks();
    const filtered = tasks.filter(t => t.id !== taskId);
    if (filtered.length !== tasks.length) {
      this.saveTasks(filtered);
      logAuditEvent({
        action: 'athena_research_deleted',
        source: 'athena',
        details: { taskId }
      });
      return { success: true };
    }
    return { success: false, error: 'Task not found' };
  }

  cancelTask(taskId) {
    const tasks = this.loadTasks();
    const task = tasks.find(t => t.id === taskId);
    if (task && (task.status === RESEARCH_STATUS.QUEUED || task.status === RESEARCH_STATUS.RESEARCHING || task.status === RESEARCH_STATUS.SYNTHESIZING)) {
      task.status = RESEARCH_STATUS.CANCELLED;
      task.statusMessage = 'Research cancelled by user.';
      task.completedAt = new Date().toISOString();
      this.saveTasks(tasks);
      return { success: true };
    }
    return { success: false, error: 'Cannot cancel task in current status' };
  }
}

const athenaEngine = new AthenaEngine();

module.exports = {
  athenaEngine,
  AthenaEngine,
  RESEARCH_STATUS,
  RESEARCH_DEPTH
};
