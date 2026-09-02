// Hybrid (BM25 Sparse + Vector Dense + RRF) relevance scoring for learnedKnowledge,
// inspired by RAGFlow's hybrid retrieval architecture, with an age-decay factor so older
// auto-researched entries naturally prioritize fresher knowledge.
const store = require('./store.cjs');
const { getEmbedding, cosineSimilarity } = require('./confidenceEscalation.cjs');
const { hybridSearch, BM25Index, tokenize, reciprocalRankFusion, extractSnippet } = require('./hybridRetriever.cjs');

const MAX_RELEVANT_ENTRIES = 3;
const MIN_RELEVANCE_SCORE = 0.005;
const DECAY_RATE = 0.02;

function keywordOverlap(a, b) {
  const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits++;
  return hits / Math.max(wa.size, wb.size);
}

function daysSince(iso) {
  if (!iso) return 0;
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 86400000);
}

async function getRelevantKnowledge(question) {
  const cleanQuestion = (question || '').trim();
  if (!cleanQuestion) return [];
  const d = store.load();
  const entries = d.learnedKnowledge || [];
  if (entries.length === 0) return [];

  // Map learnedKnowledge into hybrid retriever format with text representation
  const corpus = entries.map((e, idx) => ({
    id: e.id || `learned-${idx}`,
    text: `${e.topic || ''} ${e.summary || ''} ${(e.sources || []).join(' ')}`,
    topic: e.topic,
    summary: e.summary,
    savedAt: e.savedAt,
    embedding: e.embedding,
    original: e
  }));

  const results = await hybridSearch(cleanQuestion, corpus, {
    topK: MAX_RELEVANT_ENTRIES * 2,
    minScore: MIN_RELEVANCE_SCORE
  });

  // Apply recency decay to RRF score
  const decayed = results.map(r => {
    const entry = r.entry.original || r.entry;
    const decay = Math.exp(-DECAY_RATE * daysSince(entry.savedAt));
    return {
      entry,
      score: r.rrfScore * decay,
      matchType: r.matchType,
      citationTag: r.citationTag,
      snippet: r.snippet
    };
  });

  return decayed
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RELEVANT_ENTRIES)
    .map(d => d.entry);
}

// Computes and attaches the embedding a learnedKnowledge entry needs for
// future vector scoring above
async function embedKnowledgeEntry(entry) {
  const embedding = await getEmbedding(`${entry.topic} ${entry.summary}`);
  return { ...entry, embedding: embedding || null };
}

module.exports = {
  getRelevantKnowledge,
  embedKnowledgeEntry,
  keywordOverlap,
  hybridSearch
};
