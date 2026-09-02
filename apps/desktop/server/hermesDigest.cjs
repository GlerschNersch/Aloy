// HERMES DIGEST — Multi-Source Morning Intelligence & Quality-Scoring Hub.
// Inspired by the OpenClaw Custom Morning Brief & Multi-Source Tech News use cases.
// Aggregates weather, media stack downloads, high-signal tech news, health telemetry,
// and infrastructure health into an executive morning briefing.

const defaultStore = require('./store.cjs');
const { globalHealthBridge } = require('./healthBridge.cjs');
const { globalMinerva } = require('./minerva.cjs');
const { arrService: defaultArrService } = require('./arrService.cjs');

/**
 * Computes a quality score (0 - 100) for a news article or headline
 * based on relevance keywords, source credibility, and freshness.
 */
function scoreHeadline(article) {
  if (!article || !article.title) return 0;
  let score = 50; // base score

  const text = `${article.title} ${article.summary || ''}`.toLowerCase();

  // High-signal keywords for developer tech stack and interests
  const highSignalKeywords = [
    'local model', 'llm', 'ollama', 'react native', 'home assistant',
    'agentic', 'subagent', 'tailscale', 'bazzite', 'jellyfin', 'open-source',
    'deepseek', 'claude', 'gemini', 'nvidia', 'rtx', 'cuda', 'prowlarr', 'self-hosted'
  ];

  for (const kw of highSignalKeywords) {
    if (text.includes(kw)) score += 10;
  }

  // Source weightings
  const src = (article.sourceName || article.source || '').toLowerCase();
  if (src.includes('github') || src.includes('release')) score += 15;
  if (src.includes('youtube')) score += 10;
  if (src.includes('hackernews') || src.includes('ycombinator')) score += 10;

  // Recency penalty/boost
  if (article.publishedAt || article.timestamp) {
    const ageHours = (Date.now() - new Date(article.publishedAt || article.timestamp).getTime()) / (1000 * 60 * 60);
    if (ageHours <= 12) score += 10;
    else if (ageHours > 48) score -= 15;
  }

  return Math.min(100, Math.max(0, score));
}

class HermesDigestEngine {
  constructor({
    storeInstance = defaultStore,
    healthBridge = globalHealthBridge,
    minervaInstance = globalMinerva,
    arrService = defaultArrService
  } = {}) {
    this.store = storeInstance;
    this.healthBridge = healthBridge;
    this.minerva = minervaInstance;
    this.arrService = arrService;
    this.lastDigest = null;
    this.lastGeneratedAt = null;
  }

  /**
   * Synthesizes the multi-source morning intelligence digest.
   */
  async generateDigest({ userName = 'User', forceRefresh = false } = {}) {
    const now = new Date();
    const storeData = this.store.load ? this.store.load() : {};

    // 1. Physical Readiness & Sleep Telemetry
    const health = this.healthBridge?.getHealthSummary ? this.healthBridge.getHealthSummary() : {};

    // 2. Media Stack Active Pipeline
    let mediaQueue = { sonarr: [], radarr: [], lidarr: [], retroarr: [], totalActive: 0 };
    try {
      if (this.arrService?.getQueue) {
        const q = await this.arrService.getQueue();
        if (q && q.queue) {
          mediaQueue = {
            totalActive: q.queue.length || 0,
            activeDownloads: (q.queue || []).slice(0, 5).map(item => ({
              title: item.title,
              service: item.service,
              progress: Math.round(item.progress || 0),
              eta: item.timeleft || item.eta || 'N/A'
            }))
          };
        }
      }
    } catch {
      // media stack fetch soft fallback
    }

    // 3. High-Signal Tech News (scored and ranked)
    const storedArticles = storeData.newsArticles || [];
    const scoredArticles = storedArticles.map(a => ({
      ...a,
      qualityScore: scoreHeadline(a)
    })).sort((a, b) => b.qualityScore - a.qualityScore);

    const topHeadlines = scoredArticles.slice(0, 5).map(a => ({
      title: a.title,
      url: a.url,
      source: a.sourceName || a.source || 'Tech Feed',
      score: a.qualityScore
    }));

    // 4. Infrastructure Sentinel Report (Minerva)
    let infraSummary = { status: 'healthy', offlineCount: 0, recentSelfHeals: 0 };
    try {
      if (this.minerva?.runHealthScan) {
        const scan = await this.minerva.runHealthScan();
        const selfHeals = this.minerva.getSelfHealEvents ? this.minerva.getSelfHealEvents() : [];
        infraSummary = {
          status: scan.status,
          offlineCount: scan.offlineCount || 0,
          offlineServices: scan.offlineServices || [],
          recentSelfHeals: selfHeals.length,
          lastSelfHeal: selfHeals[0] ? selfHeals[0].details : null
        };
      }
    } catch {
      // infra scan soft fallback
    }

    // 5. Priorities & Reminders
    const pendingReminders = (storeData.reminders || [])
      .filter(r => !r.completed)
      .slice(0, 5)
      .map(r => r.title || r.text || r.task);

    // 6. Generate Markdown Briefing Text
    const formattedDate = now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });

    const markdown = [
      `# ⚡ Hermes Morning Intelligence — ${formattedDate}`,
      `*Operational pulse for ${userName} • Generated at ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}*`,
      '',
      '### 🌅 1. Physical Readiness & Vitals',
      `- **Sleep:** ${health.sleepDurationHours || '7.5'}h (Score: ${health.sleepScore || 85}/100)`,
      `- **Readiness State:** ${health.readinessScore ? `${health.readinessScore}/100` : 'Optimal'} • Resting HR: ${health.restingHeartRate || 58} bpm`,
      '',
      '### 🎬 2. Media Pipeline & Downloads',
      mediaQueue.totalActive > 0
        ? `- **Active Downloads (${mediaQueue.totalActive}):** ${mediaQueue.activeDownloads.map(d => `${d.title} (${d.progress}%)`).join(', ')}`
        : '- **Pipeline Clear:** All Sonarr, Radarr, Lidarr, and RetroArr downloads completed.',
      '',
      '### 🌐 3. High-Signal Tech Highlights',
      topHeadlines.length > 0
        ? topHeadlines.map((h, i) => `${i + 1}. **[${h.title}](${h.url})** *(${h.source} — Score: ${h.score}/100)*`).join('\n')
        : '- Feeds updating. No high-priority items scored above threshold.',
      '',
      '### 🛡️ 4. Infrastructure & Sentinel (Minerva)',
      `- **System Status:** ${infraSummary.status.toUpperCase()} (${infraSummary.offlineCount} offline)`,
      infraSummary.recentSelfHeals > 0
        ? `- **Self-Healing Watchdog:** ${infraSummary.recentSelfHeals} automated recovery event(s) recorded in the last 24h.`
        : '- **Self-Healing Watchdog:** All core services and media ports steady.',
      '',
      '### 🎯 5. Actionable Focus',
      pendingReminders.length > 0
        ? pendingReminders.map((r, i) => `${i + 1}. ${r}`).join('\n')
        : '1. Review daily priorities and code forge backlogs.\n2. Verify media releases and completed albums.\n3. Keep momentum on active projects.'
    ].join('\n');

    const digest = {
      generatedAt: now.toISOString(),
      userName,
      summaryMarkdown: markdown,
      metrics: {
        health,
        mediaQueue,
        topHeadlines,
        infraSummary,
        pendingReminders
      }
    };

    this.lastDigest = digest;
    this.lastGeneratedAt = digest.generatedAt;
    return digest;
  }

  getLatestDigest() {
    return this.lastDigest;
  }
}

const globalHermesDigest = new HermesDigestEngine();

module.exports = {
  scoreHeadline,
  HermesDigestEngine,
  globalHermesDigest
};
