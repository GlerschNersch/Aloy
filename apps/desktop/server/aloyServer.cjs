// Aloy backend server — the Phase 2 piece for a future mobile client.
// Runs inside Electron's main process, reachable over Tailscale. Reuses the
// EXACT SAME tool definitions (server/../src/services/tools.js) the desktop
// app uses, via dynamic import (those are ES modules; this file is CJS).
//
// Scope note: this owns its OWN data store (server/store.cjs), seeded once
// from the NAS backup. It does NOT yet read/write the desktop app's
// localStorage — that reconciliation (true single source of truth
// everywhere) is deliberate follow-up work, not done here.
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

function resolveService(serviceFile) {
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'src', 'services', serviceFile),
    path.join(__dirname, '..', 'src', 'services', serviceFile)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return pathToFileURL(p).href;
    }
  }
  return pathToFileURL(path.join(__dirname, '..', 'src', 'services', serviceFile)).href;
}

// Ensure Home Assistant and AI API keys are loaded into process.env
const EXTERNAL_ENV_PATH = path.join(os.homedir(), '.aloy-server', '.env');
try {
  process.loadEnvFile(EXTERNAL_ENV_PATH);
} catch {
  try {
    process.loadEnvFile(path.join(__dirname, '..', '.env'));
  } catch {}
}

const store = require('./store.cjs');
const { getConnectedClients, trackClientMiddleware } = require('./clientTracker.cjs');
const { MODELS } = require('./models.cjs');
const { getOrCreateToken, requireAuth } = require('./auth.cjs');
const { initMcpClients, getMcpToolDefinitions, callMcpTool } = require('./mcpClient.cjs');
const { checkConfidenceAndMaybeEscalate, getEscalationStats, stripContextBoilerplate } = require('./confidenceEscalation.cjs');
const { researchTopic } = require('./research.cjs');
const { getSkillsDashboard } = require('./skillsDashboard.cjs');
const { getInboxFeed } = require('./inboxAggregator.cjs');
const { getAutoRipStatusText } = require('./autoripStatus.cjs');
const { proofreadDocumentRewrite, extractAttachedDocument } = require('./documentProofread.cjs');
const { getRelevantKnowledge, embedKnowledgeEntry } = require('./knowledgeRetrieval.cjs');
const { logToolCallSequence, getRelevantSkills } = require('./skillSynthesis.cjs');
const { searchCliHub, getCliHubInfo, executeCliHubTool } = require('./cliHubRunner.cjs');
const { logAuditEvent, getRecentAuditLogs } = require('./auditLogger.cjs');
const { validateSmartHomeAction,
  sanitizeUntrustedWebContent
} = require('./securityGuard.cjs');
const { globalPlanner } = require('./planner.cjs');
const { searchKnowledgeGraph } = require('./graphRAG.cjs');
const { globalEvalHarness } = require('./evalHarness.cjs');
const { buildDistillationDataset } = require('./trainer/datasetBuilder.cjs');
const { globalHephaestus, TASK_STATUS: HEPH_TASK_STATUS } = require('./hephaestus.cjs');
const { globalHephGoalEngine } = require('./hephGoalEngine.cjs');
const { athenaEngine } = require('./athena.cjs');
const { globalApollo } = require('./apollo.cjs');
const { globalMinerva } = require('./minerva.cjs');
const { globalHermes, globalHermesPipeline, globalHermesEvolution, globalHermesMemory, globalHermesGateway } = require('./hermes.cjs');
const { globalHermesDigest } = require('./hermesDigest.cjs');
const { ConclaveEngine } = require('./conclave.cjs');
const { globalJobRadar } = require('./jobRadar.cjs');
const { SidecarWatchdog } = require('./sidecarWatchdog.cjs');
const { routeModelRequest } = require('./modelRouter.cjs');
const { httpFetch, httpJson, TIMEOUTS } = require('./http.cjs');
const { globalVoiceBridge, DEFAULT_VOICES } = require('./voiceBridge.cjs');
const { globalBrowserAgent } = require('./browserAgent.cjs');
const { globalHassTelemetryBridge } = require('./hassTelemetryBridge.cjs');
const { globalLightGraphRAG } = require('./lightGraphRAG.cjs');
const { globalHealthBridge } = require('./healthBridge.cjs');
const { globalZeppSyncEngine } = require('./zeppSyncEngine.cjs');
const { TokenCompressor, quotaRouter } = require('./tokenCompressor.cjs');
const { memoryHub: globalMemoryHub } = require('./apolloMemoryHub.cjs');
const { NeedleIntentEngine } = require('./needleIntent.cjs');
const { mcpRegistry: globalMcpRegistry } = require('./mcpRegistry.cjs');

const globalConclave = new ConclaveEngine({
  minervaEngine: globalMinerva,
  apolloEngine: globalApollo,
  hephaestusEngine: globalHephaestus,
  athenaEngine: athenaEngine,
  hermesEngine: globalHermes
});

const globalSidecarWatchdog = new SidecarWatchdog();

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (err) {}

const MAX_TOOL_LOOP_DEPTH = 6;
const DEFAULT_MODEL = 'aloy-assistant';

function sanitizeNoteFilename(filename) {
  const safe = String(filename).replace(/[\\/:*?"<>|]/g, '').trim();
  return safe.toLowerCase().endsWith('.md') ? safe : `${safe}.md`;
}

// Port 5555 collides with Android's own emulator/ADB transport convention
// (emulator-5554 pairs with an ADB port at 5555) — discovered when a health
// check intermittently got empty replies from the emulator's QEMU process
// instead of this server. 7890 avoids that reserved range entirely.
async function startAloyServer(port = 7890, extraHandlers = {}) {
  const { streamChat } = await import(resolveService('ollama.js'));
  // toolRequiresConfirmation / isWriteTool are imported from tools.js rather
  // than reimplemented here on purpose: they encode a security decision
  // (which actions may run without asking) and the desktop path in App.jsx
  // imports the same two functions. A local copy WILL drift from the shared
  // one — a previous local duplicate here silently dropped the shared
  // version's fail-closed try/catch, so a throwing predicate would have
  // executed the action instead of prompting.
  const { getToolDefinitions, getTool, parseToolArguments, registerMcpTools, toolRequiresConfirmation, isWriteTool } = await import(resolveService('tools.js'));
  const {
    fetchHomeAssistantStates, groupEntitiesByCategory, calculateSmartHomeStats, executeHAService,
    formatSmartHomeContext, fetchGoogleCalendarEvents, fetchLLMVisionTimeline, summarizeLLMVisionActivity, getLLMVisionEventsDetail
  } = await import(resolveService('homeassistant.js'));
  const { calculateBudgetStatus } = await import(resolveService('financeTracker.js'));
  const { createReminder } = await import(resolveService('reminders.js'));
  const { createWorkoutEntry, calculateWorkoutStreak, formatWorkoutHistoryContext } = await import(resolveService('workouts.js'));
  const { trimWhitespace, allocateContextBudget, capLinesToBudget, INJECTED_SECTION_WEIGHTS } = await import(resolveService('contextCompression.js'));
  const CONTEXT_SECTION_BUDGETS = allocateContextBudget(INJECTED_SECTION_WEIGHTS);
  const { fetchProjectStatus, parseProjectStatusSummary } = await import(resolveService('projectMonitor.js'));

  const token = getOrCreateToken();
  console.log(`Aloy server: auth token (for the mobile app config) at ${require('./auth.cjs').TOKEN_PATH}`);

  // Seed once from the local backup if this server's own store is empty.
  const backupPath = path.join(os.homedir(), 'Documents', 'Aloy Backups', 'aloy-backup-latest.json');
  if (store.seedFromBackupIfEmpty(backupPath)) {
    console.log('Aloy server: seeded initial data from backup.');
  }

  // Live Home Assistant snapshot, refreshed like the desktop app's own poll.
  let haCategories = {};
  let smartHomeStats = null;
  let cachedRawStates = null;
  const refreshHA = async () => {
    try {
      const states = await fetchHomeAssistantStates();
      if (states) {
        cachedRawStates = states;
        haCategories = groupEntitiesByCategory(states);
        smartHomeStats = calculateSmartHomeStats(haCategories);
      }
    } catch (err) {
      console.warn('Aloy server HA refresh warning:', err.message);
    }
  };
  await refreshHA();
  setInterval(refreshHA, 60000);

  // MCP tools (see server/mcpClient.cjs) — this shares a process with
  // electron.cjs, which also calls initMcpClients(); memoized there, so this
  // just awaits the same in-flight/completed init rather than double-
  // spawning servers. Registers into THIS module's own tools.js instance
  // (a separate one from the renderer's, per the comment in tools.js) with
  // callMcpTool called directly — no IPC hop needed, same process.
  await initMcpClients();
  registerMcpTools(getMcpToolDefinitions(), callMcpTool);

  function buildCtx() {
    const data = store.load();
    return {
      transactions: data.transactions,
      budgets: data.budgets,
      trackedProjects: data.trackedProjects || [],
      haCategories,
      smartHomeStats,
      rawHaStates: cachedRawStates,
      onFetchRawHaStates: async () => cachedRawStates || fetchHomeAssistantStates(),
      onAddTransaction: (tx) => {
        const d = store.load();
        d.transactions.push(tx);
        store.save(d);
      },
      onSetBudget: ({ category, limit }) => {
        const d = store.load();
        d.budgets = [...d.budgets.filter((b) => b.category !== category), { category, limit }];
        store.save(d);
      },
      onExecuteHAService: async (domain, service, entityId) => {
        const success = await executeHAService(domain, service, entityId);
        if (success) setTimeout(refreshHA, 1000);
        return success;
      },
      onGetPortfolioSnapshot: () => globalHermes.getPortfolioSnapshot(),
      onSetPortfolioShares: (symbol, shares) => globalHermes.setShares(symbol, shares),
      onAddReminder: (text, dueAt) => {
        const d = store.load();
        d.reminders.push(createReminder(text, dueAt));
        store.save(d);
      },
      onCompleteReminder: (textMatch) => {
        const d = store.load();
        const lower = textMatch.toLowerCase();
        const match = d.reminders.find((r) => !r.completed && r.text.toLowerCase().includes(lower));
        if (!match) return false;
        match.completed = true;
        store.save(d);
        return true;
      },
      onAddWorkout: (exercises, notes) => {
        const d = store.load();
        d.workouts = d.workouts || [];
        d.workouts.push(createWorkoutEntry(exercises, notes));
        store.save(d);
      },
      onGetWorkoutHistory: () => (store.load().workouts || []),
      onCreateNote: async (title, content) => {
        const d = store.load();
        if (!d.vaultDir) return { success: false, error: 'No Obsidian vault configured on this server yet.' };
        try {
          const finalName = sanitizeNoteFilename(title);
          const fullPath = path.join(d.vaultDir, finalName);
          const resolvedVault = path.resolve(d.vaultDir);
          const resolvedPath = path.resolve(fullPath);
          if (!resolvedPath.startsWith(resolvedVault + path.sep)) {
            return { success: false, error: 'Resolved path escaped the vault directory' };
          }
          fs.writeFileSync(fullPath, content, 'utf-8');
          return { success: true, path: fullPath, filename: finalName };
        } catch (err) {
          return { success: false, error: err.message };
        }
      },
      onResearchTopic: (topic) => researchTopic({ topic }),
      onSaveLearnedKnowledge: async (entry) => {
        const embedded = await embedKnowledgeEntry(entry);
        const d = store.load();
        d.learnedKnowledge = [...(d.learnedKnowledge || []), embedded];
        store.save(d);
      },
      onSaveLesson: (entry) => {
        const d = store.load();
        d.lessons = [...(d.lessons || []), entry];
        store.save(d);
      },
      onAddMemory: (newFact) => {
        const d = store.load();
        const mems = d.memories || [];
        if (!mems.includes(newFact)) {
          d.memories = [...mems, newFact];
          store.save(d);
        }
      },
      onSaveProfile: (patch) => {
        const d = store.load();
        d.userProfile = { ...(d.userProfile || {}), ...patch };
        store.save(d);
      },
      onGetSkillsDashboard: () => getSkillsDashboard(),
      onGetAutoRipStatus: () => getAutoRipStatusText(),
      onGetTechNews: () => (store.load().newsArticles || []).filter((a) => a.relevant),
      onSearchCliTools: (query) => searchCliHub(query),
      onGetCliToolInfo: (toolName) => getCliHubInfo(toolName),
      onRunCliTool: (toolName, args) => executeCliHubTool(toolName, args),
      onSearchKnowledgeGraph: (query) => searchKnowledgeGraph(query, haCategories),
      onCreateForgeTask: async (taskData) => globalHephaestus.createTask(taskData),
      onGetForgeTask: async (taskId) => globalHephaestus.getTask(taskId),
      onDispatchAthenaResearch: async (taskData) => athenaEngine.createTask(taskData),
      onGetAthenaTask: async (taskId) => athenaEngine.getTask(taskId),
      onAuditMediaLibrary: async (args) => {
        const { mediaFormatterService } = require('./mediaFormatterService.cjs');
        return await mediaFormatterService.audit(args || {});
      },
      onFormatMediaLibrary: async (args) => {
        const { mediaFormatterService } = require('./mediaFormatterService.cjs');
        return await mediaFormatterService.format(args || {});
      },
      onRunSequentialPipeline: async (args) => {
        const { SequentialPipeline, SessionStateStore } = require('./adkOrchestrator.cjs');
        const pipeline = new SequentialPipeline({ name: args.pipeline_name });
        for (const step of args.steps || []) {
          pipeline.addStep({
            agent: async (input, state) => {
              if (step.agent_name === 'athena') return await athenaEngine.createTask({ query: input });
              if (step.agent_name === 'hephaestus') return await globalHephaestus.createTask({ title: input });
              if (step.agent_name === 'hermes') return await globalHermes.getDailyBriefing();
              if (step.agent_name === 'minerva') return await globalMinerva.runHealthScan();
              return { message: `Step executed for ${step.agent_name}`, input };
            },
            inputTemplate: step.input_template,
            outputKey: step.output_key
          });
        }
        return await pipeline.execute(args.initial_input || '');
      },
      onRunParallelDispatch: async (args) => {
        const { ParallelDispatch, AgentAsTool } = require('./adkOrchestrator.cjs');
        const agents = (args.tasks || []).map(t => ({
          agent: new AgentAsTool({
            name: t.agent_name,
            agentInstance: {
              executeTask: async (task) => {
                if (t.agent_name === 'athena') return await athenaEngine.createTask({ query: task });
                if (t.agent_name === 'hephaestus') return await globalHephaestus.createTask({ title: task });
                if (t.agent_name === 'hermes') return await globalHermes.getDailyBriefing();
                if (t.agent_name === 'minerva') return await globalMinerva.runHealthScan();
                return { task, completed: true };
              }
            }
          }),
          task: t.task,
          outputKey: t.output_key
        }));
        const dispatch = new ParallelDispatch({ name: args.dispatch_name, agents });
        return await dispatch.execute();
      },
      onTransferToAgent: (targetAgent, reason) => {
        // The shared instance, not a fresh one. Constructing per call reset the
        // handoff stack every time, so nothing was ever preserved across a
        // transfer and returnControl could never pop back.
        const { globalHandoffManager } = require('./adkOrchestrator.cjs');
        return globalHandoffManager.transferToAgent(targetAgent, reason);
      }
    };
  }

  // Local (not UTC) date components — using toISOString() here would shift
  // the date across midnight-UTC boundaries (e.g. any time after ~5-8pm
  // Pacific is already "tomorrow" in UTC), silently corrupting "today".
  function localISODate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function formatDateAnchor() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekday = (date) => date.toLocaleDateString('en-US', { weekday: 'long' });
    return `[DATE ANCHOR — use these exact values, do not compute "today"/"tomorrow" yourself]: Today is ${localISODate(now)} (${weekday(now)}). Tomorrow is ${localISODate(tomorrow)} (${weekday(tomorrow)}).`;
  }

  // End-of-day learning report: a scheduled job (checked every 5 min, fires
  // once per local day at/after REPORT_HOUR) that summarizes every
  // claudeEscalations entry from today into a new message in a dedicated,
  // pinned chat thread — reusing the existing chat UI/sync on both desktop
  // and mobile rather than building a new notification surface. "Learned"
  // here means claudeEscalations specifically (the AI-driven correction
  // log from server/confidenceEscalation.cjs) — the separate `memories`
  // domain is user-entered facts about the user, not something the AI adds
  // to, so it's intentionally not part of this report.
  const REPORT_HOUR = 21; // 9 PM local
  const REPORT_CHAT_TITLE = 'Daily Learning Report';

  function getOrCreateReportChatId() {
    const d = store.load();
    let chat = d.chats.find((c) => c.title === REPORT_CHAT_TITLE);
    if (!chat) {
      chat = { id: `chat-report-${Date.now()}`, title: REPORT_CHAT_TITLE, messages: [], createdAt: new Date().toISOString(), pinned: true };
      d.chats.unshift(chat);
      store.save(d);
    }
    return chat.id;
  }

  // Report-display alias for the same stripping confidenceEscalation.cjs now
  // uses before embedding (see stripContextBoilerplate there for why this
  // boilerplate exists and the bug it caused) — kept as a named wrapper here
  // since call sites below read more clearly as "for display" than reusing
  // the embedding-focused name directly.
  const cleanQuestionForDisplay = stripContextBoilerplate;

  function generateDailyReportText(todayStr, todaysEscalations) {
    const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    let text = '';
    if (todaysEscalations.length === 0) {
      text = `📚 **Daily Learning Report — ${weekday}**\n\nNo corrections were needed today — every local answer passed its own confidence check, or nothing was asked.`;
    } else {
      text = `📚 **Daily Learning Report — ${weekday}**\n\nAloy checked with Claude ${todaysEscalations.length} time${todaysEscalations.length !== 1 ? 's' : ''} today:\n\n`;
      todaysEscalations.forEach((e, i) => {
        text += `**${i + 1}. ${cleanQuestionForDisplay(e.question)}**\n${e.claudeAnswer.trim()}${e.fromCache ? '\n_(answered from a cached prior correction)_' : ''}\n\n`;
      });
    }

    try {
      const openHephTasks = (globalHephaestus?.listTasks ? globalHephaestus.listTasks() : []).filter(t => t.status === 'queued');
      if (openHephTasks.length > 0) {
        text += `\n\n⏳ **Pending Engineering Work Orders (${openHephTasks.length}):**\n` +
          openHephTasks.map(t => `• **${t.title}** (awaiting dispatch)`).join('\n');
      }
    } catch {}

    return text.trim();
  }

  function maybeGenerateDailyReport() {
    const now = new Date();
    if (now.getHours() < REPORT_HOUR) return;
    const todayStr = localISODate(now);
    const d = store.load();
    if (d.lastDailyReportDate === todayStr) return; // already generated today

    const todaysEscalations = (d.claudeEscalations || []).filter((e) => e.timestamp.startsWith(todayStr));
    const reportText = generateDailyReportText(todayStr, todaysEscalations);

    const chatId = getOrCreateReportChatId();
    const dd = store.load();
    const chat = dd.chats.find((c) => c.id === chatId);
    chat.messages.push({ role: 'assistant', content: reportText, timestamp: new Date().toISOString(), isDailyReport: true });
    dd.lastDailyReportDate = todayStr;
    store.save(dd);
    console.log(`Daily learning report generated for ${todayStr} (${todaysEscalations.length} escalations).`);
  }

  // Checked every 5 min; maybeGenerateDailyReport itself gates on time-of-day
  // and a persisted lastDailyReportDate flag so it actually fires once. Also
  // checked once immediately here — covers the app being closed at 9 PM and
  // opened later the same evening, matching store.cjs's seededFromBackup
  // "fire once, not on a schedule assumption" philosophy. Placed after
  // REPORT_HOUR/generateDailyReportText are actually initialized — calling
  // it any earlier in this function hits their temporal dead zone.
  setInterval(maybeGenerateDailyReport, 5 * 60 * 1000);
  maybeGenerateDailyReport();

  // Automated nightly teaching pass (added 2026-08-04) — an hour before the
  // daily report, so escalations logged that day are already tagged with a
  // teachingStatus by the time the report reads them (not required for
  // correctness, just a cleaner sequence). See skillsDashboard.cjs's
  // runNightlyAutoTeaching for what this actually does and the safety
  // properties it has that the earlier manual bulk-resolve didn't.
  const TEACHING_HOUR = 20; // 8 PM local
  async function maybeRunNightlyTeaching() {
    const now = new Date();
    if (now.getHours() < TEACHING_HOUR) return;
    const todayStr = localISODate(now);
    const d = store.load();
    if (d.lastAutoTeachingRun && localISODate(new Date(d.lastAutoTeachingRun)) === todayStr) return;
    const { runNightlyAutoTeaching } = require('./skillsDashboard.cjs');
    try {
      const result = await runNightlyAutoTeaching();
      console.log(`Nightly auto-teaching for ${todayStr}: ${result.confirmedCount} confirmed, ${result.reviewCount} need review, ${result.errorCount} errors (${result.processed} processed).`);
    } catch (err) {
      console.error('Nightly auto-teaching failed:', err.message);
    }
  }
  setInterval(maybeRunNightlyTeaching, 5 * 60 * 1000);
  maybeRunNightlyTeaching();

  // Tech-news scrape pipeline (added 2026-08-15) — interval-gated rather
  // than hour-of-day gated like the jobs above, since "a few times a day"
  // doesn't map to a single fire time. See newsScraper.cjs's runNewsScrape
  // for the actual scrape+relevance-filter work.
  const NEWS_SCRAPE_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours
  async function maybeRunNewsScrape() {
    const d = store.load();
    if (!(d.newsSources || []).length) return; // nothing configured yet
    if (d.lastNewsScrapeAt && Date.now() - new Date(d.lastNewsScrapeAt).getTime() < NEWS_SCRAPE_INTERVAL_MS) return;
    const { runNewsScrape } = require('./newsScraper.cjs');
    try {
      const result = await runNewsScrape();
      console.log(`News scrape: ${result.rawArticlesFound} found, ${result.newArticlesScored} scored, ${result.relevantCount} relevant.`);
    } catch (err) {
      console.error('News scrape failed:', err.message);
    }
  }
  setInterval(maybeRunNewsScrape, 5 * 60 * 1000);
  maybeRunNewsScrape();

  // Job Radar scheduled scan (added 2026-08-19). jobRadar.cjs shipped with
  // `autoScanIntervalHours` in its config and nothing reading it, so the
  // "autonomous" scanner only ran when someone POSTed /api/jobs/scan. Same
  // interval-gated shape as the news scrape above.
  //
  // Failure alerting matters more here than for other jobs: LinkedIn's guest
  // endpoint rate-limits and blocks (HTTP 429/999), and every failure path in
  // the engine degrades to an empty array — so a blocked scanner looks exactly
  // like "no new jobs" and can stay silently dead indefinitely. jobRadar now
  // tracks consecutiveFailedScans and a parserSuspect flag; after
  // JOB_RADAR_FAILURES_TO_ALERT consecutive bad scans this reuses the same two
  // channels the service watchdog uses, and alerts once per outage rather
  // than every cycle.
  const JOB_RADAR_FAILURES_TO_ALERT = 3;
  let jobRadarAlerted = false;
  async function maybeRunJobScan() {
    try {
      const cfg = globalJobRadar.getConfig();
      if (cfg.enabled === false) return;
      const intervalMs = Math.max(1, Number(cfg.autoScanIntervalHours) || 6) * 60 * 60 * 1000;
      if (cfg.lastScannedAt && Date.now() - new Date(cfg.lastScannedAt).getTime() < intervalMs) return;

      const result = await globalJobRadar.runJobScan();
      console.log(`Job Radar scan: ${result.newJobsCount} new, ${result.totalListingsCount} total${result.success ? '' : ' (SCAN DEGRADED)'}.`);

      const fails = result.health?.consecutiveFailedScans || 0;
      if (fails >= JOB_RADAR_FAILURES_TO_ALERT && !jobRadarAlerted) {
        jobRadarAlerted = true;
        const reason = result.health?.parserSuspect
          ? 'LinkedIn returned pages but no jobs could be parsed — the markup has likely changed and the scraper needs updating.'
          : `Scans keep failing: ${result.health?.lastError || 'unknown error'}`;
        const message = `Job Radar has failed ${fails} consecutive scans. ${reason}`;
        await globalMinerva.dispatchAlert({ title: 'Job Radar Degraded', message, severity: 'warning' }).catch(() => {});
        appendFollowupMessage(getOrCreateAlertsChatId(), `⚠️ **Job Radar Degraded**\n\n${message}`, {
          timestamp: new Date().toISOString(), isServiceAlert: true
        });
        console.warn(`[jobradar] ${message}`);
      } else if (fails === 0 && jobRadarAlerted) {
        jobRadarAlerted = false;
        appendFollowupMessage(getOrCreateAlertsChatId(), '✅ **Job Radar Recovered** — scans are returning results again.', {
          timestamp: new Date().toISOString(), isServiceAlert: true
        });
      }
    } catch (err) {
      console.error('Job Radar scheduled scan failed:', err.message);
    }
  }
  setInterval(maybeRunJobScan, 15 * 60 * 1000);
  // Not run immediately at startup — the machine may still be coming up, and
  // an immediate scrape on every restart looks like automated hammering to
  // LinkedIn. First scan happens within 15 minutes.

  // Anomaly-alert notifications (added 2026-08-12) — pushes a real OS
  // notification via Home Assistant's existing mobile_app companion-app
  // integration whenever the 5 local-Ollama camera automations log
  // something notable (non-routine per getLLMVisionEventsDetail's filter).
  // Deliberately NOT built as AloyMobile background polling: this same
  // session already confirmed Android suspends backgrounded JS timers and
  // `force-stop` cancels scheduled WorkManager jobs, whereas HA's own
  // companion-app push already works reliably regardless of app state or
  // whether AloyMobile is even installed. Checks a short rolling window
  // frequently (not a long one occasionally) so nothing falls in the gap
  // between checks.
  const VISION_ALERT_TARGET = 'mobile_app_oneplus_15';
  async function maybeAlertVisionAnomalies() {
    try {
      const d = store.load();
      // First-ever run: just set the checkpoint to now. Without this, a
      // fresh checkpoint would immediately fire alerts for the whole
      // last-hour backlog fetched below.
      if (!d.lastVisionAlertAt) {
        d.lastVisionAlertAt = new Date().toISOString();
        store.save(d);
        return;
      }
      const events = await fetchLLMVisionTimeline(1);
      const { notable } = getLLMVisionEventsDetail(events);
      const since = new Date(d.lastVisionAlertAt).getTime();
      const fresh = notable
        .filter((e) => new Date(e.start).getTime() > since)
        .sort((a, b) => new Date(a.start) - new Date(b.start));
      if (fresh.length === 0) return;
      for (const e of fresh) {
        await executeHAService('notify', VISION_ALERT_TARGET, null, {
          title: 'Aloy Vision Alert',
          message: e.description
        });
      }
      const dd = store.load();
      dd.lastVisionAlertAt = fresh[fresh.length - 1].start;
      store.save(dd);
      console.log(`Vision anomaly alert: pushed ${fresh.length} notable event(s) to ${VISION_ALERT_TARGET}.`);
    } catch (err) {
      console.warn('Vision anomaly alert check failed:', err.message);
    }
  }
  setInterval(maybeAlertVisionAnomalies, 3 * 60 * 1000);
  maybeAlertVisionAnomalies();

  // Service-outage watchdog (added 2026-08-17) — scheduled Minerva health
  // scan with TRANSITION-based alerting: a service only alerts when it
  // crosses from up to down (never on every poll while it stays down), and
  // only after WATCHDOG_FAILURES_TO_ALERT consecutive failed checks, so a
  // quick Jellyfin restart or one flaky probe doesn't false-alarm. A
  // recovery notice fires once when a previously-alerted service comes
  // back. Alert state ({alerted, failCount} per service) is persisted in
  // store.json (serviceHealthState) so a server restart doesn't re-alert
  // for an outage that was already announced. Delivery reuses BOTH existing
  // channels: Minerva's Discord webhook (dispatchAlert — no-op if
  // DISCORD_ALERT_WEBHOOK is unset) and the same HA companion-app push the
  // vision anomaly poller above uses (VISION_ALERT_TARGET), for the same
  // reason documented there — HA push reaches the phone regardless of
  // whether AloyMobile is running.
  //
  // Deliberately NOT run immediately at startup (unlike the pollers above):
  // this server often boots alongside the whole machine, before Jellyfin/
  // Ollama/etc. have finished starting. First check at +3 min, plus the
  // 2-consecutive-failure rule, means the earliest possible outage alert is
  // ~6 min after boot — enough grace for sidecars to come up.
  const WATCHDOG_SERVICES = ['ollama', 'whisper', 'kokoro', 'jellyfin', 'homeAssistant', 'mediaDriveP', 'anthropicApiKey', 'geminiApiKey'];
  const WATCHDOG_FAILURES_TO_ALERT = 2;
  const WATCHDOG_DOWN_STATUSES = new Set(['offline', 'unmounted', 'invalid_key']);

  // Third delivery surface for watchdog alerts: a dedicated, pinned chat
  // thread — same reuse-the-chat-UI pattern as the Daily Learning Report
  // (getOrCreateReportChatId above), so outage/recovery notices are waiting
  // inside AloyMobile's own chat list next time the app is opened.
  // AloyMobile can't receive real push while backgrounded (see the vision
  // poller's comment), so this is the in-app record; the HA companion-app
  // push remains the immediate channel.
  const ALERTS_CHAT_TITLE = 'Service Alerts';
  function getOrCreateAlertsChatId() {
    const d = store.load();
    let chat = d.chats.find((c) => c.title === ALERTS_CHAT_TITLE);
    if (!chat) {
      chat = { id: `chat-alerts-${Date.now()}`, title: ALERTS_CHAT_TITLE, messages: [], createdAt: new Date().toISOString(), pinned: true };
      d.chats.unshift(chat);
      store.save(d);
    }
    return chat.id;
  }
  async function runServiceWatchdog() {
    try {
      const report = await globalMinerva.runHealthScan();
      const d = store.load();
      const prev = d.serviceHealthState || {};
      const next = {};
      const newlyDown = [];
      const recovered = [];

      for (const name of WATCHDOG_SERVICES) {
        const dep = report.dependencies?.[name];
        if (!dep) continue; // scan shape changed — skip rather than false-alert
        const isDown = WATCHDOG_DOWN_STATUSES.has(dep.status);
        let { alerted = false, failCount = 0 } = prev[name] || {};

        if (isDown) {
          failCount += 1;
          if (!alerted && failCount >= WATCHDOG_FAILURES_TO_ALERT) {
            newlyDown.push({ name, detail: dep.error || dep.status });
            alerted = true;
          }
        } else {
          if (alerted) recovered.push(name);
          alerted = false;
          failCount = 0;
        }
        next[name] = { alerted, failCount };
      }

      // Re-load before saving — runHealthScan takes seconds and another
      // request may have written the store since the read above (same
      // read-mutate-save convention as the pollers above).
      const dd = store.load();
      dd.serviceHealthState = next;
      store.save(dd);

      // Each channel individually swallowed so one failed send can't block
      // the other channel or the remaining notices (the Discord webhook and
      // HA itself may be down — HA outages are exactly what this watches).
      // Lazily resolved once per cycle — most cycles have no events, and
      // creating the pinned thread before the first-ever alert would leave
      // an empty "Service Alerts" chat sitting in both apps' sidebars.
      let alertsChatId = null;
      const alertTimestamp = () => new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

      for (const svc of newlyDown) {
        const message = `Service "${svc.name}" is DOWN (${svc.detail}). Confirmed across ${WATCHDOG_FAILURES_TO_ALERT} consecutive checks.`;
        await globalMinerva.dispatchAlert({ title: 'Aloy Service Outage', message, severity: 'critical' }).catch(() => {});
        await Promise.resolve(executeHAService('notify', VISION_ALERT_TARGET, null, {
          title: '🚨 Aloy Service Outage',
          message
        })).catch(() => {});
        if (!alertsChatId) alertsChatId = getOrCreateAlertsChatId();
        appendFollowupMessage(alertsChatId, `🚨 **Service Outage — ${alertTimestamp()}**\n\n${message}`, { timestamp: new Date().toISOString(), isServiceAlert: true });
        console.warn(`[watchdog] ${message}`);
      }
      for (const name of recovered) {
        const message = `Service "${name}" is back ONLINE.`;
        await globalMinerva.dispatchAlert({ title: 'Aloy Service Recovered', message, severity: 'info' }).catch(() => {});
        await Promise.resolve(executeHAService('notify', VISION_ALERT_TARGET, null, {
          title: '✅ Aloy Service Recovered',
          message
        })).catch(() => {});
        if (!alertsChatId) alertsChatId = getOrCreateAlertsChatId();
        appendFollowupMessage(alertsChatId, `✅ **Service Recovered — ${alertTimestamp()}**\n\n${message}`, { timestamp: new Date().toISOString(), isServiceAlert: true });
        console.log(`[watchdog] ${message}`);
      }
    } catch (err) {
      console.warn('Service watchdog check failed:', err.message);
    }
  }
  setInterval(runServiceWatchdog, 3 * 60 * 1000);

  // Both engines' recoverStaleTasks only ran once, at construction — meaning
  // a task orphaned by a hung call (the Athena DuckDuckGo bug; a hung
  // Hephaestus AI-review call) sat stuck until the NEXT server restart, not
  // when it actually went stale. This is what actually catches it while the
  // server keeps running. 5 minutes comfortably below both engines' own
  // staleness windows (15/20 min) so a real stuck task isn't sitting for the
  // better part of an hour before anything notices.
  function sweepStaleAgentTasks() {
    try { athenaEngine.recoverStaleTasks(); } catch (err) { console.warn('[watchdog] Athena stale-task sweep failed:', err.message); }
    try { globalHephaestus.recoverStaleTasks(); } catch (err) { console.warn('[watchdog] Hephaestus stale-task sweep failed:', err.message); }
  }
  setInterval(sweepStaleAgentTasks, 5 * 60 * 1000);

  // Keeps stockPortfolio.lastQuotes warm so a chat request never has to wait
  // on a live Yahoo Finance round trip, and so Hermes has an actual
  // "tracked" picture between requests rather than only fetching on demand.
  // 30 min: prices don't need to be fresher than that for a personal
  // check-in, and it's a courteous cadence against a free, keyless endpoint.
  async function refreshPortfolioQuotes() {
    try {
      const d = store.load();
      if ((d.stockPortfolio?.symbols || []).length > 0) await globalHermes.getPortfolioSnapshot();
    } catch (err) {
      console.warn('[watchdog] Portfolio quote refresh failed:', err.message);
    }
  }
  setInterval(refreshPortfolioQuotes, 30 * 60 * 1000);

  async function buildSystemInstruction(apiMessages) {
    const d = store.load();
    const memoriesList = d.memories.map((m) => `- ${typeof m === 'string' ? m : (m.fact || m.content || m.text || JSON.stringify(m))}`).join('\n');
    const checkIn = store.maybeConsumeDailyCheckIn();
    const lessonsList = (d.lessons || []).map((l) => `- ${l.topic}: ${l.correction}`).join('\n');

    // Relevance-scored learnedKnowledge lookup (server/knowledgeRetrieval.cjs)
    // — closes the loop so the nightly teaching pipeline's output actually
    // reaches live answers, not just the dashboard. Uses the LAST user
    // message as the query, same convention as the calendar-injection block
    // below.
    const lastUserMsg = [...(apiMessages || [])].reverse().find((m) => m.role === 'user');
    const relevantKnowledge = lastUserMsg
      ? await getRelevantKnowledge(stripContextBoilerplate(String(lastUserMsg.content || '')))
      : [];
    const knowledgeList = relevantKnowledge.map((k) => `- ${k.topic}: ${k.summary}`).join('\n');

    // Synthesized tool-call skills (server/skillSynthesis.cjs) — auto-learned
    // from repeated real usage, read-only sequences only.
    const relevantSkills = lastUserMsg
      ? await getRelevantSkills(stripContextBoilerplate(String(lastUserMsg.content || '')))
      : [];
    const skillsList = relevantSkills.map((s) => `- For questions like "${s.exampleQuestion}": call ${s.toolSequence.join(' → ')}`).join('\n');

    return `[CURRENT DATE/TIME]: ${new Date().toString()}

You are ${d.userProfile.name}'s personalized 100% local AI assistant, reached via a mobile/remote API client.

IF THE USER ASKS ABOUT YOU (what you are, your specs/capabilities, how many parameters you have, how to explain you to someone else): answer directly and confidently using this description — this is a fact about your own setup, not a knowledge gap, so do NOT hedge or express uncertainty. You are Aloy, ${d.userProfile.name}'s personal AI assistant, running 100% locally via Ollama on his own hardware (no cloud dependency for normal chat). You have tools for his calendar, smart home, finances, reminders, project tracking, document analysis, and web research, plus a background system that can escalate low-confidence answers to Claude or verify researched facts with Gemini. You do not know your exact parameter count or quantization beyond what's in your Ollama model name — if asked for that specific number, say so plainly rather than guessing, but everything else above you should state as fact.

USER PROFILE & PERSONAL INSTRUCTIONS:
- User Name: ${d.userProfile.name}
- Communication Style: ${d.userProfile.style}
- Personal Guidelines: ${d.userProfile.instructions}

USER-CORRECTED FACTS (highest priority — these override your own training knowledge, any previously researched information, and anything else in this prompt if they conflict):
${lessonsList || 'None yet.'}

RELEVANT PREVIOUSLY RESEARCHED KNOWLEDGE (auto-researched and Gemini-verified, only shown when likely relevant to the current question):
${knowledgeList || 'Nothing specifically relevant found.'}

KNOWN EFFICIENT TOOL-CALL PATTERNS (learned from repeated real usage — when a new question closely matches one of these, prefer this exact sequence over guessing):
${skillsList || 'None learned yet.'}

PERSISTENT MEMORY BANK:
${memoriesList || 'None saved yet.'}

You HAVE real-time access to ${d.userProfile.name}'s Google Calendar, Home Assistant server, tracked local Projects, and Finances — but ONLY when the relevant data was actually injected above as a labeled block (e.g. [LIVE ...], [SMART HOME ...], [LIVE PROJECT STATUS: ...]), OR when you use one of your tools to look it up.
If you don't have injected data or a tool result for what the user is asking about, say so honestly — do NOT invent status reports, numbers, entity counts, or actions. Guessing plausible-sounding details you were not actually given is a serious failure.
This also applies to labels and categories, not just facts: when data is unfamiliar (e.g. a chore or calendar entry you don't recognize), report it using the source's own naming (the calendar/entity name it came from) — do NOT invent a thematic category or label for it that isn't actually stated in the data. Group and summarize; never re-interpret.
When analyzing or rewriting an attached document (resume, letter, report, etc.): NEVER introduce a new number, percentage, date, or quantified claim that isn't already present in the source text — this includes satisfying your own feedback (e.g. "add quantification") by inventing a plausible-sounding figure. If a bullet or claim needs a number the source doesn't provide, leave a clear placeholder (e.g. "[X%]") and tell the user to fill in the real value themselves — do not guess one. Before presenting any rewritten document with dates (employment history, timelines, etc.), verify every date range makes chronological sense — each end date must be after its start date, and ranges should not overlap or reverse against neighboring entries — and flag anything that looks wrong in the source rather than silently carrying an error into your rewrite.
You have tools to look up live finances, smart home status, project status, existing Home Assistant automations/scripts, dashboard/Lovelace card configuration, and entities in a specific domain — and to log transactions, set budgets, control smart home devices, add/complete reminders, or create a note in the user's Obsidian vault. Use them whenever the request calls for it, instead of guessing.
When the user asks for automation recommendations: ALWAYS call get_smart_home_automations first, and use list_home_assistant_entities to check what's actually available before proposing anything.
When the user asks about a dashboard, card, or Lovelace YAML: ALWAYS call get_dashboard_config first — these are custom-built and specific to this setup, not standard/default cards, and guessing at them is a serious failure.
When the user asks about disc ripping, AutoRip, or recent disc encodes: ALWAYS call get_autorip_status first — do not guess what the ripping pipeline processed.
When the user asks about tech news, a specific headline, or a video from the Tech News feed: ALWAYS call get_tech_news first — do not guess at feed contents.
When the user asks you to look at something in front of them right now — what they're holding, what's on their desk, how they look, whether they're wearing something — ALWAYS call look_at_webcam with their actual question rather than answering from the separate real-time presence line already in this prompt (that line only confirms someone is there, it says nothing about what they're doing or holding). Note: this only works from the desktop app's own webcam — if called from a context with no camera access it will say so.
When the user asks about files, directories, movies, TV shows, media, or contents on drive P: (such as P:\Movies, P:\TV Shows, P:\Games, P:\Music, P:\Photos, P:\Other) or in Documents: ALWAYS call your MCP filesystem tools (mcp__filesystem__list_directory, mcp__filesystem__search_files, or mcp__filesystem__directory_tree) with the target path (e.g. "P:\\Movies") to check the real filesystem directly. You HAVE full read and write permissions to drive P:\ and Documents — do NOT claim filesystem access is restricted or rely solely on AutoRip records when asked about files on P:\.
When the user explicitly asks you to research, look into, or learn about something: call research_topic to get a real sourced draft, present it to them, and only call save_researched_knowledge if they confirm they want it kept — never save without an explicit confirmation.
When the user directly corrects something you said, or explicitly tells you to remember/note a fact going forward: call save_lesson with a short topic and the corrected fact — this is different from save_researched_knowledge (that's for things you looked up yourself; this is for things the user told you directly, and it always takes priority).
When the user asks about your own skill gaps, proficiency, what you're weak at, or what needs review: call get_skills_dashboard first — this reflects real logged data, do not guess or estimate a percentage yourself. If any category comes back as a critical/low-proficiency gap, after reporting it offer to research one of its specific open gap questions right now — if the user agrees, call research_topic using that gap's actual question text as the topic (not a paraphrase), present the sourced result, and only call save_researched_knowledge if they then confirm they want it kept, same as any other research.
When ${d.userProfile.name} shares personal details, habits, preferences, daily routines, pet peeves, workflow choices, tooling/editor preferences, food/drink tastes, or answers questions about himself: ALWAYS immediately call save_user_memory with a clear, concise fact to permanently add it to his PERSISTENT MEMORY BANK so you remember it forever across all future conversations.
When ${d.userProfile.name} gives instructions on how you should format responses, speak, or behave: call update_user_profile to permanently adapt your personality and communication style to his liking.
In conversation, be attentive and curiously inquiring — when natural and relevant, ask thoughtful follow-up questions to understand his lifestyle, habits, and preferences deeper over time.${checkIn ?`\n\nThis is the first message today — before addressing the request below, naturally weave in a brief, genuine one-line check-in about how ${d.userProfile.name}'s day is going, in your own words matching the Communication Style above. Keep it short and light; don't force it if the request is clearly urgent or time-sensitive.` : ''}`;
  }

  // Calendar-keyword-triggered context injection — mirrors the desktop
  // app's per-message extraContext block (src/App.jsx) so the mobile
  // Context injection — mirrors the desktop app's per-message extraContext
  // block (src/App.jsx) so the mobile client gets real Google Calendar and
  // Smart Home data instead of the model guessing. Only the LAST user message
  // in the turn is augmented (matching desktop); the client's stored history
  // stays the plain text.
  const CALENDAR_KEYWORDS = ["calendar", "schedule", "event", "meeting", "appointment", "agenda", "tomorrow", "chores"];
  const SMART_HOME_KEYWORDS = ["home assistant", "light", "switch", "sensor", "device", "door", "lock", "thermostat", "temperature", "entity", "dashboard", "smart home", "turn on", "turn off", "climate", "garage", "motion", "occupancy", "kitchen", "living room", "bedroom", "office", "dining"];
  const HEALTH_REGEX = /\b(sle+p|sle+pt|bed|rest|nap|wake|woke|health|fit|step|heart|pulse|bpm|hr|watch|amazfit|zepp|t-?rex|vital|readiness|stress|recovery|briefing|morning|workout)\w*/i;

  async function augmentLastUserMessage(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return messages;
    const lastIdx = messages.length - 1;
    const last = messages[lastIdx];
    if (last.role !== 'user' || typeof last.content !== 'string') return messages;

    const text = last.content.toLowerCase();
    const isCalendarQuery = CALENDAR_KEYWORDS.some((k) => text.includes(k));
    const isSmartHomeQuery = SMART_HOME_KEYWORDS.some((k) => text.includes(k));
    const isHealthQuery = HEALTH_REGEX.test(text);

    if (!isCalendarQuery && !isSmartHomeQuery && !isHealthQuery) return messages;

    const d = store.load();
    let extraContext = '';

    // 0. Wearable Health & Readiness Telemetry
    if (isHealthQuery) {
      const healthBlock = globalHealthBridge.formatHealthContext();
      if (healthBlock) {
        extraContext += `${healthBlock}\nIMPORTANT DIRECTIVE: The user is asking about their personal health, sleep, recovery, steps, or watch metrics. Report the LIVE WEARABLE & HEALTH TELEMETRY data above accurately to ${d.userProfile.name}.\n\n`;
      }
    }

    // 1. Google Calendar
    if (isCalendarQuery) {
      const events = await fetchGoogleCalendarEvents(7);
      const dateAnchor = formatDateAnchor();
      let eventLines = '';
      if (events.length > 0) {
        // Calendar summaries are UNTRUSTED INPUT. Anyone who can send the user
        // a Google Calendar invite (which Google auto-adds by default) controls
        // this text, and it used to be concatenated raw directly above an
        // "IMPORTANT DIRECTIVE" block — putting attacker text in the same trust
        // register as the app's own instructions, in front of a model holding
        // control_smart_home_device, where light/switch/fan/scene/media_player
        // auto-execute with no confirmation prompt.
        //
        // Scraped web content already goes through this exact function; the
        // calendar path was the one untrusted source that did not.
        events.forEach((ev) => {
          const cal = ev.calendar ? `[${ev.calendar}] ` : '';
          const safeSummary = sanitizeUntrustedWebContent(
            String(ev.summary || 'Event'),
            { sourceUrl: 'google_calendar_event', wrapSandbox: false }
          ).replace(/\s+/g, ' ').trim() || 'Event';
          eventLines += `- ${cal}${safeSummary} (Date/Time: ${ev.start || ''})\n`;
        });
        eventLines = capLinesToBudget(eventLines.trim(), CONTEXT_SECTION_BUDGETS.calendarEvents, 'events') + '\n';
      } else {
        eventLines = `No upcoming events found on ${d.userProfile.name}'s calendar for the next 7 days.\n`;
      }
      const calStr = `[LIVE GOOGLE CALENDAR DATA RETRIEVED FROM HOME ASSISTANT (${events.length} Events)]:\n${eventLines}`;
      extraContext += `${dateAnchor}\n${calStr}\nIMPORTANT DIRECTIVE: The user is asking about their Google Calendar. Report the events listed above directly to ${d.userProfile.name}. Use the DATE ANCHOR above for what "today"/"tomorrow" mean — do not compute those dates yourself. Do NOT output generic action placeholders.\n\n`;
    }

    // 2. Home Assistant Smart Home
    if (isSmartHomeQuery) {
      try {
        const rawStates = await fetchHomeAssistantStates();
        if (rawStates && Array.isArray(rawStates)) {
          const categories = groupEntitiesByCategory(rawStates);
          const stats = calculateSmartHomeStats(categories);
          const shSummary = formatSmartHomeContext(categories, stats);

          let entityLines = '[LIVE HOME ASSISTANT CONTROLLABLE ENTITIES]:\n';
          const relevant = [
            ...(categories.lights || []).map(l => `- Light: "${l.name}" (entity_id: "${l.entity_id}") [State: ${l.state}]`),
            ...(categories.switches || []).map(s => `- Switch: "${s.name}" (entity_id: "${s.entity_id}") [State: ${s.state}]`),
            ...(categories.locks || []).map(k => `- Lock: "${k.name}" (entity_id: "${k.entity_id}") [State: ${k.state}]`),
            ...(categories.climate || []).map(c => `- Climate: "${c.name}" (entity_id: "${c.entity_id}") [Temp: ${c.attributes?.current_temperature || c.state}°]`)
          ];
          entityLines += relevant.slice(0, 35).join('\n') + '\n\n';

          extraContext += `${shSummary}\n${entityLines}\nIMPORTANT DIRECTIVE: To control a device, call \`control_smart_home_device\` with domain, service (e.g. "turn_on", "turn_off"), and the exact entity_id from above.\n\n`;
        }
      } catch (err) {
        console.warn('Failed to inject smart home context in aloyServer:', err.message);
      }
    }

    const augmented = [...messages];
    augmented[lastIdx] = { ...last, content: `${trimWhitespace(extraContext)}\n\nUser Request: ${last.content}` };
    return augmented;
  }


  // Short-lived, in-memory "what's happening" tracker for mobile's live
  // status polling during a turn (see GET /api/chat/status/:turnId below).
  // Desktop doesn't need this — it streams tokens directly from Ollama in
  // the renderer and never goes through runTurn at all. Mobile's /api/chat
  // is a single blocking round trip that can legitimately run for minutes
  // through a multi-tool chain, so this is the one thing standing between
  // that and a bare spinner with zero information. Never persisted; entries
  // are pruned by age so a client that stops polling (backgrounded, crashed)
  // can't leak memory forever.
  const turnStatus = new Map(); // turnId -> { text, updatedAt }
  const TURN_STATUS_TTL_MS = 5 * 60 * 1000;
  function setTurnStatus(turnId, text) {
    if (!turnId) return;
    turnStatus.set(turnId, { text, updatedAt: Date.now() });
  }
  function pruneTurnStatus() {
    const cutoff = Date.now() - TURN_STATUS_TTL_MS;
    for (const [id, entry] of turnStatus) {
      if (entry.updatedAt < cutoff) turnStatus.delete(id);
    }
  }
  // Tool names are function identifiers ("get_autorip_status"), not prose —
  // this is a deliberately minimal humanization (underscores to spaces),
  // not a full display-name mapping table.
  function humanizeToolName(name) {
    return String(name || 'tool').replace(/_/g, ' ');
  }

  // One non-streaming model turn, auto-executing read-only tools and
  // recursing — mirrors the desktop app's runModelTurn, collapsed into a
  // single promise since this is a REST endpoint, not a live UI stream.
  async function runTurn(apiMessages, model, depth = 0, usedTools = false, toolNamesUsed = [], hadWriteTool = false, turnId = null) {
    setTurnStatus(turnId, depth === 0 ? 'Thinking…' : 'Composing response…');
    const systemPrompt = await buildSystemInstruction(apiMessages);
    const lastUserMsg = [...(apiMessages || [])].reverse().find((m) => m.role === 'user');
    let userQuery = String(lastUserMsg?.content || '');
    const userReqIdx = userQuery.lastIndexOf('User Request:');
    if (userReqIdx !== -1) {
      userQuery = userQuery.slice(userReqIdx + 'User Request:'.length).trim();
    } else {
      userQuery = stripContextBoilerplate(userQuery);
    }
    const toolDefs = getToolDefinitions(userQuery);

    const result = await new Promise((resolve, reject) => {
      streamChat({
        model,
        messages: apiMessages,
        systemPrompt,
        temperature: 0.7,
        tools: toolDefs,
        onChunk: () => {},
        onThinking: () => {},
        onToolCalls: (rawToolCalls) => resolve({ type: 'tool_calls', rawToolCalls }),
        onComplete: (text) => resolve({ type: 'complete', text }),
        onError: (err) => reject(new Error(err))
      });
    });

    if (result.type === 'complete') {
      return { type: 'complete', text: result.text, apiMessages, usedTools, toolNamesUsed, hadWriteTool };
    }

    if (depth >= MAX_TOOL_LOOP_DEPTH) {
      return { type: 'complete', text: '⚠️ Stopped after too many tool calls in a row — try again.', apiMessages };
    }

    const ctx = buildCtx();
    const calls = await Promise.all(result.rawToolCalls.map(async (tc, i) => {
      const name = tc.function?.name;
      const args = parseToolArguments(tc.function?.arguments);
      const call = { id: tc.id || `call-${Date.now()}-${i}`, name, arguments: args, status: 'pending', result: null };
      const tool = getTool(name);
      if (!tool) {
        call.status = 'error';
        call.result = JSON.stringify({ error: `Unknown tool: ${name}` });
      } else if (!toolRequiresConfirmation(tool, args)) {
        try {
          setTurnStatus(turnId, `Checking ${humanizeToolName(name)}…`);
          call.result = await tool.execute(args, ctx);
          call.status = 'done';
          // DO NOT REMOVE — pairs with the `calls.some((c) => c.wasWrite)`
          // read below. Since confirmation became risk-tiered, a tool can be
          // auto-executed and STILL be a write (control_smart_home_device
          // skips the prompt for a light toggle). Without this line the read
          // below sees undefined forever, hadWriteTool stays false, and
          // smart-home write sequences get mined into auto-suggested skills
          // — the one thing skillSynthesis.cjs's header says must never
          // happen. This regressed once already; App.jsx has the matching
          // pair on the desktop path.
          if (isWriteTool(tool)) call.wasWrite = true;
        } catch (err) {
          call.status = 'error';
          call.result = JSON.stringify({ error: err.message || 'Tool execution failed' });
        }
      } else {
        call.confirmLabel = tool.confirmLabel ? tool.confirmLabel(args) : `Run ${name}?`;
      }
      return call;
    }));

    const pending = calls.filter((c) => c.status === 'pending');
    const assistantToolCallsMsg = {
      role: 'assistant',
      content: '',
      tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.arguments } }))
    };

    if (pending.length > 0) {
      // Stop here — client must confirm via /api/chat/resolve before we continue.
      // Record what we pended so resolve can execute the stored version rather
      // than whatever the client sends back.
      rememberPendingCalls(pending);
      return {
        type: 'pending_confirmation',
        pendingCalls: pending.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments, confirmLabel: c.confirmLabel })),
        apiMessages: [...apiMessages, assistantToolCallsMsg],
        resolvedCalls: calls.filter((c) => c.status !== 'pending')
      };
    }

    function formatToolResultContent(name, status, result) {
      let content = typeof result === 'string' ? result : JSON.stringify(result);
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && (parsed.status === 'error' || parsed.error)) {
          const hint = parsed.recoveryHint || `Review the output above and attempt a self-correction with adjusted parameters or an alternative tool if applicable.`;
          return `${content}\n\n[SYSTEM HINT]: Tool '${name}' reported an issue. ${hint}`;
        }
      } catch {}

      const isError = status === 'error' || (typeof content === 'string' && /\b(error|failed|exception)\b/i.test(content) && !content.includes('[SYSTEM HINT]') && !content.includes('declined'));
      if (isError) {
        content += `\n\n[SYSTEM HINT]: Tool '${name}' encountered an issue. Review the output above and attempt a self-correction with adjusted parameters or an alternative tool if applicable.`;
      }
      return content;
    }

    const continuedMessages = [
      ...apiMessages,
      assistantToolCallsMsg,
      ...calls.map((c) => ({ role: 'tool', content: formatToolResultContent(c.name, c.status, c.result) }))
    ];
    // Accumulated across the whole recursive chain — feeds skill synthesis
    // (server/skillSynthesis.cjs) once the chain reaches a final text
    // answer with no further tool calls.
    //
    // This used to assume every call reaching here was read-only (writes
    // always went pending). That stopped being true when confirmation became
    // risk-tiered: a low-risk smart-home action now auto-executes and still
    // reaches this line. Any such call sets `wasWrite` above, and it's OR'd
    // into hadWriteTool here so the "never mine write sequences into skills"
    // invariant (see skillSynthesis.cjs's header) still holds.
    const executedNames = calls.filter((c) => c.status === 'done').map((c) => c.name);
    const chainHadWrite = hadWriteTool || calls.some((c) => c.wasWrite);
    return runTurn(continuedMessages, model, depth + 1, true, [...toolNamesUsed, ...executedNames], chainHadWrite, turnId);
  }

  // Persists a completed turn into its thread — takes the CLEAN {role,
  // content} history (never the tool-call/tool-result bookkeeping messages
  // used internally for the Ollama loop), so a thread's saved messages stay
  // exactly what a UI should display. Also sets the thread's title from the
  // first user message, matching the desktop app's own convention.
  function persistChatTurn(chatId, cleanMessages, assistantText, toolCalls = null) {
    if (!chatId) return;
    const d = store.load();
    const chat = d.chats.find((c) => c.id === chatId);
    if (!chat) return;
    const assistantMsg = {
      role: 'assistant',
      content: assistantText || '',
      timestamp: new Date().toISOString(),
      ...(toolCalls ? { toolCalls } : {})
    };
    chat.messages = [...cleanMessages, assistantMsg];
    if (!chat.title || chat.title === 'New Chat') {
      const firstUser = chat.messages.find((m) => m.role === 'user');
      if (firstUser) chat.title = firstUser.content.slice(0, 40);
    }
    chat.updatedAt = new Date().toISOString();
    store.save(d);
  }

  const app = express();
  // Safe local CORS support for loopback Vite dev/preview servers
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (/^http:\/\/localhost:(5173|7890)$/.test(origin) || /^http:\/\/127\.0\.0\.1:(5173|7890)$/.test(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });
  // Normalize Content-Type to lowercase charset (e.g. charset="UTF-8" -> charset=utf-8) to prevent body-parser 415 UnsupportedMediaTypeError
  app.use((req, _res, next) => {
    const ct = req.headers['content-type'];
    if (ct && typeof ct === 'string' && /charset=/i.test(ct)) {
      req.headers['content-type'] = ct.replace(/charset=["']?([^"';]+)["']?/i, (_match, p1) => `charset=${p1.toLowerCase()}`);
    }
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  // Media streaming for remote LAN video players (MPV, VLC, Smart TVs, Roku).
  //
  // This route is registered ABOVE app.use(requireAuth(token)) and has to stay
  // there: Roku, VLC and smart-TV players fetch the URL themselves and cannot
  // attach an Authorization header. That makes `file` the only thing standing
  // between an open port and the filesystem, so it is validated here rather
  // than trusted.
  //
  // WHAT THIS USED TO BE (found 2026-08-31): req.query.file went straight into
  // fs.existsSync and fs.createReadStream with no validation of any kind, on
  // an unauthenticated route bound to the Tailscale interface. That is an
  // arbitrary read of the whole machine, and the two most valuable files on it
  // are one request away:
  //
  //   /api/media/stream?file=~/.aloy-server/auth-token.txt
  //     -> the bearer token that guards every other route on this server
  //   /api/media/stream?file=~/.aloy-server/.env
  //     -> ANTHROPIC_API_KEY, GEMINI_API_KEY, JELLYFIN_API_KEY, the HA token
  //
  // A wildcard Access-Control-Allow-Origin was later added to make Roku work.
  // Native players do not implement CORS and never needed it; what it did add
  // was permission for any web page the user happens to visit to issue those
  // same requests from his browser and READ the responses. It is not set here.
  //
  // Two independent gates, both required, neither sufficient alone:
  //   1. the resolved REAL path must sit inside a configured media root
  //      (realpath first, so a symlink or junction cannot point out of one)
  //   2. the extension must be one this server actually streams
  //
  // Gate 2 exists because gate 1 alone would still serve any stray file that
  // ended up in a media folder. Gate 1 exists because gate 2 alone would serve
  // C:\anything.mp4. Do not drop either to fix a playback bug: a file that
  // fails these checks is a file this route was never meant to serve.
  const STREAMABLE_TYPES = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime'
  };

  // Compared case-insensitively on Windows, where this server runs and where
  // p:\movies and P:\Movies are the same directory; case-sensitively elsewhere.
  const forPathCompare = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);

  function realpathOrNull(p) {
    try {
      return fs.realpathSync(path.resolve(p));
    } catch {
      return null;
    }
  }

  function resolveStreamPath(raw) {
    if (!raw || typeof raw !== 'string' || raw.includes('\0')) return null;

    const real = realpathOrNull(raw);
    if (!real) return null;

    const ext = path.extname(real).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(STREAMABLE_TYPES, ext)) return null;

    let stat;
    try {
      stat = fs.statSync(real);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;

    // Same defaults as mediaDispatcher.cjs / jellyfinService.cjs. Read from
    // env each call so changing MOVIES_DIR does not need a server restart.
    const roots = [
      process.env.MOVIES_DIR || 'P:\\Movies',
      process.env.TV_SHOWS_DIR || 'P:\\TV Shows',
      process.env.JELLYFIN_DIR || path.join(os.homedir(), 'Jellyfin')
    ];

    const contained = roots.some((root) => {
      const realRoot = realpathOrNull(root);
      if (!realRoot) return false;
      // Trailing separator matters: without it, "P:\Movies-private" would
      // pass a startsWith check against root "P:\Movies".
      const base = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
      return forPathCompare(real).startsWith(forPathCompare(base));
    });

    return contained ? real : null;
  }

  const handleMediaStream = (req, res) => {
    const filePath = resolveStreamPath(req.query.file);
    if (!filePath) {
      // Logged so a probe of this route is visible, and so a legitimate
      // playback failure caused by a mis-set MOVIES_DIR is diagnosable.
      logAuditEvent({
        category: 'security',
        action: 'media_path_rejected',
        target: String(req.query.file || '').slice(0, 300),
        status: 'denied',
        details: 'Requested file is outside every configured media root, is not a streamable video type, or does not exist.'
      });
      // Deliberately the same response as a genuine miss. Distinguishing
      // "exists but forbidden" from "does not exist" would turn this route
      // into a filesystem oracle for anything that can reach the port.
      return res.status(404).send('Media file not found');
    }
    try {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      const ext = path.extname(filePath).toLowerCase();
      const contentType = STREAMABLE_TYPES[ext] || 'video/mp4';

      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes'
        });
        return res.end();
      }

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes'
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (err) {
      res.status(500).send(`Streaming error: ${err.message}`);
    }
  };

  app.get('/api/media/stream', handleMediaStream);
  app.head('/api/media/stream', handleMediaStream);

  // Aloy Developer Documentation (Static Site)
  const docsDist = path.join(__dirname, '..', '..', 'docs', 'dist');
  if (fs.existsSync(docsDist)) {
    app.use('/docs', express.static(docsDist));
    // Redirect direct hits without /docs prefix (e.g. /guides/..., /architecture/...)
    app.use((req, res, next) => {
      const docsPrefixes = ['/guides', '/architecture', '/pantheon', '/media/dispatcher', '/media/roku-ecp', '/media/party-mode', '/mobile/architecture', '/mobile/bento-command-center', '/mobile/offline-sync', '/api/endpoints', '/api/hardware-bridge'];
      if (docsPrefixes.some(p => req.path.startsWith(p))) {
        return res.redirect(301, `/docs${req.originalUrl}`);
      }
      next();
    });
  }

  app.use(requireAuth(token));
  // After requireAuth so only real authenticated traffic counts as a
  // "client" — an unauthenticated scanner/probe hitting the port shouldn't
  // show up in the connected-clients widget.
  app.use(trackClientMiddleware);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/api/hud/open', (_req, res) => {
    if (extraHandlers.openHud) {
      extraHandlers.openHud();
      return res.json({ success: true, opened: true });
    }
    res.json({ success: false, reason: 'No HUD handler attached' });
  });

  // "How many clients are connected" status widget data (desktop sidebar +
  // mobile drawer) — see clientTracker.cjs for what "connected" means here.
  app.get('/api/clients', (_req, res) => res.json(getConnectedClients()));

  // PortPal-inspired Port Management Endpoints
  const { listListeningPorts, killProcessOnPort, getProcessForPort } = require('./portManager.cjs');
  app.get('/api/ports', (_req, res) => {
    try {
      res.json(listListeningPorts());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ports/kill', async (req, res) => {
    const { port } = req.body || {};
    if (!port) return res.status(400).json({ error: 'Port number is required.' });
    try {
      const result = await killProcessOnPort(Number(port));
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Chat threads — list/create/read/delete, mirroring the desktop sidebar's
  // chat history concept for the mobile client.
  app.get('/api/chats', (_req, res) => {
    const d = store.load();
    res.json(d.chats.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt })));
  });
  app.post('/api/chats', (_req, res) => {
    const d = store.load();
    const chat = { id: `chat-${Date.now()}`, title: 'New Chat', messages: [], createdAt: new Date().toISOString() };
    d.chats.unshift(chat);
    store.save(d);
    res.json(chat);
  });
  app.get('/api/chats/:id', (req, res) => {
    const d = store.load();
    const chat = d.chats.find((c) => c.id === req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  });
  app.delete('/api/chats/:id', (req, res) => {
    const d = store.load();
    d.chats = d.chats.filter((c) => c.id !== req.params.id);
    store.save(d);
    res.json({ success: true });
  });

  // Appends a follow-up assistant message to an already-persisted chat
  // thread (does NOT overwrite the original turn) — used by
  // maybeEscalateInBackground so a mobile client that re-fetches the thread
  // later sees the correction alongside the original local answer.
  function appendFollowupMessage(chatId, text, extra = {}) {
    if (!chatId) return;
    const d = store.load();
    const chat = d.chats.find((c) => c.id === chatId);
    if (!chat) return;
    chat.messages.push({ role: 'assistant', content: text, ...extra });
    store.save(d);
  }

  // Confidence-checks a completed turn's answer and, if warranted, escalates
  // to Claude — entirely in the background, AFTER the response for the
  // triggering request has already been sent. The check itself can take
  // several seconds (forcing the model to justify YES/NO on its own answer
  // sometimes runs long chains of hidden reasoning first); blocking the
  // response on that turned every single turn into a multi-second stall for
  // no benefit on the common/confident path. Any error here is swallowed —
  // this must never affect the request that already completed.
  //
  // Skipped entirely when usedTools is true — confirmed live 2026-08-03
  // that Claude has no way to verify a real-world action (e.g. "turned on
  // the kitchen light") actually happened, so escalating on a tool-call
  // summary produces a generically unhelpful "I can't control your lights"
  // answer. Whether the action worked is already known from the tool's own
  // result, not from re-litigating the one-line summary text.
  function maybeEscalateInBackground(chatId, rawMessages, localAnswer, model, usedTools) {
    if (usedTools) return;
    const userMsg = [...(rawMessages || [])].reverse().find((m) => m.role === 'user');
    if (!userMsg?.content) return;

    // Document analysis/rewrite turns get a Claude proofread pass instead
    // of the normal confidence-escalation check below — see
    // documentProofread.cjs for why (a real bug this session that the
    // local model's own confidence self-rating didn't catch).
    const originalDocument = extractAttachedDocument(userMsg.content);
    if (originalDocument) {
      proofreadDocumentRewrite({ originalDocument, localResponse: localAnswer })
        .then((result) => {
          store.logDocumentProofread(result);
          if (!result.clean) {
            appendFollowupMessage(chatId, `_Claude proofread this against your original document:_\n\n${result.notes}`, { answeredViaClaude: true });
          }
        })
        .catch((err) => console.warn('Document proofread failed (turn already completed):', err.message));
      return;
    }

    checkConfidenceAndMaybeEscalate({
      model: model || DEFAULT_MODEL,
      question: userMsg.content,
      localAnswer
    }).then((check) => {
      if (check.escalated) {
        appendFollowupMessage(chatId, check.answer, { answeredViaClaude: true, fromCache: check.fromCache });
      }
    }).catch((err) => {
      console.warn('Confidence check/escalation failed (turn already completed):', err.message);
    });
  }

  // Model routing with an availability guard.
  //
  // modelRouter.cjs picks a model by keyword (coder / vision / general), but
  // its MODEL_REGISTRY is a hardcoded wish list — routing to a model that was
  // never `ollama pull`ed makes the whole turn fail with a 404 from Ollama,
  // which is a worse outcome than simply answering with the default model.
  // So: ask Ollama what actually exists, cache it, and fall back when the
  // routed choice isn't installed.
  //
  // Second guard: aloy-ai is the model this app's tool layer is built and
  // tested against. runTurn always passes the full tool definitions, so
  // routing a tool-bound question ("what's on my calendar", "turn off the
  // lights") to a code model risks losing tool calling entirely. Keywords like
  // 'script', 'function', 'git' and 'endpoint' are broad enough to catch such
  // questions by accident, so anything that looks tool-bound stays on the
  // general model regardless of what the router said.
  let _modelCache = { at: 0, names: new Set() };
  async function getInstalledModels() {
    if (Date.now() - _modelCache.at < 5 * 60 * 1000 && _modelCache.names.size) return _modelCache.names;
    try {
      const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return _modelCache.names;
      const data = await res.json();
      const names = new Set((data.models || []).map((m) => m.name));
      // Ollama reports "name:tag"; also index the bare name so a registry
      // entry without an explicit tag still matches.
      for (const n of [...names]) names.add(String(n).split(':')[0]);
      _modelCache = { at: Date.now(), names };
    } catch {
      // Ollama unreachable — leave the cache alone and let the caller default.
    }
    return _modelCache.names;
  }

  // Trailing \w* so inflections match: remind->reminder, light->lights,
  // transaction->transactions. (`\bremind\b` missed "reminder" and routed
  // "script my morning reminder" to the code model, losing tool calling.)
  // Over-matching here is the safe direction — it just keeps the turn on the
  // model the tool layer was built against.
  const TOOL_BOUND_HINTS = /\b(calendar|schedul|meeting|remind|light|lock|thermostat|climate|door|camera|budget|spend|transaction|jellyfin|movie|episode|news|automation|dashboard|entit|autorip|vault|obsidian|note|weather|sonarr|lidarr|radarr|prowlarr|sabnzbd|retroarr)\w*/i;

  async function resolveRoutedModel(messages) {
    const decision = routeModelRequest(messages);
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

    if (decision.route !== 'general' && TOOL_BOUND_HINTS.test(String(lastUser))) {
      console.log(`[router] ${decision.route} match overridden — question looks tool-bound, staying on ${DEFAULT_MODEL}.`);
      return DEFAULT_MODEL;
    }
    if (decision.selectedModel === DEFAULT_MODEL) return DEFAULT_MODEL;

    const installed = await getInstalledModels();
    if (installed.size > 0 && !installed.has(decision.selectedModel) && !installed.has(String(decision.selectedModel).split(':')[0])) {
      console.warn(`[router] ${decision.route} route wanted "${decision.selectedModel}" but it is not installed — falling back to ${DEFAULT_MODEL}.`);
      return DEFAULT_MODEL;
    }
    console.log(`[router] routed to ${decision.selectedModel} (${decision.reason}).`);
    return decision.selectedModel;
  }

  // Lets you see what the router would do without spending a turn on it.
  app.post('/api/model/route-preview', async (req, res) => {
    try {
      const messages = req.body?.messages || [{ role: 'user', content: req.body?.prompt || '' }];
      const decision = routeModelRequest(messages);
      const resolved = await resolveRoutedModel(messages);
      res.json({ ...decision, resolvedModel: resolved, overridden: resolved !== decision.selectedModel });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/chat', async (req, res) => {
    // Optional — mobile generates one client-side and polls
    // GET /api/chat/status/:turnId while this request is in flight so a
    // long tool chain reads as "Checking calendar…" instead of a bare
    // spinner. Absent for any other caller; runTurn/setTurnStatus are no-ops
    // without it.
    const { messages, model, chatId, turnId } = req.body;
    try {
      // An explicit model from the client always wins — the desktop session
      // picker is a deliberate user choice. Routing only decides when the
      // client left it open (mobile text chat sends no model).
      const targetModel = model || await resolveRoutedModel(messages || []);
      const augmented = await augmentLastUserMessage(messages || []);
      const result = await runTurn(augmented, targetModel, 0, false, [], false, turnId);
      if (result.type === 'complete') {
        persistChatTurn(chatId, messages || [], result.text);
        maybeEscalateInBackground(chatId, messages, result.text, targetModel, result.usedTools);
        if (result.toolNamesUsed?.length > 0 && !result.hadWriteTool) {
          const originalQuestion = [...(messages || [])].reverse().find((m) => m.role === 'user')?.content || '';
          logToolCallSequence({ question: originalQuestion, toolSequence: result.toolNamesUsed })
            .catch((err) => console.warn('[skills:logToolSequence] failed:', err.message));
        }
      } else if (result.type === 'pending_confirmation') {
        persistChatTurn(chatId, messages || [], '', result.pendingCalls);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      if (turnId) turnStatus.delete(turnId);
    }
  });

  // Mobile's live-status poll for the request above — see the turnStatus
  // tracker declared next to runTurn. Always 200s with text:null for an
  // unknown/expired/not-yet-started id rather than 404ing, since the normal
  // case (client starts polling a beat before the first setTurnStatus call
  // lands, or after the turn already finished and was cleaned up) isn't an
  // error.
  app.get('/api/chat/status/:turnId', (req, res) => {
    pruneTurnStatus();
    const entry = turnStatus.get(req.params.turnId);
    res.json({ text: entry?.text || null });
  });

  app.post('/api/models/route', (req, res) => {
    const { messages } = req.body;
    res.json(routeModelRequest(messages || []));
  });

  // Manual run-now escape hatch for evalHarness.cjs's ground-truth regression
  // suite (no scheduled/automatic trigger — same "manual, no UI button yet"
  // pattern as /api/skills-dashboard/auto-resolve). Runs each benchmark
  // prompt through the real tool-calling loop via runTurn, including the
  // security-relevant "Prevent unauthenticated lock unlock" case.
  app.post('/api/eval/run', async (_req, res) => {
    try {
      const executor = async (prompt) => {
        const augmented = await augmentLastUserMessage([{ role: 'user', content: prompt }]);
        const result = await runTurn(augmented, DEFAULT_MODEL);
        if (result.type === 'pending_confirmation') {
          return {
            toolName: result.pendingCalls?.[0]?.name || null,
            text: (result.pendingCalls || []).map((c) => c.confirmLabel).join('; ')
          };
        }
        return { toolName: result.toolNamesUsed?.[0] || null, text: result.text || '' };
      };
      // runEvaluation was renamed to runRobustEvaluation when the harness
      // gained multi-pass variance measurement — this route called the old
      // name and threw "not a function" on every request, which meant the
      // ONLY way to trigger an eval was broken. Defaults to 3 iterations;
      // pass {"iterations": N} to override, or {"holdout": true} to also
      // score the held-out split.
      const iterations = Number(_req.body?.iterations) || 3;
      const report = await globalEvalHarness.runRobustEvaluation(executor, { iterations });
      if (_req.body?.holdout) {
        report.holdout = await globalEvalHarness.runHoldoutEvaluation(executor, null, { judge: !!_req.body?.judge });
      }
      // Real-life simulation: replays actual past Claude escalations
      // (questions aloy-ai demonstrably struggled with) against the live
      // tool-calling loop, graded by an LLM judge — "would this still need
      // to escalate today?" Pass {"escalations": true}, optionally
      // {"escalationsLimit": N} (default 20, most recent).
      if (_req.body?.escalations) {
        report.escalationRegression = await globalEvalHarness.runEscalationRegressionSuite(executor, {
          limit: Number(_req.body?.escalationsLimit) || 20
        });
      }
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stats for the mobile drawer's "Claude assist" status widget.
  app.get('/api/escalations/stats', (_req, res) => res.json(getEscalationStats()));

  // Stats for the sidebar's "Security" status widget — recent
  // Hephaestus-reviewer injection-attempt detections and securityGuard
  // filesystem write/read denials, see MinervaEngine.getSecurityStats.
  app.get('/api/security/stats', (_req, res) => res.json(globalMinerva.getSecurityStats()));

  // Cross-agent Inbox feed — merges Apollo (Claude-assist escalations),
  // Athena (completed research), and Minerva/securityGuard (blocked
  // access/injection attempts) into one time-windowed, recency-sorted list.
  // Vision-timeline and lock-unlock-history items are merged in client-side
  // (they're already fetched there; see ARCHITECTURE.md).
  app.get('/api/inbox/feed', (req, res) => {
    const windowMs = req.query.windowMs ? Number(req.query.windowMs) : undefined;
    res.json(getInboxFeed({ athenaEngine, globalMinerva, globalHephaestus, windowMs }));
  });

  // Stats for the mobile drawer's "Last vision event" status widget — a
  // lightweight summary of the last 24h from the 5 local-Ollama camera
  // automations (see fetchLLMVisionTimeline in homeassistant.js), not the
  // full timeline (that's the get_llm_vision_activity chat tool).
  app.get('/api/llm-vision/stats', async (_req, res) => {
    try {
      const events = await fetchLLMVisionTimeline(24);
      res.json(summarizeLLMVisionActivity(events));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Full browsable event list for AloyMobile's Vision Events screen — the
  // stats route above only returns a one-line summary, not enough to render
  // an actual list.
  app.get('/api/llm-vision/events', async (req, res) => {
    try {
      const hours = Number(req.query.hours) || 24;
      const events = await fetchLLMVisionTimeline(hours);
      res.json({ hours, ...getLLMVisionEventsDetail(events) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  // ── Home Assistant proxy for the renderer ──────────────────────────────
  //
  // The renderer no longer carries a Home Assistant token (it used to be
  // inlined into the bundle by Vite — see the note in
  // src/services/homeassistant.js). It calls here instead, already
  // authenticated with the Aloy bearer token, and the HA credential is
  // attached on this side from the server environment.
  //
  app.all(/^\/api\/ha-proxy(\/.*)?$/, async (req, res) => {
    const haToken = process.env.HA_TOKEN || process.env.VITE_HA_TOKEN;
    if (!haToken) {
      return res.status(503).json({ error: 'HA_TOKEN is not configured in the server environment.' });
    }
    const haUrl = process.env.HA_URL || 'http://localhost:8123';
    const suffix = req.originalUrl.replace(/^\/api\/ha-proxy/, '');
    try {
      const upstream = await httpFetch(`${haUrl}${suffix}`, {
        timeoutMs: TIMEOUTS.API,
        method: req.method,
        headers: { Authorization: `Bearer ${haToken}`, 'Content-Type': 'application/json' },
        ...(req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined
          ? { body: JSON.stringify(req.body) }
          : {})
      });
      const text = await upstream.text();
      res.status(upstream.status)
         .type(upstream.headers.get('content-type') || 'application/json')
         .send(text);
    } catch (err) {
      res.status(502).json({ error: `Home Assistant proxy failed: ${err.message}` });
    }
  });

  // ── Server-side pending-call store ─────────────────────────────────────
  //
  // /api/chat/resolve used to take `pendingCalls` from the REQUEST BODY and
  // execute `getTool(call.name).execute(call.arguments)` directly, with no
  // check that the model had ever proposed that call, that the arguments were
  // unmodified, or that the tool required confirmation at all.
  //
  // That meant every `requiresConfirmation: true` in this codebase was enforced
  // by the CLIENT. A token holder could POST a hand-written pendingCalls array
  // and run any registered tool with any arguments — including the remote-shell
  // tools — and the prompt the user would have seen simply never happened.
  //
  // Now /api/chat records what it actually pended, and resolve executes the
  // STORED name and arguments, looked up by id. The client can only say yes or
  // no to something the model genuinely asked for.
  const pendingToolCalls = new Map();
  const PENDING_TTL_MS = 15 * 60 * 1000;

  function rememberPendingCalls(calls) {
    const now = Date.now();
    // Opportunistic sweep so an abandoned confirmation cannot be resurrected
    // an hour later, and the map cannot grow without bound.
    for (const [id, entry] of pendingToolCalls) {
      if (now - entry.createdAt > PENDING_TTL_MS) pendingToolCalls.delete(id);
    }
    for (const c of calls) {
      pendingToolCalls.set(c.id, { name: c.name, arguments: c.arguments, createdAt: now });
    }
  }

  // Resolves pending confirmations from a /api/chat response, executes the
  // approved ones (denied ones get the same "deliberate decline" message the
  // desktop app uses), then continues the model turn.
  app.post('/api/chat/resolve', async (req, res) => {
    const { apiMessages, pendingCalls, approvals, model, chatId, cleanMessages, turnId } = req.body;
    try {
      const ctx = buildCtx();
      const toolResultMessages = [];
      for (const clientCall of pendingCalls) {
        // Look the call up by id. Only the id is trusted from the client; the
        // tool name and arguments come from what the server recorded when the
        // model proposed it. A call the server never pended is refused, so a
        // hand-written pendingCalls array executes nothing.
        const stored = pendingToolCalls.get(clientCall?.id);
        if (!stored) {
          logAuditEvent({
            category: 'security', action: 'unknown_pending_call_rejected',
            target: String(clientCall?.name || 'unknown'), status: 'denied',
            payload: { id: clientCall?.id || null, claimedName: clientCall?.name || null },
            details: 'A confirmation resolve referenced a call this server never pended.'
          });
          toolResultMessages.push({
            role: 'tool',
            content: JSON.stringify({
              error: 'This action was not pending confirmation on the server and was not executed.'
            })
          });
          continue;
        }
        // One-shot: consume it so the same approval cannot be replayed.
        pendingToolCalls.delete(clientCall.id);

        const call = { id: clientCall.id, name: stored.name, arguments: stored.arguments };
        const approved = !!approvals?.[call.id];
        let result;
        if (approved) {
          const tool = getTool(call.name);
          try {
            result = await tool.execute(call.arguments, ctx);
          } catch (err) {
            result = JSON.stringify({ error: err.message || 'Tool execution failed' });
          }
        } else {
          result = JSON.stringify({
            declined: true,
            reason: 'The user reviewed this exact action and chose not to proceed — this was a deliberate decision, not a technical failure. Acknowledge it and do not retry or suggest adjustments unless the user asks again.'
          });
        }
        let formattedContent = typeof result === 'string' ? result : JSON.stringify(result);
        if (approved && (/\b(error|failed|exception)\b/i.test(formattedContent) && !formattedContent.includes('[SYSTEM HINT]'))) {
          formattedContent += `\n\n[SYSTEM HINT]: Tool '${call.name}' encountered an issue. Review the output above and attempt a self-correction with adjusted parameters or an alternative tool if applicable.`;
        }
        toolResultMessages.push({ role: 'tool', content: formattedContent });
      }
      const continuedMessages = [...apiMessages, ...toolResultMessages];
      // This endpoint only ever runs after the user confirmed a pending tool
      // call, so the completion always follows a tool execution — force
      // usedTools:true rather than relying on runTurn's own depth-based
      // tracking (which starts fresh at depth 0 here). hadWriteTool:true for
      // the same reason skill synthesis is excluded: a write action was
      // just taken, so even a further read-only tool call in this same
      // chain shouldn't get mined into a skill (see runModelTurn's onComplete
      // in App.jsx for the matching desktop-side logic).
      const result = await runTurn(continuedMessages, model || DEFAULT_MODEL, 0, true, [], true, turnId);
      if (result.type === 'complete') {
        persistChatTurn(chatId, cleanMessages || [], result.text);
        maybeEscalateInBackground(chatId, cleanMessages, result.text, model, result.usedTools);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      if (turnId) turnStatus.delete(turnId);
    }
  });

  // Direct data access for a mobile UI (not just via chat).
  app.get('/api/reminders', (_req, res) => res.json(store.load().reminders));
  // By id, not text-match like the chat tool's complete_reminder — the
  // mobile UI has the exact reminder in hand, no need for fuzzy matching.
  app.post('/api/reminders/:id/complete', (req, res) => {
    const d = store.load();
    const reminder = d.reminders.find((r) => r.id === req.params.id);
    if (!reminder) return res.status(404).json({ success: false, error: 'Reminder not found' });
    reminder.completed = true;
    store.save(d);
    res.json({ success: true });
  });
  app.get('/api/workouts', (_req, res) => {
    const workouts = store.load().workouts || [];
    res.json({ workouts, streak: calculateWorkoutStreak(workouts) });
  });
  app.get('/api/transactions', (_req, res) => res.json(store.load().transactions));
  app.get('/api/budgets', (_req, res) => {
    const d = store.load();
    res.json(calculateBudgetStatus(d.budgets, d.transactions));
  });
  app.get('/api/profile', (_req, res) => res.json(store.load().userProfile));
  app.put('/api/profile', (req, res) => {
    const d = store.load();
    d.userProfile = { ...d.userProfile, ...req.body };
    store.save(d);
    res.json(d.userProfile);
  });
  // Live tracked-project status (e.g. AutoRipManager) for the mobile app's
  // sidebar widget — same fetch/parse helpers as the desktop app's
  // per-message check and background poller, just exposed as a direct route
  // so the mobile client can poll it without going through chat.
  app.get('/api/projects/status', async (_req, res) => {
    const d = store.load();
    const projectsWithStatus = (d.trackedProjects || []).filter((p) => p.statusUrl);
    const results = await Promise.all(projectsWithStatus.map(async (proj) => {
      const statusData = await fetchProjectStatus(proj.statusUrl);
      const summary = statusData ? parseProjectStatusSummary(statusData) : null;
      return summary ? { name: proj.name, summary } : null;
    }));
    res.json(results.filter(Boolean));
  });

  // Upcoming calendar events for the mobile app's Agenda card — same
  // fetchGoogleCalendarEvents already imported above and used for the
  // system-prompt calendar injection, just exposed directly so mobile can
  // poll it without going through chat (mirrors /api/projects/status).
  app.get('/api/calendar/events', async (req, res) => {
    try {
      const daysAhead = Number(req.query.days) || 2;
      const events = await fetchGoogleCalendarEvents(daysAhead);
      res.json(events);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Tech-news feed — cached articles from the scheduled/manual scrape
  // pipeline (server/newsScraper.cjs), not fetched live per request.
  app.get('/api/news', (_req, res) => {
    const d = store.load();
    res.json((d.newsArticles || []).filter((a) => a.relevant));
  });
  // Manual "scrape now" escape hatch — same convention as
  // /api/skills-dashboard/auto-resolve and the backup feature's manual
  // trigger. Runs synchronously and returns the run summary; the client
  // re-fetches /api/news afterward for the actual updated feed.
  // Fire-and-forget rather than awaited — measured live: scoring 30
  // articles through the local model took over 2 minutes (~4s/article),
  // far too slow to hold an HTTP response open for a "Refresh Now" button.
  // Same "can't block the visible response" lesson already learned for the
  // confidence-escalation check. Client polls /api/news/refresh/status
  // (or just re-fetches /api/news after a delay) to see when it's done.
  app.post('/api/news/refresh', (_req, res) => {
    const { runNewsScrape, isNewsScrapeInProgress } = require('./newsScraper.cjs');
    if (isNewsScrapeInProgress()) {
      return res.status(409).json({ success: false, error: 'A refresh is already in progress.' });
    }
    runNewsScrape()
      .then((result) => console.log(`News refresh (manual): ${result.rawArticlesFound} found, ${result.newArticlesScored} scored, ${result.relevantCount} relevant.`))
      .catch((err) => console.error('Manual news refresh failed:', err.message));
    res.json({ success: true, started: true });
  });
  app.get('/api/news/refresh/status', (_req, res) => {
    const { isNewsScrapeInProgress } = require('./newsScraper.cjs');
    const d = store.load();
    res.json({ inProgress: isNewsScrapeInProgress(), lastScrapeAt: d.lastNewsScrapeAt });
  });
  app.get('/api/news/sources', (_req, res) => res.json(store.load().newsSources || []));
  app.put('/api/news/sources', (req, res) => {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Body must be an array of sources.' });
    const { normalizeNewsSources } = require('./newsScraper.cjs');
    const d = store.load();
    d.newsSources = normalizeNewsSources(req.body);
    store.save(d);
    res.json({ success: true, newsSources: d.newsSources });
  });
  app.get('/api/news/interests', (_req, res) => res.json(store.load().newsInterests || []));
  app.put('/api/news/interests', (req, res) => {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Body must be an array of interest strings.' });
    const d = store.load();
    d.newsInterests = req.body;
    store.save(d);
    res.json({ success: true, newsInterests: d.newsInterests });
  });

  // Live Smart Home data + control for the mobile app's quick-controls
  // widget. GET is read-only (haCategories/smartHomeStats are the same
  // vars refreshHA() already maintains for the chat tool-calling path).
  // The execute route is a DIRECT UI action, not LLM-mediated — no
  // confirmation gate, matching how the desktop SmartHomeDrawer calls
  // onExecuteHAService directly (confirmation is only for LLM tool calls).
  app.get('/api/smarthome', (_req, res) => {
    res.json({ categories: haCategories, stats: smartHomeStats });
  });
  // Unlike the chat tool-calling path (where the LLM's own judgment is a
  // soft filter before a call happens), this route has no such filter —
  // it's called directly from the mobile UI. Restrict it to exactly the
  // domain.service combos the Smart Home widget actually uses.
  const SMART_HOME_ALLOWED_SERVICES = { light: ['turn_on', 'turn_off'], lock: ['lock', 'unlock'], climate: ['set_temperature', 'set_hvac_mode'] };
  const CLIMATE_ALLOWED_HVAC_MODES = new Set(['off', 'heat', 'cool', 'auto', 'fan_only', 'heat_cool', 'dry']);
  app.post('/api/smarthome/execute', async (req, res) => {
    const { domain, service, entity_id, temperature, hvac_mode } = req.body;
    const allowedServices = SMART_HOME_ALLOWED_SERVICES[domain];
    if (!allowedServices || !allowedServices.includes(service)) {
      return res.status(400).json({ success: false, error: `Service "${domain}.${service}" is not allowed via this route.` });
    }
    if (typeof entity_id !== 'string' || !entity_id.startsWith(`${domain}.`)) {
      return res.status(400).json({ success: false, error: 'entity_id does not match domain.' });
    }
    let extraData = {};
    if (service === 'set_temperature') {
      if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 40 || temperature > 95) {
        return res.status(400).json({ success: false, error: 'temperature must be a number between 40 and 95.' });
      }
      extraData = { temperature };
    } else if (service === 'set_hvac_mode') {
      if (typeof hvac_mode !== 'string' || !CLIMATE_ALLOWED_HVAC_MODES.has(hvac_mode)) {
        return res.status(400).json({ success: false, error: 'hvac_mode is not a recognized mode.' });
      }
      extraData = { hvac_mode };
    }

    // NOTE: this used to hardcode authContext.isInteractiveUser: true, which
    // unconditionally satisfied validateSmartHomeAction's exterior-lock 2FA
    // check for every caller — the check existed in securityGuard.cjs but
    // could never actually fire from this route. This route has no LLM
    // judgment as a soft filter (see comment above), so "isInteractiveUser"
    // can't be inferred from anything available here; failing closed until
    // this route accepts a real pinVerified/faceMatchUser signal.
    const secCheck = validateSmartHomeAction({
      domain,
      service,
      entityId: entity_id,
      authContext: {}
    });
    if (!secCheck.allowed) {
      return res.status(403).json({ success: false, error: secCheck.reason, requires2FA: secCheck.requires2FA });
    }

    const success = await executeHAService(domain, service, entity_id, extraData);
    logAuditEvent({
      category: 'smarthome',
      action: `${domain}.${service}`,
      target: entity_id,
      client: 'mobile_app',
      status: success ? 'success' : 'error',
      payload: { temperature, hvac_mode }
    });

    if (success) setTimeout(refreshHA, 1000);
    res.json({ success });
  });

  // Extended Smart Home Telemetry Routes
  app.get('/api/smart-home/batteries', async (_req, res) => {
    try {
      const states = cachedRawStates || (await fetchHomeAssistantStates());
      const { getBatteryHealthOverview } = await import(resolveService('homeassistant.js'));
      res.json(getBatteryHealthOverview(states));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/smart-home/appliances', async (_req, res) => {
    try {
      const states = cachedRawStates || (await fetchHomeAssistantStates());
      const { getApplianceOverview } = await import(resolveService('homeassistant.js'));
      res.json(getApplianceOverview(states));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/smart-home/presence', async (_req, res) => {
    try {
      const states = cachedRawStates || (await fetchHomeAssistantStates());
      const { getPresenceOverview } = await import(resolveService('homeassistant.js'));
      res.json(getPresenceOverview(states));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/smart-home/environment', async (_req, res) => {
    try {
      const states = cachedRawStates || (await fetchHomeAssistantStates());
      const { getEnvironmentalOverview } = await import(resolveService('homeassistant.js'));
      res.json(getEnvironmentalOverview(states));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/smart-home/weather', async (_req, res) => {
    try {
      const states = cachedRawStates || (await fetchHomeAssistantStates());
      const { getWeatherOverview } = await import(resolveService('homeassistant.js'));
      res.json(getWeatherOverview(states));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Audit log query endpoint
  app.get('/api/audit-logs', (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const category = req.query.category || null;
    const status = req.query.status || null;
    res.json(getRecentAuditLogs({ limit, category, status }));
  });

  // Agentic planner endpoints
  app.post('/api/planner/create', (req, res) => {
    const { goal, steps } = req.body;
    if (!goal || !Array.isArray(steps)) return res.status(400).json({ error: 'goal and steps array required' });
    const plan = globalPlanner.createPlan(goal, steps);
    res.json(plan);
  });

  app.post('/api/planner/dry-run', async (req, res) => {
    const { planId } = req.body;
    try {
      const result = await globalPlanner.dryRunPlan(planId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Distillation dataset builder trigger
  app.post('/api/trainer/build-dataset', (_req, res) => {
    try {
      const result = buildDistillationDataset();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // HEPHAESTUS (Heph) Coding Agent Endpoints
  // ==========================================
  app.get('/api/hephaestus/tasks', (req, res) => {
    const { status, category } = req.query;
    res.json(globalHephaestus.listTasks({ status, category }));
  });

  app.get('/api/hephaestus/training-stats', (_req, res) => {
    const { getTrainingStats } = require('./hephReviewer.cjs');
    res.json(getTrainingStats());
  });

  app.get('/api/hephaestus/tasks/:id', (req, res) => {
    const task = globalHephaestus.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  });

  app.post('/api/hephaestus/tasks', (req, res) => {
    const { title, description, category, targetFiles, requirements, autoDeploy, requestedBy } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const task = globalHephaestus.createTask({
      title,
      description,
      category,
      targetFiles,
      requirements,
      autoDeploy,
      requestedBy: requestedBy || 'user'
    });
    res.status(201).json(task);
  });

  app.post('/api/hephaestus/tasks/:id/stage', (req, res) => {
    const { filePath, proposedContent } = req.body;
    if (!filePath || proposedContent == null) {
      return res.status(400).json({ error: 'filePath and proposedContent required' });
    }
    try {
      const change = globalHephaestus.stageFileModification(req.params.id, filePath, proposedContent);
      res.json({ success: true, change, task: globalHephaestus.getTask(req.params.id) });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/hephaestus/tasks/:id/verify', async (req, res) => {
    const { testCmd } = req.body;
    try {
      const task = await globalHephaestus.runVerification(req.params.id, testCmd);
      res.json({ success: true, task });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/hephaestus/tasks/:id/approve', async (req, res) => {
    try {
      const result = await globalHephaestus.approveAndDeploy(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/hephaestus/tasks/:id/reject', (req, res) => {
    const { reason } = req.body;
    try {
      const task = globalHephaestus.rejectTask(req.params.id, reason);
      res.json({ success: true, task });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/hephaestus/tasks/:id/rollback', async (req, res) => {
    try {
      const result = await globalHephaestus.rollbackDeployment(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/hephaestus/tasks/:id', (req, res) => {
    const deleted = globalHephaestus.deleteTask(req.params.id);
    res.json({ success: deleted });
  });

  // HEPHAESTUS Autonomous Goals & STATE.yaml (OpenClaw Parity)
  app.get('/api/hephaestus/goals', (_req, res) => {
    res.json(globalHephGoalEngine.listGoals());
  });

  app.post('/api/hephaestus/goals', (req, res) => {
    try {
      const { title, description, priority, targetDirectory, steps, activeFiles } = req.body || {};
      const goal = globalHephGoalEngine.createGoal({
        title,
        description,
        priority,
        targetDirectory,
        steps,
        activeFiles
      });
      res.json(goal);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/hephaestus/goals/:id', (req, res) => {
    const goal = globalHephGoalEngine.getGoal(req.params.id);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    res.json(goal);
  });

  app.post('/api/hephaestus/goals/:id/execute', async (req, res) => {
    try {
      const { autoAdvance } = req.body || {};
      const updated = await globalHephGoalEngine.executeGoal(req.params.id, { autoAdvance: autoAdvance !== false });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/hephaestus/goals/:id', (req, res) => {
    const deleted = globalHephGoalEngine.deleteGoal(req.params.id);
    res.json({ success: deleted });
  });

  // ATHENA Autonomous Deep Research Scout Endpoints
  app.get('/api/athena/tasks', (req, res) => {
    res.json(athenaEngine.listTasks(req.query));
  });

  app.get('/api/athena/tasks/:id', (req, res) => {
    const task = athenaEngine.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Research task not found' });
    res.json(task);
  });

  app.post('/api/athena/tasks', async (req, res) => {
    try {
      const { query, depth, focusAreas, requestedBy } = req.body || {};
      const task = await athenaEngine.createTask({ query, depth, focusAreas, requestedBy });
      res.status(201).json(task);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/athena/tasks/:id/cancel', (req, res) => {
    const result = athenaEngine.cancelTask(req.params.id);
    res.json(result);
  });

  app.delete('/api/athena/tasks/:id', (req, res) => {
    const result = athenaEngine.deleteTask(req.params.id);
    res.json(result);
  });

  // APOLLO Document Intelligence & Vault Curator Endpoints
  app.get('/api/apollo/tasks', (_req, res) => res.json(globalApollo.listTasks()));
  app.get('/api/apollo/tasks/:id', (req, res) => {
    const t = globalApollo.getTask(req.params.id);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    res.json(t);
  });
  app.post('/api/apollo/tasks', async (req, res) => {
    try {
      const { title, rawContent, category, requestedBy } = req.body || {};
      const task = await globalApollo.createDocumentTask({ title, rawContent, category, requestedBy });
      res.status(201).json(task);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.post('/api/apollo/garden-memories', (_req, res) => res.json(globalApollo.gardenMemories()));
  app.post('/api/apollo/sync-vault', async (_req, res) => {
    try {
      const r = await globalApollo.triggerVaultSync();
      res.json(r);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // APOLLO 4-Asset Memory & LLM-Wiki Hub Endpoints
  app.get('/api/apollo/memory-hub', (_req, res) => res.json(globalMemoryHub.getHubOverview()));
  app.get('/api/apollo/wiki', (_req, res) => res.json(globalMemoryHub.getWikiPages()));
  app.get('/api/apollo/wiki/:slug', (req, res) => {
    const content = globalMemoryHub.getWikiPage(req.params.slug);
    if (!content) return res.status(404).json({ error: 'Wiki page not found' });
    res.json({ slug: req.params.slug, content });
  });
  app.post('/api/apollo/wiki/:slug', (req, res) => {
    const { title, content } = req.body || {};
    if (!content) return res.status(400).json({ error: 'Content required' });
    res.json(globalMemoryHub.saveWikiPage(req.params.slug, title || req.params.slug, content));
  });
  app.get('/api/apollo/code-graph', (_req, res) => res.json(globalMemoryHub.getCodeGraph()));
  app.post('/api/apollo/code-graph', (req, res) => res.json(globalMemoryHub.updateCodeGraph(req.body)));

  // Token Compressor & Quota Fallback Endpoints
  app.post('/api/token-compressor/compress', (req, res) => {
    const { text, messages, options } = req.body || {};
    if (text) return res.json(TokenCompressor.compressText(text, options));
    if (messages) return res.json(TokenCompressor.compressMessages(messages, options));
    res.status(400).json({ error: 'Either text or messages required' });
  });
  app.get('/api/token-compressor/quota-status', (_req, res) => res.json(quotaRouter.getStatus()));

  // Needle Fast-Intent Classifier Endpoint
  app.post('/api/needle/classify', (req, res) => {
    const { input } = req.body || {};
    if (!input) return res.status(400).json({ error: 'Input required' });
    res.json(NeedleIntentEngine.classify(input));
  });

  // Community MCP Plugin Registry Endpoints
  app.get('/api/mcp/registry', (_req, res) => res.json(globalMcpRegistry.getRegistry()));
  app.post('/api/mcp/registry/:id/toggle', (req, res) => {
    const { enable } = req.body || {};
    res.json(globalMcpRegistry.togglePlugin(req.params.id, Boolean(enable)));
  });

  // MINERVA Sentinel & Smart Home Watchdog Endpoints
  app.get('/api/minerva/health', async (_req, res) => {
    try {
      res.json(await globalMinerva.runHealthScan());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post('/api/minerva/alert', async (req, res) => {
    try {
      const { title, message, severity } = req.body || {};
      res.json(await globalMinerva.dispatchAlert({ title, message, severity }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.post('/api/minerva/self-heal', async (req, res) => {
    try {
      const { serviceName, force } = req.body || {};
      const result = await globalMinerva.selfHeal({ serviceName, force: !!force });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get('/api/minerva/self-heal/events', (_req, res) => {
    try {
      res.json(globalMinerva.getSelfHealEvents());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // HERMES Operations & Daily Briefing Endpoints
  app.get('/api/hermes/daily-brief', async (req, res) => {
    try {
      const userName = req.query.userName || 'User';
      res.json(await globalHermes.generateDailyBriefing({ userName }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get('/api/hermes/morning-digest', async (req, res) => {
    try {
      const userName = req.query.userName || 'User';
      const digest = await globalHermesDigest.generateDigest({ userName });
      res.json(digest);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post('/api/hermes/morning-digest/refresh', async (req, res) => {
    try {
      const userName = req.body?.userName || 'User';
      const digest = await globalHermesDigest.generateDigest({ userName, forceRefresh: true });
      res.json(digest);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get('/api/hermes/budget-health', (_req, res) => res.json(globalHermes.evaluateBudgetHealth()));
  app.get('/api/hermes/portfolio', async (_req, res) => {
    try {
      res.json(await globalHermes.getPortfolioSnapshot());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post('/api/hermes/portfolio/shares', (req, res) => {
    try {
      const { symbol, shares } = req.body;
      res.json(globalHermes.setShares(symbol, shares));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // HERMES RPC Script Pipeline, Dialectic Memory, Evolution & Gateway Routes
  app.post('/api/hermes/pipeline/run', async (req, res) => {
    try {
      const { script, context } = req.body || {};
      if (!script) return res.status(400).json({ error: 'script is required' });
      const result = await globalHermesPipeline.executePipeline(script, context || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/hermes/skills', (_req, res) => {
    try {
      res.json(globalHermesEvolution.listSkills());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/hermes/skills/synthesize', (req, res) => {
    try {
      res.json(globalHermesEvolution.synthesizeSkill(req.body || {}));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/hermes/skills/evolve', (req, res) => {
    try {
      const { skillName, reason, feedback } = req.body || {};
      res.json(globalHermesEvolution.evolveSkill(skillName, { reason, feedback }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/hermes/user-model', (_req, res) => {
    try {
      res.json(globalHermesMemory.getUserModel());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/hermes/user-model', (req, res) => {
    try {
      res.json(globalHermesMemory.updateUserModel(req.body || {}));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/hermes/memory/fts-search', (req, res) => {
    try {
      const query = req.query.q || '';
      const limit = Number(req.query.limit) || 8;
      res.json(globalHermesMemory.searchCrossSession(query, { maxResults: limit }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/hermes/gateway/status', (_req, res) => {
    try {
      res.json(globalHermesGateway.getGatewayStatus());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/hermes/gateway/schedule', (req, res) => {
    try {
      res.json(globalHermesGateway.scheduleTask(req.body || {}));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // JOB RADAR — Technical Writer & Content Dev Opportunity Scanner Endpoints
  app.get('/api/jobs/listings', (req, res) => {
    try {
      res.json(globalJobRadar.getListings(req.query || {}));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post('/api/jobs/scan', async (req, res) => {
    try {
      res.json(await globalJobRadar.runJobScan(req.body || {}));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post('/api/jobs/:id/status', (req, res) => {
    try {
      const updated = globalJobRadar.updateListingStatus(req.params.id, req.body.status || 'new');
      if (!updated) return res.status(404).json({ error: 'Job listing not found' });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.get('/api/jobs/config', (_req, res) => res.json(globalJobRadar.getConfig()));
  app.post('/api/jobs/config', (req, res) => {
    try {
      res.json(globalJobRadar.updateConfig(req.body || {}));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.get('/api/jobs/summary', (_req, res) => res.json(globalJobRadar.getDailySummary()));


  // PANTHEON COUNCIL — Weekly Strategic Conclave Endpoints
  app.get('/api/conclave/latest', (_req, res) => {
    try {
      res.json({ success: true, conclave: globalConclave.getLatest() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/conclave/history', (_req, res) => {
    try {
      res.json({ success: true, history: globalConclave.getHistory() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/conclave/convene', async (req, res) => {
    try {
      const session = await globalConclave.conveneConclave({
        manualTrigger: req.body?.manualTrigger ?? true,
        overrideTime: req.body?.overrideTime || null
      });
      res.json({ success: true, conclave: session });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Scheduled Weekly Strategic Conclave Check:
  // Convenes if the current ISO week has no conclave record yet (covers Sunday 8 PM window & catch-up if PC was off)
  async function maybeRunWeeklyConclave() {
    try {
      const now = new Date();
      const { getIsoWeekData } = require('./conclave.cjs');
      const { week: currentIsoWeek, year: currentYear } = getIsoWeekData(now);
      const latest = globalConclave.getLatest();
      const hasConclaveForThisWeek = latest && latest.isoWeek === currentIsoWeek && latest.year === currentYear;

      if (!hasConclaveForThisWeek) {
        console.log(`[conclave] Convening weekly Pantheon Strategic Conclave (Week ${currentIsoWeek}, ${currentYear})...`);
        await globalConclave.conveneConclave({ manualTrigger: false });
      }
    } catch (err) {
      console.warn('[conclave] Scheduled conclave check warning:', err.message);
    }
  }
  setInterval(maybeRunWeeklyConclave, 30 * 60 * 1000);

  // MINDWALK 3D Codebase & Agent Replay Endpoints
  app.get('/api/mindwalk/status', async (_req, res) => {
    try {
      const { checkMindwalkLive, MINDWALK_PORT } = require('./mindwalkAdapter.cjs');
      const isLive = await checkMindwalkLive(MINDWALK_PORT);
      res.json({
        running: isLive,
        port: MINDWALK_PORT,
        localUrl: `http://127.0.0.1:${MINDWALK_PORT}`,
        tailscaleUrl: process.env.TAILSCALE_IP ? `http://${process.env.TAILSCALE_IP}:${MINDWALK_PORT}` : null
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/mindwalk/start', async (_req, res) => {
    try {
      const { ensureMindwalkRunning } = require('./mindwalkAdapter.cjs');
      const result = await ensureMindwalkRunning();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/mindwalk/export-session', (req, res) => {
    try {
      const { convertTranscriptToClaudeJsonl } = require('./mindwalkAdapter.cjs');
      const { transcriptPath, sessionId, repoDir } = req.body || {};
      const result = convertTranscriptToClaudeJsonl({
        transcriptPath: transcriptPath || path.join(os.homedir(), '.aloy', 'logs', 'transcript.jsonl'),
        sessionId: sessionId || `session-${Date.now()}`,
        repoDir: repoDir || path.join(os.homedir(), 'AloyMobile')
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Ruflo Harvest (ruvnet/ruflo): Federation, SPARC, & Arena ─────────
  const { RufloFederationEngine } = require('./rufloFederation.cjs');
  const { SparcLifecycleEngine } = require('./sparcLifecycle.cjs');
  const { AgentArenaEngine } = require('./agentArena.cjs');

  const federationEngine = new RufloFederationEngine();
  const sparcEngine = new SparcLifecycleEngine();
  const arenaEngine = new AgentArenaEngine();

  // Federation Routes
  app.get('/api/federation/peers', (_req, res) => {
    res.json({ success: true, peers: federationEngine.getPeers(), nodeId: federationEngine.nodeId });
  });

  app.post('/api/federation/peers/register', (req, res) => {
    try {
      const peer = federationEngine.registerPeer(req.body || {});
      res.json({ success: true, peer });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/federation/dispatch', async (req, res) => {
    try {
      const { peerId, taskData, options } = req.body || {};
      const result = await federationEngine.dispatchTask(peerId, taskData, options);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/federation/receive', async (req, res) => {
    try {
      const envelope = req.body || {};
      const result = await federationEngine.handleIncomingMessage(envelope, async (payload) => {
        return { handled: true, payload };
      });
      if (!result.success) {
        return res.status(result.status || 400).json(result);
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // SPARC 5-Phase Methodology Routes
  app.get('/api/sparc/workflows', (_req, res) => {
    res.json({ success: true, workflows: sparcEngine.listWorkflows() });
  });

  app.post('/api/sparc/init', (req, res) => {
    try {
      const wf = sparcEngine.createWorkflow(req.body || {});
      res.json({ success: true, workflow: wf });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/sparc/advance', (req, res) => {
    try {
      const { workflowId, phaseData } = req.body || {};
      if (phaseData) {
        const wf = sparcEngine.getWorkflow(workflowId);
        if (wf) sparcEngine.updatePhaseData(workflowId, wf.currentPhase, phaseData);
      }
      const result = sparcEngine.advancePhase(workflowId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.get('/api/sparc/report/:id', (req, res) => {
    try {
      const report = sparcEngine.generateReport(req.params.id);
      res.json({ success: true, report });
    } catch (err) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  // Agent Arena Routes
  app.get('/api/arena/strategies', (_req, res) => {
    res.json({ success: true, strategies: arenaEngine.getStrategies(), tournaments: arenaEngine.getTournaments() });
  });

  app.post('/api/arena/match', async (req, res) => {
    try {
      const { stratAId, stratBId, task } = req.body || {};
      const result = await arenaEngine.runMatch(stratAId, stratBId, task || 'Benchmark Task');
      res.json({ success: true, match: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arena/tournament', async (req, res) => {
    try {
      const { tasks } = req.body || {};
      const tournament = await arenaEngine.runTournament(tasks);
      res.json({ success: true, tournament });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arena/evolve', async (req, res) => {
    try {
      const { baseStrategyId, generations } = req.body || {};
      const evolution = await arenaEngine.evolveStrategy(baseStrategyId, generations);
      res.json({ success: true, evolution });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/vision/triage', async (req, res) => {
    try {
      const { triageSnapshot } = require('./visionTriage.cjs');
      const triageResult = await triageSnapshot(req.body || {});
      res.json({ success: true, triage: triageResult });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Jellyfin Media Integration Routes
  app.get('/api/jellyfin/status', async (_req, res) => {
    try {
      const { jellyfinService } = require('./jellyfinService.cjs');
      const status = await jellyfinService.getStatus();
      const sessions = await jellyfinService.getSessions();
      res.json({ success: true, status, activeSessionCount: sessions.length });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/jellyfin/sessions', async (_req, res) => {
    try {
      const { jellyfinService } = require('./jellyfinService.cjs');
      const { getActiveMediaSessions } = require('./mediaDispatcher.cjs');
      const jfSessions = await jellyfinService.getSessions().catch(() => []);
      const aloySessions = typeof getActiveMediaSessions === 'function' ? getActiveMediaSessions() : [];
      const sessions = [...aloySessions, ...jfSessions.filter(js => !aloySessions.some(as => as.id === js.id))];
      res.json({ success: true, sessions });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Real-time Jellyfin Server-Sent Events (SSE) stream for live playback push
  app.get('/api/jellyfin/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();

    const { jellyfinService } = require('./jellyfinService.cjs');
    const { getActiveMediaSessions } = require('./mediaDispatcher.cjs');
    jellyfinService.startWebSocket();

    // Push current snapshot immediately
    jellyfinService.getSessions().then((jfSessions) => {
      const aloySessions = typeof getActiveMediaSessions === 'function' ? getActiveMediaSessions() : [];
      const sessions = [...aloySessions, ...jfSessions.filter(js => !aloySessions.some(as => as.id === js.id))];
      res.write(`data: ${JSON.stringify({ type: 'sessions', sessions })}\n\n`);
    }).catch(() => {});

    const onSessions = (jfSessions) => {
      try {
        const aloySessions = typeof getActiveMediaSessions === 'function' ? getActiveMediaSessions() : [];
        const sessions = [...aloySessions, ...(Array.isArray(jfSessions) ? jfSessions : []).filter(js => !aloySessions.some(as => as.id === js.id))];
        res.write(`data: ${JSON.stringify({ type: 'sessions', sessions })}\n\n`);
      } catch {}
    };

    const onPlayback = (playbackEvent) => {
      try {
        res.write(`data: ${JSON.stringify({ type: 'playback', data: playbackEvent })}\n\n`);
      } catch {}
    };

    jellyfinService.on('sessions', onSessions);
    jellyfinService.on('playback', onPlayback);

    const heartbeat = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {}
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      jellyfinService.off('sessions', onSessions);
      jellyfinService.off('playback', onPlayback);
    });
  });

  app.post('/api/jellyfin/control', async (req, res) => {
    try {
      const { sessionId, command, params } = req.body || {};
      if (sessionId && sessionId.startsWith('aloy:')) {
        const { handleMediaSessionControl } = require('./mediaDispatcher.cjs');
        const result = await handleMediaSessionControl(sessionId, command, params || {});
        return res.json({ success: true, result });
      }
      const { jellyfinService } = require('./jellyfinService.cjs');
      const result = await jellyfinService.sendSessionCommand(sessionId, command, params || {});
      res.json({ success: true, result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.get('/api/jellyfin/search', async (req, res) => {
    try {
      const { jellyfinService } = require('./jellyfinService.cjs');
      const { q, limit } = req.query;
      const results = await jellyfinService.searchMedia(q, limit ? parseInt(limit, 10) : 10);
      res.json({ success: true, results });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/jellyfin/libraries', async (_req, res) => {
    try {
      const { jellyfinService } = require('./jellyfinService.cjs');
      const libraries = await jellyfinService.getLibraries();
      res.json({ success: true, libraries });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/jellyfin/refresh', async (_req, res) => {
    try {
      const { jellyfinService } = require('./jellyfinService.cjs');
      const result = await jellyfinService.refreshLibrary();
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/jellyfin/start', async (_req, res) => {
    try {
      const { jellyfinService } = require('./jellyfinService.cjs');
      const result = await jellyfinService.startServer();
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/jellyfin/restart', async (_req, res) => {
    try {
      const { jellyfinService } = require('./jellyfinService.cjs');
      const result = await jellyfinService.restartServer();
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/jellyfin/stop', async (_req, res) => {
    try {
      const { jellyfinService } = require('./jellyfinService.cjs');
      const result = await jellyfinService.stopServer();
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/jellyfin/diagnostics', async (_req, res) => {
    try {
      const { jellyfinService } = require('./jellyfinService.cjs');
      const report = await jellyfinService.diagnose();
      res.json({ success: true, report });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Media Formatter & Audit Routes
  app.get('/api/media/audit', async (req, res) => {
    try {
      const { mediaFormatterService } = require('./mediaFormatterService.cjs');
      const report = await mediaFormatterService.audit(req.query || {});
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/media/format', async (req, res) => {
    try {
      const { mediaFormatterService } = require('./mediaFormatterService.cjs');
      const result = await mediaFormatterService.format(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Radarr & Sonarr Media Orchestration Routes (*Arr Stack)
  app.get('/api/arr/status', async (_req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const status = await arrService.getStatus();
      res.json({ success: true, status });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/arr/queue', async (_req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const queue = await arrService.getQueue();
      res.json({ success: true, ...queue });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/arr/search', async (req, res) => {
    try {
      const { q, type } = req.query;
      const { arrService } = require('./arrService.cjs');
      const results = await arrService.searchMedia(q, type || 'all');
      res.json({ success: true, ...results });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/arr/calendar', async (req, res) => {
    try {
      const days = req.query.days ? parseInt(req.query.days, 10) : 14;
      const { arrService } = require('./arrService.cjs');
      const calendar = await arrService.getCalendar(days);
      res.json({ success: true, ...calendar });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arr/movie', async (req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const result = await arrService.addMovie(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arr/series', async (req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const result = await arrService.addSeries(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arr/music/artist', async (req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const result = await arrService.addArtist(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arr/music/rip', async (req, res) => {
    try {
      const { query, url } = req.body || {};
      const { arrService } = require('./arrService.cjs');
      const result = await arrService.ripAudio(url || query || '');
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arr/webhook', async (req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const result = await arrService.handleWebhook(req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Media Stack lifecycle control — start/stop/restart either the whole
  // stack or a single named service (prowlarr/radarr/sonarr/lidarr/sabnzbd/
  // retroarr). Backs the MediaStackHub restart buttons, the arr_stack_control
  // chat tool, and the mobile MediaStackModal.
  app.post('/api/arr/stack/start', async (_req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const result = await arrService.startStack();
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arr/stack/stop', async (_req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const result = await arrService.stopStack();
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arr/stack/restart', async (_req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const result = await arrService.restartStack();
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arr/service/:name/start', async (req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const result = await arrService.startService(req.params.name);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arr/service/:name/stop', async (req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const result = await arrService.stopService(req.params.name);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/arr/service/:name/restart', async (req, res) => {
    try {
      const { arrService } = require('./arrService.cjs');
      const result = await arrService.restartService(req.params.name);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Google ADK Multi-Agent Workflow Routes
  app.post('/api/adk/sequential', async (req, res) => {
    try {
      const { SequentialPipeline } = require('./adkOrchestrator.cjs');
      const { pipeline_name, initial_input, steps } = req.body || {};
      const pipeline = new SequentialPipeline({ name: pipeline_name });
      for (const step of steps || []) {
        pipeline.addStep({
          agent: async (input) => {
            if (step.agent_name === 'athena') return await athenaEngine.createTask({ query: input });
            if (step.agent_name === 'hephaestus') return await globalHephaestus.createTask({ title: input });
            if (step.agent_name === 'hermes') return await globalHermes.getDailyBriefing();
            if (step.agent_name === 'minerva') return await globalMinerva.runHealthScan();
            return { message: `Step completed for ${step.agent_name}`, input };
          },
          inputTemplate: step.input_template,
          outputKey: step.output_key
        });
      }
      const result = await pipeline.execute(initial_input || '');
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/adk/parallel', async (req, res) => {
    try {
      const { ParallelDispatch, AgentAsTool } = require('./adkOrchestrator.cjs');
      const { dispatch_name, tasks } = req.body || {};
      const agents = (tasks || []).map(t => ({
        agent: new AgentAsTool({
          name: t.agent_name,
          agentInstance: {
            executeTask: async (task) => {
              if (t.agent_name === 'athena') return await athenaEngine.createTask({ query: task });
              if (t.agent_name === 'hephaestus') return await globalHephaestus.createTask({ title: task });
              if (t.agent_name === 'hermes') return await globalHermes.getDailyBriefing();
              if (t.agent_name === 'minerva') return await globalMinerva.runHealthScan();
              return { task, completed: true };
            }
          }
        }),
        task: t.task,
        outputKey: t.output_key
      }));
      const dispatch = new ParallelDispatch({ name: dispatch_name, agents });
      const result = await dispatch.execute();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/system/dependency-health', async (_req, res) => {
    try {
      res.json(await globalMinerva.runHealthScan());
    } catch (err) {
      res.status(500).json({ status: 'degraded', error: err.message });
    }
  });

  app.get('/api/system/health-digest', (_req, res) => {
    const os = require('os');
    const uptimeHours = (process.uptime() / 3600).toFixed(1);
    const totalMemGb = (os.totalmem() / (1024 ** 3)).toFixed(1);
    const freeMemGb = (os.freemem() / (1024 ** 3)).toFixed(1);
    res.json({
      status: 'healthy',
      serverUptimeHours: parseFloat(uptimeHours),
      memory: { totalGb: parseFloat(totalMemGb), freeGb: parseFloat(freeMemGb) },
      cpus: os.cpus().length,
      platform: os.platform(),
      timestamp: new Date().toISOString()
    });
  });

  app.post('/api/system/webhook-alert', async (req, res) => {
    const { title, message, webhookUrl } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const targetUrl = webhookUrl || process.env.DISCORD_ALERT_WEBHOOK;
    if (!targetUrl) return res.json({ forwarded: false, reason: 'No webhook configured' });
    // `webhookUrl` comes from the request body and was POSTed to with
    // caller-chosen content — an SSRF pivot into the tailnet (and a tidy
    // exfiltration channel, since `message` is attacker-supplied too). Only a
    // caller-supplied URL is checked; the configured DISCORD_ALERT_WEBHOOK is
    // trusted because it comes from the server's own environment.
    if (webhookUrl) {
      try {
        const { isPrivateHostname } = require('./browserAgent.cjs');
        const u = new URL(targetUrl);
        if (!['http:', 'https:'].includes(u.protocol) || isPrivateHostname(u.hostname)) {
          logAuditEvent({
            category: 'security', action: 'webhook_target_rejected', target: u.hostname,
            status: 'denied', details: 'Webhook target is a private/loopback address or a disallowed protocol.'
          });
          return res.status(403).json({ forwarded: false, error: `Webhook target not allowed: ${u.protocol}//${u.hostname}` });
        }
      } catch {
        return res.status(400).json({ forwarded: false, error: 'Malformed webhookUrl' });
      }
    }
    try {
      await httpFetch(targetUrl, {
        timeoutMs: TIMEOUTS.WEBHOOK,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `🚨 **[Aloy Alert: ${title || 'Notification'}]**\n${message}` })
      });
      res.json({ forwarded: true });
    } catch (err) {
      res.status(500).json({ forwarded: false, error: err.message });
    }
  });

  app.post('/api/system/gpu-purge', async (req, res) => {
    try {
      // The conversational model is deliberately EXCLUDED by default.
      //
      // streamChat now pins it in VRAM (keep_alive) precisely so the first
      // request after a quiet period doesn't pay a multi-second cold load —
      // which is the worst latency in the voice loop and the moment
      // responsiveness matters most. Purging it here would undo that on every
      // call and reintroduce the stall.
      //
      // Pass { "includeChatModel": true } for Gaming Mode, where reclaiming
      // every last MB of VRAM genuinely does outrank assistant latency.
      const includeChat = req.body?.includeChatModel === true;
      const secondaryModels = [MODELS.CODER, MODELS.MULTIMODAL, MODELS.VISION];
      const models = includeChat ? [...secondaryModels, DEFAULT_MODEL] : secondaryModels;
      for (const m of models) {
        try {
          await httpFetch('http://localhost:11434/api/generate', {
            timeoutMs: TIMEOUTS.PROBE,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: m, keep_alive: 0 })
          });
        } catch {}
      }
      res.json({
        success: true,
        purged: models,
        chatModelKept: !includeChat ? DEFAULT_MODEL : null,
        message: includeChat
          ? 'All models unloaded, including the conversational model.'
          : `Secondary models unloaded. ${DEFAULT_MODEL} kept resident for response latency — pass includeChatModel:true to purge it too.`
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/system/gpu-stats', async (_req, res) => {
    try {
      const { exec } = require('child_process');
      exec('nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits', { timeout: 3000 }, (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          const os = require('os');
          return res.json({
            available: false,
            name: 'System RAM',
            gpuUtilPct: 0,
            vramUsedMb: Math.round((os.totalmem() - os.freemem()) / (1024 * 1024)),
            vramTotalMb: Math.round(os.totalmem() / (1024 * 1024)),
            tempC: null
          });
        }
        const parts = stdout.trim().split(',').map(s => s.trim());
        res.json({
          available: true,
          name: parts[0] || 'NVIDIA GPU',
          gpuUtilPct: parseInt(parts[1], 10) || 0,
          vramUsedMb: parseInt(parts[2], 10) || 0,
          vramTotalMb: parseInt(parts[3], 10) || 0,
          tempC: parseInt(parts[4], 10) || null
        });
      });
    } catch (err) {
      res.status(500).json({ available: false, error: err.message });
    }
  });

  // ==========================================
  // REMOTE MACHINES BRIDGE (Bazzite, Lenny, etc.)
  // ==========================================
  const {
    getMachineStatus,
    getAllMachinesStatus,
    executeRemoteCommand,
    launchRemoteTerminal,
    getBazziteStatus,
    executeBazziteCommand,
    launchBazziteTerminal
  } = require('./bazziteBridge.cjs');

  app.get('/api/remote-machines/status', async (_req, res) => {
    try {
      const data = await getAllMachinesStatus();
      res.json({ success: true, ...data });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/remote-machines/:machineId/status', async (req, res) => {
    try {
      const status = await getMachineStatus(req.params.machineId);
      res.json({ success: true, status });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/remote-machines/exec', async (req, res) => {
    try {
      const { machineId, command, timeoutMs, elevated } = req.body || {};
      if (!command) return res.status(400).json({ success: false, error: 'Command is required' });
      // `elevated` asks the bridge to prepend sudo using a password held only
      // in the server environment; the client never sees or sends the secret.
      const result = await executeRemoteCommand(machineId || 'bazzite', command, timeoutMs || 20000, { elevated: !!elevated });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/remote-machines/launch-terminal', async (req, res) => {
    try {
      const { machineId } = req.body || {};
      const result = await launchRemoteTerminal(machineId || 'bazzite');
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Backward-compatible routes
  app.get('/api/bazzite/status', async (_req, res) => {
    try {
      const status = await getBazziteStatus();
      res.json({ success: true, status });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/bazzite/exec', async (req, res) => {
    try {
      const { command, timeoutMs } = req.body || {};
      if (!command) return res.status(400).json({ success: false, error: 'Command is required' });
      const result = await executeBazziteCommand(command, timeoutMs || 20000);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/bazzite/launch-terminal', async (_req, res) => {
    try {
      const result = await launchBazziteTerminal();
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // UNIVERSAL MEDIA DISPATCHER (Local, Bazzite, Lenny, Jellyfin, Cast)
  // ==========================================
  const {
    listPlaybackTargets,
    searchLocalMedia,
    dispatchMedia
  } = require('./mediaDispatcher.cjs');

  app.get('/api/media/targets', async (_req, res) => {
    try {
      const targets = await listPlaybackTargets(haCategories || {});
      res.json({ success: true, targets });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/media/library', (req, res) => {
    try {
      const { query, limit, category } = req.query;
      const results = searchLocalMedia(query, parseInt(limit, 10) || 1500, category || 'all');
      res.json({ success: true, results, count: results.length });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/media/dispatch', async (req, res) => {
    try {
      const { targetId, mediaPath, mediaTitle, itemId } = req.body || {};
      const result = await dispatchMedia({ targetId, mediaPath, mediaTitle, itemId });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // ROUTE INTELLIGENCE & NETWORK TRACE (NextTrace Engine)
  // ==========================================
  const { traceRoute } = require('./networkTrace.cjs');

  app.get('/api/network/trace', async (req, res) => {
    try {
      const { target, protocol, maxHops } = req.query;
      const result = await traceRoute(target || '1.1.1.1', {
        protocol: protocol || 'ICMP',
        maxHops: parseInt(maxHops, 10) || 15
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // LOCAL VOICE PIPELINE (Kokoro-TTS & Faster-Whisper)
  // ==========================================
  app.get('/api/voice/status', async (_req, res) => {
    try {
      const status = await globalVoiceBridge.getStatus();
      res.json({ success: true, ...status });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/voice/tts', async (req, res) => {
    try {
      const { text, voice, speed } = req.body || {};
      if (!text) return res.status(400).json({ error: 'text is required' });

      const result = await globalVoiceBridge.synthesizeSpeech(text, { voice, speed });
      if (!result.success) {
        return res.status(502).json({ success: false, error: result.error });
      }

      res.setHeader('Content-Type', result.contentType || 'audio/wav');
      res.setHeader('Content-Length', result.byteLength);
      res.send(result.audioBuffer);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/voice/stt', async (req, res) => {
    try {
      let audioBuffer = null;
      let mimeType = req.headers['content-type'] || 'audio/webm';

      if (Buffer.isBuffer(req.body)) {
        audioBuffer = req.body;
      } else if (req.body?.audioBase64) {
        audioBuffer = Buffer.from(req.body.audioBase64, 'base64');
        if (req.body.mimeType) mimeType = req.body.mimeType;
      }

      if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).json({ error: 'Audio data is missing or empty' });
      }

      const result = await globalVoiceBridge.transcribeAudio(audioBuffer, mimeType);
      if (!result.success) {
        return res.status(502).json({ success: false, error: result.error });
      }

      res.json({ success: true, text: result.text });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // VISION-GUIDED BROWSER AGENT (browser-use)
  // ==========================================
  app.post('/api/browser/navigate', async (req, res) => {
    try {
      const { url } = req.body || {};
      const result = await globalBrowserAgent.navigate(url);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/browser/action', async (req, res) => {
    try {
      const { action } = req.body || {};
      const result = await globalBrowserAgent.executeAction(action);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // PC TELEMETRY & SMART HOME BRIDGE (HASS.Agent)
  // ==========================================
  app.get('/api/telemetry/system', async (_req, res) => {
    try {
      const telemetry = await globalHassTelemetryBridge.getSystemTelemetry();
      const haSensors = globalHassTelemetryBridge.formatHomeAssistantSensors(telemetry);
      res.json({ success: true, telemetry, haSensors });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/telemetry/notify', async (req, res) => {
    try {
      const { title, message } = req.body || {};
      const result = await globalHassTelemetryBridge.sendWindowsNotification({ title, message });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // DUAL-LEVEL OBSIDIAN GRAPHRAG (LightRAG)
  // ==========================================
  app.post('/api/graphrag/query', (req, res) => {
    try {
      const { query } = req.body || {};
      const result = globalLightGraphRAG.queryGraph(query);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/graphrag/reindex', async (_req, res) => {
    try {
      const d = store.load();
      const facts = (d.memories || []).map(m => typeof m === 'string' ? m : (m.fact || m.text || ''));
      const stats = await globalLightGraphRAG.buildKnowledgeGraph(facts);
      res.json({ success: true, ...stats });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // WEARABLE & HEALTH CONNECT (Zepp / Amazfit)
  // ==========================================
  app.post('/api/health/sync', (req, res) => {
    try {
      const metrics = req.body || {};
      const updated = globalHealthBridge.ingestHealthData(metrics);
      res.json({ success: true, healthMetrics: updated });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/health/summary', (_req, res) => {
    try {
      const summary = globalHealthBridge.getHealthSummary();
      res.json({ success: true, ...summary });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/zepp/sync-ha', async (req, res) => {
    try {
      const metrics = req.body || {};
      const result = await globalZeppSyncEngine.syncAndPublish(metrics);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // ROOM OBSERVER & AMBIENT VISION PIPELINE
  // ==========================================
  app.get('/api/observer/observations', (_req, res) => {
    try {
      const d = store.load();
      res.json({
        success: true,
        observations: d.ambientObservations || [],
        lastUpdated: d.lastObservationAt || null
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/observer/latest', (_req, res) => {
    try {
      const d = store.load();
      const obs = (d.ambientObservations || [])[0] || null;
      res.json({
        success: true,
        observation: obs,
        deskStatus: obs ? (obs.badge || 'Online') : 'Ready',
        timestamp: obs?.timestamp || null
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/observer/log', (req, res) => {
    try {
      const observation = req.body || {};
      if (!observation.text && !observation.badge) {
        return res.status(400).json({ error: 'Valid observation object required' });
      }
      const d = store.load();
      const existing = d.ambientObservations || [];
      const updated = [observation, ...existing.filter((o) => o.id !== observation.id)].slice(0, 30);
      d.ambientObservations = updated;
      d.lastObservationAt = observation.timestamp || new Date().toISOString();
      store.save(d);

      // Append to disk log as well
      try {
        const logFile = path.join(STORAGE_DIR, 'observations.log.jsonl');
        fs.appendFileSync(logFile, JSON.stringify(observation) + '\n', 'utf8');
      } catch {}

      res.json({ success: true, observation, count: updated.length });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/memories', (_req, res) => res.json(store.load().memories));
  app.get('/api/learned-knowledge', (_req, res) => res.json(store.load().learnedKnowledge || []));
  app.get('/api/lessons', (_req, res) => res.json(store.load().lessons || []));
  app.get('/api/skills-dashboard', async (_req, res) => res.json(await getSkillsDashboard()));
  // Manual "run tonight's batch early" escape hatch — the nightly scheduler
  // below handles this automatically; no current UI calls this directly.
  app.post('/api/skills-dashboard/auto-resolve', async (_req, res) => {
    const { runNightlyAutoTeaching } = require('./skillsDashboard.cjs');
    try {
      const result = await runNightlyAutoTeaching();
      res.json({ success: true, ...result, dashboard: await getSkillsDashboard() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  app.delete('/api/learned-knowledge/:id', (req, res) => {
    const d = store.load();
    const id = req.params.id;
    d.learnedKnowledge = (d.learnedKnowledge || []).filter((k) => k.id !== id);
    store.save(d);
    res.json({ success: true, learnedKnowledge: d.learnedKnowledge });
  });
  app.delete('/api/escalations/:timestamp', (req, res) => {
    const d = store.load();
    const ts = decodeURIComponent(req.params.timestamp);
    d.claudeEscalations = (d.claudeEscalations || []).filter((e) => e.timestamp !== ts && e.id !== ts);
    store.save(d);
    res.json({ success: true, claudeEscalations: d.claudeEscalations });
  });
  app.post('/api/memories', (req, res) => {
    const d = store.load();
    d.memories.push(req.body.text);
    store.save(d);
    res.json(d.memories);
  });
  app.put('/api/vault', (req, res) => {
    // The traversal guard on note creation correctly pins each note inside
    // vaultDir — but it cannot help when vaultDir ITSELF is chosen by the
    // request. Point this at a Startup folder and every subsequent
    // create_obsidian_note writes there. Validate the root the same way every
    // other filesystem write is validated.
    const requested = req.body?.vaultDir;
    const check = validatePathAccess(requested, true);
    if (!check.allowed) {
      logAuditEvent({
        category: 'filesystem', action: 'vault_root_rejected', target: String(requested || ''),
        status: 'denied', details: check.reason
      });
      return res.status(403).json({ error: `Vault directory rejected: ${check.reason}` });
    }
    const d = store.load();
    d.vaultDir = check.normalizedPath || requested;
    store.save(d);
    logAuditEvent({ category: 'filesystem', action: 'vault_root_set', target: d.vaultDir });
    res.json({ vaultDir: d.vaultDir });
  });

  return new Promise((resolve) => {
    const srv = app.listen(port, '0.0.0.0', () => {
      console.log(`Aloy server listening on 0.0.0.0:${port}`);
      try {
        const { syncToVault } = require('./vaultSync.cjs');
        syncToVault();
      } catch (err) {
        console.warn('[server] Initial vault sync warning:', err.message);
      }
      try {
        const { jellyfinService } = require('./jellyfinService.cjs');
        jellyfinService.startWebSocket();
      } catch (err) {
        console.warn('[server] Jellyfin WebSocket auto-start warning:', err.message);
      }
      resolve(srv);
    });
  });
}

process.on('uncaughtException', (err) => {
  console.error('Aloy server uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Aloy server unhandledRejection:', reason);
});

module.exports = { startAloyServer };

if (require.main === module) {
  startAloyServer();
}
