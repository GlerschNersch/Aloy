// HERMES — Autonomous Operations, Logistics & Daily Briefing Commander.
// Synthesizes daily morning briefings, categorizes transactions, monitors budget thresholds,
// and organizes schedules & pending tasks.

const defaultStore = require('./store.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');
const { fetchQuotes } = require('./stockTracker.cjs');
const { globalHealthBridge } = require('./healthBridge.cjs');
const { globalHermesPipeline, HermesScriptPipeline } = require('./hermesScriptPipeline.cjs');
const { globalHermesEvolution, HermesEvolutionEngine } = require('./hermesEvolutionEngine.cjs');
const { globalHermesMemory, HermesDialecticMemory } = require('./hermesDialecticMemory.cjs');
const { globalHermesGateway, HermesGateway } = require('./hermesGateway.cjs');

class HermesEngine {
  constructor(customStore = null) {
    this.store = customStore || defaultStore;
    this.pipeline = globalHermesPipeline;
    this.evolution = globalHermesEvolution;
    this.memory = globalHermesMemory;
    this.gateway = globalHermesGateway;
  }

  /**
   * Generates a structured, executive Daily Briefing.
   */
  async generateDailyBriefing({ userName = 'User' } = {}) {
    const d = this.store.load();
    const reminders = d.reminders || [];
    const transactions = d.transactions || [];
    const budgets = d.budgets || [];
    const now = new Date();

    // 1. Pending Reminders
    const pendingReminders = reminders.filter(r => !r.completed);

    // 2. Financial Pulse (current 30-day window or recent expenses)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentSpend = transactions
      .filter(t => {
        const isExpense = t.type === 'expense' || t.amount < 0;
        if (!isExpense) return false;
        if (t.date) return new Date(t.date) >= thirtyDaysAgo;
        return true;
      })
      .slice(-10);

    const totalSpentRecent = recentSpend.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    // 3. System activity
    const activeProjects = (d.trackedProjects || []).filter(p => p.status !== 'completed');

    // 4. Pantheon Strategic Conclave Directives
    const latestConclave = d.latestConclave || null;
    const conclaveDirectives = latestConclave?.directives || [];

    // 5. Job Radar Opportunities (Technical Writer & Content Dev)
    const { JobRadarEngine } = require('./jobRadar.cjs');
    const jobRadarEngine = new JobRadarEngine(this.store);
    const jobSummary = jobRadarEngine.getDailySummary();

    // 6. Wearable Health & Sleep Telemetry (Amazfit / Zepp / Health Connect)
    const healthSummary = globalHealthBridge.getHealthSummary();

    const brief = {
      generatedAt: now.toISOString(),
      userName,
      greeting: `Good day, ${userName}. Here is your operations pulse.`,
      sections: {
        health: {
          steps: healthSummary.steps,
          sleepDurationHours: healthSummary.sleepDurationHours,
          sleepScore: healthSummary.sleepScore,
          restingHeartRate: healthSummary.restingHeartRate,
          readinessScore: healthSummary.readinessScore,
          recoveryState: healthSummary.recoveryState,
          stressScore: healthSummary.stressScore,
          batteryLevel: healthSummary.batteryLevel
        },
        reminders: {
          totalPending: pendingReminders.length,
          items: pendingReminders.slice(0, 5).map(r => r.title || r.text || 'Untitled reminder')
        },
        finances: {
          recentTransactionCount: recentSpend.length,
          recentSpendTotal: parseFloat(totalSpentRecent.toFixed(2)),
          budgetStatus: budgets.length > 0 ? `${budgets.length} active budget categories` : 'No budget limits configured'
        },
        projects: {
          activeCount: activeProjects.length,
          items: activeProjects.slice(0, 3).map(p => p.name || p.title)
        },
        conclave: {
          hasDirectives: conclaveDirectives.length > 0,
          isoWeek: latestConclave?.isoWeek,
          directivesCount: conclaveDirectives.length,
          topDirectives: conclaveDirectives.slice(0, 3)
        },
        jobRadar: {
          totalFresh: jobSummary.totalFresh,
          techWriterCount: jobSummary.techWriterCount,
          contentDevCount: jobSummary.contentDevCount,
          topListings: jobSummary.topListings,
          lastScannedAt: jobSummary.lastScannedAt
        }
      },
      markdown: `# ☀️ Daily Operations Briefing — ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}\n\n` +
        `> **Good day, ${userName}**. All core background systems are synchronized.\n\n` +
        (healthSummary.sleepDurationHours != null || healthSummary.steps > 0
          ? `### 💤 Sleep & Physical Readiness\n` +
            `- **Sleep Duration:** ${healthSummary.sleepDurationHours || 'N/A'} hrs (Score: **${healthSummary.sleepScore || 'N/A'}/100**)\n` +
            `- **Resting Heart Rate:** ${healthSummary.restingHeartRate || 'N/A'} bpm • **Readiness:** ${healthSummary.readinessScore}/100 (*${healthSummary.recoveryState}*)\n` +
            `- **Activity So Far:** ${healthSummary.steps.toLocaleString()} steps\n\n`
          : '') +
        `### 📌 High Priority Items\n` +
        (pendingReminders.length > 0
          ? pendingReminders.slice(0, 5).map(r => `- [ ] ${r.title || r.text}`).join('\n')
          : `- *No pending reminders scheduled.*`) +
        `\n\n### 🎯 Daily Job Radar (Technical Writer & Content Dev)\n` +
        (jobSummary.totalFresh > 0
          ? `- **${jobSummary.totalFresh} fresh openings found today** (${jobSummary.techWriterCount} Technical Writer, ${jobSummary.contentDevCount} Content Dev).\n` +
            jobSummary.topListings.map(j => `  - **[${j.title}](${j.url})** at *${j.company}* (${j.location}) • \`${j.postedTimeStr}\``).join('\n')
          : `- *No new postings detected in the last scan pass. Run a scan anytime from the Job Radar panel.*`) +
        `\n\n### 💳 Financial Overview\n` +
        `- **30-Day Outflow:** $${totalSpentRecent.toFixed(2)} across ${recentSpend.length} transactions.\n` +
        `- **Budgets Monitored:** ${budgets.length}\n\n` +
        `### 📂 Tracked Projects\n` +
        (activeProjects.length > 0
          ? activeProjects.slice(0, 3).map(p => `- **${p.name || p.title}** (${p.status || 'in progress'})`).join('\n')
          : `- *No active project work orders.*`) +
        (conclaveDirectives.length > 0
          ? `\n\n### 🏛️ Weekly Pantheon Directives (Week ${latestConclave.isoWeek})\n` +
            conclaveDirectives.slice(0, 3).map(d => `- **[${d.priority}] ${d.title}** (${d.assignedTo}) — ${d.description}`).join('\n')
          : '')
    };

    logAuditEvent({
      action: 'hermes_daily_brief_generated',
      source: 'hermes',
      details: { pendingReminders: pendingReminders.length, activeProjects: activeProjects.length }
    });

    return brief;
  }

  getDailyBriefing(params) {
    return this.generateDailyBriefing(params);
  }

  /**
   * Categorizes transactions and evaluates monthly limits with robust threshold math.
   */
  evaluateBudgetHealth() {
    const d = this.store.load();
    const transactions = d.transactions || [];
    const budgets = d.budgets || [];

    const categorySpend = {};
    for (const tx of transactions) {
      if (tx.type === 'expense' || tx.amount < 0) {
        const cat = tx.category || 'Uncategorized';
        categorySpend[cat] = (categorySpend[cat] || 0) + Math.abs(tx.amount || 0);
      }
    }

    const budgetAlerts = [];
    for (const b of budgets) {
      const limit = typeof b.limit === 'number' && b.limit > 0
        ? b.limit
        : (typeof b.amount === 'number' && b.amount > 0 ? b.amount : null);

      if (limit === null) continue; // Skip unconfigured limit to avoid false $1 triggers

      const spent = categorySpend[b.category] || 0;
      const pct = (spent / limit) * 100;
      if (pct >= 85) {
        budgetAlerts.push({
          category: b.category,
          spent,
          limit,
          percent: parseFloat(pct.toFixed(1)),
          warning: pct >= 100 ? 'EXCEEDED' : 'NEAR_LIMIT'
        });
      }
    }

    return {
      categorySpend,
      budgetAlerts,
      isHealthy: budgetAlerts.length === 0,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Live portfolio check for the tickers configured in
   * store.stockPortfolio.symbols. Fetches fresh quotes (server/stockTracker.cjs,
   * no API key, isolated per-symbol failure) and updates the cached
   * lastQuotes alongside — so a later request that can't reach the network
   * (or a symbol that's temporarily failing) still has the last real
   * snapshot to fall back on, labeled as stale rather than silently absent.
   *
   * Each holding carries `value` (price * shares) when a share count is set
   * via setShares — a symbol with no share count is still tracked and
   * priced, it just has no position value to sum. totalValue only counts
   * holdings with a real (non-stale, non-failed) price, so a temporarily
   * unreachable quote can't silently understate the total using a $0
   * fallback — it's excluded and flagged instead.
   */
  async getPortfolioSnapshot() {
    const d = this.store.load();
    const symbols = d.stockPortfolio?.symbols || [];
    if (symbols.length === 0) {
      return { symbols: [], holdings: [], hasData: false, message: 'No stock symbols configured yet.' };
    }

    const results = await fetchQuotes(symbols);
    const dd = this.store.load(); // re-load — the fetch above can take a few seconds
    const lastQuotes = { ...(dd.stockPortfolio?.lastQuotes || {}) };
    const shares = dd.stockPortfolio?.shares || {};
    const holdings = [];

    for (const r of results) {
      if (r.ok) {
        lastQuotes[r.symbol] = r;
        holdings.push({ ...r, stale: false });
      } else {
        const cached = lastQuotes[r.symbol];
        holdings.push(cached
          ? { ...cached, stale: true, staleReason: r.error }
          : { symbol: r.symbol, ok: false, stale: true, error: r.error });
      }
    }

    // Preserve `shares` — this used to overwrite the whole stockPortfolio
    // object on every price refresh, silently wiping out share counts the
    // user had entered the moment prices next refreshed.
    dd.stockPortfolio = { symbols, shares, lastQuotes };
    this.store.save(dd);

    let totalValue = 0;
    let totalValueIsPartial = false;
    for (const h of holdings) {
      const shareCount = shares[h.symbol];
      if (typeof shareCount === 'number' && shareCount > 0) {
        if (h.price != null) {
          h.shares = shareCount;
          h.value = Number((h.price * shareCount).toFixed(2));
          totalValue += h.value;
          if (h.stale || h.ok === false) totalValueIsPartial = true;
        } else {
          h.shares = shareCount;
          h.value = null;
          totalValueIsPartial = true;
        }
      }
    }

    const gainers = holdings.filter(h => h.ok !== false && h.changePercent > 0).length;
    const decliners = holdings.filter(h => h.ok !== false && h.changePercent < 0).length;
    const hasAnyShares = Object.values(shares).some(s => typeof s === 'number' && s > 0);

    logAuditEvent({
      action: 'hermes_portfolio_checked',
      source: 'hermes',
      details: { symbolCount: symbols.length, failedCount: results.filter(r => !r.ok).length }
    });

    return {
      symbols,
      holdings,
      hasData: true,
      gainers,
      decliners,
      totalValue: hasAnyShares ? Number(totalValue.toFixed(2)) : null,
      totalValueIsPartial,
      checkedAt: new Date().toISOString()
    };
  }

  /**
   * Sets (or clears, with shares=0/null) the share count for one symbol —
   * the Hermes Financial Pulse panel's per-stock input calls this. Does not
   * add the symbol to the tracked list; it must already be in
   * stockPortfolio.symbols (set at initial configuration).
   */
  setShares(symbol, shareCount) {
    const d = this.store.load();
    if (!d.stockPortfolio?.symbols?.includes(symbol)) {
      throw new Error(`"${symbol}" is not a tracked symbol.`);
    }
    const n = Number(shareCount);
    if (shareCount != null && shareCount !== '' && (!Number.isFinite(n) || n < 0)) {
      throw new Error('Share count must be a non-negative number.');
    }
    d.stockPortfolio.shares = d.stockPortfolio.shares || {};
    if (!shareCount && shareCount !== 0) {
      delete d.stockPortfolio.shares[symbol];
    } else {
      d.stockPortfolio.shares[symbol] = n;
    }
    this.store.save(d);

    logAuditEvent({
      action: 'hermes_portfolio_shares_updated',
      source: 'hermes',
      details: { symbol, shares: d.stockPortfolio.shares[symbol] ?? null }
    });

    return { symbol, shares: d.stockPortfolio.shares[symbol] ?? null };
  }
}

const globalHermes = new HermesEngine();

module.exports = {
  HermesEngine,
  globalHermes,
  HermesScriptPipeline,
  globalHermesPipeline,
  HermesEvolutionEngine,
  globalHermesEvolution,
  HermesDialecticMemory,
  globalHermesMemory,
  HermesGateway,
  globalHermesGateway
};
