// JOB RADAR — Autonomous Career & Technical Writing Opportunity Scanner
// Scrapes, deduplicates, and organizes daily LinkedIn job postings for Technical Writer
// and Content Developer roles, integrating directly into Hermes Daily Briefings and Aloy Dashboards.

const defaultStore = require('./store.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');

const DEFAULT_CONFIG = {
  enabled: true,
  queries: ['Technical Writer', 'Content Developer', 'Documentation Engineer'],
  location: 'Remote',
  timeFilter: 'r86400', // 24 hours (86400s)
  autoScanIntervalHours: 6,
  lastScannedAt: null
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Short deterministic hash — used to build a stable synthetic id for cards
// that expose no LinkedIn jobId, so dedup survives across scans.
function stableKey(input) {
  let h = 5381;
  const str = String(input || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

class JobRadarEngine {
  constructor(customStore = null) {
    this.store = customStore || defaultStore;
  }

  /**
   * Retrieves active Job Radar config from store.
   */
  getConfig() {
    const d = this.store.load();
    return {
      ...DEFAULT_CONFIG,
      ...(d.jobRadarConfig || {})
    };
  }

  /**
   * Updates Job Radar configuration.
   */
  updateConfig(patch) {
    const d = this.store.load();
    d.jobRadarConfig = {
      ...DEFAULT_CONFIG,
      ...(d.jobRadarConfig || {}),
      ...patch
    };
    this.store.save(d);
    return d.jobRadarConfig;
  }

  /**
   * Cleans text and XML/HTML entities.
   */
  cleanText(text) {
    if (!text) return '';
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Robust HTML parser for LinkedIn public guest job search cards.
   */
  parseLinkedInHtml(html, query = '') {
    if (!html || typeof html !== 'string') return [];

    const jobs = [];
    const seenIds = new Set();

    // Match <li> cards or base-card blocks
    const cardRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let cardMatch;

    while ((cardMatch = cardRegex.exec(html)) !== null) {
      const cardHtml = cardMatch[1];
      if (!cardHtml.includes('job-search-card') && !cardHtml.includes('base-search-card')) {
        continue;
      }

      // 1. Extract Job ID / URN
      let jobId = null;
      const urnMatch = cardHtml.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/i) ||
                       cardHtml.match(/jobPosting:(\d+)/i) ||
                       cardHtml.match(/\/jobs\/view\/[^"?]+-(\d+)/i);
      if (urnMatch) {
        jobId = urnMatch[1];
      }

      // 2. Extract Job Link
      let url = '';
      const linkMatch = cardHtml.match(/<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/i) ||
                        cardHtml.match(/<a[^>]*href="(https:\/\/[^"]*linkedin\.com\/jobs\/view\/[^"]+)"/i);
      if (linkMatch) {
        url = linkMatch[1].split('?')[0]; // Clean tracking params
      }

      // Fallback ID from URL if URN was missing
      if (!jobId && url) {
        const idFromUrl = url.match(/(\d+)(?:\/?$)/);
        if (idFromUrl) jobId = idFromUrl[1];
      }

      if (!jobId && !url) continue;
      const uniqueKey = jobId || url;
      if (seenIds.has(uniqueKey)) continue;
      seenIds.add(uniqueKey);

      // 3. Extract Title
      let title = '';
      const titleMatch = cardHtml.match(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i) ||
                         cardHtml.match(/<span[^>]*class="sr-only"[^>]*>([\s\S]*?)<\/span>/i);
      if (titleMatch) {
        title = this.cleanText(titleMatch[1].replace(/<[^>]+>/g, ''));
      }

      // 4. Extract Company & Company Link
      let company = '';
      let companyUrl = '';
      const compMatch = cardHtml.match(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i);
      if (compMatch) {
        const compHtml = compMatch[1];
        const compLinkMatch = compHtml.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (compLinkMatch) {
          companyUrl = compLinkMatch[1].split('?')[0];
          company = this.cleanText(compLinkMatch[2].replace(/<[^>]+>/g, ''));
        } else {
          company = this.cleanText(compHtml.replace(/<[^>]+>/g, ''));
        }
      }

      // 5. Extract Location
      let location = '';
      const locMatch = cardHtml.match(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      if (locMatch) {
        location = this.cleanText(locMatch[1].replace(/<[^>]+>/g, ''));
      }

      // 6. Extract Posted Date/Time String
      let postedTimeStr = '';
      let postedDate = '';
      const timeMatch = cardHtml.match(/<time[^>]*class="[^"]*job-search-card__listdate[^"]*"[^>]*datetime="([^"]*)"[^>]*>([\s\S]*?)<\/time>/i) ||
                        cardHtml.match(/<time[^>]*datetime="([^"]*)"[^>]*>([\s\S]*?)<\/time>/i);
      if (timeMatch) {
        postedDate = timeMatch[1] || '';
        postedTimeStr = this.cleanText(timeMatch[2] || '');
      }

      if (title) {
        jobs.push({
          // Fallback ID must be STABLE across scans: Date.now()+random
          // produced a new id every parse, so a card with no jobId was
          // re-added as "new" on every single run. Derive from the url,
          // or from title+company when even that is missing.
          id: `li-${jobId || stableKey(url || `${title}|${company}`)}`,
          jobId: jobId || null,
          title,
          company: company || 'Company Confidential',
          companyUrl: companyUrl || null,
          location: location || 'Remote',
          postedTimeStr: postedTimeStr || 'Recent',
          postedDate: postedDate || new Date().toISOString().slice(0, 10),
          url: url || `https://www.linkedin.com/jobs/view/${jobId}`,
          source: 'LinkedIn',
          query: query || 'Technical Writer',
          status: 'new', // 'new' | 'saved' | 'applied' | 'dismissed'
          firstSeenAt: new Date().toISOString()
        });
      }
    }

    return jobs;
  }

  /**
   * Fetches job cards from LinkedIn Guest API with timeout & user-agent rotation.
   */
  async fetchLinkedInJobs({ query = 'Technical Writer', location = 'Remote', timeFilter = 'r86400', start = 0 } = {}) {
    const encodedQuery = encodeURIComponent(query);
    const encodedLoc = encodeURIComponent(location);
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodedQuery}&location=${encodedLoc}&f_TPR=${timeFilter}&start=${start}`;

    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': randomUA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        console.warn(`[JobRadar] LinkedIn returned HTTP ${response.status} for query "${query}"`);
        return [];
      }

      const html = await response.text();
      const parsed = this.parseLinkedInHtml(html, query);

      // Parser-health signal. This scrapes LinkedIn's guest HTML by regex over
      // class names like `base-search-card__title`. When LinkedIn changes its
      // markup — and it will — the fetch still returns 200 and the parser
      // silently yields nothing, which is indistinguishable from "no jobs
      // today". A substantial body producing zero jobs means the parser broke,
      // not that the market is quiet.
      if (parsed.length === 0 && html.length > 2000) {
        this._diag.parserSuspect = true;
        this._diag.notes.push(`"${query}": HTTP 200, ${html.length} bytes, 0 jobs parsed — markup may have changed`);
      }
      return parsed;
    } catch (err) {
      const aborted = err?.name === 'AbortError';
      this._diag.errors.push(`"${query}": ${aborted ? `timed out after 12s` : err.message}`);
      console.warn(`[JobRadar] Fetch error for query "${query}":`, err.message);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Persistent health record for the scanner.
   *
   * LinkedIn rate-limits and blocks aggressively (HTTP 429 / 999), and every
   * failure path here degrades to an empty array. Without this, a blocked or
   * broken scanner is indistinguishable from "no new jobs" and can stay
   * silently dead for weeks — the same failure mode that hid the Athena hang.
   */
  getHealth() {
    const d = this.store.load();
    return {
      consecutiveFailedScans: 0,
      lastSuccessfulScanAt: null,
      lastError: null,
      parserSuspect: false,
      ...(d.jobRadarHealth || {})
    };
  }

  _recordHealth(patch) {
    const d = this.store.load();
    d.jobRadarHealth = { ...this.getHealth(), ...patch };
    this.store.save(d);
    return d.jobRadarHealth;
  }

  /**
   * Runs a complete multi-query scan across LinkedIn for technical writer & content dev roles.
   */
  async runJobScan({ queries = null, location = null, timeFilter = null } = {}) {
    // Reset per-scan diagnostics; fetchLinkedInJobs writes into this.
    this._diag = { parserSuspect: false, errors: [], notes: [] };
    const cfg = this.getConfig();
    const searchQueries = queries || cfg.queries || ['Technical Writer', 'Content Developer'];
    const searchLocation = location || cfg.location || 'Remote';
    const filterTime = timeFilter || cfg.timeFilter || 'r86400';

    const d = this.store.load();
    const existingListings = d.jobListings || [];
    const existingKeyMap = new Map();

    existingListings.forEach(item => {
      if (item.jobId) existingKeyMap.set(item.jobId, item);
      if (item.url) existingKeyMap.set(item.url, item);
    });

    const newJobsFound = [];
    const scannedAt = new Date().toISOString();

    for (const q of searchQueries) {
      try {
        const fetched = await this.fetchLinkedInJobs({
          query: q,
          location: searchLocation,
          timeFilter: filterTime
        });

        for (const job of fetched) {
          const key = job.jobId || job.url;
          if (!existingKeyMap.has(key)) {
            existingKeyMap.set(key, job);
            existingListings.unshift(job);
            newJobsFound.push(job);
          }
        }
      } catch (err) {
        console.warn(`[JobRadar] Scan pass failed for "${q}":`, err.message);
      }
    }

    // Keep store capped at 500 listings
    d.jobListings = existingListings.slice(0, 500);
    d.jobRadarConfig = {
      ...cfg,
      lastScannedAt: scannedAt
    };
    this.store.save(d);

    logAuditEvent({
      action: 'job_radar_scan_completed',
      source: 'job_radar',
      details: {
        queries: searchQueries,
        location: searchLocation,
        newJobsCount: newJobsFound.length,
        totalJobsCount: d.jobListings.length
      }
    });

    // A scan "failed" when no query returned a single parseable job AND
    // something went wrong (network error, or a 200 with unparseable HTML).
    // Zero jobs with a clean fetch is a legitimate quiet day, not a failure.
    const anyJobsSeen = existingKeyMap.size > 0 && newJobsFound.length >= 0;
    const scanFailed = this._diag.errors.length > 0 || this._diag.parserSuspect;
    const prior = this.getHealth();
    const health = this._recordHealth(
      scanFailed
        ? {
            consecutiveFailedScans: (prior.consecutiveFailedScans || 0) + 1,
            lastError: [...this._diag.errors, ...this._diag.notes][0] || 'unknown scan failure',
            parserSuspect: this._diag.parserSuspect
          }
        : {
            consecutiveFailedScans: 0,
            lastSuccessfulScanAt: scannedAt,
            lastError: null,
            parserSuspect: false
          }
    );

    return {
      success: !scanFailed,
      scannedAt,
      newJobsCount: newJobsFound.length,
      totalListingsCount: d.jobListings.length,
      newJobs: newJobsFound,
      health,
      diagnostics: this._diag
    };
  }

  /**
   * Retrieves all listings with optional filtering.
   */
  getListings({ status = null, query = null, search = null, limit = 100 } = {}) {
    const d = this.store.load();
    let list = d.jobListings || [];

    if (status && status !== 'ALL') {
      list = list.filter(j => j.status === status);
    }
    if (query && query !== 'ALL') {
      list = list.filter(j => j.query?.toLowerCase() === query.toLowerCase());
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(j =>
        (j.title || '').toLowerCase().includes(q) ||
        (j.company || '').toLowerCase().includes(q) ||
        (j.location || '').toLowerCase().includes(q)
      );
    }

    return {
      listings: list.slice(0, limit),
      totalCount: list.length,
      lastScannedAt: d.jobRadarConfig?.lastScannedAt || null,
      queries: this.getConfig().queries
    };
  }

  /**
   * Updates status of a listing (e.g. 'saved', 'applied', 'dismissed', 'new').
   */
  updateListingStatus(id, newStatus) {
    const d = this.store.load();
    const list = d.jobListings || [];
    const item = list.find(j => j.id === id || j.jobId === id);
    if (!item) return null;

    item.status = newStatus;
    item.updatedAt = new Date().toISOString();
    this.store.save(d);
    return item;
  }

  /**
   * Returns a concise summary of fresh job opportunities for Hermes Daily Briefings.
   */
  getDailySummary() {
    const d = this.store.load();
    const list = d.jobListings || [];
    const todayStr = new Date().toISOString().slice(0, 10);

    const freshJobs = list.filter(j => {
      if (j.status === 'dismissed') return false;
      const seenDate = (j.firstSeenAt || '').slice(0, 10);
      return seenDate === todayStr || j.postedTimeStr?.includes('hour') || j.postedTimeStr?.includes('minute');
    });

    // Mutually exclusive buckets: a "Technical Content Developer" previously
    // counted in BOTH, so the two numbers could exceed totalFresh and the
    // briefing read as if there were more roles than actually exist.
    const isTechWriter = (j) => /technical writer|documentation/i.test(`${j.query || ''} ${j.title || ''}`);
    const techWriterCount = freshJobs.filter(isTechWriter).length;
    const contentDevCount = freshJobs.filter(j => !isTechWriter(j) && /content/i.test(`${j.query || ''} ${j.title || ''}`)).length;

    return {
      totalFresh: freshJobs.length,
      techWriterCount,
      contentDevCount,
      topListings: freshJobs.slice(0, 5),
      lastScannedAt: d.jobRadarConfig?.lastScannedAt || null
    };
  }
}

const globalJobRadar = new JobRadarEngine();

module.exports = {
  JobRadarEngine,
  globalJobRadar
};
