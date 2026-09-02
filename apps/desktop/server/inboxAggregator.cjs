// INBOX — cross-agent findings feed.
// Aggregates timestamped, already-existing background-agent activity (Athena
// research completions, Claude-assist escalations, Minerva/securityGuard
// security events) into one flat, time-windowed list. Grouping by agent and
// merging in client-side-only sources (Vision timeline, lock-unlock history)
// happens in the desktop UI — this module only does the parts that are
// already server-resident, so it stays reusable by mobile later without
// needing to also ship lockHistory/vision-fetch logic server-side.
const store = require('./store.cjs');
const { getRecentAuditLogs } = require('./auditLogger.cjs');

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

function getInboxFeed({ athenaEngine, globalMinerva, globalHephaestus, windowMs = DEFAULT_WINDOW_MS, loadStore = store.load }) {
  const cutoff = Date.now() - windowMs;
  const items = [];

  const d = loadStore();
  for (const e of d.claudeEscalations || []) {
    const t = new Date(e.timestamp).getTime();
    if (Number.isFinite(t) && t >= cutoff) {
      items.push({
        agent: 'Apollo',
        type: 'escalation',
        timestamp: e.timestamp,
        text: e.question
      });
    }
  }

  for (const task of athenaEngine.listTasks()) {
    if (task.status !== 'completed' || !task.completedAt) continue;
    const t = new Date(task.completedAt).getTime();
    if (Number.isFinite(t) && t >= cutoff) {
      items.push({
        agent: 'Athena',
        type: 'research',
        timestamp: task.completedAt,
        text: task.query
      });
    }
  }

  const securityStats = globalMinerva.getSecurityStats({ windowMs });
  for (const ev of securityStats.recent || []) {
    items.push({
      agent: 'Minerva',
      type: ev.category === 'security' ? 'injection-attempt' : 'blocked-access',
      timestamp: ev.timestamp,
      text: ev.category === 'security'
        ? `Blocked a suspected prompt-injection attempt${ev.target ? ` (${ev.target})` : ''}`
        : `Blocked a filesystem ${(ev.action || 'access').replace('_blocked', '')} outside the allowed path${ev.target ? ` (${ev.target})` : ''}`
    });
  }

  if (globalMinerva && typeof globalMinerva.getSelfHealEvents === 'function') {
    for (const ev of globalMinerva.getSelfHealEvents({ windowMs })) {
      items.push({
        agent: 'Minerva',
        type: 'self-healing',
        timestamp: ev.timestamp,
        text: `Auto-Healing Sentinel: ${ev.details || 'Recovered offline infrastructure services'}`
      });
    }
  }

  // Athena tasks stuck in `queued` are always anomalous, unlike Hephaestus's
  // — createTask immediately schedules executeTask via setImmediate, so a
  // healthy task should be in 'researching' within the same tick. A task
  // still sitting in `queued` means the process died in that exact window
  // before executeTask ever ran, which recoverStaleTasks' own sweep can't
  // catch (it only recognizes 'researching'/'synthesizing' as orphanable —
  // 'queued' isn't covered), so nothing else in the system will ever notice
  // or retry it. Found live 2026-08-24: a user-requested task sat 5 days.
  // Shown unconditionally, same ambient-alert shape as Hephaestus's below.
  for (const task of athenaEngine.listTasks()) {
    if (task.status === 'queued') {
      items.push({
        agent: 'Athena',
        type: 'stuck-research-task',
        timestamp: task.createdAt,
        text: `"${task.query}" has been queued since ${new Date(task.createdAt).toLocaleString()} and never started — this shouldn't happen under normal operation; likely orphaned by a server restart at the exact moment it was created.`
      });
    }
  }

  // Pantheon Council-dispatched Hephaestus work orders sitting in `queued`
  // never get automatically staged/reviewed — that only happens when a
  // human opens the Cauldron and generates a diff for them — so a Council
  // directive can silently sit for its whole life until it goes stale and
  // gets re-dispatched next convene (this recurred at least 3 times before
  // being noticed; see DECISIONS.md). Shown unconditionally, not gated by
  // `windowMs`, because "still queued" is itself the thing needing
  // attention regardless of when it was created — same ambient-alert shape
  // as Minerva's locksUnlocked.
  if (globalHephaestus) {
    for (const task of globalHephaestus.listTasks()) {
      if (task.status === 'queued' && task.requestedBy === 'pantheon_conclave') {
        items.push({
          agent: 'Hephaestus',
          type: 'stuck-work-order',
          timestamp: task.createdAt,
          text: `"${task.title}" is queued but hasn't been staged in the Cauldron yet — it'll auto-close as stale within 24h of creation if untouched.`
        });
      }
    }
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return { items, windowMs };
}

module.exports = { getInboxFeed, DEFAULT_WINDOW_MS };
