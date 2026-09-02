// Tech-news scrape + relevance-filter pipeline. Scraping itself happens in
// a separate Python sidecar (news_scraper_server.py, port 8892, wraps
// Scrapling) since Scrapling is Python-only — this module just orchestrates
// calling it per configured source, then filters results through the local
// model before anything lands in store.json's newsArticles.
const store = require('./store.cjs');
const { getOrCreateToken } = require('./auth.cjs');

const OLLAMA_URL = 'http://localhost:11434';
const SCRAPER_URL = 'http://localhost:8892';
const RELEVANCE_MODEL = 'aloy-assistant';
const MAX_NEWS_ARTICLES = 200;
// Caps local-model relevance calls per run, same reasoning as
// skillsDashboard.cjs's runNightlyAutoTeaching MAX_PER_RUN — bounds how
// long a single scheduled run can take. Articles skipped this way aren't
// remembered as "pending" anywhere; they're simply re-scraped (and get a
// fresh scoring chance) on the next run, since dedup is only against
// already-STORED articles. Acceptable for personal-scale source lists;
// worth a real pending-queue if the source list ever grows large.
const MAX_TO_SCORE_PER_RUN = 30;
const FETCH_TIMEOUT_MS = 25000;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeWebSource(source) {
  try {
    const res = await fetchWithTimeout(`${SCRAPER_URL}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getOrCreateToken()}` },
      body: JSON.stringify({ url: source.url, link_selector: source.linkSelector || undefined })
    }, FETCH_TIMEOUT_MS);

    if (!res.ok) {
      console.warn(`[news] scrape HTTP ${res.status} for ${source.name || source.url}`);
      return [];
    }
    const data = await res.json();
    if (!data.success) {
      console.warn(`[news] scrape failed for ${source.name || source.url}: ${data.error}`);
      return [];
    }
    return (data.articles || []).map((a) => ({
      title: a.title,
      url: a.url,
      sourceId: source.id,
      sourceName: source.name || source.url
    }));
  } catch (err) {
    console.warn(`[news] scrape error for ${source.name || source.url}:`, err.message);
    return [];
  }
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(str) {
  return (str || '').replace(/&(#\d+|#x[0-9a-fA-F]+|[a-z]+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isNaN(code) ? m : String.fromCodePoint(code);
    }
    return XML_ENTITIES[ent] ?? m;
  });
}

// YouTube's channel-page HTML embeds the channel's own id twice under two
// different keys — confirmed live against a real channel that "channelId"
// pointed at a DIFFERENT (secondary) channel than the one being viewed,
// while "externalId" matched (cross-checked by pulling both ids' RSS feeds
// and comparing against a known video). externalId is the one to trust.
const CHANNEL_URL_ID_RE = /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/;
async function resolveYouTubeChannelId(url) {
  const direct = CHANNEL_URL_ID_RE.exec(url);
  if (direct) return direct[1];

  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  }, FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Channel page HTTP ${res.status}`);
  const html = await res.text();
  const match = /"externalId":"(UC[a-zA-Z0-9_-]{22})"/.exec(html);
  if (!match) throw new Error('Could not find channel id on channel page');
  return match[1];
}

// Plain Atom-feed regex parse rather than a full XML parser dependency —
// YouTube's channel RSS format (https://www.youtube.com/feeds/videos.xml)
// is fixed and simple (no nested <title> tags, no CDATA), so this is a
// pragmatic match for the one feed shape this ever needs to read.
function parseYouTubeFeed(xml) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml))) {
    const block = m[1];
    const videoIdMatch = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(block);
    const titleMatch = /<title>([^<]*)<\/title>/.exec(block);
    if (!videoIdMatch || !titleMatch) continue;
    entries.push({
      videoId: videoIdMatch[1],
      title: unescapeXml(titleMatch[1]),
      url: `https://www.youtube.com/watch?v=${videoIdMatch[1]}`
    });
  }
  return entries;
}

async function scrapeYouTubeChannel(source) {
  try {
    let channelId = source.channelId;
    if (!channelId) {
      channelId = await resolveYouTubeChannelId(source.url);
      // Cache the resolution onto the source so future runs skip the
      // channel-page fetch entirely — same reasoning as any other
      // memoized-onto-config pattern in this file.
      const d = store.load();
      const src = (d.newsSources || []).find((s) => s.id === source.id);
      if (src) {
        src.channelId = channelId;
        store.save(d);
      }
    }

    const res = await fetchWithTimeout(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
      {},
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) {
      console.warn(`[news] YouTube feed HTTP ${res.status} for ${source.name || source.url}`);
      return [];
    }
    const xml = await res.text();
    return parseYouTubeFeed(xml).map((v) => ({
      title: v.title,
      url: v.url,
      videoId: v.videoId,
      sourceId: source.id,
      sourceName: source.name || source.url,
      sourceType: 'youtube'
    }));
  } catch (err) {
    console.warn(`[news] YouTube channel scrape error for ${source.name || source.url}:`, err.message);
    return [];
  }
}

function parseStandardRssFeed(xml, source) {
  const items = [];
  const itemRe = /<(?:item|entry)(?:[^>]*)>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const titleMatch = /<title(?:[^>]*)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(block);
    const linkMatch = /<link(?:[^>]*)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i.exec(block) ||
                      /<link[^>]+href=["']([^"']+)["']/i.exec(block);
    if (!titleMatch) continue;
    const rawTitle = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const title = unescapeXml(rawTitle);
    let url = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : source.url;
    if (url.startsWith('/')) {
      try {
        const base = new URL(source.url);
        url = `${base.origin}${url}`;
      } catch {}
    }
    if (title) {
      items.push({
        title,
        url,
        sourceId: source.id,
        sourceName: source.name || source.url,
        sourceType: 'rss'
      });
    }
  }
  return items;
}

async function scrapeRssSource(source) {
  try {
    const res = await fetchWithTimeout(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Aloy-Scout/2.0',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      }
    }, FETCH_TIMEOUT_MS);

    if (!res.ok) {
      console.warn(`[news] RSS fetch HTTP ${res.status} for ${source.name || source.url}`);
      return [];
    }
    const xml = await res.text();
    return parseStandardRssFeed(xml, source);
  } catch (err) {
    console.warn(`[news] RSS scrape error for ${source.name || source.url}:`, err.message);
    return [];
  }
}

const RSS_SOURCE_RE = /(\/rss|\/feed|\.xml|feeds\.|\/headlines\/)/i;
const YOUTUBE_SOURCE_RE = /youtube\.com\/(@|channel\/|c\/|user\/)/i;

function isRssSource(source) {
  return source.type === 'rss' || RSS_SOURCE_RE.test(source.url || '');
}

async function scrapeSource(source) {
  if (source.type === 'youtube' || YOUTUBE_SOURCE_RE.test(source.url || '')) {
    return scrapeYouTubeChannel(source);
  }
  if (isRssSource(source)) {
    const rssItems = await scrapeRssSource(source);
    if (rssItems.length > 0) return rssItems;
  }
  return scrapeWebSource(source);
}

function normalizeNewsSources(sources) {
  return (sources || []).map((s) => {
    if (s.type) return s;
    if (YOUTUBE_SOURCE_RE.test(s.url || '')) return { ...s, type: 'youtube' };
    if (RSS_SOURCE_RE.test(s.url || '')) return { ...s, type: 'rss' };
    return { ...s, type: 'web' };
  });
}

async function scrapeAllSources() {
  const d = store.load();
  const sources = d.newsSources || [];
  const results = await Promise.all(sources.map(scrapeSource));
  return results.flat();
}

// Binary relevant/not-relevant judgment, not a graded score — the
// confidence-escalation work earlier established local models don't
// reliably discriminate on a graded scale (defaults to a "safe middle"),
// while a direct yes/no question against real cases showed real
// discrimination. Same lesson applied here.
async function scoreRelevance(article, interests) {
  if (!interests || interests.length === 0) {
    return { relevant: true, reason: 'No interest profile configured yet — showing everything.' };
  }

  const prompt = `You filter a personal tech news feed. The reader is interested in: ${interests.join(', ')}.\n\nArticle title: "${article.title}"\n\nIs this article likely relevant to those interests? Reply in EXACTLY this format, nothing else:\nRELEVANT: yes or no\nREASON: one short sentence`;

  try {
    const res = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: RELEVANCE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        // 80 tokens confirmed live to be nowhere near enough — local model's
        // reasoning channel burns the whole budget before producing any
        // real content (done_reason:'length', content:""), same class of
        // bug documented for the confidence-escalation check. 400 lets it
        // finish reasoning and still answer.
        options: { temperature: 0.1, num_predict: 400 }
      })
    }, FETCH_TIMEOUT_MS);

    if (!res.ok) return { relevant: false, reason: 'Relevance check failed (model unreachable).' };

    const data = await res.json();
    const text = (data?.message?.content || '').trim();
    const relevantMatch = /RELEVANT:\s*(yes|no)/i.exec(text);
    const reasonMatch = /REASON:\s*(.+)/i.exec(text);

    return {
      relevant: relevantMatch ? relevantMatch[1].toLowerCase() === 'yes' : false,
      reason: reasonMatch ? reasonMatch[1].trim() : (text.slice(0, 140) || 'No reason parsed.')
    };
  } catch (err) {
    return { relevant: false, reason: `Relevance check error: ${err.message}` };
  }
}

// Takes one article per source in turn (preserving each source's own
// relative order) until `limit` is reached or every source is exhausted —
// a large source's articles all sort together in the input (scrapeAllSources
// flattens per-source in order), so a plain slice() off the front is
// equivalent to "whichever source happens to be first/biggest wins the
// entire budget." This guarantees every source with anything new gets at
// least a shot in the same run, budget permitting.
function roundRobinBySource(articles, limit) {
  const bySource = new Map();
  for (const a of articles) {
    if (!bySource.has(a.sourceId)) bySource.set(a.sourceId, []);
    bySource.get(a.sourceId).push(a);
  }
  const queues = Array.from(bySource.values());
  const result = [];
  let i = 0;
  while (result.length < limit && queues.some((q) => q.length > 0)) {
    const q = queues[i % queues.length];
    if (q.length > 0) result.push(q.shift());
    i++;
  }
  return result;
}

// Caps transcript-fetch + summarization per run — much heavier per item
// than the yes/no relevance call (a real HTTP fetch to the sidecar plus a
// long-context local-model summarization), so this is deliberately smaller
// than MAX_TO_SCORE_PER_RUN.
const MAX_VIDEOS_TO_LEARN_PER_RUN = 5;
// Local model context budget is limited — same class of constraint as the
// num_predict fix below; a full transcript can run 10k+ words, so it's cut
// down before ever reaching the prompt (the sidecar already caps its own
// response at 30000 chars — this trims further, prompt-side).
const MAX_TRANSCRIPT_CHARS_FOR_PROMPT = 6000;

async function fetchVideoTranscript(videoId) {
  const res = await fetchWithTimeout(`${SCRAPER_URL}/youtube/transcript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getOrCreateToken()}` },
    body: JSON.stringify({ video_id: videoId })
  }, FETCH_TIMEOUT_MS);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return null;
  return data.transcript;
}

// Digests one relevant YouTube video's transcript into a learnedKnowledge
// entry — same storage shape/pattern as skillsDashboard.cjs's nightly
// auto-teaching (embedKnowledgeEntry + append to learnedKnowledge), so
// video-derived knowledge shows up in the existing Autonomous Skills &
// Knowledge dashboard card with no separate UI needed. Unlike nightly
// teaching, there's no independent verification pass here — the transcript
// IS the primary source (the video said it), there's nothing to fact-check
// against the way there is for the model's own researched claims.
async function extractVideoKnowledge(article) {
  const transcript = await fetchVideoTranscript(article.videoId);
  if (!transcript) return false;

  const prompt = `Summarize the key, useful takeaways from this YouTube video transcript in 3-5 concise bullet points. Focus on concrete facts, steps, or recommendations — skip filler, jokes, and sponsor reads.\n\nVideo title: "${article.title}"\n\nTranscript:\n${transcript.slice(0, MAX_TRANSCRIPT_CHARS_FOR_PROMPT)}\n\nReply with ONLY the bullet points, nothing else.`;

  try {
    const res = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: RELEVANCE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        // Same reasoning-channel budget issue as scoreRelevance below, sized
        // up further since this is a real multi-sentence response rather
        // than a one-line yes/no. Confirmed live that 700 still truncated
        // a real response mid-bullet on one video; 1000 gives more margin.
        options: { temperature: 0.2, num_predict: 1000 }
      })
    }, FETCH_TIMEOUT_MS);
    if (!res.ok) return false;
    const data = await res.json();
    const summary = (data?.message?.content || '').trim();
    if (!summary) return false;

    const { embedKnowledgeEntry } = require('./knowledgeRetrieval.cjs');
    const entry = await embedKnowledgeEntry({
      id: `knowledge-video-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      topic: article.title,
      summary,
      sources: [article.url],
      autoGenerated: true,
      savedAt: new Date().toISOString()
    });
    const d = store.load();
    d.learnedKnowledge = [...(d.learnedKnowledge || []), entry];
    store.save(d);
    return true;
  } catch (err) {
    console.warn(`[news] video knowledge extraction error for ${article.title}:`, err.message);
    return false;
  }
}

// Guard lives HERE, not in each caller — aloyServer.cjs's scheduled job,
// its own /api/news/refresh route, AND electron.cjs's IPC handler all run
// in the same Electron main process and share this same store.json.
// Per-caller flags (an earlier version of this) don't coordinate with each
// other: a desktop refresh and a mobile refresh triggered close together
// would both pass their own separate checks and race on store.save(),
// potentially losing one side's newly-scored articles. One shared flag
// here closes that gap regardless of which entry point calls in.
let scrapeInProgress = false;

function isNewsScrapeInProgress() {
  return scrapeInProgress;
}

function sortNewsArticlesByPriority(articles = []) {
  const HIGH_PRIORITY_KEYWORDS = ['anthropic', 'claude', 'deepseek', 'ollama', 'cuda', 'nvidia', 'gemini', 'openai', 'qwen', 'llm', 'ai model'];
  return [...articles].sort((a, b) => {
    const aText = `${a.title || ''} ${a.relevanceReason || ''}`.toLowerCase();
    const bText = `${b.title || ''} ${b.relevanceReason || ''}`.toLowerCase();
    const aScore = HIGH_PRIORITY_KEYWORDS.some((kw) => aText.includes(kw)) ? 2 : (a.relevant ? 1 : 0);
    const bScore = HIGH_PRIORITY_KEYWORDS.some((kw) => bText.includes(kw)) ? 2 : (b.relevant ? 1 : 0);
    if (aScore !== bScore) return bScore - aScore;
    return new Date(b.scrapedAt || 0).getTime() - new Date(a.scrapedAt || 0).getTime();
  });
}

async function runNewsScrape() {
  if (scrapeInProgress) {
    throw new Error('A news scrape is already in progress.');
  }
  scrapeInProgress = true;
  try {
    const rawArticles = await scrapeAllSources();

    const d = store.load();
    const existingUrls = new Set((d.newsArticles || []).map((a) => a.url));
    const seenThisRun = new Set();
    const newArticles = [];
    for (const article of rawArticles) {
      if (existingUrls.has(article.url) || seenThisRun.has(article.url)) continue;
      seenThisRun.add(article.url);
      newArticles.push(article);
    }

    // Round-robin across sources rather than a plain slice() off the front
    // of the flattened list — caught live: adding 3 sources at once, the
    // first source's ~50 articles filled the entire MAX_TO_SCORE_PER_RUN
    // cap before the other two sources got a single article scored in that
    // run. This still bounds total work to the same cap, it just can't let
    // one large source starve the others within a single run.
    const toScore = roundRobinBySource(newArticles, MAX_TO_SCORE_PER_RUN);
    const scored = [];
    for (const article of toScore) {
      const { relevant, reason } = await scoreRelevance(article, d.newsInterests);
      scored.push({
        id: `news-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: article.title,
        url: article.url,
        sourceId: article.sourceId,
        sourceName: article.sourceName,
        sourceType: article.sourceType || 'web',
        videoId: article.videoId,
        relevant,
        relevanceReason: reason,
        scrapedAt: new Date().toISOString()
      });
    }

    const dd = store.load();
    dd.newsArticles = sortNewsArticlesByPriority([...scored, ...(dd.newsArticles || [])]).slice(0, MAX_NEWS_ARTICLES);
    dd.lastNewsScrapeAt = new Date().toISOString();
    store.save(dd);

    // Video learning happens after articles are already saved — a slow or
    // failed transcript/summarization pass shouldn't hold back or risk the
    // feed update itself, which is the part users are actually waiting on.
    const relevantVideos = scored.filter((a) => a.relevant && a.sourceType === 'youtube').slice(0, MAX_VIDEOS_TO_LEARN_PER_RUN);
    let videosLearned = 0;
    for (const video of relevantVideos) {
      const ok = await extractVideoKnowledge(video);
      if (ok) videosLearned++;
    }

    return {
      sourcesScraped: (d.newsSources || []).length,
      rawArticlesFound: rawArticles.length,
      newArticlesScored: scored.length,
      relevantCount: scored.filter((a) => a.relevant).length,
      videosLearned
    };
  } finally {
    scrapeInProgress = false;
  }
}

module.exports = {
  scrapeAllSources,
  scrapeSource,
  scrapeRssSource,
  parseStandardRssFeed,
  scoreRelevance,
  runNewsScrape,
  isNewsScrapeInProgress,
  resolveYouTubeChannelId,
  scrapeYouTubeChannel,
  extractVideoKnowledge,
  normalizeNewsSources
};
