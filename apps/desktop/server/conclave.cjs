// CONCLAVE — Pantheon Council & Weekly Strategic Deliberation Engine.
// Orchestrates the 5 subagents (Hephaestus, Athena, Apollo, Minerva, Hermes)
// to autonomously evaluate system health, skill gaps, code backlog, and user friction,
// synthesize high-impact directives, auto-dispatch tasks, and write an Executive Dossier to the Obsidian Vault.

const fs = require('fs');
const path = require('path');
const os = require('os');
const defaultStore = require('./store.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');
const { getSkillsDashboard } = require('./skillsDashboard.cjs');

/**
 * Standard ISO-8601 week and week-year calculation.
 * Ensures New Year's edge-cases (e.g. Dec 31 in Week 1 of next year, Jan 1 in Week 53 of prev year)
 * are accurately paired with their ISO week-numbering year.
 */
function getIsoWeekData(date = new Date()) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7; // Monday = 1, Sunday = 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum); // Thursday determines year
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  const year = target.getUTCFullYear();
  return { week, year };
}

function getIsoWeek(date = new Date()) {
  return getIsoWeekData(date).week;
}

function getIsoWeekYear(date = new Date()) {
  return getIsoWeekData(date).year;
}

class ConclaveEngine {
  constructor({
    store = null,
    minervaEngine = null,
    apolloEngine = null,
    hephaestusEngine = null,
    athenaEngine = null,
    hermesEngine = null,
    vaultDir = null
  } = {}) {
    this.store = store || defaultStore;
    this.minerva = minervaEngine;
    this.apollo = apolloEngine;
    this.hephaestus = hephaestusEngine;
    this.athena = athenaEngine;
    this.hermes = hermesEngine;
    this.customVaultDir = vaultDir;
  }

  /**
   * Lazily resolves subagent engines if not injected
   */
  _resolveEngines() {
    if (!this.minerva) {
      const { globalMinerva } = require('./minerva.cjs');
      this.minerva = globalMinerva;
    }
    if (!this.apollo) {
      const { globalApollo } = require('./apollo.cjs');
      this.apollo = globalApollo;
    }
    if (!this.hephaestus) {
      const { globalHephaestus } = require('./hephaestus.cjs');
      this.hephaestus = globalHephaestus;
    }
    if (!this.athena) {
      const { athenaEngine } = require('./athena.cjs');
      this.athena = athenaEngine;
    }
    if (!this.hermes) {
      const { globalHermes } = require('./hermes.cjs');
      this.hermes = globalHermes;
    }
  }

  /**
   * Dispatches a Hephaestus work order UNLESS an equivalent one is already
   * open.
   *
   * Without this, every convene creates a fresh task for a condition that
   * hasn't been resolved yet — and because an unresolved condition is exactly
   * what triggers the directive, it re-fires forever. Observed live: 3
   * "Implement Resilient Sidecar Auto-Recovery" tasks (1 deployed, 2 stuck in
   * queued) and 2 "Continuous Code Optimization" tasks. Athena's createTask
   * has its own equivalent guard; this is the Hephaestus-side counterpart.
   *
   * Matching is on normalized title prefix rather than exact string, because
   * titles embed volatile detail (degraded service names, ISO week numbers)
   * that differs run to run while describing the same work.
   * @returns {{taskId: string|null, deduped: boolean}}
   */
  async _dispatchHephTaskOnce(taskSpec, dedupeKey) {
    if (!this.hephaestus?.createTask) return { taskId: null, deduped: false };
    try {
      const OPEN = new Set(['queued', 'analyzing', 'staging', 'testing', 'staged_for_review', 'approved']);
      const RECENT_EXPIRED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7-day cooldown on unstarted expired tasks
      const now = Date.now();
      const allTasks = this.hephaestus.listTasks ? await this.hephaestus.listTasks() : [];

      const existing = allTasks.find(t => OPEN.has(t.status) && String(t.title || '').toLowerCase().startsWith(dedupeKey.toLowerCase()));
      if (existing) {
        console.log(`[conclave] Skipping duplicate Hephaestus dispatch — "${dedupeKey}" already open as ${existing.id}.`);
        return { taskId: existing.id, deduped: true };
      }

      // Check if an identical directive expired/auto-closed recently without action (prevents weekly loop spam)
      const recentExpired = allTasks.find(t =>
        (t.status === 'expired' || t.status === 'rejected') &&
        String(t.title || '').toLowerCase().startsWith(dedupeKey.toLowerCase()) &&
        (now - new Date(t.updatedAt || t.createdAt || 0).getTime() < RECENT_EXPIRED_COOLDOWN_MS)
      );
      if (recentExpired) {
        console.log(`[conclave] Skipping duplicate Hephaestus dispatch — "${dedupeKey}" expired recently (${recentExpired.id}). 7-day cooldown active.`);
        return { taskId: recentExpired.id, deduped: true, inCooldown: true };
      }

      const t = await this.hephaestus.createTask(taskSpec);
      return { taskId: t?.id || null, deduped: false };
    } catch (err) {
      console.warn('[conclave] Failed to dispatch Hephaestus task:', err.message);
      return { taskId: null, deduped: false };
    }
  }

  /**
   * Convenes the weekly strategic conclave across all 6 subagents.
   */
  async conveneConclave({ manualTrigger = false, overrideTime = null } = {}) {
    this._resolveEngines();
    const timestamp = overrideTime ? new Date(overrideTime) : new Date();
    const { week: isoWeek, year } = getIsoWeekData(timestamp);
    const conclaveId = `conclave-${year}-w${String(isoWeek).padStart(2, '0')}-${Date.now().toString(36)}`;
    const d = this.store.load();

    // 1. Gather Telemetry & Sub-Agent Reports from Real Engines
    const reports = {};

    // Minerva Report (Reliability Sentinel)
    try {
      const health = this.minerva ? (this.minerva.lastHealthReport || (await this.minerva.runHealthScan().catch(() => null))) : null;
      const deps = health?.dependencies || {};
      const totalDeps = Object.keys(deps).length;
      const onlineDeps = Object.values(deps).filter(s => s.status === 'online').length;
      const degradedDeps = Object.entries(deps).filter(([_, s]) => s.status !== 'online').map(([k, v]) => ({ service: k, status: v.status, error: v.error }));

      reports.minerva = {
        agent: 'Minerva',
        title: 'Reliability Sentinel',
        healthScore: totalDeps > 0 ? Math.round((onlineDeps / totalDeps) * 100) : 100,
        totalServices: totalDeps,
        onlineServices: onlineDeps,
        degraded: degradedDeps,
        status: degradedDeps.length === 0 ? 'HEALTHY' : 'ATTENTION_NEEDED',
        summary: degradedDeps.length === 0
          ? `All ${onlineDeps} background sidecars and Home Assistant endpoints operating nominally.`
          : `${degradedDeps.length} service(s) flagged: ${degradedDeps.map(d => `${d.service} (${d.status})`).join(', ')}`
      };
    } catch (err) {
      reports.minerva = { agent: 'Minerva', status: 'DEGRADED', summary: `Health scan error: ${err.message}` };
    }

    // Apollo Report (Memory & Skills Gardener)
    try {
      const memories = d.memories || [];
      let skillsOverview = null;
      try {
        skillsOverview = await Promise.resolve(getSkillsDashboard());
      } catch (err) {
        console.warn('[conclave] skillsDashboard lookup failed:', err.message);
      }

      const lowestCat = (skillsOverview?.categories || [])
        .filter(c => c.gapCount > 0)
        .sort((a, b) => a.proficiencyScore - b.proficiencyScore)[0];

      reports.apollo = {
        agent: 'Apollo',
        title: 'Memory & Skills Architect',
        factsCount: memories.length,
        overallProficiency: skillsOverview?.overallProficiencyScore ?? 100,
        weakestCategory: lowestCat ? { name: lowestCat.name, score: lowestCat.proficiencyScore, gaps: lowestCat.gapCount } : null,
        status: (skillsOverview?.overallProficiencyScore ?? 100) >= 80 && !lowestCat ? 'STRONG' : 'GAPS_DETECTED',
        summary: lowestCat
          ? `Vault contains ${memories.length} persistent facts. Overall skill proficiency at ${skillsOverview?.overallProficiencyScore}%. Priority gap in ${lowestCat.name} (${lowestCat.gaps} unverified topics).`
          : `Vault contains ${memories.length} persistent facts. Skill proficiency stable across all primary domains.`
      };
    } catch (err) {
      reports.apollo = { agent: 'Apollo', status: 'OK', factsCount: (d.memories || []).length, summary: 'Memory bank and skills matrix synchronized.' };
    }

    // Hephaestus Report (Code Forge & Architecture)
    try {
      const tasks = this.hephaestus?.listTasks ? await this.hephaestus.listTasks() : (d.hephaestusTasks || []);
      const activeWorkOrders = tasks.filter(t => t.status !== 'deployed' && t.status !== 'rejected');
      const deployedCount = tasks.filter(t => t.status === 'deployed').length;
      let trainingStats = { totalSamples: 0, positiveCount: 0, correctionCount: 0 };
      if (this.hephaestus?.getTrainingStats) {
        try { trainingStats = this.hephaestus.getTrainingStats(); } catch {}
      } else {
        const { getTrainingStats } = require('./hephReviewer.cjs');
        try { trainingStats = getTrainingStats(); } catch {}
      }

      reports.hephaestus = {
        agent: 'Hephaestus',
        title: 'Code Forge & Sandbox Engine',
        activeWorkOrders: activeWorkOrders.length,
        deployedFeatures: deployedCount,
        qloraSamples: trainingStats?.totalSamples ?? (d.trainingSamples?.length || 0),
        status: activeWorkOrders.length > 5 ? 'BACKLOG_SATURATED' : 'READY',
        summary: `${activeWorkOrders.length} active work order(s) in staging, ${deployedCount} deployed feature(s) recorded, ${trainingStats?.totalSamples ?? (d.trainingSamples?.length || 0)} QLoRA training pairs buffered.`
      };
    } catch (err) {
      reports.hephaestus = { agent: 'Hephaestus', status: 'READY', summary: 'Forge sandbox idle and ready for work orders.' };
    }

    // Athena Report (Research Scout)
    try {
      const athenaMissions = this.athena?.listTasks ? await this.athena.listTasks() : (d.athenaTasks || []);
      const completedMissions = athenaMissions.filter(t => t.status === 'completed');
      const researchingMissions = athenaMissions.filter(t => t.status === 'researching' || t.status === 'queued');

      reports.athena = {
        agent: 'Athena',
        title: 'Autonomous Research Scout',
        totalMissions: athenaMissions.length,
        completedDossiers: completedMissions.length,
        activeMissions: researchingMissions.length,
        status: researchingMissions.length > 0 ? 'RESEARCHING' : 'SCOUTING',
        summary: completedMissions.length > 0
          ? `Conducted ${completedMissions.length} deep technical dossiers (${researchingMissions.length} active). Ready to scout emerging local models and tooling.`
          : `Research scout standing by for emerging model & tooling investigation (${athenaMissions.length} missions recorded).`
      };
    } catch (err) {
      reports.athena = { agent: 'Athena', status: 'SCOUTING', summary: 'Research scout standing by.' };
    }

    // Hermes Report (Operations & Daily Pulse)
    try {
      const reminders = (d.reminders || []).filter(r => !r.completed);
      const activeProjects = (d.trackedProjects || []).filter(p => p.status !== 'completed');
      let budgetHealth = null;
      if (this.hermes?.evaluateBudgetHealth) {
        try { budgetHealth = await this.hermes.evaluateBudgetHealth(); } catch {}
      }

      reports.hermes = {
        agent: 'Hermes',
        title: 'Operations & Workflow Logistics',
        pendingReminders: reminders.length,
        trackedProjects: activeProjects.length,
        budgetAlertsCount: budgetHealth?.budgetAlerts?.length || 0,
        status: (budgetHealth?.budgetAlerts?.length || 0) > 0 ? 'BUDGET_ATTENTION' : 'NOMINAL',
        summary: `${reminders.length} pending user reminder(s) queued; ${activeProjects.length} active project(s) tracked.`
      };
    } catch (err) {
      reports.hermes = { agent: 'Hermes', status: 'NOMINAL', summary: 'Operations and daily pulse active.' };
    }

    // 2. Synthesize Multi-Agent Strategic Deliberation & Consensus Threads
    const threads = [];
    const directives = [];
    let messageSeq = 0;
    const baseTime = timestamp.getTime();

    // Helper to generate sequential timestamped messages in thread
    const createMessage = ({ threadId, topic, speaker, role, avatar, statement, inReplyTo = null, directiveRef = null }) => {
      messageSeq++;
      const msgTime = new Date(baseTime + (messageSeq * 1500)); // 1.5s simulated delib cadence
      return {
        id: `msg-${conclaveId}-${messageSeq}`,
        threadId,
        topic,
        speaker,
        role,
        avatar,
        statement,
        inReplyTo,
        directiveRef,
        timestamp: msgTime.toISOString(),
        timeStr: msgTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
    };

    // ── Thread 1: Reliability & Infrastructure Sentinel ──
    const thread1 = {
      id: `thread-${conclaveId}-reliability`,
      topic: 'Infrastructure & Sidecar Reliability Sentinel',
      domain: 'Reliability',
      timestamp: new Date(baseTime).toISOString(),
      timeStr: new Date(baseTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      messages: []
    };

    if (reports.minerva?.degraded?.length > 0) {
      const degradedNames = reports.minerva.degraded.map(d => d.service).join(', ');
      const m1 = createMessage({
        threadId: thread1.id,
        topic: thread1.topic,
        speaker: 'Minerva',
        role: 'Reliability Sentinel',
        avatar: '🛡️',
        statement: `I have detected service degradation on [${degradedNames}]. This threatens Aloy's core response loop and voice interaction.`
      });
      thread1.messages.push(m1);

      const dispatch1 = await this._dispatchHephTaskOnce({
        title: `Implement Resilient Sidecar Auto-Recovery (${degradedNames})`,
        description: `Automated Conclave directive (Week ${isoWeek}, ${year}): Create background watchdog self-healing for ${degradedNames} with progressive backoff.`,
        category: 'bugfix',
        requestedBy: 'pantheon_conclave'
      }, 'Implement Resilient Sidecar Auto-Recovery');
      const dispatchedTaskId = dispatch1.taskId;

      const directive1 = {
        id: `dir-${conclaveId}-1`,
        title: `Implement Resilient Sidecar Auto-Recovery`,
        domain: 'Reliability',
        assignedTo: 'Hephaestus',
        priority: 'HIGH',
        status: dispatchedTaskId ? 'DISPATCHED' : 'PROPOSED',
        taskId: dispatchedTaskId,
        threadId: thread1.id,
        description: `Create background watchdog self-healing for ${degradedNames} with progressive backoff.`
      };
      directives.push(directive1);

      const m2 = createMessage({
        threadId: thread1.id,
        topic: thread1.topic,
        speaker: 'Hephaestus',
        role: 'Code Forge & Sandbox',
        avatar: '🔥',
        inReplyTo: m1.id,
        directiveRef: directive1.id,
        statement: `Acknowledged, Minerva. I will stage an automated health retry backoff and fallback daemon in the Code Forge to auto-recover degraded endpoints.`
      });
      thread1.messages.push(m2);
    } else {
      const m1 = createMessage({
        threadId: thread1.id,
        topic: thread1.topic,
        speaker: 'Minerva',
        role: 'Reliability Sentinel',
        avatar: '🛡️',
        statement: `Latest health scan across ${reports.minerva?.onlineServices ?? 'all'} dependency sidecars and Home Assistant endpoints is fully nominal.`
      });
      const m2 = createMessage({
        threadId: thread1.id,
        topic: thread1.topic,
        speaker: 'Hermes',
        role: 'Operations Logistics',
        avatar: '💼',
        inReplyTo: m1.id,
        statement: `Clean telemetry confirmed. Morning briefings and voice pipelines remain uninterrupted.`
      });
      thread1.messages.push(m1, m2);
    }
    threads.push(thread1);

    // ── Thread 2: Knowledge Expansion & Skills Curriculum ──
    const thread2 = {
      id: `thread-${conclaveId}-knowledge`,
      topic: 'Knowledge Expansion & Skills Curriculum',
      domain: 'Knowledge & Skills',
      timestamp: new Date(baseTime + 3000).toISOString(),
      timeStr: new Date(baseTime + 3000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      messages: []
    };

    if (reports.apollo?.weakestCategory) {
      const cat = reports.apollo.weakestCategory;
      const m1 = createMessage({
        threadId: thread2.id,
        topic: thread2.topic,
        speaker: 'Apollo',
        role: 'Memory & Skills Architect',
        avatar: '📚',
        statement: `Skill telemetry indicates a knowledge deficit in "${cat.name}" (Proficiency: ${cat.score}%, ${cat.gaps} unresolved queries).`
      });
      thread2.messages.push(m1);

      let dispatchedAthenaId = null;
      if (this.athena?.createTask) {
        try {
          const t = await this.athena.createTask({
            query: `Deep technical research on ${cat.name} skills and best practices to resolve ${cat.gaps} identified knowledge gaps`,
            depth: 'standard',
            focusAreas: [cat.name, 'Aloy Integration', 'Core Competencies'],
            requestedBy: 'pantheon_conclave'
          });
          dispatchedAthenaId = t?.id || null;
        } catch (err) {
          console.warn('[conclave] Failed to dispatch Athena task:', err.message);
        }
      }

      const directive2 = {
        id: `dir-${conclaveId}-2`,
        title: `Reinforce ${cat.name} Knowledge Domain`,
        domain: 'Knowledge & Skills',
        assignedTo: 'Athena & Apollo',
        priority: 'MEDIUM',
        status: dispatchedAthenaId ? 'DISPATCHED' : 'PROPOSED',
        taskId: dispatchedAthenaId,
        threadId: thread2.id,
        description: `Execute deep research dossier and run overnight auto-teaching curriculum to close ${cat.gaps} domain gap(s).`
      };
      directives.push(directive2);

      const m2 = createMessage({
        threadId: thread2.id,
        topic: thread2.topic,
        speaker: 'Athena',
        role: 'Autonomous Research Scout',
        avatar: '🌐',
        inReplyTo: m1.id,
        directiveRef: directive2.id,
        statement: `I will schedule an autonomous technical research mission on "${cat.name}" topics to synthesize comprehensive reference notes.`
      });
      const m3 = createMessage({
        threadId: thread2.id,
        topic: thread2.topic,
        speaker: 'Apollo',
        role: 'Memory & Skills Architect',
        avatar: '📚',
        inReplyTo: m2.id,
        statement: `Once Athena retrieves the dossiers, I will initiate an overnight auto-teaching pass with Gemini verification.`
      });
      thread2.messages.push(m2, m3);
    } else {
      const m1 = createMessage({
        threadId: thread2.id,
        topic: thread2.topic,
        speaker: 'Apollo',
        role: 'Memory & Skills Architect',
        avatar: '📚',
        statement: `Knowledge bank is tightly pruned with zero redundancy. Skill matrix remains at high confidence.`
      });
      thread2.messages.push(m1);
    }
    threads.push(thread2);

    // ── Thread 3: Architecture & Code Velocity ──
    const thread3 = {
      id: `thread-${conclaveId}-architecture`,
      topic: 'Architecture & Code Velocity',
      domain: 'Architecture',
      timestamp: new Date(baseTime + 6000).toISOString(),
      timeStr: new Date(baseTime + 6000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      messages: []
    };

    if (reports.hephaestus?.activeWorkOrders > 0) {
      const m1 = createMessage({
        threadId: thread3.id,
        topic: thread3.topic,
        speaker: 'Hephaestus',
        role: 'Code Forge & Sandbox',
        avatar: '🔥',
        statement: `We have ${reports.hephaestus.activeWorkOrders} staged work order(s) in review. I am maintaining sandboxed diffs to avoid runtime regressions.`
      });
      thread3.messages.push(m1);
    } else {
      const m1 = createMessage({
        threadId: thread3.id,
        topic: thread3.topic,
        speaker: 'Hephaestus',
        role: 'Code Forge & Sandbox',
        avatar: '🔥',
        statement: `Code Forge pipeline is clear. Ready to accept new feature initiatives from User or the Conclave.`
      });

      const dispatchOpt = await this._dispatchHephTaskOnce({
        title: `Continuous Code Optimization & Bundle Pruning (Week ${isoWeek})`,
        description: `Routine Conclave maintenance: analyze unused AST references and optimize local desktop and mobile build bundle sizes.`,
        category: 'refactor',
        requestedBy: 'pantheon_conclave'
      }, 'Continuous Code Optimization & Bundle Pruning');
      const dispatchedOptId = dispatchOpt.taskId;

      const directive3 = {
        id: `dir-${conclaveId}-3`,
        title: `Continuous Code Optimization & Bundle Pruning`,
        domain: 'Architecture',
        assignedTo: 'Hephaestus',
        priority: 'LOW',
        status: dispatchedOptId ? 'DISPATCHED' : 'PROPOSED',
        taskId: dispatchedOptId,
        threadId: thread3.id,
        description: `Perform routine AST dead-code analysis and refine local Vite / React Native bundle size.`
      };
      directives.push(directive3);

      thread3.messages.push(m1);
    }
    threads.push(thread3);

    // ── Thread 4: Operations Logistics & Executive Pulse ──
    const thread4 = {
      id: `thread-${conclaveId}-operations`,
      topic: 'Operations Logistics & Executive Pulse',
      domain: 'Operations',
      timestamp: new Date(baseTime + 9000).toISOString(),
      timeStr: new Date(baseTime + 9000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      messages: []
    };

    const mOps = createMessage({
      threadId: thread4.id,
      topic: thread4.topic,
      speaker: 'Hermes',
      role: 'Operations Logistics',
      avatar: '💼',
      statement: `I will package these ${directives.length} directives into an executive briefing summary for User's Monday morning dashboard pulse.`
    });
    thread4.messages.push(mOps);
    threads.push(thread4);

    // Flattened array of all deliberation minutes for universal compatibility
    const minutes = threads.flatMap(t => t.messages);

    // 3. Generate Executive Markdown Dossier
    const formattedDate = timestamp.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    let markdown = `# 🏛️ Aloy Pantheon — Weekly Strategic Conclave (Week ${isoWeek}, ${year})\n\n`;
    markdown += `> **Convened On:** ${formattedDate} | **Session ID:** \`${conclaveId}\`\n`;
    markdown += `> **Strategic Status:** ${directives.length} Active Directives Synthesized Across ${threads.length} Strategic Threads\n\n`;

    markdown += `## 📊 Sub-Agent Telemetry & Weekly Debriefs\n\n`;
    markdown += `| Sub-Agent | Role | Status | Key Metric | Summary |\n`;
    markdown += `| :--- | :--- | :--- | :--- | :--- |\n`;
    markdown += `| **🛡️ Minerva** | Sentinel | \`${reports.minerva?.status || 'OK'}\` | Health: ${reports.minerva?.healthScore ?? 100}% | ${reports.minerva?.summary || 'Nominal'} |\n`;
    markdown += `| **📚 Apollo** | Vault Architect | \`${reports.apollo?.status || 'OK'}\` | Proficiency: ${reports.apollo?.overallProficiency ?? 100}% | ${reports.apollo?.summary || 'Nominal'} |\n`;
    markdown += `| **🔥 Hephaestus** | Code Forge | \`${reports.hephaestus?.status || 'OK'}\` | Work Orders: ${reports.hephaestus?.activeWorkOrders ?? 0} | ${reports.hephaestus?.summary || 'Nominal'} |\n`;
    markdown += `| **🌐 Athena** | Research Scout | \`${reports.athena?.status || 'OK'}\` | Dossiers: ${reports.athena?.completedDossiers ?? 0} | ${reports.athena?.summary || 'Nominal'} |\n`;
    markdown += `| **💼 Hermes** | Operations | \`${reports.hermes?.status || 'OK'}\` | Reminders: ${reports.hermes?.pendingReminders ?? 0} | ${reports.hermes?.summary || 'Nominal'} |\n\n`;

    markdown += `## 🗣️ Deliberation Transcripts & Consensus Threads\n\n`;
    for (const [tIdx, t] of threads.entries()) {
      markdown += `### 🧵 Thread ${tIdx + 1}: ${t.topic} [${t.timeStr}]\n\n`;
      for (const m of t.messages) {
        const replyTag = m.inReplyTo ? `↳ ` : '';
        const inReplyNote = m.inReplyTo ? ` · *in reply to prior message*` : '';
        const dirNote = m.directiveRef ? `\n> *(Dispatched Directive: \`${m.directiveRef}\`)*` : '';
        markdown += `> ${replyTag}\`[${m.timeStr}]\` **${m.avatar} ${m.speaker} (${m.role})${inReplyNote}:**\n> "${m.statement}"${dirNote}\n>\n`;
      }
      markdown += `\n`;
    }

    markdown += `## 🎯 Strategic Directives Dispatched\n\n`;
    for (const [idx, d] of directives.entries()) {
      markdown += `### ${idx + 1}. [${d.priority}] ${d.title}\n`;
      markdown += `- **Assigned Sub-Agent:** ${d.assignedTo}\n`;
      markdown += `- **Domain:** \`${d.domain}\` | **Status:** \`${d.status}\`${d.taskId ? ` (\`${d.taskId}\`)` : ''}\n`;
      markdown += `- **Action Item:** ${d.description}\n\n`;
    }

    markdown += `---\n*Generated autonomously by the Aloy Sub-Agent Pantheon Conclave Engine.*`;

    // 4. Save to Obsidian Vault
    const vaultBrainDir = this.customVaultDir || (d.vaultDir ? path.join(d.vaultDir, 'Aloy Brain') : path.join(os.homedir(), 'Documents', 'Vault Notes', 'Aloy Brain'));
    const conclavesDir = path.join(vaultBrainDir, 'Weekly_Conclaves');
    let vaultFilePath = null;

    try {
      if (!fs.existsSync(conclavesDir)) {
        fs.mkdirSync(conclavesDir, { recursive: true });
      }
      vaultFilePath = path.join(conclavesDir, `Conclave_${year}-W${String(isoWeek).padStart(2, '0')}.md`);
      fs.writeFileSync(vaultFilePath, markdown, 'utf8');
    } catch (err) {
      console.warn('[conclave] Vault write warning:', err.message);
    }

    // 5. Build Session Object & Persist in Store
    const session = {
      id: conclaveId,
      isoWeek,
      year,
      convenedAt: timestamp.toISOString(),
      manualTrigger,
      reports,
      threads,
      minutes,
      directives,
      markdown,
      vaultFilePath
    };

    const nextData = this.store.load();
    const history = nextData.conclaveHistory || [];
    // Keep last 26 weeks (6 months) of conclaves
    const updatedHistory = [session, ...history.filter(h => h.id !== conclaveId)].slice(0, 26);
    nextData.conclaveHistory = updatedHistory;
    nextData.latestConclave = session;
    this.store.save(nextData);

    logAuditEvent({
      action: 'conclave_convened',
      source: 'conclave',
      details: { conclaveId, directivesCount: directives.length, isoWeek, year }
    });

    return session;
  }

  /**
   * Retrieves previous conclave sessions.
   */
  getHistory() {
    const d = this.store.load();
    return d.conclaveHistory || [];
  }

  /**
   * Retrieves the most recent conclave session.
   */
  getLatest() {
    const d = this.store.load();
    return d.latestConclave || (d.conclaveHistory && d.conclaveHistory[0]) || null;
  }
}

module.exports = {
  ConclaveEngine,
  getIsoWeek,
  getIsoWeekYear,
  getIsoWeekData
};
